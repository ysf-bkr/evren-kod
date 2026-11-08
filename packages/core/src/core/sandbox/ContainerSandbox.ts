import { spawn } from 'node:child_process';
import * as path from 'node:path';

/** Desteklenen konteyner çalışma zamanları. */
export type ContainerRuntime = 'docker' | 'podman' | 'none';

/** Konteyner sandbox yapılandırması. */
export interface ContainerSandboxConfig {
  /** Sandbox aktif mi? */
  enabled: boolean;
  /** Tercih edilen çalışma zamanı. */
  runtime?: ContainerRuntime;
  /** Kullanılacak temel imaj. */
  image?: string;
  /** Ağ izolasyon modu ('none', 'host', 'bridge'). */
  networkMode?: 'none' | 'host' | 'bridge';
  /** Bellek sınırı (örn: '2g'). */
  memoryLimit?: string;
  /** CPU sınırı (örn: '2'). */
  cpuLimit?: string;
  /** Kök dosya sistemi salt okunur mu? */
  readOnlyRootFs?: boolean;
  /** Linux yetkilerini bırakma (cap-drop ALL). */
  dropCapabilities?: boolean;
  /** Çalışma alanının konteyner içi bağlama noktası. */
  workspaceMountPath?: string;
  /** İzolasyonlu ortam değişkenleri. */
  environment?: Record<string, string>;
  /** Dış ağa erişim izni verilen alan adları. */
  allowedOutboundHosts?: string[];
}

/** Konteyner içi komut çalıştırma sonucu. */
export interface ContainerExecutionResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  isolated: boolean;
  runtimeUsed: ContainerRuntime;
  durationMs: number;
}

/**
 * Kurumsal Güvenlik İzolasyonu: Docker / Podman Konteyner Sandbox Yöneticisi.
 *
 * Kod çalıştırma ve test süreçlerini ana makineden tamamen yalıtarak,
 * dosya sistemi, ağ ve süreç izolasyonu sağlar.
 */
export class ContainerSandboxManager {
  private config: Required<ContainerSandboxConfig>;
  private detectedRuntime: ContainerRuntime | null = null;

