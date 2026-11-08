import * as path from 'path';
import * as fs from 'fs/promises';
import { EVREN_KOD_DIR } from '../../shared/constants';

/**
 * Kalite ve Performans Ölçüm Sistemi (MetricsCollector).
 *
 * Ajanın ve geliştirme sürecinin başarısını ölçülebilir metriklerle takip eder:
 * - Görev başarı oranı (Task success rate)
 * - Test başarısızlık ve regresyon oranı
 * - Ortalama görev tamamlama süresi
 * - Token harcaması ve tahmini model maliyeti ($ USD)
 * - Reviewer (incelemeci) hata yakalama oranı
 */

export interface TaskMetricRecord {
  taskId: string;
  timestamp: number;
  durationMs: number;
  success: boolean;
  tokensPrompt: number;
  tokensCompletion: number;
  model: string;
  testsExecuted: number;
  testsFailed: number;
  regressionsDetected: number;
  reviewerCatches: number;
}

export interface MetricsAggregate {
  totalTasks: number;
  successfulTasks: number;
  taskSuccessRate: number; // Yüzde (0-100)
  totalDurationSeconds: number;
  averageDurationSeconds: number;
  totalTokensPrompt: number;
  totalTokensCompletion: number;
  totalTokens: number;
  estimatedCostUsd: number;
  totalTestsExecuted: number;
  totalTestsFailed: number;
  testFailureRate: number;
  totalRegressions: number;
  totalReviewerCatches: number;
  reviewerCatchRate: number;
}

// Model token birim fiyatları (1M token başına tahmini USD)
const MODEL_PRICING: Record<string, { prompt: number; completion: number }> = {
  'glm-5.3': { prompt: 1.0, completion: 2.0 },
  mimo: { prompt: 0.2, completion: 0.5 },
  'qwen2.5-coder': { prompt: 0.0, completion: 0.0 }, // Yerel (ücretsiz)
  default: { prompt: 1.5, completion: 3.0 }
};

export class MetricsCollector {
  private records: TaskMetricRecord[] = [];

  public recordTask(metric: TaskMetricRecord): void {
    this.records.push({ ...metric });
  }

  public getAllRecords(): TaskMetricRecord[] {
    return [...this.records];
  }

  /**
   * Toplu kalite ve maliyet metriklerini hesaplar.
   */
  public computeAggregate(): MetricsAggregate {
    const total = this.records.length;
    if (total === 0) {
      return {
        totalTasks: 0,
        successfulTasks: 0,
        taskSuccessRate: 100,
        totalDurationSeconds: 0,
        averageDurationSeconds: 0,
        totalTokensPrompt: 0,
        totalTokensCompletion: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        totalTestsExecuted: 0,
        totalTestsFailed: 0,
        testFailureRate: 0,
        totalRegressions: 0,
        totalReviewerCatches: 0,
        reviewerCatchRate: 0
      };
    }

    const successful = this.records.filter((r) => r.success).length;
    const totalDurationMs = this.records.reduce((acc, r) => acc + r.durationMs, 0);
    const totalPrompt = this.records.reduce((acc, r) => acc + r.tokensPrompt, 0);
    const totalCompletion = this.records.reduce((acc, r) => acc + r.tokensCompletion, 0);
    const totalTests = this.records.reduce((acc, r) => acc + r.testsExecuted, 0);
    const totalFailedTests = this.records.reduce((acc, r) => acc + r.testsFailed, 0);
    const totalRegressions = this.records.reduce((acc, r) => acc + r.regressionsDetected, 0);
    const totalReviewerCatches = this.records.reduce((acc, r) => acc + r.reviewerCatches, 0);

    // Maliyet hesabı ($ / 1M token)
    let estimatedCost = 0;
    const defaultPricing = { prompt: 1.5, completion: 3.0 };
    for (const r of this.records) {
      const pricing = MODEL_PRICING[r.model] ?? defaultPricing;
      const promptCost = (r.tokensPrompt / 1_000_000) * pricing.prompt;
      const completionCost = (r.tokensCompletion / 1_000_000) * pricing.completion;
      estimatedCost += promptCost + completionCost;
    }

    const taskSuccessRate = Math.round((successful / total) * 1000) / 10;
    const testFailureRate = totalTests > 0 ? Math.round((totalFailedTests / totalTests) * 1000) / 10 : 0;
    const reviewerCatchRate = total > 0 ? Math.round((totalReviewerCatches / total) * 100) / 100 : 0;

    return {
      totalTasks: total,
      successfulTasks: successful,
      taskSuccessRate,
      totalDurationSeconds: Math.round(totalDurationMs / 1000),
      averageDurationSeconds: Math.round(totalDurationMs / total / 1000),
      totalTokensPrompt: totalPrompt,
      totalTokensCompletion: totalCompletion,
      totalTokens: totalPrompt + totalCompletion,
      estimatedCostUsd: Math.round(estimatedCost * 10000) / 10000,
      totalTestsExecuted: totalTests,
      totalTestsFailed: totalFailedTests,
      testFailureRate,
      totalRegressions,
      totalReviewerCatches,
      reviewerCatchRate
    };
  }

