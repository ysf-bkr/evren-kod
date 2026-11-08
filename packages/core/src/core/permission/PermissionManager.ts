import * as path from 'path';
import { realpathSync } from 'fs';
import { EVREN_KOD_DIR, EVREN_KOD_FILES } from '../../shared/constants';
import * as fs from 'fs/promises';
import { ToolName, UserSettings } from '../../shared/types';
import { isRecord } from '../../shared/errors';
import { assessCommand, describeAssessment } from '../../shared/commandPolicy';
import { isFlowMetadataTool, policyFor, targetPathFor } from './toolPolicy';
import { autonomyLevel } from '../agent/autonomy';
import { isBroadPattern, matchCommandPattern, matchPathPattern } from './patterns';

/** Çalışma alanını değiştirebilen politika türleri; bozuk izin dosyası bunları engeller. */
const MUTATING_POLICIES = new Set(['write', 'git-write', 'command']);

/** CI iş akışları depo gizli anahtarlarıyla çalışır; yazımı her zaman açık onay ister. */
function isCiWorkflowPath(relativePath: string): boolean {
  return /\.github\/workflows\//i.test(relativePath.replace(/^\/+/, ''));
}

/**
 * İçeriği açık onay olmadan okunmaması gereken dosyalar.
 * Bilgi tabanı indeksleyicisinin `SENSITIVE_PATTERNS` listesiyle aynı
 * hassasiyeti taşır; aksi hâlde indekse girmeyen bir dosya `read_file`
 * ile onaysız okunabiliyordu.
 */
const PROTECTED_READ_PATHS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*.keystore',
  'id_rsa',
  'id_rsa.*',
  'id_dsa*',
  'id_ecdsa*',
  'id_ed25519*',
  '.npmrc',
  '.pypirc',
  '.git/**',
  '**/.git/**',
  'secrets/**',
  'secrets.*',
  'secret/**',
  'credentials/**',
  'credentials.*',
  'credential/**'
];

/** Kod çalıştırma izni veren ya da güvenliği gevşeten dosyalar; ajan bunlara asla otomatik yazmaz. */
const PROTECTED_WRITE_PATHS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'id_rsa',
  'id_rsa.*',
  '.git/**',
  '.evren-kod/hooks.json',
  '.evren-kod/mcp_config.json',
  '.evren-kod/permissions.json',
  'evren-kod.permissions.json',
  'opencode.json',
  'mcp_config.json',
  '.mcp.json',
  'AGENTS.md',
  '.agents/**'
];

export interface ProjectPermissionsConfig {
  allow?: {
    readFiles?: string[];
    writeFiles?: string[];
    commands?: string[];
  };
  deny?: {
    readFiles?: string[];
    writeFiles?: string[];
    commands?: string[];
  };
  autoApprove?: {
    readFiles?: boolean;
    writeFiles?: boolean;
    executeCommands?: boolean;
  };
}

export class PermissionManager {
  private projectPermissions?: ProjectPermissionsConfig;
  private workspaceRoot?: string;
  private configError?: string;
  private workspaceTrusted = true;

  constructor(private settings: UserSettings) {}

  public updateSettings(settings: UserSettings) {
    this.settings = settings;
  }

  /**
   * Proje izinleri deponun kendisinden gelir, bu yüzden yalnızca güvenilir
   * çalışma alanında dikkate alınır. Güvenilmeyen çalışma alanları kullanıcının
   * global ayarlarına döner (deny ve hassas dosya kuralları yine geçerlidir).
   */
  public async loadProjectPermissions(workspaceRoot?: string, workspaceTrusted = true): Promise<void> {
    this.projectPermissions = undefined;
    this.configError = undefined;
    this.workspaceRoot = workspaceRoot;
    this.workspaceTrusted = workspaceTrusted;
    if (!workspaceRoot) return;

    const possiblePaths = [
      path.join(workspaceRoot, EVREN_KOD_DIR, EVREN_KOD_FILES.permissions),
      path.join(workspaceRoot, 'evren-kod.permissions.json'),
      path.join(workspaceRoot, 'opencode.json')
    ];

    for (const p of possiblePaths) {
      let raw: string;
      try {
        raw = await fs.readFile(p, 'utf-8');
      } catch {
        continue; // File does not exist; try the next candidate.
      }

      try {
        this.projectPermissions = this.sanitizeConfig(JSON.parse(raw));
      } catch {
        // Bu dosya varsa ama geçersizse daha zayıf bir dosyaya düşme.
        this.configError = `Invalid permission file: ${p}`;
      }
      break;
    }
  }

