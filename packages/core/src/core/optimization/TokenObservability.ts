import type { TaskObservabilitySummary } from '../../shared/types';

export interface CallTokenMetrics {
  callId: string;
  stage: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  toolSchemaTokens: number;
  contextTokens: number;
  latencyMs: number;
  success: boolean;
  timestamp: number;
}

export type { TaskObservabilitySummary };

export class TokenObservability {
  private calls: CallTokenMetrics[] = [];

  /**
   * Bir model çağrısının metriklerini kaydeder.
   */
  public recordCall(metrics: CallTokenMetrics): void {
    this.calls.push(metrics);
  }

  /**
   * Tüm görevin kümülatif gözlemlenebilirlik özetini çıkarır.
   */
  public getSummary(): TaskObservabilitySummary {
    if (this.calls.length === 0) {
      return {
        totalCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedTokens: 0,
        totalToolSchemaTokens: 0,
        totalContextTokens: 0,
        totalTokens: 0,
        averageLatencyMs: 0,
        cacheHitRatePercent: 0,
        schemaOverheadPercent: 0,
        successRatePercent: 100,
        estimatedCostReductionPercent: 0
      };
    }

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedTokens = 0;
    let totalToolSchemaTokens = 0;
    let totalContextTokens = 0;
    let totalLatencyMs = 0;
    let successfulCalls = 0;

    for (const call of this.calls) {
      totalInputTokens += call.inputTokens;
      totalOutputTokens += call.outputTokens;
      totalCachedTokens += call.cachedTokens;
      totalToolSchemaTokens += call.toolSchemaTokens;
      totalContextTokens += call.contextTokens;
      totalLatencyMs += call.latencyMs;
      if (call.success) successfulCalls++;
    }

    const totalTokens = totalInputTokens + totalOutputTokens;
    const cacheHitRatePercent =
      totalInputTokens > 0 ? Math.round((totalCachedTokens / totalInputTokens) * 100) : 0;
    const schemaOverheadPercent =
      totalInputTokens > 0 ? Math.round((totalToolSchemaTokens / totalInputTokens) * 100) : 0;
    const successRatePercent =
      this.calls.length > 0 ? Math.round((successfulCalls / this.calls.length) * 100) : 100;
    const averageLatencyMs = Math.round(totalLatencyMs / this.calls.length);

    // Teorik baz model çağrısına (tüm şemalar + önbelleksiz) göre tasarruf hesabı
    const estimatedCostReductionPercent = Math.min(
      85,
      Math.max(0, Math.round(cacheHitRatePercent * 0.7 + (100 - schemaOverheadPercent) * 0.2))
    );

    return {
      totalCalls: this.calls.length,
      totalInputTokens,
      totalOutputTokens,
      totalCachedTokens,
      totalToolSchemaTokens,
      totalContextTokens,
      totalTokens,
      averageLatencyMs,
      cacheHitRatePercent,
      schemaOverheadPercent,
      successRatePercent,
      estimatedCostReductionPercent
    };
  }

  /**
   * UI ve raporlar için formatlanmış Türkçe özet metni üretir.
   */
  public formatReport(): string {
    const s = this.getSummary();
    return (
      `=== TOKEN GÖZLEMLENEBİLİRLİK VE MALİYET RAPORU ===\n` +
      `• Toplam API Çağrısı: ${s.totalCalls}\n` +
      `• Toplam Token Tüketimi: ${s.totalTokens.toLocaleString('tr-TR')} (Giriş: ${s.totalInputTokens.toLocaleString('tr-TR')}, Üretim: ${s.totalOutputTokens.toLocaleString('tr-TR')})\n` +
      `• Önbellekten Okunan (Cached): ${s.totalCachedTokens.toLocaleString('tr-TR')} (%${s.cacheHitRatePercent} İsabet)\n` +
      `• Araç Şeması Yükü: ${s.totalToolSchemaTokens.toLocaleString('tr-TR')} (%${s.schemaOverheadPercent} pay)\n` +
      `• Ortalama Gecikme (Latency): ${s.averageLatencyMs} ms\n` +
      `• Çağrı Başarı Oranı: %${s.successRatePercent}\n` +
      `• Tahmini Maliyet Tasarrufu: %${s.estimatedCostReductionPercent}`
    );
  }

  public reset(): void {
    this.calls = [];
  }
}
