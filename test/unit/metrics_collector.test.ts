import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { MetricsCollector } from '@evren-kod/core/core/metrics/MetricsCollector';

describe('MetricsCollector: quality and performance measurement', () => {
  let tmpDir: string;
  let collector: MetricsCollector;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'evren-kod-metrics-'));
    collector = new MetricsCollector();
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('records task metrics and calculates aggregate scorecard', () => {
    collector.recordTask({
      taskId: 'task_1',
      timestamp: Date.now(),
      durationMs: 4000,
      success: true,
      tokensPrompt: 5000,
      tokensCompletion: 1000,
      model: 'glm-5.3',
      testsExecuted: 10,
      testsFailed: 0,
      regressionsDetected: 0,
      reviewerCatches: 0
    });

    collector.recordTask({
      taskId: 'task_2',
      timestamp: Date.now(),
      durationMs: 6000,
      success: true,
      tokensPrompt: 8000,
      tokensCompletion: 2000,
      model: 'glm-5.3',
      testsExecuted: 15,
      testsFailed: 1,
      regressionsDetected: 0,
      reviewerCatches: 1
    });

    const agg = collector.computeAggregate();
    assert.strictEqual(agg.totalTasks, 2);
    assert.strictEqual(agg.successfulTasks, 2);
    assert.strictEqual(agg.taskSuccessRate, 100);
    assert.strictEqual(agg.totalTestsExecuted, 25);
    assert.strictEqual(agg.totalTestsFailed, 1);
    assert.ok(agg.estimatedCostUsd > 0);
  });

  it('generates executive scorecard in markdown format', () => {
    const md = collector.generateScorecardMarkdown();
    assert.match(md, /Evren Kod Kalite ve Performans Karnesi/);
    assert.match(md, /Görev Başarı Oranı/);
    assert.match(md, /Harcanan Token/);
  });

  it('persists metrics to disk and reloads them', async () => {
    await collector.saveToDisk(tmpDir);

    const reloaded = new MetricsCollector();
    await reloaded.loadFromDisk(tmpDir);

    assert.strictEqual(reloaded.getAllRecords().length, 2);
  });
});