  /**
   * Deny/allow kuralları eşleşmeden önce yolları çalışma alanına göre
   * normalize eder. Böylece "./secret/x" ile mutlak çalışma alanı yolu aynı kalıba uyar.
   */
  private normalizeTarget(target: string): string {
    let value = String(target || '')
      .replace(/\\/g, '/')
      .trim();
    if (!value) return '';

    if (this.workspaceRoot) {
      const absolute = path.isAbsolute(value) ? value : path.resolve(this.workspaceRoot, value);
      const relative = path.relative(this.workspaceRoot, absolute).replace(/\\/g, '/');
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        value = relative;
      } else if (path.isAbsolute(value)) {
        value = value.replace(/\\/g, '/');
      }
    }

    return value.replace(/^\.\//, '').replace(/\/+/g, '/');
  }

  /**
   * Bozuk permissions.json değerlerinin ajan döngüsünü çökertmesini önler;
   * yalnızca geçerli dizi ve boolean alanlar kabul edilir.
   */
  private sanitizeConfig(input: unknown): ProjectPermissionsConfig {
    const list = (value: unknown): string[] | undefined =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
    const bool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

    const config: ProjectPermissionsConfig = {};
    if (!isRecord(input)) return config;

    if (isRecord(input.allow)) {
      config.allow = {
        readFiles: list(input.allow.readFiles),
        writeFiles: list(input.allow.writeFiles),
        commands: list(input.allow.commands)
      };
    }
    if (isRecord(input.deny)) {
      config.deny = {
        readFiles: list(input.deny.readFiles),
        writeFiles: list(input.deny.writeFiles),
        commands: list(input.deny.commands)
      };
    }
    if (isRecord(input.autoApprove)) {
      config.autoApprove = {
        readFiles: bool(input.autoApprove.readFiles),
        writeFiles: bool(input.autoApprove.writeFiles),
        executeCommands: bool(input.autoApprove.executeCommands)
      };
    }

    return config;
  }

