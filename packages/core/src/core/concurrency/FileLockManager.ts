/**
 * Dosya Sahipliği ve Eşzamanlılık Kilidi Yöneticisi (FileLockManager).
 *
 * Çoklu ajan (ana ajan, alt ajanlar) ve insan geliştiricilerin aynı dosyayı
 * eşzamanlı olarak değiştirmesini ve ezmesini önler.
 *
 * Temel ilkeler:
 * - Kiralama süreli (TTL / Lease) kilitler: ajan çökse bile kilit kalıcı olarak asılı kalmaz (deadlock engellenir).
 * - Sahiplik (Ownership): Kilidi alan ajan (`ownerId`) işlem bitene kadar dosyanın tek mutasyon yetkilisidir.
 * - Çakışma tespiti (Conflict detection): Başka bir ajan dosyayı değiştirmeye çalıştığında açık hata verir.
 */

export interface FileLock {
  filePath: string;
  ownerId: string;
  acquiredAt: number;
  expiresAt: number;
  metadata?: Record<string, unknown>;
}

export class FileLockConflictError extends Error {
  public readonly code = 'FILE_LOCK_CONFLICT';
  constructor(
    public readonly filePath: string,
    public readonly currentOwner: string,
    public readonly requestedBy: string
  ) {
    super(
      `Eşzamanlılık çakışması: "${filePath}" dosyası şu anda "${currentOwner}" tarafından kilitlenmiş durumda. "${requestedBy}" tarafından yapılan yazma işlemi engellendi.`
    );
    this.name = 'FileLockConflictError';
  }
}

export class FileLockManager {
  private locks = new Map<string, FileLock>();
  private defaultTtlMs = 30_000; // 30 saniye varsayılan kiralama süresi

  private normalizeKey(filePath: string): string {
    return filePath.trim().replace(/\\/g, '/').toLowerCase();
  }

  /**
   * Belirtilen dosya için kilit talep eder. Dosya başka bir sahip tarafından
   * kilitliyse ve kilidin süresi dolmamışsa `FileLockConflictError` fırlatır.
   */
  public acquire(filePath: string, ownerId: string, ttlMs = this.defaultTtlMs): FileLock {
    const key = this.normalizeKey(filePath);
    const now = Date.now();
    const existing = this.locks.get(key);

    if (existing && existing.expiresAt > now) {
      if (existing.ownerId === ownerId) {
        // Aynı sahip: kiralamayı uzat (heartbeat)
        existing.expiresAt = now + ttlMs;
        return { ...existing };
      }
      throw new FileLockConflictError(filePath, existing.ownerId, ownerId);
    }

    const lock: FileLock = {
      filePath,
      ownerId,
      acquiredAt: now,
      expiresAt: now + ttlMs
    };

    this.locks.set(key, lock);
    return { ...lock };
  }

  /**
   * Kilidi almaya çalışır; çakışma durumunda hata fırlatmak yerine boolean döndürür.
   */
  public tryAcquire(
    filePath: string,
    ownerId: string,
    ttlMs = this.defaultTtlMs
  ): { acquired: boolean; lock?: FileLock; currentOwner?: string } {
    try {
      const lock = this.acquire(filePath, ownerId, ttlMs);
      return { acquired: true, lock };
    } catch (err) {
      if (err instanceof FileLockConflictError) {
        return { acquired: false, currentOwner: err.currentOwner };
      }
      throw err;
    }
  }

  /**
   * Kilidi serbest bırakır. Yalnızca kilidin gerçek sahibi serbest bırakabilir.
   */
  public release(filePath: string, ownerId: string): boolean {
    const key = this.normalizeKey(filePath);
    const existing = this.locks.get(key);
    if (!existing) return false;

    if (existing.ownerId === ownerId || existing.expiresAt <= Date.now()) {
      this.locks.delete(key);
      return true;
    }

    return false;
  }

  /**
   * Dosyanın şu anda aktif ve süresi dolmamış bir kilidi olup olmadığını sorgular.
   */
  public isLocked(filePath: string): boolean {
    const key = this.normalizeKey(filePath);
    const existing = this.locks.get(key);
    if (!existing) return false;
    if (existing.expiresAt <= Date.now()) {
      this.locks.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Aktif kilidi döndürür (süresi dolmuşsa temizler).
   */
  public getLock(filePath: string): FileLock | undefined {
    const key = this.normalizeKey(filePath);
    const existing = this.locks.get(key);
    if (!existing) return undefined;
    if (existing.expiresAt <= Date.now()) {
      this.locks.delete(key);
      return undefined;
    }
    return { ...existing };
  }

  /**
   * Belirli bir ajana/sahibe ait tüm aktif kilitleri serbest bırakır (oturum sonu/görev tamamlama).
   */
  public releaseAllForOwner(ownerId: string): number {
    let count = 0;
    for (const [key, lock] of this.locks.entries()) {
      if (lock.ownerId === ownerId) {
        this.locks.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Dosya kilidi altında güvenli bir işlem yürütür ve işlem bitince kilidi otomatik serbest bırakır.
   */
  public async withLock<T>(
    filePath: string,
    ownerId: string,
    action: () => Promise<T>,
    ttlMs = this.defaultTtlMs
  ): Promise<T> {
    this.acquire(filePath, ownerId, ttlMs);
    try {
      return await action();
    } finally {
      this.release(filePath, ownerId);
    }
  }

  /**
   * Süresi dolmuş kilitleri süpürür.
   */
  public purgeExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, lock] of this.locks.entries()) {
      if (lock.expiresAt <= now) {
        this.locks.delete(key);
        count++;
      }
    }
    return count;
  }

  public clear(): void {
    this.locks.clear();
  }
}
