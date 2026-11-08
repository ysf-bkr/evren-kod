import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ToolSchemaOptimizer,
  TokenBudgetManager,
  OutputOptimizer,
  ToolDeduplicator,
  RelevanceScorer,
  ContextOptimizer,
  StructuredWorkingMemory,
  ProviderCacheManager,
  TokenObservability,
  TokenOptimizationEngine
} from '../../packages/core/src/core/optimization';
import { MODEL_TOOLS } from '../../packages/core/src/tools';
import { ProviderMessage } from '../../packages/core/src/providers/base';

test('ToolSchemaOptimizer: aşama bazlı araç maskeleme ve token tasarrufu', () => {
  const optimizer = new ToolSchemaOptimizer();

  // Onboard aşamasında yalnızca keşif araçları bulunmalı
  const onboardTools = optimizer.filterTools(MODEL_TOOLS, 'onboard', 'code');
  assert.ok(onboardTools.length > 0 && onboardTools.length <= 8);
  assert.ok(onboardTools.some((t) => t.name === 'read_file'));
  assert.ok(onboardTools.some((t) => t.name === 'get_project_knowledge'));
  assert.ok(!onboardTools.some((t) => t.name === 'write_file'));
  assert.ok(!onboardTools.some((t) => t.name === 'execute_command'));

  // Build aşamasında yazma ve çalıştırma olmalı, spec yazma olmamalı
  const buildTools = optimizer.filterTools(MODEL_TOOLS, 'build', 'code');
  assert.ok(buildTools.some((t) => t.name === 'edit_file'));
  assert.ok(buildTools.some((t) => t.name === 'execute_command'));
  assert.ok(!buildTools.some((t) => t.name === 'write_spec'));

  // Verify aşamasında test/doğrulama olmalı
  const verifyTools = optimizer.filterTools(MODEL_TOOLS, 'verify', 'code');
  assert.ok(verifyTools.some((t) => t.name === 'run_verification'));
  assert.ok(verifyTools.some((t) => t.name === 'run_tests'));
  assert.ok(!verifyTools.some((t) => t.name === 'update_plan'));

  // Şema tasarruf oranı hesaplaması (%60+ tasarruf hedefi)
  const savings = optimizer.calculateSavings(MODEL_TOOLS, onboardTools);
  assert.ok(savings.savedTokens > 0);
  assert.ok(
    savings.reductionPercentage >= 60,
    `Tasarruf %${savings.reductionPercentage} olmalı (hedef: >=%60)`
  );
});

test('TokenBudgetManager: aşama bütçesi ve geçiş uyarısı', () => {
  const manager = new TokenBudgetManager({
    intake: 2_000,
    build: 10_000
  });

  // Harcama yapılmadan önce durum
  const initial = manager.getPhaseStatus('intake');
  assert.strictEqual(initial.spentTokens, 0);
  assert.strictEqual(initial.shouldTransition, false);

  // Bütçenin %50'si harcandığında
  manager.recordSpend('intake', 800, 200);
  const mid = manager.getPhaseStatus('intake');
  assert.strictEqual(mid.spentTokens, 1_000);
  assert.strictEqual(mid.percentUsed, 50);
  assert.strictEqual(mid.shouldTransition, false);

  // Bütçenin %85'i harcandığında geçiş tavsiyesi tetiklenmeli
  manager.recordSpend('intake', 500, 200);
  const high = manager.getPhaseStatus('intake');
  assert.strictEqual(high.spentTokens, 1_700);
  assert.strictEqual(high.percentUsed, 85);
  assert.strictEqual(high.shouldTransition, true);
  assert.ok(high.advisory?.includes('geçiş önerilir'));

  // Bütçe ölçekleme kontrolü
  manager.scaleForContextWindow(192_000); // 2x pencere
  const scaled = manager.getPhaseStatus('build');
  assert.ok(scaled.budgetTokens > 10_000);
});