  /**
   * Hedefin, sembolik bağlar çözüldükten sonraki çalışma alanı göreli yolu.
   *
   * İzin kuralları istenen yolun adıyla eşleşiyor; kök içinde kalan bir
   * symlink (`alias.txt -> .env`) hassas hedefe alternatif ad sağlıyordu.
   * Dosya henüz yoksa en yakın var olan üst dizin kanonikleştirilir ve
   * kalan parçalar yeniden eklenir (denetim bulgusu F03).
   */
  private realRelativeTarget(target: string): string | undefined {
    if (!this.workspaceRoot) return undefined;
    const absolute = path.isAbsolute(target) ? target : path.resolve(this.workspaceRoot, target);

    let real: string | undefined;
    try {
      real = realpathSync(absolute);
    } catch {
      // Dosya yok: en yakın var olan üst dizini kanonikleştir.
      let current = path.dirname(absolute);
      const tail: string[] = [];
      while (current !== path.dirname(current)) {
        try {
          const canonicalDir = realpathSync(current);
          real = tail.length > 0 ? path.join(canonicalDir, ...tail) : canonicalDir;
          break;
        } catch {
          tail.unshift(path.basename(current));
          current = path.dirname(current);
        }
      }
    }
    if (!real) return undefined;

    let rootReal = this.workspaceRoot;
    try {
      rootReal = realpathSync(this.workspaceRoot);
    } catch {
      // Kök çözümlenemiyorsa olduğu gibi kullan.
    }

    const relative = path.relative(rootReal, real).replace(/\\/g, '/');
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    return relative.replace(/^\.\//, '');
  }

  /**
   * İzin eşleştirmesinde denetlenecek yol adayları: normalize edilmiş istenen
   * yol ve kanonik gerçek hedef. Symlink ve büyük/küçük harf farkları iki
   * adayda da yakalanır.
   */
  private targetCandidates(target: string): string[] {
    const normalized = this.normalizeTarget(target);
    const candidates = new Set<string>();
    if (normalized) candidates.add(normalized);
    const real = this.realRelativeTarget(target);
    if (real) candidates.add(real);
    return [...candidates];
  }

  /**
   * Aracın güvenlik kurallarıyla tamamen engellenip engellenmediği.
   */
  public isToolBlocked(
    toolName: ToolName,
    args: Record<string, unknown>
  ): { blocked: boolean; reason?: string } {
    const deny = this.projectPermissions?.deny;
    const rawTarget = String(args.path || args.skill_name || '');
    const targetPath = this.normalizeTarget(rawTarget);

    const readTools: ToolName[] = [
      'read_file',
      'list_directory',
      'search_files',
      'read_skill',
      'get_diagnostics',
      'get_definition',
      'get_hover',
      'get_references',
      'get_workspace_symbols',
      'index_workspace',
      'find_symbol',
      'analyze_impact',
      'knowledge_graph',
      'graph_callers',
      'graph_callees',
      'graph_impact',
      'graph_search',
      'get_callers',
      'get_callees',
      'call_graph_impact',
      'find_related_code',
      'prepare_pr',
      'search_memory',
      'read_notebook',
      'git_status',
      'git_diff'
    ];

    if (readTools.includes(toolName) && targetPath) {
      // Hassas dosya ve deny kuralları istenen adla VE kanonik gerçek hedefle
      // eşleşir; kök içindeki symlink alternatif adları aşılamaz (F03/F04).
      const candidates = this.targetCandidates(rawTarget);
      for (const candidate of candidates) {
        const criticalRead = PROTECTED_READ_PATHS;
        if (criticalRead.some((glob) => matchPathPattern(glob.toLowerCase(), candidate.toLowerCase()))) {
          return {
            blocked: true,
            reason: `Security: Reading "${candidate}" is blocked because it is a sensitive file.`
          };
        }
      }

      if (deny?.readFiles) {
        for (const candidate of candidates) {
          for (const glob of deny.readFiles) {
            if (matchPathPattern(glob, candidate)) {
              return {
                blocked: true,
                reason: `Reading "${candidate}" is blocked by the .evren-kod/permissions.json rule.`
              };
            }
          }
        }
      }
    }

    if (toolName === 'write_file' || toolName === 'edit_file') {
      const candidates = targetPath ? this.targetCandidates(rawTarget) : [];

      // Varsayılan hassas dosya koruması deny kurallarından bağımsız uygulanır.
      for (const p of candidates) {
        if (PROTECTED_WRITE_PATHS.some((glob) => matchPathPattern(glob.toLowerCase(), p.toLowerCase()))) {
          return {
            blocked: true,
            reason: `Security: Writing to "${p}" is blocked by default because it is a sensitive file.`
          };
        }
      }

      if (deny?.writeFiles) {
        for (const p of candidates) {
          for (const glob of deny.writeFiles) {
            if (matchPathPattern(glob, p)) {
              return {
                blocked: true,
                reason: `Writing to "${p}" is blocked by the .evren-kod/permissions.json rule.`
              };
            }
          }
        }
      }
    }

    if (
      toolName === 'execute_command' ||
      toolName === 'run_tests' ||
      toolName === 'run_linter' ||
      toolName === 'run_verification'
    ) {
      const cmd = String(args.command || '').trim();
      const assessment = assessCommand(cmd, this.workspaceRoot);
      if (assessment.risk === 'blocked') {
        return {
          blocked: true,
          reason: `Security: blocked destructive command (${describeAssessment(assessment)}).`
        };
      }

      if (deny?.commands) {
        for (const glob of deny.commands) {
          if (matchCommandPattern(glob, cmd)) {
            return {
              blocked: true,
              reason: `The command "${cmd}" is blocked by the .evren-kod/permissions.json rule.`
            };
          }
        }
      }
    }

    return { blocked: false };
  }

  /**
   * Bir çalışma alanı izin dosyası kullanıcının global otomatik onay
   * tercihlerini daraltabilir ama asla genişletemez. Aksi hâlde kötü niyetli
   * bir depo `.evren-kod/permissions.json` içine `autoApprove.executeCommands: true`
   * koyup kullanıcının bilinçli olarak elle bıraktığı komutları sessizce çalıştırabilirdi.
   */
  private effectiveAutoApprove(projectValue: boolean | undefined, globalValue: boolean): boolean {
    if (!globalValue) return false;
    return projectValue !== false;
  }

  /**
   * Proje allow listesi var ama hedefi kapsamıyorsa doğrudur.
   *
   * Liste, kullanıcının ana otomatik onay anahtarından *sonra* uygulanan bir
   * filtredir; yalnızca ajanın daha sık sormasına yol açabilir. Her şeyi
   * yakalayan kalıplar yok sayılır: genel bir izne dönüşemezler.
   */
  private isNarrowedByAllowList(patterns: string[] | undefined, target: string | undefined): boolean {
    const usable = (patterns || []).filter((pattern) => !isBroadPattern(pattern));
    if (usable.length === 0) return false;
    if (!target) return true;
    return !usable.some((pattern) => matchPathPattern(pattern, target));
  }

  private get activeProjectPermissions(): ProjectPermissionsConfig | undefined {
    return this.workspaceTrusted ? this.projectPermissions : undefined;
  }

  public requiresApproval(toolName: ToolName, args: Record<string, unknown>): boolean {
    if (this.configError && MUTATING_POLICIES.has(policyFor(toolName))) {
      return true;
    }

    const allow = this.activeProjectPermissions?.allow;
    const projectAuto = this.activeProjectPermissions?.autoApprove;
    const targetPath = this.normalizeTarget(targetPathFor(toolName, args));
    // Otonomi seviyesi onay motorunu da şekillendirir: "Otonom" seçiliyse
    // olağan dosya yazma ve güvenli komutlar otomatik onaylı sayılır;aksi
    // hâlde seviye sözü tutmuyor, her yazma kartı görevi durduruyordu.
    // Güvenlik sınırları seviyeden BAĞIMSIZ durur: riskli/bilinmeyen komut,
    // engelli komut, hassas dosya ve 'always' araçları her seviyede sorar.
    const level = autonomyLevel(this.settings);
    const autonomous = level === 'auto';

    switch (policyFor(toolName)) {
      case 'read': {
        // Öncelik: deny (isToolBlocked) > ana otomatik onay > allow filtresi.
        // Proje dosyası kullanıcı tercihini daraltabilir, asla genişletemez.
        const autoRead =
          autonomous ||
          this.effectiveAutoApprove(projectAuto?.readFiles, this.settings.autoApprove.readFiles);
        if (!autoRead) return true;
        return this.isNarrowedByAllowList(allow?.readFiles, targetPath);
      }

      case 'write': {
        // Akış üst verisi (spec taslağı, kriter işaretleme) yalnızca
        // `.evren-kod/specs/` altına dokunur. Yazma otomatik onayı kapalı olsa bile
        // onay istemez; aksi hâlde spec onay kartı hiç görünmez ve ajan
        // `write_spec` için 10 dakikalık onay zaman aşımını bekler.
        if (isFlowMetadataTool(toolName)) return false;
        // GitHub iş akışları depo sırlarıyla (secrets) çalışır; otonom modda
        // bile sessizce yazılmaz, açık onay ister (denetim bulgusu M1).
        if (targetPath && isCiWorkflowPath(targetPath)) return true;
        // "Yönlendirilmiş" seviyesinin sözü: yazma öncesi her zaman sorulur.
        if (level === 'guided') return true;
        const autoWrite =
          autonomous ||
          this.effectiveAutoApprove(projectAuto?.writeFiles, this.settings.autoApprove.writeFiles);
        if (!autoWrite) return true;
        return this.isNarrowedByAllowList(allow?.writeFiles, targetPath);
      }

      case 'git-write':
        return !(
          autonomous ||
          this.effectiveAutoApprove(projectAuto?.writeFiles, this.settings.autoApprove.writeFiles)
        );

      case 'always':
        return true;

      case 'delegate': {
        // Devretme akış adımıdır: otonom/yönlendirilmiş modda kullanıcıyı
        // bekletmez. Alt ajanın kendi yazma/komut çağrıları ayrıca onaya
        // tabidir, bu yüzden burada güvenlik gevşemesi oluşmaz.
        return level === 'manual';
      }

      case 'never':
        return false;

      case 'command': {
        const cmd = String(args.command || '');
        const assessment = assessCommand(cmd, this.workspaceRoot);

        // Komut politikası allow listesi tabanlıdır: bilinen güvenli olmayan her
        // komut (yıkıcı, alıntı hileleri ya da tamamen bilinmeyen) otomatik onay ya da
        // proje allow listesi açık olsa bile açık, komut bazlı onay ister.
        if (assessment.risk === 'blocked') {
          return true;
        }

        const autoCmd =
          autonomous ||
          this.effectiveAutoApprove(projectAuto?.executeCommands, this.settings.autoApprove.executeCommands);
        if (!autoCmd) {
          return true;
        }

        if (assessment.risk === 'risky') {
          return true;
        }

        // Proje allow listesi hangi güvenli komutların otomatik çalışacağını
        // daraltabilir; kullanıcının elle onayını asla geri açamaz.
        const usable = (allow?.commands || []).filter((pattern) => !isBroadPattern(pattern));
        if (usable.length > 0 && !usable.some((pattern) => matchCommandPattern(pattern, cmd))) {
          return true;
        }
        return false;
      }

      default:
        // Bilinmeyen araçlar güvenli tarafta kalır. Politikası eklenmeden kayıt
        // defterine eklenen yeni bir araç bir şey yapmadan önce onay ister.
        return true;
    }
  }

  /**
   * Bir aracın neden hâlâ onay istediği; doğrudan arayüzde gösterilecek biçimde.
   *
   * Kullanıcı tüm otomatik onay anahtarlarını açsa bile sorulabilir; çünkü bir
   * proje izin dosyası ayarı daraltıyordur ya da komut her zaman risklidir. Bu
   * açıklama olmadan onay hata gibi görünür.
   */
  public explainApproval(toolName: ToolName, args: Record<string, unknown>): string | undefined {
    if (!this.requiresApproval(toolName, args)) return undefined;

    if (this.configError) {
      return `İzin dosyası okunamadı (${this.configError}); güvenlik için her işlem onay ister.`;
    }

    const projectAuto = this.activeProjectPermissions?.autoApprove;
    const isWriteTool = toolName === 'write_file' || toolName === 'edit_file' || toolName === 'write_spec';
    const isCommandTool =
      toolName === 'execute_command' ||
      toolName === 'run_tests' ||
      toolName === 'run_linter' ||
      toolName === 'run_verification';

    if (toolName === 'add_knowledge_note') {
      return "Bilgi tabanı notları sonraki tüm görevlerin prompt'una girdiği için açık kullanıcı onayı gerekir.";
    }

    if (toolName === 'write_knowledge_file') {
      return "Bilgi dosyaları (project/conventions/decisions) sonraki tüm görevlerin prompt'una girdiği için açık kullanıcı onayı gerekir.";
    }

    if (isWriteTool) {
      if (autonomyLevel(this.settings) === 'guided') {
        return 'Otonomi seviyesi "Yönlendirilmiş": yazma öncesi onay her zaman istenir; otomatik olması için seviyeyi "Otonom" yapın.';
      }
      if (this.settings.autoApprove.writeFiles && projectAuto?.writeFiles === false) {
        return 'Proje izin dosyası (.evren-kod/permissions.json) yazma otomatik onayını kapatıyor; dosyadaki autoApprove.writeFiles değerini kaldırın veya true yapın.';
      }
      return 'Ayarlar ekranında "Dosya yazma/düzenleme" otomatik onayı kapalı.';
    }

    if (isCommandTool) {
      const assessment = assessCommand(String(args.command || ''), this.workspaceRoot);
      if (assessment.risk === 'risky' || assessment.risk === 'blocked') {
        return 'Riskli komutlar güvenlik için her zaman açık onay ister.';
      }
      if (this.settings.autoApprove.executeCommands && projectAuto?.executeCommands === false) {
        return 'Proje izin dosyası (.evren-kod/permissions.json) komut otomatik onayını kapatıyor; dosyadaki autoApprove.executeCommands değerini kaldırın veya true yapın.';
      }
      return 'Ayarlar ekranında "Terminal komutları" otomatik onayı kapalı.';
    }

    if (toolName === 'web_fetch' || toolName === 'web_search') {
      return 'Bu araç türü tasarımdan dolayı her zaman onay ister (ağ erişimi).';
    }

    if (toolName === 'invoke_subagent' || toolName === 'run_parallel_tasks') {
      return 'Görev devri elle modda onay ister; otonomi açıkken akışı durdurmaz. Alt ajanın yazma/komut işlemleri yine onaya tabidir.';
    }

    return 'Bu araç onay gerektiriyor.';
  }

  public getToolExplanation(toolName: ToolName, args: Record<string, unknown>): string {
    switch (toolName) {
      case 'read_file':
        return `"${args.path}" dosyasını oku.`;
      case 'write_file':
        return `"${args.path}" dosyasını oluştur veya yaz.`;
      case 'edit_file':
        return `"${args.path}" dosyasını düzenle.`;
      case 'execute_command': {
        const command = String(args.command || '');
        const chained = /[;&|<>`\n]|\$\(/.test(command);
        return (
          `\`${command}\` terminal komutunu çalıştır.` +
          (chained ? ' (komut zinciri veya boru hattı içeriyor; ek komutlar çalışabilir)' : '')
        );
      }
      case 'run_tests':
        return 'Testleri çalıştır.';
      case 'run_linter':
        return 'Kod denetleyicisini (linter) çalıştır.';
      case 'run_verification':
        return 'Değişiklikleri test, lint ve tip denetimleriyle doğrula.';
      case 'update_plan':
        return 'Görev planını güncelle.';
      case 'update_module_plan':
        return 'İşi katmanlı modüllere ayır (katman, yollar, sorumluluk, bağımlılıklar, sahip rol).';
      case 'get_references':
        return 'Sembolün tüm kullanımlarını bul.';
      case 'get_workspace_symbols':
        return `Çalışma alanı sembollerinde "${args.query || ''}" ara.`;
      case 'index_workspace':
        return 'Kod tabanı sembol indeksini oluştur.';
      case 'find_symbol':
        return `"${args.query || ''}" sembolünü ara.`;
      case 'analyze_impact':
        return `"${args.symbol || ''}" sembolünden etkilenen dosyaları analiz et.`;
      case 'knowledge_graph':
        return `Bilgi grafiğini sorgula ("${args.focus || args.mode || 'mimari'}").`;
      case 'graph_callers':
      case 'graph_callees':
      case 'get_callers':
      case 'get_callees':
        return `"${args.symbol || ''}" için çağrı ilişkilerini oku.`;
      case 'graph_impact':
      case 'call_graph_impact':
        return `"${(args.symbols as string[] | undefined)?.join(', ') || ''}" etki alanını analiz et.`;
      case 'graph_search':
      case 'find_related_code':
        return `Bilgi grafiğinde "${args.query || ''}" ara.`;
      case 'graph_status':
      case 'call_graph_status':
        return 'Bilgi grafiği hazırlık durumunu oku.';
      case 'git_create_branch':
        return `"${args.name || ''}" adında yeni bir Git dalı oluştur.`;
      case 'git_commit':
        return "Değişiklikleri Git commit'i olarak kaydet.";
      case 'prepare_pr':
        return 'PR (Pull Request) açıklamasını hazırla.';
      case 'web_fetch':
        return `"${args.url || ''}" adresinden içerik getir.`;
      case 'web_search':
        return `Web'de "${args.query || ''}" ara.`;
      case 'search_memory':
        return 'Proje hafızasını ara.';
      case 'read_notebook':
        return 'Jupyter defteri içeriğini oku.';
      case 'run_parallel_tasks':
        return 'Birden fazla alt ajanı paralel çalıştır.';
      case 'merge_worktree':
        return 'İzole worktree değişikliklerini ana çalışma alanına aktar.';
      case 'invoke_subagent':
        return `Görevi "${args.role}" alt ajanına devret: ${String(args.task || '').slice(0, 200)}`;
      case 'read_skill':
        return `"${args.skill_name}" becerisi yönergelerini oku.`;
      case 'write_knowledge_file':
        return `"${args.file || ''}.md" bilgi dosyasının içeriğini kullanıcı onayına sun.`;
      case 'search_files':
        return `Proje dosyalarında "${args.query}" ara.`;
      case 'list_directory':
        return `"${args.path || '.'}" dizinini listele.`;
      case 'git_diff':
        return 'Git değişikliklerini (diff) incele.';
      case 'get_diagnostics':
        return 'Derleyici ve linter tanılarını incele.';
      case 'undo_change':
        return 'En son dosya değişikliğini geri al.';
      default:
        return `"${toolName}" aracını çalıştır.`;
    }
  }

  public async createTemplatePermissions(workspaceRoot: string): Promise<string> {
    const dir = path.join(workspaceRoot, EVREN_KOD_DIR);
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, 'permissions.json');

    const template: ProjectPermissionsConfig = {
      allow: {
        readFiles: ['**/*'],
        writeFiles: ['src/**/*', 'tests/**/*', 'webview-ui/**/*'],
        commands: [
          'npm test*',
          'npm run build*',
          'npm run lint*',
          'npm run typecheck*',
          'git status*',
          'git diff*'
        ]
      },
      deny: {
        writeFiles: ['.env*', '**/*.pem', '**/*.key', 'package-lock.json'],
        commands: ['rm -rf /*', 'git push*', 'mkfs*']
      },
      autoApprove: {
        readFiles: true,
        writeFiles: false,
        executeCommands: false
      }
    };

    await fs.writeFile(target, JSON.stringify(template, null, 2), 'utf-8');
    return target;
  }
}
