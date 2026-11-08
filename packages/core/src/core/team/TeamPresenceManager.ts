import * as path from 'path';
import * as fs from 'fs/promises';
import { EVREN_KOD_DIR } from '../../shared/constants';

/**
 * Gerçek Zamanlı İnsan-Ekip Koordinasyonu ve Çakışma Önleme Yöneticisi (TeamPresenceManager).
 *
 * Çoklu geliştirici (insanlar ve AI ajanları) aynı depoda çalıştığında:
 * - Kimin hangi dosyada aktif olduğunu canlı izler (presence / heartbeat).
 * - İnsan geliştirici bir dosyada kod yazarken ajanın aynı dosyaya müdahale edip
 *   kullanıcının imlecini ve çalışmasını ezmesini engeller (Human-in-the-Loop koruması).
 * - Ekipler arası çakışmaları 3 yollu (3-way merge) analiziyle önceden haber verir.
 */

export interface TeamMember {
  id: string;
  name: string;
  role: 'human' | 'agent';
  currentBranch?: string;
  activeFiles: string[];
  lastHeartbeat: number;
}

export class HumanEditingConflictError extends Error {
  public readonly code = 'HUMAN_EDITING_CONFLICT';
  constructor(
    public readonly filePath: string,
    public readonly humanName: string
  ) {
    super(
      `İnsan-Ajan Çakışması Engellendi: "${filePath}" dosyası şu anda "${humanName}" adlı geliştirici tarafından aktif olarak düzenleniyor. Kullanıcının emeğini korumak için ajanın yazma işlemi durduruldu.`
    );
    this.name = 'HumanEditingConflictError';
  }
}

export interface MergeConflictItem {
  line: number;
  ours: string;
  theirs: string;
}

export interface ThreeWayMergeResult {
  clean: boolean;
  merged?: string;
  conflicts: MergeConflictItem[];
}

export class TeamPresenceManager {
  private members = new Map<string, TeamMember>();
  private defaultStaleThresholdMs = 60_000; // 60 saniye boyunca sinyal vermeyen üye pasif sayılır

  private normalizePath(filePath: string): string {
    return filePath.trim().replace(/\\/g, '/').toLowerCase();
  }

  /**
   * Bir ekip üyesinin (insan veya alt ajan) canlılık sinyalini (heartbeat) kaydeder.
   */
  public heartbeat(params: {
    id: string;
    name: string;
    role: 'human' | 'agent';
    currentBranch?: string;
    activeFiles?: string[];
  }): TeamMember {
    const now = Date.now();
    const existing = this.members.get(params.id);

    const activeFiles = params.activeFiles
      ? params.activeFiles.map((f) => this.normalizePath(f))
      : (existing?.activeFiles ?? []);

    const member: TeamMember = {
      id: params.id,
      name: params.name,
      role: params.role,
      currentBranch: params.currentBranch ?? existing?.currentBranch,
      activeFiles,
      lastHeartbeat: now
    };

    this.members.set(params.id, member);
    return member;
  }

  /**
   * Belirli bir üyenin aktif düzenlediği dosyaları günceller.
   */
  public setActiveFiles(memberId: string, files: string[]): void {
    const member = this.members.get(memberId);
    if (member) {
      member.activeFiles = files.map((f) => this.normalizePath(f));
      member.lastHeartbeat = Date.now();
    }
  }

  /**
   * Belirli bir dosyayı şu anda aktif olarak düzenleyen bir insan olup olmadığını sorgular.
   */
  public isHumanActiveOnFile(
    filePath: string,
    staleThresholdMs = this.defaultStaleThresholdMs
  ): { active: boolean; member?: TeamMember } {
    const key = this.normalizePath(filePath);
    const now = Date.now();

    for (const member of this.members.values()) {
      if (member.role === 'human' && now - member.lastHeartbeat <= staleThresholdMs) {
        if (member.activeFiles.includes(key)) {
          return { active: true, member };
        }
      }
    }

    return { active: false };
  }