test('OutputOptimizer: AST iskeleti, test/diff temizleme', () => {
  const optimizer = new OutputOptimizer();

  // 1. Kısa dosya ham dönmeli
  const shortCode = 'export function hello() { return "world"; }\n';
  const shortResult = optimizer.optimizeReadFile('src/short.ts', shortCode);
  assert.strictEqual(shortResult, shortCode);

  // 2. Büyük dosya için AST iskeleti üretilmeli
  const largeLines: string[] = [];
  for (let i = 0; i < 250; i++) {
    if (i % 20 === 0) {
      largeLines.push(`export class ServiceBlock${i} {`);
      largeLines.push(`  public executeTask${i}(): void {}`);
      largeLines.push(`}`);
    } else {
      largeLines.push(`  const x${i} = ${i};`);
    }
  }
  const largeCode = largeLines.join('\n');
  const skeleton = optimizer.optimizeReadFile('src/largeService.ts', largeCode);
  assert.ok(skeleton.includes('Dosya İskeleti'));
  assert.ok(skeleton.includes('ServiceBlock0'));
  assert.ok(!skeleton.includes('x42 = 42;')); // Gövde satırları elenmeli

  // 3. Başarılı test çıktısı tek satıra indirgenmeli
  const verboseTestOutput =
    '✔ test/unit/a.test.ts (10ms)\n✔ test/unit/b.test.ts (12ms)\n✔ 162 pass\nℹ duration_ms 4200\n';
  const cleanTest = optimizer.optimizeTestOutput(verboseTestOutput);
  assert.ok(cleanTest.startsWith('✔ Testler başarıyla geçti'));
  assert.ok(!cleanTest.includes('a.test.ts (10ms)'));

  // 4. Hatalı test çıktısında hata satırları ve stack trace korunmalı
  const failTestOutput =
    '✔ test/a.test.ts\n✖ test/b.test.ts\nAssertionError [ERR_ASSERTION]: Expected true to be false\n at line 42\n';
  const errorTest = optimizer.optimizeTestOutput(failTestOutput);
  assert.ok(errorTest.includes('Test Hataları Özeti'));
  assert.ok(errorTest.includes('AssertionError'));
  assert.ok(!errorTest.includes('✔ test/a.test.ts'));

  // 5. Diff çıktısından lockfile elenmeli
  const rawDiff =
    'diff --git a/package-lock.json b/package-lock.json\n+10000 satır json\ndiff --git a/src/index.ts b/src/index.ts\n+console.log(1);\n';
  const cleanDiff = optimizer.optimizeDiffOutput(rawDiff);
  assert.ok(cleanDiff.includes('Kilit dosyası / statik asset diff gövdesi token tasarrufu için elendi'));
  assert.ok(cleanDiff.includes('src/index.ts'));
});

test('ToolDeduplicator: hash ve mtime bazlı yinelenen okuma engeli', () => {
  const deduper = new ToolDeduplicator();
  const filePath = 'src/config.ts';
  const content = 'export const PORT = 3000;\n';
  const mtime = 1700000000000;

  // İlk okuma çalışmalı
  const first = deduper.checkFileRead(filePath, mtime, content);
  assert.strictEqual(first.isDuplicate, false);

  // Değişmeyen dosyanın ikinci okuması atlanmalı
  const second = deduper.checkFileRead(filePath, mtime, content);
  assert.strictEqual(second.isDuplicate, true);
  assert.ok(second.note?.includes('Yinelenen Okuma Atlandı'));

  // Dosya güncellenince önbellek düşmeli
  deduper.invalidateFile(filePath);
  const afterInvalidate = deduper.checkFileRead(
    filePath,
    mtime + 1000,
    content + 'export const HOST = "127.0.0.1";\n'
  );
  assert.strictEqual(afterInvalidate.isDuplicate, false);
});

test('RelevanceScorer & ContextOptimizer: puanlama ve reaktif düşürme', () => {
  const scorer = new RelevanceScorer();
  const sysScore = scorer.scoreMessage({ role: 'system', content: 'Instruction' }, 0, 5);
  assert.strictEqual(sysScore.score, 1.0);

  const errorScore = scorer.scoreMessage(
    { role: 'tool', toolCallId: 'c1', content: 'Error: Cannot find module' },
    2,
    10
  );
  assert.strictEqual(errorScore.score, 0.85);

  const optimizer = new ContextOptimizer();
  const filePath = 'src/session.ts';
  const initialContent = 'export interface UserSession { id: string; }\nexport function createSession() {}\n';
  const hash = 'abc123hash';

  // Dosya içgörüsü kaydedilir
  optimizer.recordFileInsight(filePath, initialContent, hash);
  const insight = optimizer.getInsight(filePath);
  assert.strictEqual(insight?.exportedSymbols.includes('UserSession'), true);

  // Sohbette bu dosyaya ait eski bir okuma var
  const messages: ProviderMessage[] = [
    { role: 'system', content: 'You are an agent.' },
    { role: 'user', content: 'Fix the session handling.' },
    {
      role: 'tool',
      toolCallId: 'call_1',
      content: `[file:${filePath} · 500 satır]\n${'x'.repeat(2000)}`
    },
    { role: 'assistant', content: 'I will now edit this file.' }
  ];

  // Dosya düzenlendiğinde reaktif düşürme çalışır
  const updated = optimizer.reactiveEvict(messages, filePath, '+5 satır eklendi');
  const toolMsg = updated.find((m) => m.role === 'tool');
  assert.ok(toolMsg?.content.includes('sürüm 2 olarak düzenlendi'));
  assert.ok(toolMsg?.content.includes('Korunan Semboller/Sözleşmeler: UserSession'));
  assert.ok(!toolMsg?.content.includes('x'.repeat(500))); // Ham gövde atılmış olmalı
});