  /**
   * Yönetici karnesi (Executive Quality Scorecard) formatında Markdown raporu üretir.
   */
  public generateScorecardMarkdown(): string {
    const agg = this.computeAggregate();
    return [
      '# Evren Kod Kalite ve Performans Karnesi',
      '',
      `**Görev Başarı Oranı:** %${agg.taskSuccessRate} (${agg.successfulTasks}/${agg.totalTasks} Başarılı)`,
      `**Toplam Harcanan Token:** ${agg.totalTokens.toLocaleString()} (~$${agg.estimatedCostUsd.toFixed(4)} USD)`,
      `**Ortalama Görev Süresi:** ${agg.averageDurationSeconds} saniye`,
      '',
      '| Metrik Göstergesi | Değer | Durum |',
      '| :--- | :---: | :--- |',
      `| Görev Başarı Oranı | %${agg.taskSuccessRate} | ${agg.taskSuccessRate >= 90 ? '🟢 Mükemmel' : '🟡 Geliştirilmeli'} |`,
      `| Test Başarısızlık Oranı | %${agg.testFailureRate} | ${agg.testFailureRate <= 5 ? '🟢 Sağlıklı' : '🔴 Yüksek'} |`,
      `| Yakalanan Regresyon Sayısı | ${agg.totalRegressions} adet | ${agg.totalRegressions === 0 ? '🟢 Sıfır Regresyon' : '⚠️ İncelenmeli'} |`,
      `| İncelemeci (Reviewer) Yakalaması | ${agg.totalReviewerCatches} adet | 🛡️ Güvenlik Filtresi Aktif |`,
      `| Toplam Yürütülen Test | ${agg.totalTestsExecuted} test | 🧪 Kanıt Odaklı Doğrulama |`
    ].join('\n');
  }

  /**
   * Durumu `.evren-kod/metrics/metrics.json` ve `SCORECARD.md` altına kaydeder.
   */
  public async saveToDisk(workspaceRoot: string): Promise<void> {
    const dir = path.join(workspaceRoot, EVREN_KOD_DIR, 'metrics');
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(path.join(dir, 'metrics.json'), JSON.stringify(this.records, null, 2), 'utf-8');
    await fs.writeFile(path.join(dir, 'SCORECARD.md'), this.generateScorecardMarkdown(), 'utf-8');
  }

  /**
   * `.evren-kod/metrics/metrics.json` dosyasından metrikleri yükler.
   */
  public async loadFromDisk(workspaceRoot: string): Promise<void> {
    const jsonPath = path.join(workspaceRoot, EVREN_KOD_DIR, 'metrics', 'metrics.json');
    try {
      const raw = await fs.readFile(jsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as TaskMetricRecord[];
      if (Array.isArray(parsed)) {
        this.records = parsed.filter((r) => r && r.taskId);
      }
    } catch {
      // Yoksa devam
    }
  }

  public clear(): void {
    this.records = [];
  }
}