  /**
   * Ajan dosyaya yazmadan önce çağrılır; dosya bir insan tarafından düzenleniyorsa hata fırlatır.
   */
  public assertNotConflictingWithHuman(
    filePath: string,
    staleThresholdMs = this.defaultStaleThresholdMs
  ): void {
    const check = this.isHumanActiveOnFile(filePath, staleThresholdMs);
    if (check.active && check.member) {
      throw new HumanEditingConflictError(filePath, check.member.name);
    }
  }

  /**
   * Aktif olan tüm ekip üyelerini döndürür (süresi geçenler filtrelenir).
   */
  public getActiveMembers(staleThresholdMs = this.defaultStaleThresholdMs): TeamMember[] {
    const now = Date.now();
    const active: TeamMember[] = [];
    for (const member of this.members.values()) {
      if (now - member.lastHeartbeat <= staleThresholdMs) {
        active.push({ ...member });
      }
    }
    return active;
  }

  /**
   * 3 yollu birleştirme analizi: Taban (base), Ajan (ours) ve İnsan/Harici (theirs)
   * sürümlerini satır satır karşılaştırır; çakışma varsa satır numaralarıyla raporlar.
   */
  public threeWayMergeCheck(base: string, ours: string, theirs: string): ThreeWayMergeResult {
    const baseLines = base.split('\n');
    const ourLines = ours.split('\n');
    const theirLines = theirs.split('\n');

    // Kolay durumlar: taraflardan biri değişmediyse
    if (base === ours) {
      return { clean: true, merged: theirs, conflicts: [] };
    }
    if (base === theirs || ours === theirs) {
      return { clean: true, merged: ours, conflicts: [] };
    }

    const maxLines = Math.max(baseLines.length, ourLines.length, theirLines.length);
    const conflicts: MergeConflictItem[] = [];
    const mergedLines: string[] = [];
    let isClean = true;

    for (let i = 0; i < maxLines; i++) {
      const b = baseLines[i];
      const o = ourLines[i];
      const t = theirLines[i];

      if (o === t) {
        // İki taraf da aynı değişikliği yaptı veya değiştirmedi
        if (o !== undefined) mergedLines.push(o);
      } else if (o === b) {
        // Yalnızca karşı taraf değiştirdi
        if (t !== undefined) mergedLines.push(t);
      } else if (t === b) {
        // Yalnızca bizim taraf değiştirdi
        if (o !== undefined) mergedLines.push(o);
      } else {
        // Her iki taraf da aynı satırı farklı değiştirdi: ÇAKIŞMA!
        isClean = false;
        conflicts.push({
          line: i + 1,
          ours: o ?? '',
          theirs: t ?? ''
        });
        mergedLines.push(`<<<<<<< AJAN\n${o ?? ''}\n=======\n${t ?? ''}\n>>>>>>> İNSAN`);
      }
    }

    return {
      clean: isClean,
      merged: mergedLines.join('\n'),
      conflicts
    };
  }

  /**
   * Durumu `.evren-kod/team/presence.json` altına kaydeder.
   */
  public async saveToDisk(workspaceRoot: string): Promise<void> {
    const dir = path.join(workspaceRoot, EVREN_KOD_DIR, 'team');
    await fs.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, 'presence.json');
    const data = this.getActiveMembers();
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * `.evren-kod/team/presence.json` dosyasından mevcut takım üyelerini yükler.
   */
  public async loadFromDisk(workspaceRoot: string): Promise<void> {
    const filePath = path.join(workspaceRoot, EVREN_KOD_DIR, 'team', 'presence.json');
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as TeamMember[];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.id && item.name) {
            this.members.set(item.id, item);
          }
        }
      }
    } catch {
      // Dosya yoksa sessizce devam
    }
  }

  public clear(): void {
    this.members.clear();
  }
}
