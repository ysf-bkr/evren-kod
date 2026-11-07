/**
 * Yönlendirilmiş iş akışı denetleyicisi.
 *
 * Aşama geçişleri, spec/plan onay kapıları ve tur sonu ilerleme burada.
 * Kapılar `@core/workflow/TaskWorkflow` içindeki saf fonksiyonlardan gelir;
 * bu sınıf yalnızca yan etkileri (durum, kalıcılık, arayüz) uygular.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ToolCall, ReleaseGateRecord, ReviewedFileEvidence } from '@evren-kod/core/shared/types';
import {
  canTransition,
  createWorkflowState,
  gateForStage,
  stageLabel,
  stageOrderForMode,
  WorkflowStage,
  WorkflowState
} from '@evren-kod/core/core/workflow/TaskWorkflow';
import {
  computeChangesDigest,
  evaluateReleaseGate,
  formatGateRecord,
  machineCheckPass,
  GateWorldSnapshot
} from '@evren-kod/core/core/gate/ReleaseGate';
import { ReleaseGatePort } from '@evren-kod/core/tools/contracts';
import { errorMessage } from '@evren-kod/core/shared/errors';
import { isReadOnlyMode } from '@evren-kod/core/core/agent/modeTools';
import { logWarning } from '@evren-kod/core/shared/logging';
import { rolesForChangedFiles } from '@evren-kod/core/shared/agents/routing';
import { ROLE_ALIASES } from '@evren-kod/core/shared/agents';
import {
  markReviewed,
  normalizeFile,
  recordWrites,
  unreviewedFiles,
  verifyLedgerFreshness,
  computeWorldSnapshotId,
  SHADOW_REVIEW_HASH,
  type FileFingerprint
} from '@evren-kod/core/core/gate/ReviewLedger';
import { skipsApprovalGates } from '@evren-kod/core/core/agent/autonomy';
import { getActiveWorkspaceRoot } from '../workspace/workspaceRoot';
import type { TaskSpec } from '@evren-kod/core/core/spec/SpecStore';
import { checkSpecCoverage } from '@evren-kod/core/core/spec/SpecStore';
import type { TaskPlan } from '@evren-kod/core/shared/types';
import type { AgentHost } from './agentHost';
import { publishVerificationStats } from './verificationController';

export class WorkflowController {
  constructor(private host: AgentHost) {}

  /**
   * Onay kapısından çıkan ortak kapanış: bekleme temizlenir, ajan idle'a
   * döner, durum diske ve arayüze yansır, bilgi bildirimi gösterilir.
   */
  private async idleAfterApproval(message: string): Promise<void> {
    this.host.state.pendingApproval = undefined;
    this.host.state.status = 'idle';
    this.syncProgressToState();
    await this.host.saveCurrentState();
    this.host.emitState();
    this.host.notify({ level: 'info', message });
  }

  /**
   * Kabul kriterleri eksik spec onayını reddeder: sistem mesajı kaydedilir,
   * ajan idle'a döner ve uyarı gösterilir. Etkileşimli ve otonom onay aynı
   * kapıyı kullanır.
   */
  private async rejectSpecApproval(message: string, syncProgress: boolean): Promise<void> {
    this.host.state.pendingApproval = undefined;
    this.host.state.status = 'idle';
    this.host.state.messages.push({
      id: this.host.nextMessageId(),
      role: 'system',
      content: message,
      timestamp: Date.now()
    });
    if (syncProgress) {
      this.syncProgressToState();
    }
    await this.host.saveCurrentState();
    this.host.emitState();
    this.host.notify({ level: 'warning', message });
  }

  public getWorkflow(): WorkflowState {
    const existing = this.host.state.workflow;
    if (existing) return existing;
    const created = createWorkflowState();
    this.host.state.workflow = created;
    return created;
  }

  /**
   * İş akışını, spec'i ve bilgi durumunu TaskState'e yansıtır ki webview
   * bunları ekstra gidiş dönüş olmadan görüntüleyebilsin.
   */
  public syncProgressToState(): void {
    const workflow = this.getWorkflow();
    this.host.state.workflow = workflow;

    // Modül haritası arayüzde ayrı bir bölüm olarak gösterilir.
    this.host.state.modules = this.host.modulePlanner.getPlan();

    // Yalnızca bu iş akışına bağlı spec gösterilir. Herhangi bir onaylı
    // spece geri düşmek, temiz bir oturumda önceki görevin spec'ini gösteriyordu.
    const spec = workflow.specId ? this.host.specStore.get(workflow.specId) : undefined;
    this.host.state.spec = spec
      ? {
          id: spec.id,
          goal: spec.goal,
          scope: spec.scope,
          outOfScope: spec.outOfScope,
          assumptions: spec.assumptions,
          acceptanceCriteria: spec.acceptanceCriteria.map((criterion) => ({
            id: criterion.id,
            text: criterion.text,
            done: criterion.done
          })),
          files: spec.files,
          risk: spec.risk,
          status: spec.status
        }
      : undefined;

    const knowledge = this.host.knowledgeStore.getStatus();
    this.host.state.knowledge = {
      ready: knowledge.ready,
      fileCount: knowledge.fileCount,
      symbolCount: knowledge.symbolCount,
      summarizedCount: knowledge.summarizedCount,
      indexedAt: knowledge.indexedAt,
      lastCommit: knowledge.lastCommit
    };
  }

  /**
   * İş akışı aşaması değişimi ister. Kapılar spec/plan onayını dayatır;
   * model doğrudan kod yazmaya atlayamaz.
   */
  public async setWorkflowStage(stage: WorkflowStage): Promise<{ ok: boolean; reason?: string }> {
    // Tur ortasında elle değişim, araç listesini gerçek aşamadan koparırdı.
    if (this.host.isBusy()) {
      return { ok: false, reason: 'Ajan çalışırken aşama değiştirilemez.' };
    }
    const workflow = this.getWorkflow();
    const transition = canTransition(workflow.stage, stage, this.host.state.mode);
    if (!transition.allowed) {
      return { ok: false, reason: transition.reason };
    }

    const gate = gateForStage(
      stage,
      {
        state: workflow,
        // Kapı bu iş akışının kendi spec'ine göre kapsamlandırılmalı.
        // Depo genelinde bir arama, önceki görevin onaylı spec'inin ilgisiz
        // yeni bir görev için plan ve build aşamalarını açmasına izin verirdi.
        hasApprovedSpec: Boolean(
          workflow.specId && this.host.specStore.get(workflow.specId)?.status === 'approved'
        ),
        hasPlan: this.host.planner.hasPlan(),
        hasModules: this.host.modulePlanner.hasPlan(),
        criteriaMet: this.currentSpecCriteriaMet(),
        verificationPassed: this.verificationPassed(),
        releaseGatePassed: this.evaluateGate().ok
      },
      this.host.state.mode
    );
    if (!gate.allowed) {
      return { ok: false, reason: gate.reason };
    }

    workflow.stage = stage;
    workflow.updatedAt = Date.now();
    workflow.blockedReason = undefined;
    this.syncProgressToState();
    this.host.emitState();
    return { ok: true };
  }

  public currentSpecCriteriaMet(): boolean {
    const specId = this.getWorkflow().specId;
    if (!specId) return false;
    return this.host.specStore.isComplete(specId);
  }

  /**
   * Bitti kapısı için doğrulama yeterli mi?
   *
   * `passed` her zaman yeterlidir. Atlanmış doğrulamada kabul edilen nedenler:
   * - `no-workspace`: komut çalıştırmanın imkânı yok.
   * - `no-commands`: projede test/lint komutu yok; doğrulama yapılamaz olduğu
   *   için kapıyı süresiz bloke edemez (denetim bulgusu: görev asla done
   *   olmuyordu, verify→build→review→verify döngüsü sonsuzlanıyordu).
   * `aborted` ve `failed` kabul edilmez. Kullanıcı autoVerify'i kapattıysa
   * doğrulama onun tercihen atladığı bir adımdır; kapı bunu soru saymaz.
   */
  public verificationPassed(): boolean {
    const verification = this.host.state.stats.verification;
    if (!verification) {
      // Doğrulama hiç çalışmamış: kullanıcı autoVerify'i kapattıysa bu bir
      // tercih, değilse (autoVerify=true ama adım atlanmış) kapalı kalır.
      return this.host.settings.autoVerify === false;
    }
    if (verification.status === 'passed') return true;
    if (verification.status === 'skipped') {
      return verification.skippedReason === 'no-workspace' || verification.skippedReason === 'no-commands';
    }
    return false;
  }

  /**
   * Yayın kapısı servisi: `record_release_gate` aracı bu port üzerinden
   * karar kaydeder. Kayıt anının dünyası (değişen dosyalar, işaretli
   * kriterler, doğrulama durumu) digest'e damgalanır; karardan sonra tek
   * dosya değişse karar bayatlar ve kapı yeniden koşar.
   */
  public readonly releaseGatePort: ReleaseGatePort = {
    record: (input) => this.recordReleaseGate(input),
    evaluate: () => this.evaluateGate(),
    preCommitGuard: () => {
      // Aktif görevi olan iş akışında commit yalnız taze PASS ile geçer;
      // görev dışı (specsiz) hızlı commit'ler kapı kapsamı dışındadır ama
      // araç sonucu dürüstçe "gate dışı" diye etiketlenir.
      const workflow = this.getWorkflow();
      if (!workflow.specId) return { required: false, ok: true };
      const res = this.evaluateGate();
      return { required: true, ok: res.ok, reason: res.reason };
    }
  };

  /** Kapı kararının damgalandığı dünya görünümü. */
  private currentGateWorld(): GateWorldSnapshot {
    const specId = this.getWorkflow().specId;
    const spec = specId ? this.host.specStore.get(specId) : undefined;
    const ledger = this.getWorkflow().reviewLedger ?? [];
    const worldPaths = new Set<string>([
      ...(this.host.state.stats.filesModified ?? []).map(normalizeFile),
      ...ledger.map((entry) => entry.file)
    ]);
    const world = this.fingerprintPaths(worldPaths);
    return {
      files: this.host.state.stats.filesModified ?? [],
      fileContents: [...world.entries()].map(([file, fp]) => ({ path: file, ...fp })),
      criteriaDone: (spec?.acceptanceCriteria ?? []).filter((c) => c.done).map((c) => c.id),
      verificationStatus: this.host.state.stats.verification?.status ?? 'not_run',
      unreviewed: unreviewedFiles(ledger)
    };
  }

  /** Hash'i ölçülemeyecek kadar büyük dosyalar için ortak işaret. */
  private static readonly TOO_LARGE = 'too-large';
  private static readonly MAX_HASH_BYTES = 32 * 1024 * 1024;

  /**
   * Verilen yolların İÇERİK parmak izleri (path → sha256+size). Kanıt
   * üretiminde ve kapı doğrulamasında tek kaynak; mtime kullanılmaz —
   * önbellek de yoktur: aynı mtime'a touch'lanmış değişmiş içerik burada
   * yakalanır. Okunamayan/silinmiş dosyalar haritada YER ALMAZ; bulunmama
   * sinyalinin kendisi doğrulama için bilgidir.
   */
  private fingerprintPaths(paths: Iterable<string>): Map<string, FileFingerprint> {
    const out = new Map<string, FileFingerprint>();
    if (!getActiveWorkspaceRoot()) return out;
    for (const raw of paths) {
      const file = normalizeFile(raw);
      if (!file || file.startsWith('command:') || out.has(file)) continue;
      const fp = this.fingerprintFile(file);
      if (fp) out.set(file, fp);
    }
    return out;
  }

  /**
   * Defteri dünyayla yüzleştirir (fail closed): kanıtsız inceleme kaydı ve
   * içeriği değişmiş inceleme borca döner; diskten düşen yol (geri alınan
   * değişiklik) defterden düşer; defterde izi olmayan değişmiş yol
   * "unattributed" borcu açar. Her kapı değerlendirmesi ve reviewer
   * kapanışı öncesi koşar. Kök yoksa (depolama dışı oturum) varlık/hash
   * denetimi atlanır; kanıtsız kayıt denetimi yine çalışır.
   */
  private reconcileLedger(): string[] {
    const workflow = this.getWorkflow();
    const ledger = workflow.reviewLedger ?? [];
    if (ledger.length === 0) return [];
    const hasRoot = Boolean(getActiveWorkspaceRoot());
    const ledgerPaths = ledger.map((entry) => entry.file).filter((f) => !f.startsWith('command:'));
    const currentFiles = hasRoot ? this.fingerprintPaths(ledgerPaths) : undefined;
    const result = verifyLedgerFreshness(ledger, currentFiles);
    let next = result.ledger;
    // Defterde izi olmayan değişmiş yol: ölçülememiş bir yan etki ya da
    // eski sürüm kaydıdır; kim yazmış olursa olsun bağımsız inceleme borcudur.
    if (hasRoot) {
      const tracked = new Set(next.map((entry) => entry.file));
      const touched = this.fingerprintPaths(this.host.state.stats.filesModified ?? []);
      const untrackedPaths = [...touched.keys()].filter((p) => !tracked.has(p));
      if (untrackedPaths.length > 0) {
        next = recordWrites(next, 'unattributed', untrackedPaths);
      }
    }
    if (result.changed || next !== ledger) {
      workflow.reviewLedger = next;
    }
    return result.reasons;
  }

  /**
   * Denetim defterine yazma olayı işler: yazar rol takma addan çözülen
   * kimliktir; aynı dosya yeniden yazılırsa eski inceleme kararı düşer.
   */
  public recordLedgerWrites(role: string, files: readonly string[]): void {
    const workflow = this.getWorkflow();
    const writer = (ROLE_ALIASES[role.toLowerCase()] || role).toLowerCase();
    workflow.reviewLedger = recordWrites(workflow.reviewLedger ?? [], writer, files);
  }

  /**
   * Bağımsız reviewer turunun tamamlandığını deftere işler. Yalnızca
   * incelemeye yetkili kategoriler (kalite/güvenlik/mimari) sayılır ve
   * kapsama kanıtı şarttır: reviewer yalnızca GERÇEKTEN okuduğu dosyaların
   * borcunu kapatır. Bu genel giriş kanıtı kanıttan üretir: dosyalar o an
   * diskte nasıl görülüyorsa hash'i odur; okunamayan dosya kanıtsız kalır
   * ve borcu kapanmaz (fail closed).
   */
  public recordLedgerReview(reviewer: string, seenFiles: readonly string[]): void {
    const role = (ROLE_ALIASES[reviewer.toLowerCase()] || reviewer).toLowerCase();
    const prints = new Map<string, FileFingerprint>();
    for (const file of seenFiles) {
      const fp = this.fingerprintFile(file);
      if (fp) prints.set(normalizeFile(file), fp);
    }
    this.attachReviewerRun(role, prints);
  }

  /** Tek dosyanın içerik parmak izi; okunamayan/çok büyük dosya undefined. */
  private fingerprintFile(relPath: string): FileFingerprint | undefined {
    const root = getActiveWorkspaceRoot();
    if (!root) return undefined;
    const file = normalizeFile(relPath);
    if (!file || file.startsWith('command:')) return undefined;
    try {
      const stat = fs.statSync(path.join(root, file));
      if (!stat.isFile()) return undefined;
      if (stat.size > WorkflowController.MAX_HASH_BYTES) {
        // Ölçülemez ama boyu bilinen dosya: işaret her iki tarafta da aynı
        // üretildiği için kanıt/denetim karşılaştırması tutarlı kalır.
        return { contentHash: WorkflowController.TOO_LARGE, size: stat.size };
      }
      const hash = crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(root, file)))
        .digest('hex');
      return { contentHash: hash, size: stat.size };
    } catch {
      return undefined;
    }
  }

  /**
   * Kanıt setini deftere işler: okunan her dosya okuma anındaki parmak iziyle
   * damgalanır; tüm kanıtlar aynı dünya snapshot'ına bağlanır. Ölçülemeyen
   * komut borçları (command:*) yalnız tur GERÇEKTEN bir şey okuduysa kapanır.
   */
  private attachReviewerRun(reviewer: string, prints: ReadonlyMap<string, FileFingerprint>): void {
    const workflow = this.getWorkflow();
    this.reconcileLedger();
    const worldPaths = new Set<string>([
      ...(this.host.state.stats.filesModified ?? []),
      ...(workflow.reviewLedger ?? []).map((entry) => entry.file),
      ...prints.keys()
    ]);
    const world = this.fingerprintPaths(worldPaths);
    const snapshotId = computeWorldSnapshotId(world);
    const at = new Date().toISOString();
    const evidence: ReviewedFileEvidence[] = [];
    for (const [file, fp] of prints) {
      evidence.push({
        path: file,
        contentHash: fp.contentHash,
        size: fp.size,
        reviewedAt: at,
        reviewerId: reviewer,
        snapshotId
      });
    }
    if (prints.size > 0) {
      for (const entry of workflow.reviewLedger ?? []) {
        if (entry.file.startsWith('command:') && !entry.reviewedBy && entry.writer !== reviewer) {
          evidence.push({
            path: entry.file,
            contentHash: SHADOW_REVIEW_HASH,
            size: 0,
            reviewedAt: at,
            reviewerId: reviewer,
            snapshotId
          });
        }
      }
    }
    workflow.reviewLedger = markReviewed(workflow.reviewLedger ?? [], reviewer, evidence);
  }

  /**
   * Alt ajan okumalarının oturum-üstü kanıt seti. Kalıcı değildir: yalnızca
   * o an koşan tur için anlamlıdır ve tüketildiğinde silinir. Parmak izi
   * OKUMA ANINDA alınır — yazar okumadan sonra dosyayı değiştirirse kanıt
   * eski içeriği gösterir ve kapı doğrulaması incelemeyi bayat sayar.
   */
  private readonly subagentReads = new Map<string, Map<string, FileFingerprint>>();

  /** Alt uzmanın okuduğu dosyayı inceleme kanıtı olarak biriktirir. */
  public recordLedgerRead(role: string, file: string): void {
    const key = (ROLE_ALIASES[role.toLowerCase()] || role).toLowerCase();
    let reads = this.subagentReads.get(key);
    if (!reads) {
      // Bellek güvenliği: tek rolün okuma kanıtı sınırsız büyümez.
      if (this.subagentReads.size > 32) this.subagentReads.clear();
      reads = new Map();
      this.subagentReads.set(key, reads);
    }
    const normalized = normalizeFile(file);
    const fp = this.fingerprintFile(normalized);
    if (reads.size < 500) {
      if (fp) reads.set(normalized, fp);
      // Okunamayan dosya kanıtsız kalır: borç kapanmaz (fail closed).
    }
  }

  /** Reviewer turu bitti: okuma kanıtını tüketir ve borcu kapsama göre kapatır. */
  public completeReviewerRun(reviewer: string): string[] {
    const key = (ROLE_ALIASES[reviewer.toLowerCase()] || reviewer).toLowerCase();
    const reads = this.subagentReads.get(key);
    this.subagentReads.delete(key);
    const seen = [...(reads?.keys() ?? [])];
    this.attachReviewerRun(key, reads ?? new Map());
    return seen;
  }

  /** İnceleme bekleyen dosyalar; kapı makine denetimi ve talimat metni bunu sorar. */
  public unreviewedChanges(): string[] {
    // Borç listesi sorulurken defter dünyayla tazelenir: kanıtı bayatlamış
    // inceleme burada yeniden borca döner.
    this.reconcileLedger();
    return unreviewedFiles(this.getWorkflow().reviewLedger ?? []);
  }

  /** Taze PASS kararı var mı? `done` kapısı bu cevabı sorar. */
  public evaluateGate(): { ok: boolean; reason?: string } {
    // Önce defteri dünyayla yüzleştir: bayat/kanıtsız inceleme borca döner,
    // borç digest'i kırdığı için eski karar kendiliğinden bayatlar.
    this.reconcileLedger();
    const workflow = this.getWorkflow();
    return evaluateReleaseGate(workflow.releaseGate, {
      currentSpecId: workflow.specId,
      currentDigest: computeChangesDigest(this.currentGateWorld())
    });
  }

  /**
   * Kapı kararını kaydeder. "pass" beyanı makine denetiminden geçer:
   * kriterler eksik ya da doğrulama taze geçmemişse kayıt BLOCK'a çevrilir
   * ve makine gerekçeleri eklenir — modelin iyimserliği kapıyı açamaz.
   */
  private async recordReleaseGate(input: {
    verdict: 'pass' | 'block';
    reasons: string[];
    criteriaEvidence: Array<{ id: string; note: string }>;
    risks: string[];
    rollback: string;
  }): Promise<string> {
    const workflow = this.getWorkflow();
    const specId = workflow.specId;
    if (!specId) {
      return 'Yayın kapısı kaydedilemedi: bu iş akışında aktif bir spec yok.';
    }
    // Kanıt tazeliği karar anında yeniden doğrulanır: bayat inceleme borca
    // döner ve gerekçesi BLOCK satırlarına işlenir.
    const staleReasons = this.reconcileLedger();
    let verdict = input.verdict;
    const reasons = [...input.reasons, ...staleReasons];
    if (verdict === 'pass') {
      const failures = machineCheckPass({
        hasSpec: this.host.specStore.get(specId)?.status === 'approved',
        criteriaMet: this.currentSpecCriteriaMet(),
        verificationPassed: this.verificationPassed(),
        unreviewedChanges: unreviewedFiles(workflow.reviewLedger ?? [])
      });
      if (failures.length > 0) {
        verdict = 'block';
        reasons.push(...failures);
      }
    }
    const world = this.currentGateWorld();
    const record: ReleaseGateRecord = {
      specId,
      verdict,
      reasons,
      criteriaEvidence: input.criteriaEvidence,
      risks: input.risks,
      rollback: input.rollback,
      verificationStatus: world.verificationStatus,
      digest: computeChangesDigest(world),
      recordedAt: new Date().toISOString(),
      // Kararı kimin kaydettiği izlenebilir olmalı: alt ajan turunda koşan
      // araç aktif rolü taşır; ana ajan kaydediyorsa orkestratörün kendisidir.
      recordedBy: this.host.state.activeSubagent?.role ?? 'manager'
    };
    workflow.releaseGate = record;
    workflow.updatedAt = Date.now();
    if (verdict === 'block') {
      workflow.blockedReason = `Yayın kapısı BLOCK: ${reasons[0] || 'gerekçe belirtilmedi'}`;
    }
    this.syncProgressToState();
    await this.host.saveCurrentState();
    this.host.emitState();
    return formatGateRecord(record);
  }

  /**
   * Yayın kapısı talimatını modele sistem mesajı olarak iletir.
   *
   * Doğrulama geçtiği hâlde taze kapı kararı yoksa aşama `verify`'de kalır
   * (build'e döngü yok); ajan bağımsız @release-gate denetimini çağırır ve
   * kararı `record_release_gate` ile kaydeder.
   */
  public requestReleaseGate(reason?: string): void {
    const workflow = this.getWorkflow();
    workflow.blockedReason = reason || 'Yayın kapısı kararı bekleniyor.';
    const unreviewed = this.unreviewedChanges();
    const reviewHint =
      unreviewed.length > 0
        ? `Önce bağımsız inceleme zorunlu: denetim defterinde ${unreviewed.length} kayıt incelemesiz ` +
          `(${unreviewed.slice(0, 8).join(', ')}). Yazan rolden farklı salt-okunur bir reviewer uzmanını ` +
          `(ör. invoke_subagent role "quality") çağır ve DEĞİŞEN DOSYALARIN HER BİRİNİ read_file ile açtır: ` +
          `yalnızca gerçekten okunan dosyaların borcu kapanır. Ölçülemeyen komut kayıtları (command:*) ` +
          `herhangi bir tamamlanmış denetim turuyla kapanır. `
        : '';
    this.host.state.messages.push({
      id: this.host.nextMessageId(),
      role: 'system',
      content:
        `Doğrulama tamamlandı; görev bitmeden önce bağımsız yayın kapısı koşmalı. ${reviewHint}` +
        `invoke_subagent ile role "release-gate" uzmanını çağır: her kabul kriterini ` +
        `(ac-1, ac-2, …) kanıtlayan senaryoyu tek tek denetlesin, kalan riskleri ve tek ` +
        `cümlelik geri alma planını listelelesin, kararı record_release_gate aracıyla ` +
        `kaydetsin. Kayıt sonrası dosya değişirse karar bayatlar; kapı yeniden koşar. ` +
        `Kapı durumu: ${reason || 'karar yok'}`,
      timestamp: Date.now()
    });
    void this.host.saveCurrentState().then(() => this.host.emitState());
    this.syncProgressToState();
  }

  /**
   * Bir tur bittikten sonra iş akışını ilerletir.
   *
   * Eskiden hiçbir şey `build` aşamasını geçemiyordu; plan onaylandıktan
   * hemen sonra şerit "Uygulama"da takılı kalıyordu. Otomatik adımlar da
   * kullanıcı istemli geçişle aynı kapılardan geçer; bir kapı reddederse
   * (örneğin işaretlenmemiş kabul kriterleri) şerit orada durur ve ilerleme
   * taklidi yapmak yerine açık ve dürüst bir neden gösterir.
   */
  public async advanceWorkflowAfterTurn(context: { changedFiles: boolean }): Promise<void> {
    if (this.host.state.status !== 'completed') return;

    const workflow = this.getWorkflow();
    const planning = isReadOnlyMode(this.host.state.mode);
    const order = stageOrderForMode(this.host.state.mode);
    if (workflow.stage === 'done') return;

    if (planning) {
      // Planlama modunda plan yoksa sohbet turu plan aşaması gibi görünmemeli.
      if (!this.host.planner.hasPlan()) return;
      if (workflow.stage !== 'review' && workflow.stage !== 'plan') return;
    } else {
      // Plan onaylanmadan önce aşamalar spec/plan araçları ve onay kapılarıyla
      // ilerler; bu yardımcı devreye girmez.
      if (!workflow.planApproved) return;
      if (order.indexOf(workflow.stage) < order.indexOf('build')) return;

      const verificationRan = (this.host.state.stats.verification?.status ?? 'not_run') !== 'not_run';
      if (workflow.stage === 'build' && !context.changedFiles && !verificationRan) {
        workflow.blockedReason =
          'Uygulama aşamasında değişiklik yapılmadı; ilerlemek için bir görev gönderin.';
        this.host.emitState();
        return;
      }
    }

    // Yalnızca BİR sonraki aşamaya geçilir. Eskiden `done`'a kadar döngü
    // çalışıyordu; bu, inceleme ve doğrulama kapılarının aynı turda sessizce
    // atlanmasına ve şeridin yanlış aşamada kalmasına yol açıyordu.
    const nextStage = order[order.indexOf(workflow.stage) + 1];
    if (!nextStage) return;

    const result = await this.setWorkflowStage(nextStage);
    if (!result.ok) {
      workflow.blockedReason =
        nextStage === 'done'
          ? 'Görev tamamlanmadı: kabul kriterleri işaretlenmeli, doğrulama geçmeli ve @release-gate taze bir PASS kararı kaydetmeli.'
          : `${stageLabel(nextStage)} aşamasına geçilemedi; önce tamamlanması gereken adımlar var.`;
      this.syncProgressToState();
      this.host.emitState();
      return;
    }

    workflow.blockedReason = undefined;
    this.syncProgressToState();
    this.host.emitState();

    // İnceleme aşamasına girildiyse çağrı haritasıyla "güncellenmemiş çağıran"
    // kontrolü yapılır; bulgu modele sistem mesajı olarak iletilir.
    if (!planning && nextStage === 'review') {
      await this.runReviewStage();
    }

    // Doğrulama aşamasına girildiyse doğrulamayı burada çalıştır: sonuç
    // "done" kapısını açar ya da ajanı uygulama aşamasına geri gönderir.
    if (!planning && nextStage === 'verify') {
      await this.runVerifyStage(true);
    }
  }

  /**
   * İnceleme aşamasının işleyicisi.
   *
   * Değişen dosyalardaki dışa aktarılan fonksiyonların çağıranlarına bakar;
   * çağıran dosya da değiştirilmediyse bunu "güncellenmemiş çağıran olabilir"
   * diye dürüstçe raporlar. Harita hazır değilse kontrol atlanır ve bu açıkça
   * yazılır; sessizce "temiz" denmez.
   */
  public async runReviewStage(): Promise<void> {
    const workspaceRoot = getActiveWorkspaceRoot();
    if (!workspaceRoot) return;

    // Bağımsız inceleme çağrısı: kodu yazan ajan kendi değişikliğini
    // onaylamaz; diff'i @quality, güvenlik hassasiyeti varsa @security görür.
    this.pushIndependentReviewInstruction();

    try {
      await this.collectStaleCallers(workspaceRoot);
    } catch (err) {
      // İnceleme yardımcı bir adımdır; hatası tüm turu düşürmemeli.
      logWarning('İnceleme adımı tamamlanamadı', err);
      this.host.state.messages.push({
        id: this.host.nextMessageId(),
        role: 'system',
        content: `İnceleme: çağıran kontrolü çalıştırılamadı (${errorMessage(err)}). Değişiklikleri elle gözden geçirin.`,
        timestamp: Date.now()
      });
      await this.host.saveCurrentState();
      this.host.emitState();
    }
  }

  /**
   * İnceleme aşamasına bağımsız inceleme talimatını ekler.
   *
   * Değişen dosyalara göre incelemeye katılması gereken roller deterministik
   * biçimde belirlenir (routing.rolesForChangedFiles); yazan ajanın kendi
   * işini onaylaması sistem talimatıyla engellenir.
   */
  private pushIndependentReviewInstruction(): void {
    const changedFiles = this.host.state.stats.filesModified;
    if (changedFiles.length === 0) return;
    const roles = rolesForChangedFiles(changedFiles);
    const roleList = roles.map((role) => `@${role}`).join(', ');
    const securityNote = roles.includes('security')
      ? ' Değişen dosyalar güvenlik açısından hassas görünüyor; @security ayrıca kimlik doğrulama, yetki ve veri sızmaları açısından denetlemeli.'
      : '';
    this.host.state.messages.push({
      id: this.host.nextMessageId(),
      role: 'system',
      content:
        `Bağımsız inceleme: bu değişiklikleri yazan ajan kendi işini onaylayamaz. ` +
        `Diff ve test sonuçları ${roleList} tarafından ayrıca incelenmeli.${securityNote} ` +
        `Testler geçmeden görevi tamamlanmış gösterme.`,
      timestamp: Date.now()
    });
  }

  /** Değişen sembollerin güncellenmemiş çağıranlarını toplar. */
  private async collectStaleCallers(workspaceRoot: string): Promise<void> {
    const document = this.host.callGraphManager.getDocument(workspaceRoot);
    const changedFiles = new Set(this.host.state.stats.filesModified.map((file) => file.replace(/\\/g, '/')));

    if (!document) {
      this.host.state.messages.push({
        id: this.host.nextMessageId(),
        role: 'system',
        content:
          'İnceleme: çağrı haritası hazır olmadığı için "güncellenmemiş çağıran" kontrolü yapılamadı. ' +
          'Değişen dışa aktarılan fonksiyonların çağıranlarını elle kontrol edin.',
        timestamp: Date.now()
      });
      await this.host.saveCurrentState();
      this.host.emitState();
      return;
    }

    const staleCallers: string[] = [];
    for (const node of document.nodes) {
      if (!changedFiles.has(node.file) || !node.exported) continue;
      const callers = document.edges.filter((edge) => edge.to === node.id);
      for (const edge of callers) {
        const caller = document.nodes.find((candidate) => candidate.id === edge.from);
        if (!caller || changedFiles.has(caller.file)) continue;
        staleCallers.push(
          `${caller.file}:${caller.startLine} ${caller.name} → ${node.file}:${node.startLine} ${node.name}`
        );
      }
    }

    const unique = [...new Set(staleCallers)].slice(0, 20);
    const body =
      unique.length === 0
        ? 'İnceleme: değişen dışa aktarılan fonksiyonların bilinen çağıranları da güncellenmiş görünüyor.'
        : 'İnceleme: aşağıdaki çağıranlar değişmedi; imza/ davranış değiştiyse gözden geçirin:\n' +
          unique.map((line) => `- ${line}`).join('\n');

    this.host.state.messages.push({
      id: this.host.nextMessageId(),
      role: 'system',
      content: `${body}\n(Bu liste çağrı haritasına dayanır; dinamik çağrılar ve başka paketlerden kullanım görünmez.)`,
      timestamp: Date.now()
    });
    await this.host.saveCurrentState();
    this.host.emitState();
  }

  /**
   * Doğrulama aşamasının işleyicisi.
   *
   * Doğrulama geçerse `done` denenir; kriterler eksikse ajan uygulama
   * aşamasına geri döner ve neyin eksik olduğu dürüstçe bildirilir. Böylece
   * aşama şeridi "Doğrulama"da asılı kalmaz ve yazma işi bittiğinde görev
   * gerçekten kapanır.
   */
  public async runVerifyStage(reachedVerify: boolean): Promise<void> {
    const workflow = this.getWorkflow();
    if (!reachedVerify || workflow.stage !== 'verify') return;

    try {
      await this.verifyAndFinish();
    } catch (err) {
      // Doğrulama çalıştırılamazsa görev "başarılı" sayılmaz; durum dürüstçe
      // bildirilir ve ajan uygulama aşamasında kalır.
      logWarning('Doğrulama adımı çalıştırılamadı', err);
      this.host.state.messages.push({
        id: this.host.nextMessageId(),
        role: 'system',
        content: `Doğrulama çalıştırılamadı: ${errorMessage(err)}. Test/lint komutunu elle çalıştırın.`,
        timestamp: Date.now()
      });
      await this.host.saveCurrentState();
      this.host.emitState();
    }
  }

  /** Doğrulamayı çalıştırır, sonuca göre `done` ya da `build` aşamasına geçer. */
  private async verifyAndFinish(): Promise<void> {
    const workflow = this.getWorkflow();
    const workspaceRoot = getActiveWorkspaceRoot();
    if (workspaceRoot && this.host.settings.autoVerify !== false) {
      const verification = await this.host.verificationManager.verify(workspaceRoot, {
        signal: this.host.activeAbortController?.signal
      });
      await publishVerificationStats(this.host, verification);
    }

    if (this.canFinishTask()) {
      const result = await this.setWorkflowStage('done');
      if (result.ok) {
        workflow.blockedReason = undefined;
        this.syncProgressToState();
        this.host.emitState();
        return;
      }
      // Kriter ve doğrulama tamamsa eksik olan yalnızca yayın kapısıdır:
      // build'e geri düşürmek gereksiz döngü üretirdi; verify'de kal ve
      // @release-gate denetimini iste.
      const gate = this.evaluateGate();
      if (!gate.ok && this.currentSpecCriteriaMet() && this.verificationPassed()) {
        this.requestReleaseGate(gate.reason);
        return;
      }
    }

    // Bitti kapısı kapalı: uygulama aşamasına geri dön ve nedenini yaz.
    const back = await this.setWorkflowStage('build');
    if (back.ok) {
      workflow.stage = 'build';
      workflow.updatedAt = Date.now();
    }
    const missing = this.missingAcceptanceCriteria();
    workflow.blockedReason =
      missing.length > 0
        ? `Bitti kapısı kapalı: işaretlenmemiş kabul kriterleri var (${missing.join(', ')}).`
        : 'Bitti kapısı kapalı: doğrulama geçmedi. Test/lint çıktısına göre düzeltme gerekiyor.';
    this.syncProgressToState();
    this.host.emitState();
  }

  /** Bitti kapısı için gereken koşullar sağlanmış mı? */
  private canFinishTask(): boolean {
    return this.currentSpecCriteriaMet() && this.verificationPassed();
  }

  /** Henüz işaretlenmemiş kabul kriterlerinin kimlikleri. */
  private missingAcceptanceCriteria(): string[] {
    const specId = this.getWorkflow().specId;
    if (!specId) return [];
    const spec = this.host.specStore.get(specId);
    if (!spec) return [];
    return spec.acceptanceCriteria.filter((criterion) => !criterion.done).map((criterion) => criterion.id);
  }

  /**
   * Kullanıcı onayından sonra ajan döngüsünü sürdürür.
   *
   * Spec veya plan onayı eskiden yalnızca durumu `idle` yapıyordu; ajan planı
   * hiç üretmiyor ve uygulamaya hiç başlamıyordu: görev "Plan" aşamasında
   * sıkışmış görünüyordu. Döngü, sahte bir kullanıcı mesajı eklemeden iç bir
   * sistem talimatıyla sürdürülür.
   */
  public resumeAfterApproval(instruction: string): void {
    if (this.host.isCancelled) return;
    void this.host.handleSendMessage(instruction, undefined, { internal: true }).catch((err: unknown) => {
      this.host.notify({
        level: 'error',
        message: errorMessage(err, 'Onay sonrası görev sürdürülemedi.')
      });
    });
  }

  /** Yazılan spec'i onaylı olarak işaretler ve planlama aşamasına geçer. */
  public async approveSpec(): Promise<boolean> {
    const workflow = this.getWorkflow();
    const specId = workflow.specId;
    if (!specId) {
      this.host.notify({ level: 'warning', message: 'Onaylanacak bir spec bulunamadı.' });
      return false;
    }
    if (!this.host.state.pendingApproval || this.host.state.pendingApproval.kind !== 'spec') {
      this.host.notify({ level: 'warning', message: 'Şu anda onay bekleyen bir spec yok.' });
      return false;
    }

    // Onay, sözleşmenin imzalandığı andır: kabul kriterleri üç boyutu
    // kapsamıyorsa spec onaylanmaz, model eksik boyutu eklemek üzere uyarılır.
    const spec = this.host.specStore.get(specId);
    if (spec) {
      const coverage = checkSpecCoverage(spec);
      if (!coverage.ok) {
        await this.rejectSpecApproval(coverage.message, false);
        this.resumeAfterApproval(
          'Spec kabul kriterleri eksik olduğu için onaylanmadı. `write_spec` aracını yeniden çağırıp ' +
            'eksik boyutları (mutlu yol, hata yolu, uç durum) kapsayan kriterleri ekle.'
        );
        return false;
      }
    }

    await this.host.specStore.approve(this.workspaceRootForApproval(), specId);
    workflow.specApproved = true;
    workflow.stage = 'plan';
    workflow.updatedAt = Date.now();
    workflow.blockedReason = undefined;
    await this.idleAfterApproval('Spec onaylandı. Plan hazırlanıyor…');
    this.resumeAfterApproval(
      'Spec onaylandı ve plan aşamasına geçildi. Şimdi `update_plan` aracıyla hedefe ve kabul kriterlerine ' +
        'uygun, bağımlılıkları belirtilmiş adımlardan oluşan planı oluştur ve onaya sun. ' +
        'Bu aşamada kod yazma ve komut çalıştırma yok.'
    );
    return true;
  }

  /** Güncel planı onaylar ki ajan uygulamaya başlayabilsin. */
  public async approvePlan(): Promise<boolean> {
    const workflow = this.getWorkflow();
    if (!this.host.state.pendingApproval || this.host.state.pendingApproval.kind !== 'plan') {
      this.host.notify({ level: 'warning', message: 'Şu anda onay bekleyen bir plan yok.' });
      return false;
    }
    if (!this.host.planner.hasPlan()) {
      this.host.notify({ level: 'warning', message: 'Onaylanacak bir plan bulunamadı.' });
      return false;
    }
    // Planlama modu onaylı planla biter; inşa edecek bir şey yoktur.
    const planning = isReadOnlyMode(this.host.state.mode);
    if (!planning && !workflow.specApproved) {
      this.host.notify({ level: 'warning', message: 'Plan onaylanmadan önce spec onaylanmalı.' });
      return false;
    }

    workflow.planApproved = true;
    workflow.stage = planning ? 'done' : 'build';
    workflow.updatedAt = Date.now();
    workflow.blockedReason = undefined;
    // Plan onaylandığında adımlara uzman rol atanır; yönetici buna göre delege eder.
    if (!planning) {
      this.host.planner.assignRoles();
      this.host.state.plan = this.host.planner.getPlan();
    }
    await this.idleAfterApproval(
      planning ? 'Plan onaylandı. Plan hazır.' : 'Plan onaylandı. Uygulama başlıyor…'
    );
    if (!planning) {
      this.resumeAfterApproval(
        'Plan onaylandı ve uygulama aşamasına geçildi. Planı sırayla uygula: her adımı tamamla, ' +
          'bitirdiğin adımı `update_plan` ile "completed" olarak işaretle ve ilgili kabul kriterini güncelle. ' +
          'Değişikliklerden sonra test/lint ile doğrula. Bitirmeden "tamamlandı" deme.'
      );
    }
    return true;
  }

  public async rejectApproval(reason?: string): Promise<void> {
    if (!this.host.state.pendingApproval) return;
    const kind = this.host.state.pendingApproval.kind;
    this.host.state.pendingApproval = undefined;
    this.host.state.status = 'idle';
    const workflow = this.getWorkflow();
    // Red, ilgili onay bayraklarını geçersiz kılar. Bu sıfırlama olmadan
    // bayat bir `specApproved`/`planApproved` reddedilmeyi atlatıyordu ve
    // sonraki tur, az önce reddedilen onay kapısını atlıyordu.
    if (kind === 'spec') {
      workflow.specApproved = false;
      workflow.planApproved = false;
      workflow.stage = 'intake';
    } else {
      // README: "Değişiklik iste" akışı İstek aşamasına geri alır. Plan
      // reddi de gereksinimleri yeniden netleştirmeyi gerektirebilir.
      workflow.planApproved = false;
      workflow.stage = 'intake';
    }
    workflow.updatedAt = Date.now();
    this.syncProgressToState();
    await this.host.saveCurrentState();
    this.host.emitState();
    this.host.notify({
      level: 'info',
      message: `${kind === 'spec' ? 'Spec' : 'Plan'} reddedildi. ${reason?.trim() || 'Gereksinimleri netleştirip tekrar deneyin.'}`
    });
  }

  public workspaceRootForApproval(): string {
    return getActiveWorkspaceRoot() || this.host.persistence.currentRoot || '';
  }

  /**
   * Spec kapısı: yeni yazılan bir spec, ajan plan yapmadan veya kod yazmadan
   * önce kullanıcı tarafından onaylanmalıdır. Onay bayraklarını sıfırlar,
   * çünkü yeni taslak önceki onayları geçersiz kılar (kapı atlama zinciri düzeltmesi).
   *
   * Tur onay kartı için duraklamalıysa true döner.
   */
  public async pauseForSpecApproval(
    drafted: TaskSpec,
    modelToolCalls: ToolCall[],
    toolCallId: string
  ): Promise<boolean> {
    const currentWorkflow = this.getWorkflow();
    currentWorkflow.specId = drafted.id;
    currentWorkflow.stage = 'spec';
    // Bu sıfırlama olmadan, önceki spec'ten kalan bayat bir `specApproved`
    // modelin onay kapısını tamamen atlatmasına izin veriyordu.
    currentWorkflow.specApproved = false;
    currentWorkflow.planApproved = false;
    currentWorkflow.updatedAt = Date.now();

    // Otonom modda spec kartı kullanıcıyı beklemez; spec kaydedilir ve ajan
    // planlamaya geçebilir. Spec içeriği ve kabul kriterleri yine görünür.
    if (skipsApprovalGates(this.host.settings)) {
      const root = getActiveWorkspaceRoot() || this.host.persistence.currentRoot || '';

      // Otonom onay da aynı kalite kapısına tabidir: üç boyutu kapsamayan
      // spec imzalanmaz, model eksik kriterleri eklemek üzere uyarılır.
      const coverage = checkSpecCoverage(drafted);
      if (!coverage.ok) {
        this.host.closeRemainingToolCalls(
          modelToolCalls,
          toolCallId,
          'Spec kabul kriterleri eksik; bu çağrı çalıştırılmadı.'
        );
        await this.rejectSpecApproval(coverage.message, true);
        this.resumeAfterApproval(
          'Spec kabul kriterleri eksik olduğu için onaylanmadı. `write_spec` aracını yeniden çağırıp ' +
            'eksik boyutları (mutlu yol, hata yolu, uç durum) kapsayan kriterleri ekle.'
        );
        return true;
      }

      try {
        await this.host.specStore.approve(root, drafted.id);
        currentWorkflow.specApproved = true;
        currentWorkflow.stage = 'plan';
        currentWorkflow.updatedAt = Date.now();
        this.host.state.pendingApproval = undefined;
        this.host.state.messages.push({
          id: this.host.nextMessageId(),
          role: 'system',
          content:
            `Spec otomatik onaylandı (otonomi: ${this.host.settings.autonomy}). ` +
            'Şimdi `update_plan` ile bağımlılıkları ve dosyaları belirtilmiş planı oluştur; ' +
            'her adıma `ownerRole` ekle. Plan onayı da otomatik geçilecek.',
          timestamp: Date.now()
        });
        this.syncProgressToState();
        await this.host.saveCurrentState();
        this.host.emitState();
        this.host.notify({ level: 'info', message: 'Spec otomatik onaylandı; plan hazırlanıyor.' });
        return false;
      } catch (err) {
        // Otomatik onay başarısızsa güvenli tarafa düş: kullanıcıya sor.
        logWarning('Spec otomatik onaylanamadı; kullanıcı onayı isteniyor', err);
      }
    }

    this.host.state.pendingApproval = {
      kind: 'spec',
      title: `Spec onayı: ${drafted.goal}`,
      details: this.host.specStore.formatForDisplay(drafted.id)
    };
    this.host.state.status = 'waiting_user_input';
    this.host.closeRemainingToolCalls(
      modelToolCalls,
      toolCallId,
      'Spec onayı bekleniyor; bu çağrı çalıştırılmadı.'
    );
    this.syncProgressToState();
    await this.host.saveCurrentState();
    this.host.emitState();
    return true;
  }

  /**
   * Plan kapısı: spec onayından sonra yazılan plan, herhangi bir kod yazılmadan
   * önce kullanıcı tarafından onaylanmalıdır. Planlama modunda plan teslimatın
   * kendisidir, bu yüzden kod spec'i beklemez.
   *
   * Tur onay kartı için duraklamalıysa true döner.
   */
  public async pauseForPlanApproval(
    plan: TaskPlan,
    modelToolCalls: ToolCall[],
    toolCallId: string
  ): Promise<boolean> {
    const currentWorkflow = this.getWorkflow();
    const planningMode = isReadOnlyMode(this.host.state.mode);
    if (!(planningMode || (currentWorkflow.specApproved && !currentWorkflow.planApproved))) {
      return false;
    }
    currentWorkflow.stage = 'plan';
    currentWorkflow.updatedAt = Date.now();
    currentWorkflow.blockedReason = undefined;

    // Otonom modda plan kartı da beklemez. Roller plana yazılır; uygulama
    // turunda yönetici bu atamaya göre delege eder.
    if (skipsApprovalGates(this.host.settings) && !planningMode) {
      this.host.planner.assignRoles();
      currentWorkflow.planApproved = true;
      currentWorkflow.stage = 'build';
      currentWorkflow.updatedAt = Date.now();
      this.host.state.pendingApproval = undefined;
      this.host.state.plan = this.host.planner.getPlan();
      this.host.state.messages.push({
        id: this.host.nextMessageId(),
        role: 'system',
        content:
          `Plan otomatik onaylandı (otonomi: ${this.host.settings.autonomy}). Rol atamaları:\n` +
          `${this.host.planner.formatAssignments()}\n` +
          'Şimdi planı sırayla uygula. Her adımı sahibi olan uzman role `invoke_subagent` ile devret (@backend, @frontend, @security...); birden çok uzmanın eşgüdümü gerekiyorsa @manager kullan, bağımsız adımları `run_parallel_tasks` ile koştur. ' +
          'Her adımı bitirince `update_plan` ile "completed" işaretle ve kabul kriterini güncelle. ' +
          'Bitirmeden "tamamlandı" deme.',
        timestamp: Date.now()
      });
      this.syncProgressToState();
      await this.host.saveCurrentState();
      this.host.emitState();
      this.host.notify({ level: 'info', message: 'Plan otomatik onaylandı; uygulama başlıyor.' });
      return false;
    }

    this.host.state.pendingApproval = {
      kind: 'plan',
      title: `Plan onayı: ${plan.goal || 'Görev planı'}`,
      details: this.host.planner.formatForTool()
    };
    this.host.state.status = 'waiting_user_input';
    this.host.closeRemainingToolCalls(
      modelToolCalls,
      toolCallId,
      'Plan onayı bekleniyor; bu çağrı çalıştırılmadı.'
    );
    this.syncProgressToState();
    await this.host.saveCurrentState();
    this.host.emitState();
    return true;
  }
}
