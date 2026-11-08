import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { TelemetryExporter } from '@evren-kod/core/core/telemetry/TelemetryExporter';

describe('TelemetryExporter: APM ve telemetri aktarımı', () => {
  it('span kayıtlarını toplar ve gizli verileri arındırarak OTLP yükü üretir', () => {
    const exporter = new TelemetryExporter({
      serviceName: 'evren-test',
      environment: 'staging'
    });

    exporter.recordSpan({
      traceId: 'tr-1',
      spanId: 'sp-1',
      name: 'agent_turn',
      kind: 'INTERNAL',
      startTimeMs: 1000,
      endTimeMs: 1200,
      status: 'OK',
      attributes: {
        'model.name': 'glm-5.3',
        'auth.token': 'Bearer sk-ant-secret123456789'
      }
    });

    const otlp = exporter.exportOtlpPayload() as {
      resourceSpans: Array<{
        scopeSpans: Array<{
          spans: Array<{
            name: string;
            attributes: Array<{ key: string; value: { stringValue?: string } }>;
          }>;
        }>;
      }>;
    };
    assert.strictEqual(exporter.getQueueStats().spans, 1);

    const spans = otlp.resourceSpans[0]?.scopeSpans[0]?.spans;
    assert.ok(spans);
    assert.strictEqual(spans.length, 1);
    assert.strictEqual(spans[0]?.name, 'agent_turn');

    // Gizli anahtarın arındırıldığını doğrula
    const tokenAttr = spans[0]?.attributes.find((a) => a.key === 'auth.token');
    assert.ok(tokenAttr?.value.stringValue);
    assert.match(tokenAttr.value.stringValue, /REDACTED/);
  });

  it('hata olaylarını Sentry envelope formatında dışa aktarır', () => {
    const exporter = new TelemetryExporter();
    const error = new Error('Test hatası oluştu: api key --api-key=sk-1234567890abcdef');

    exporter.recordError(error, { role: 'backend' });

    assert.strictEqual(exporter.getQueueStats().errors, 1);
    const sentryEvents = exporter.exportSentryPayload();

    assert.strictEqual(sentryEvents.length, 1);
    const firstEvent = sentryEvents[0];
    assert.ok(firstEvent);
    assert.strictEqual(firstEvent.level, 'error');
    const tags = firstEvent.tags as Record<string, string>;
    assert.strictEqual(tags?.role, 'backend');
    // Hassas anahtarın mesajdan maskelendiğini kontrol et
    assert.match(String(firstEvent.message), /REDACTED/);

    exporter.clear();
    assert.strictEqual(exporter.getQueueStats().errors, 0);
  });
});
