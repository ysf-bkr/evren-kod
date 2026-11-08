import { redactSecrets } from '../../shared/redaction';
import { EXTENSION_VERSION } from '../../shared/version';

/** Telemetri hedef türü. */
export type TelemetryTarget = 'otlp' | 'sentry' | 'memory';

/** Telemetri yapılandırması. */
export interface TelemetryConfig {
  /** Servis adı. */
  serviceName: string;
  /** Servis sürümü. */
  serviceVersion: string;
  /** Dağıtım ortamı ('production', 'development', 'staging'). */
  environment: string;
  /** OTLP uç nokta adresi (örn: http://localhost:4318/v1/traces). */
  otlpEndpoint?: string;
  /** Sentry DSN anahtarı. */
  sentryDsn?: string;
  /** Örnekleme oranı (0.0 - 1.0). */
  sampleRate?: number;
  /** Otomatik veri arındırma açık mı? */
  redactData?: boolean;
}

/** OpenTelemetry açıklayıcı span kaydı. */
export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: 'INTERNAL' | 'SERVER' | 'CLIENT';
  startTimeMs: number;
  endTimeMs: number;
  attributes: Record<string, string | number | boolean>;
  status: 'OK' | 'ERROR';
  errorMessage?: string;
}

/** Sentry tarzı hata olayı kaydı. */
export interface ErrorEventRecord {
  eventId: string;
  timestamp: string;
  level: 'fatal' | 'error' | 'warning' | 'info';
  message: string;
  exception?: {
    type: string;
    value: string;
    stacktrace?: string[];
  };
  breadcrumbs?: Array<{
    category: string;
    message: string;
    timestamp: number;
  }>;
  tags?: Record<string, string>;
}

/**
 * Canlı APM, Telemetri ve Gözlemlenebilirlik Dışa Aktarıcısı (OTLP / Sentry uyumlu).
 *
 * Kod asistanı süreçlerinin performansını, başarısızlık oranlarını ve
 * hatalarını kurumsal telemetri sistemlerine güvenle aktarır.
 */
export class TelemetryExporter {
  private config: Required<TelemetryConfig>;
  private spanQueue: SpanRecord[] = [];
  private errorQueue: ErrorEventRecord[] = [];

  constructor(config: Partial<TelemetryConfig> = {}) {
    this.config = {
      serviceName: config.serviceName ?? 'evren-kod',
      serviceVersion: config.serviceVersion ?? EXTENSION_VERSION,
      environment: config.environment ?? 'production',
      otlpEndpoint: config.otlpEndpoint ?? '',
      sentryDsn: config.sentryDsn ?? '',
      sampleRate: config.sampleRate ?? 1.0,
      redactData: config.redactData ?? true
    };
  }

  /**
   * Yeni bir işlem span'ı kaydeder.
   */
  public recordSpan(span: SpanRecord): void {
    if (Math.random() > this.config.sampleRate) return;

    const sanitized: SpanRecord = {
      ...span,
      attributes: this.config.redactData ? this.sanitizeAttributes(span.attributes) : span.attributes
    };
    this.spanQueue.push(sanitized);
  }

  /**
   * Hata olayını Sentry uyumlu biçimde kaydeder.
   */
  public recordError(error: Error, tags: Record<string, string> = {}): ErrorEventRecord {
    const rawMessage = error.message;
    const sanitizedMessage = this.config.redactData ? redactSecrets(rawMessage) : rawMessage;

    const event: ErrorEventRecord = {
      eventId: Math.random().toString(36).substring(2, 15),
      timestamp: new Date().toISOString(),
      level: 'error',
      message: sanitizedMessage,
      exception: {
        type: error.name || 'Error',
        value: sanitizedMessage,
        stacktrace: error.stack?.split('\n').map((l) => l.trim())
      },
      tags: {
        ...tags,
        service: this.config.serviceName,
        version: this.config.serviceVersion,
        environment: this.config.environment
      }
    };

    this.errorQueue.push(event);
    return event;
  }

  /**
   * Biriken span'ları OTLP JSON yükü (payload) olarak dışa aktarır.
   */
  public exportOtlpPayload(): Record<string, unknown> {
    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: this.config.serviceName } },
              { key: 'service.version', value: { stringValue: this.config.serviceVersion } },
              { key: 'deployment.environment', value: { stringValue: this.config.environment } }
            ]
          },
          scopeSpans: [
            {
              scope: { name: '@evren-kod/core', version: this.config.serviceVersion },
              spans: this.spanQueue.map((span) => ({
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId,
                name: span.name,
                startTimeUnixNano: span.startTimeMs * 1_000_000,
                endTimeUnixNano: span.endTimeMs * 1_000_000,
                status: { code: span.status === 'OK' ? 1 : 2, message: span.errorMessage },
                attributes: Object.entries(span.attributes).map(([k, v]) => ({
                  key: k,
                  value: typeof v === 'string' ? { stringValue: v } : { intValue: Number(v) }
                }))
              }))
            }
          ]
        }
      ]
    };

    return payload;
  }

  /**
   * Biriken hata kayıtlarını Sentry Envelope JSON olarak üretir.
   */
  public exportSentryPayload(): Record<string, unknown>[] {
    return this.errorQueue.map((event) => ({
      event_id: event.eventId,
      timestamp: event.timestamp,
      platform: 'node',
      level: event.level,
      message: event.message,
      environment: this.config.environment,
      release: `${this.config.serviceName}@${this.config.serviceVersion}`,
      exception: event.exception ? { values: [event.exception] } : undefined,
      tags: event.tags
    }));
  }

  /**
   * Kuyrukları temizler.
   */
  public clear(): void {
    this.spanQueue = [];
    this.errorQueue = [];
  }

  /**
   * Kuyruktaki span ve hata sayılarını bildirir.
   */
  public getQueueStats(): { spans: number; errors: number } {
    return {
      spans: this.spanQueue.length,
      errors: this.errorQueue.length
    };
  }

  private sanitizeAttributes(
    attrs: Record<string, string | number | boolean>
  ): Record<string, string | number | boolean> {
    const result: Record<string, string | number | boolean> = {};
    for (const [key, val] of Object.entries(attrs)) {
      if (typeof val === 'string') {
        result[key] = redactSecrets(val);
      } else {
        result[key] = val;
      }
    }
    return result;
  }
}