  constructor(config: Partial<ContainerSandboxConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? false,
      runtime: config.runtime ?? 'docker',
      image: config.image ?? 'evren-kod-sandbox:latest',
      networkMode: config.networkMode ?? 'none',
      memoryLimit: config.memoryLimit ?? '2g',
      cpuLimit: config.cpuLimit ?? '2',
      readOnlyRootFs: config.readOnlyRootFs ?? true,
      dropCapabilities: config.dropCapabilities ?? true,
      workspaceMountPath: config.workspaceMountPath ?? '/workspace',
      environment: config.environment ?? {},
      allowedOutboundHosts: config.allowedOutboundHosts ?? []
    };
  }

  /**
   * Sistemde Docker veya Podman varlığını denetler.
   */
  public async detectRuntime(): Promise<ContainerRuntime> {
    if (this.detectedRuntime !== null) {
      return this.detectedRuntime;
    }

    const checkRuntime = (binary: string): Promise<boolean> => {
      return new Promise((resolve) => {
        try {
          const child = spawn(binary, ['--version'], {
            stdio: ['ignore', 'ignore', 'ignore'],
            shell: false
          });
          child.on('error', () => resolve(false));
          child.on('close', (code) => resolve(code === 0));
        } catch {
          resolve(false);
        }
      });
    };

    if (await checkRuntime('docker')) {
      this.detectedRuntime = 'docker';
    } else if (await checkRuntime('podman')) {
      this.detectedRuntime = 'podman';
    } else {
      this.detectedRuntime = 'none';
    }

    return this.detectedRuntime;
  }

  /**
   * Konteyner ortamının kullanılabilir olup olmadığını bildirir.
   */
  public async isAvailable(): Promise<boolean> {
    const runtime = await this.detectRuntime();
    return runtime !== 'none';
  }

  /**
   * Verilen komut için konteyner argüman listesini inşa eder.
   */
  public buildExecutionArgs(
    command: string,
    workspaceRoot: string,
    overrides?: Partial<ContainerSandboxConfig>
  ): { binary: string; args: string[] } {
    const opts = { ...this.config, ...overrides };
    const runtime = opts.runtime === 'none' ? 'docker' : opts.runtime;

    const args: string[] = [
      'run',
      '--rm',
      '--init',
      `-w=${opts.workspaceMountPath}`,
      `-v=${path.resolve(workspaceRoot)}:${opts.workspaceMountPath}:rw`,
      `--network=${opts.networkMode}`,
      `--memory=${opts.memoryLimit}`,
      `--cpus=${opts.cpuLimit}`
    ];

    if (opts.readOnlyRootFs) {
      args.push('--read-only');
      // Geçici dosyalar için tmpfs alanı açılır
      args.push('--tmpfs=/tmp:rw,noexec,nosuid,size=256m');
    }

    if (opts.dropCapabilities) {
      args.push('--cap-drop=ALL');
      args.push('--security-opt=no-new-privileges');
    }

    // İzolasyonlu ortam değişkenlerini aktar
    for (const [key, value] of Object.entries(opts.environment)) {
      args.push(`-e=${key}=${value}`);
    }

    args.push(opts.image);
    args.push('/bin/sh', '-c', command);

    return { binary: runtime, args };
  }

  /**
   * Komutu konteyner sandbox içinde çalıştırır.
   * Konteyner çalışma zamanı yoksa ve izin verilmişse güvenli ana makineye düşer.
   */
  public async execute(
    command: string,
    workspaceRoot: string,
    overrides?: Partial<ContainerSandboxConfig>
  ): Promise<ContainerExecutionResult> {
    const startTime = Date.now();
    const runtime = await this.detectRuntime();

    if (!this.config.enabled) {
      return {
        command,
        exitCode: 1,
        stdout: '',
        stderr: 'Konteyner sandbox yapılandırmada devre dışı bırakılmış.',
        isolated: false,
        runtimeUsed: 'none',
        durationMs: Date.now() - startTime
      };
    }

    if (runtime === 'none') {
      return {
        command,
        exitCode: 1,
        stdout: '',
        stderr: 'Konteyner çalışma zamanı (Docker/Podman) sistemde bulunamadı.',
        isolated: false,
        runtimeUsed: 'none',
        durationMs: Date.now() - startTime
      };
    }

    const { binary, args } = this.buildExecutionArgs(command, workspaceRoot, overrides);

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      try {
        const child = spawn(binary, args, {
          cwd: workspaceRoot,
          env: { ...process.env, ...this.config.environment }
        });

        child.stdout?.on('data', (chunk) => {
          stdout += chunk.toString();
        });

        child.stderr?.on('data', (chunk) => {
          stderr += chunk.toString();
        });

        child.on('error', (err) => {
          resolve({
            command,
            exitCode: 1,
            stdout,
            stderr: `Konteyner başlatma hatası: ${err.message}`,
            isolated: true,
            runtimeUsed: runtime,
            durationMs: Date.now() - startTime
          });
        });

        child.on('close', (code) => {
          resolve({
            command,
            exitCode: code ?? 0,
            stdout,
            stderr,
            isolated: true,
            runtimeUsed: runtime,
            durationMs: Date.now() - startTime
          });
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        resolve({
          command,
          exitCode: 1,
          stdout,
          stderr: `İşlem hatası: ${errorMsg}`,
          isolated: false,
          runtimeUsed: runtime,
          durationMs: Date.now() - startTime
        });
      }
    });
  }

  /**
   * Sertleştirilmiş güvenli kurumsal sandbox Dockerfile şablonunu üretir.
   */
  public generateDockerfile(): string {
    return `# Evren Kod Kurumsal Sandbox Temel İmajı
FROM alpine:3.20

# Temel geliştirme ve derleme araçları
RUN apk add --no-cache \\
    git \\
    bash \\
    curl \\
    nodejs \\
    npm \\
    python3 \\
    py3-pip \\
    build-base

# Güvenlik: yetkisiz (non-root) geliştirici kullanıcısı
RUN addgroup -S evren && adduser -S evren -G evren -u 10001
RUN mkdir -p /workspace && chown -R evren:evren /workspace

USER evren
WORKDIR /workspace

CMD ["/bin/bash"]
`;
  }
}
