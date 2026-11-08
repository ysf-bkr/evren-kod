import * as http from 'node:http';

/** Ekip koordinasyon mesaj türleri. */
export type CoordinationMessageType =
  | 'presence_join'
  | 'presence_leave'
  | 'presence_heartbeat'
  | 'lock_acquire'
  | 'lock_release'
  | 'lock_rejected'
  | 'conflict_alert';

/** Ekip koordinasyon mesaj paketi. */
export interface CoordinationMessage {
  type: CoordinationMessageType;
  sessionId: string;
  userName: string;
  filePath?: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

/** Koordinasyon sunucusu olay dinleyicisi. */
export type CoordinationEventListener = (msg: CoordinationMessage) => void;

/**
 * Dağıtık İnsan-Ajan Ekip Koordinasyon Sunucusu.
 *
 * Farklı VS Code oturumları, geliştiriciler ve otonom ajanlar arasındaki
 * dosya kilitlerini, imleç varlıklarını ve çakışma uyarılarını merkezi olarak yönetir.
 */
export class TeamCoordinationServer {
  private activeSessions = new Map<string, { userName: string; lastSeen: number; files: Set<string> }>();
  private activeLocks = new Map<string, { sessionId: string; userName: string; acquiredAt: number }>();
  private listeners: CoordinationEventListener[] = [];
  private server: http.Server | null = null;
  private port: number = 0;

  constructor(private readonly lockTtlMs: number = 30_000) {}

  /**
   * Olay dinleyicisi kaydeder.
   */
  public addListener(listener: CoordinationEventListener): void {
    this.listeners.push(listener);
  }

  /**
   * Gelen koordinasyon iletisini işler ve durumu günceller.
   */
  public handleMessage(msg: CoordinationMessage): { success: boolean; error?: string } {
    this.broadcast(msg);

    switch (msg.type) {
      case 'presence_join':
      case 'presence_heartbeat': {
        const session = this.activeSessions.get(msg.sessionId) || {
          userName: msg.userName,
          lastSeen: Date.now(),
          files: new Set()
        };
        session.lastSeen = Date.now();
        if (msg.filePath) session.files.add(msg.filePath);
        this.activeSessions.set(msg.sessionId, session);
        return { success: true };
      }

      case 'presence_leave': {
        this.activeSessions.delete(msg.sessionId);
        // Oturuma ait tüm kilitleri serbest bırak
        for (const [file, lock] of this.activeLocks.entries()) {
          if (lock.sessionId === msg.sessionId) {
            this.activeLocks.delete(file);
          }
        }
        return { success: true };
      }

      case 'lock_acquire': {
        if (!msg.filePath) return { success: false, error: 'Dosya yolu zorunludur.' };

        this.purgeExpiredLocks();
        const existing = this.activeLocks.get(msg.filePath);

        if (existing && existing.sessionId !== msg.sessionId) {
          const alertMsg: CoordinationMessage = {
            type: 'conflict_alert',
            sessionId: msg.sessionId,
            userName: msg.userName,
            filePath: msg.filePath,
            timestamp: Date.now(),
            payload: {
              lockedBy: existing.userName,
              lockedSession: existing.sessionId
            }
          };
          this.broadcast(alertMsg);
          return {
            success: false,
            error: `Dosya "${msg.filePath}" şu anda ${existing.userName} tarafından kilitli.`
          };
        }

        this.activeLocks.set(msg.filePath, {
          sessionId: msg.sessionId,
          userName: msg.userName,
          acquiredAt: Date.now()
        });
        return { success: true };
      }

      case 'lock_release': {
        if (msg.filePath) {
          const current = this.activeLocks.get(msg.filePath);
          if (current && current.sessionId === msg.sessionId) {
            this.activeLocks.delete(msg.filePath);
          }
        }
        return { success: true };
      }

      default:
        return { success: true };
    }
  }

  /**
   * HTTP tabanlı koordinasyon uç noktasını başlatır.
   */
  public async listen(port: number = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/events') {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            try {
              const msg = JSON.parse(body) as CoordinationMessage;
              const result = this.handleMessage(msg);
              res.writeHead(result.success ? 200 : 409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Geçersiz JSON yükü' }));
            }
          });
        } else if (req.method === 'GET' && req.url === '/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              sessions: [...this.activeSessions.entries()].map(([id, s]) => ({
                id,
                userName: s.userName,
                files: [...s.files]
              })),
              locks: [...this.activeLocks.entries()].map(([file, l]) => ({
                file,
                lockedBy: l.userName,
                sessionId: l.sessionId
              }))
            })
          );
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      this.server.on('error', reject);
      this.server.listen(port, () => {
        const addr = this.server?.address();
        this.port = typeof addr === 'object' && addr ? addr.port : port;
        resolve(this.port);
      });
    });
  }

  /**
   * Sunucuyu durdurur.
   */
  public async close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * Zaman aşımına uğramış kilitleri temizler.
   */
  public purgeExpiredLocks(): number {
    const now = Date.now();
    let purged = 0;
    for (const [file, lock] of this.activeLocks.entries()) {
      if (now - lock.acquiredAt > this.lockTtlMs) {
        this.activeLocks.delete(file);
        purged++;
      }
    }
    return purged;
  }

  /**
   * Aktif kilitli dosya sayısını bildirir.
   */
  public getLockCount(): number {
    this.purgeExpiredLocks();
    return this.activeLocks.size;
  }

  /**
   * Aktif oturum sayısını bildirir.
   */
  public getSessionCount(): number {
    return this.activeSessions.size;
  }

  private broadcast(msg: CoordinationMessage): void {
    for (const listener of this.listeners) {
      try {
        listener(msg);
      } catch {
        // Dinleyici hataları sunucuyu kırmaz
      }
    }
  }
}
