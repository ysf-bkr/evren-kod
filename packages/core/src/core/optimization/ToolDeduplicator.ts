import * as crypto from 'crypto';

interface FileReadCacheEntry {
  key: string;
  mtimeMs: number;
  contentHash: string;
  timestamp: number;
}

interface CommandCacheEntry {
  command: string;
  cwd: string;
  output: string;
  timestamp: number;
}

export class ToolDeduplicator {
  private fileCache: Map<string, FileReadCacheEntry> = new Map();
  private commandCache: Map<string, CommandCacheEntry> = new Map();

  /**
   * Basit ve hızlı sha256 içerik hash'i üretir.
   */
  public hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * Dosya okuma anahtarını çözümler.
   */
  public getFileKey(filePath: string, offset?: unknown, limit?: unknown): string {
    const normPath = filePath.replace(/\\/g, '/');
    const off = typeof offset === 'number' ? Math.floor(offset) : 1;
    const lim = typeof limit === 'number' ? Math.floor(limit) : 'all';
    return `${normPath}::${off}::${lim}`;
  }

  /**
   * Dosya okumasının yinelenip yinelenmediğini kontrol eder.
   */
  public checkFileRead(
    filePath: string,
    mtimeMs: number,
    content: string,
    offset?: unknown,
    limit?: unknown
  ): { isDuplicate: boolean; note?: string } {
    const key = this.getFileKey(filePath, offset, limit);
    const cached = this.fileCache.get(key);
    const contentHash = this.hashContent(content);

    if (cached && cached.mtimeMs === mtimeMs && cached.contentHash === contentHash) {
      const range =
        typeof limit === 'number'
          ? `satır ${offset ?? 1} (${limit} satır)`
          : offset && offset !== 1
            ? `satır ${offset}'den itibaren`
            : 'tüm dosya';

      return {
        isDuplicate: true,
        note:
          `[Yinelenen Okuma Atlandı]: "${filePath}" (${range}) içeriği daha önceki adımlarda okundu ` +
          `ve dosya o andan beri değişmedi (Hash: ${contentHash}). ` +
          `Sohbetteki mevcut içeriği kullanın; dosyayı değiştirmedikçe tekrar okumayın.`
      };
    }

    // Taze okumayı önbelleğe kaydet
    this.fileCache.set(key, {
      key,
      mtimeMs,
      contentHash,
      timestamp: Date.now()
    });

    return { isDuplicate: false };
  }

  /**
   * Dosya yazıldığında veya düzenlendiğinde o dosyanın tüm önbellek kayıtlarını düşürür.
   */
  public invalidateFile(filePath: string): void {
    const normPath = filePath.replace(/\\/g, '/');
    const prefix = `${normPath}::`;
    for (const key of this.fileCache.keys()) {
      if (key.startsWith(prefix) || key === normPath) {
        this.fileCache.delete(key);
      }
    }
  }

  /**
   * Salt-okunur ve ortamı değiştirmeyen komutların çıktısını önbellekten kontrol eder.
   */
  public checkCommand(
    command: string,
    cwd: string,
    isGitClean: boolean
  ): { isCached: boolean; cachedOutput?: string } {
    // Çalışma alanı temiz değilse komut önbelleği kullanılmaz
    if (!isGitClean) return { isCached: false };

    // Yalnızca güvenli salt-okunur komutlar önbelleklenebilir
    const isReadOnly = /^(?:git\s+status|git\s+branch|node\s+-v|npm\s+-v|tsc\s+--version|pwd|whoami)\b/i.test(
      command.trim()
    );
    if (!isReadOnly) return { isCached: false };

    const cacheKey = `${cwd}::${command.trim()}`;
    const cached = this.commandCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 60_000) {
      return {
        isCached: true,
        cachedOutput: `${cached.output}\n[Önbellekten alındı (ortam ve çalışma alanı temiz)]`
      };
    }

    return { isCached: false };
  }

  /**
   * Komut çıktısını önbelleğe alır.
   */
  public recordCommand(command: string, cwd: string, output: string): void {
    const isReadOnly = /^(?:git\s+status|git\s+branch|node\s+-v|npm\s+-v|tsc\s+--version|pwd|whoami)\b/i.test(
      command.trim()
    );
    if (!isReadOnly) {
      // Değişiklik yapan bir komut çalıştıysa tüm komut önbelleğini geçersiz kıl
      this.commandCache.clear();
      return;
    }

    const cacheKey = `${cwd}::${command.trim()}`;
    this.commandCache.set(cacheKey, {
      command: command.trim(),
      cwd,
      output,
      timestamp: Date.now()
    });
  }

  /**
   * Tüm önbellekleri sıfırlar.
   */
  public reset(): void {
    this.fileCache.clear();
    this.commandCache.clear();
  }
}