test('StructuredWorkingMemory: yapılandırılmış hafıza kartı', () => {
  const memory = new StructuredWorkingMemory('OAuth2 Yenileme');
  memory.addCompletedStep('TokenStore oluşturuldu');
  memory.recordModifiedFile('src/TokenStore.ts', 45, 10, 'verified');
  memory.addOpenDecision('Refresh token ömrü 7 gün');
  memory.setNextImmediateStep('TokenValidator testlerini çalıştır');

  const formatted = memory.formatForPrompt();
  assert.ok(formatted.includes('<working_memory>'));
  assert.ok(formatted.includes('OAuth2 Yenileme'));
  assert.ok(formatted.includes('TokenStore oluşturuldu'));
  assert.ok(formatted.includes('src/TokenStore.ts (+45/-10'));
  assert.ok(formatted.includes('TokenValidator testlerini çalıştır'));
});

test('ProviderCacheManager & TokenObservability: önbellek ve metrik takibi', () => {
  const cacheManager = new ProviderCacheManager();
  const observability = new TokenObservability();

  // 1. Önbellek stratejisi
  assert.strictEqual(cacheManager.getProviderStrategy('evren'), 'byte-stable-prefix');
  assert.strictEqual(cacheManager.getProviderStrategy('openrouter'), 'ephemeral-breakpoint');

  // 2. Metrik kaydı ve özet hesabı
  observability.recordCall({
    callId: 'call_1',
    stage: 'build',
    inputTokens: 3_000,
    outputTokens: 500,
    cachedTokens: 2_100,
    toolSchemaTokens: 800,
    contextTokens: 2_200,
    latencyMs: 1_200,
    success: true,
    timestamp: Date.now()
  });

  const summary = observability.getSummary();
  assert.strictEqual(summary.totalCalls, 1);
  assert.strictEqual(summary.cacheHitRatePercent, 70); // 2100 / 3000 = %70
  assert.ok(summary.estimatedCostReductionPercent >= 50);

  const report = observability.formatReport();
  assert.ok(report.includes('%70 İsabet'));
  assert.ok(report.includes('Tahmini Maliyet Tasarrufu'));
});

test('TokenOptimizationEngine: uçtan uca merkezi optimizasyon', () => {
  const engine = new TokenOptimizationEngine({
    contextWindowTokens: 96_000,
    providerType: 'evren',
    initialGoal: 'Kullanıcı giriş modülünü tamamla'
  });

  // 1. Alet optimizasyonu (intake aşamasında şema indirgeme)
  const { tools, stats } = engine.optimizeToolsForStage(MODEL_TOOLS, 'intake', 'code');
  assert.ok(tools.length < MODEL_TOOLS.length);
  assert.ok(stats.reductionPercentage >= 50);

  // 2. Çıktı optimizasyonu
  const testOutput = engine.optimizeToolOutput('run_tests', '✔ 40 pass in 1.1s\n');
  assert.ok(testOutput.includes('Testler başarıyla geçti'));

  const largeCodeLines: string[] = [];
  for (let i = 0; i < 220; i++) {
    largeCodeLines.push(`export function func${i}(): number { return ${i}; }`);
  }
  const largeFileBody = largeCodeLines.join('\n');
  // Standart { path } parametresiyle AST iskeletlemesi çalışmalı
  const readOptimized = engine.optimizeToolOutput('read_file', largeFileBody, {
    path: 'src/api/largeFile.ts'
  });
  assert.ok(readOptimized.includes('Dosya İskeleti'));
  assert.ok(readOptimized.includes('func0'));

  // Standart { path } parametresiyle deduplication çalışmalı
  const dedupRes = engine.checkToolDeduplication('read_file', { path: 'src/api/largeFile.ts' }, () => ({
    content: largeFileBody,
    mtimeMs: 123456
  }));
  assert.strictEqual(dedupRes.isDuplicate, false);
  const dedupRes2 = engine.checkToolDeduplication('read_file', { path: 'src/api/largeFile.ts' }, () => ({
    content: largeFileBody,
    mtimeMs: 123456
  }));
  assert.strictEqual(dedupRes2.isDuplicate, true);

  // 3. Dosya mutasyonu ve reaktif bağlam kurulumu
  engine.handleFileMutation('src/auth.ts', 'export function login() {}\n', 15, 2);
  const memoryPrompt = engine.workingMemory.formatForPrompt();
  assert.ok(memoryPrompt.includes('src/auth.ts (+15/-2'));

  // 4. Konuşma kurulumu
  const conv = engine.assembleOptimizedConversation(
    'System prompt byte stable',
    [{ role: 'user', content: 'Test prompt' }],
    'build',
    ['src/auth.ts']
  );
  assert.strictEqual(conv.messages[0]?.role, 'system');
  assert.ok(conv.messages.some((m) => m.content.includes('<working_memory>')));

  // 5. Metrik kaydı
  engine.recordApiCallMetrics(
    {
      callId: 'api_1',
      stage: 'build',
      inputTokens: 2_000,
      outputTokens: 300,
      cachedTokens: 1_500,
      toolSchemaTokens: 600,
      contextTokens: 1_400,
      latencyMs: 900,
      success: true,
      timestamp: Date.now()
    },
    'build'
  );

  const budgetStatus = engine.getPhaseBudgetStatus('build');
  assert.strictEqual(budgetStatus.spentTokens, 2_300);
});
