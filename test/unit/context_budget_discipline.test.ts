/**
 * Bağlam bütçesi ve muhasebe disiplini (token tasarrufu denetimi, 2. tur).
 *
 * Bu dosya denetimde bulunan M1/M2/H2/M3/M6/L3 maddelerinin GERÇEKTEN modele
 * giden talebi değiştirdiğini uçtan uca doğrular; yardımcı fonksiyonun
 * birim davranışını değil, sonucun kendisini test eder:
 *
 * 1. Sistem istemi bayt-kararlıdır; canlı görev durumu kuyrukta taşınır (M1).
 * 2. Spec/plan/modül/bilgi blokları bütçesini aşamaz, aşarsa not düşer (H2/M2).
 * 3. Budama, sahte `<system_context>` kuyruğunu değil GERÇEK kullanıcı sözünü korur (m.7).
 * 4. Kesilen isteklerin yakılan tokenı muhasebeye "tahmini" yazılır (M3).
 * 5. Stall mesajı fiilen silahlanan zaman aşımını söyler (L3).
 * 6. Kalıcılık kopyası eski araç gövdelerini budar, canlı nesneye dokunmaz (M6).
 */
import { describe, it, after, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ContextManager } from '@evren-kod/core/core/context/ContextManager';
import { SpecStore } from '@evren-kod/core/core/spec/SpecStore';
import { TaskPlanner } from '@evren-kod/core/core/plan/TaskPlanner';
import { ModulePlanner } from '@evren-kod/core/core/plan/ModulePlanner';
import { KnowledgeStore } from '@evren-kod/core/core/knowledge/KnowledgeStore';
import { SkillManager } from '@evren-kod/core/core/skills/SkillManager';
import { slimTaskForPersistence } from '@evren-kod/core/core/memory/sessionArchive';
import {
  OpenAICompatibleProvider,
  StreamInterruptedError,
  estimateTokensFromChars
} from '@evren-kod/core/providers/openai';
import { ModelCompletionResponse, ModelProvider, ProviderMessage } from '@evren-kod/core/providers/base';
import {
  MAX_MODULE_COUNT,
  MAX_PLAN_STEPS,
  MODULE_PROMPT_BUDGET_CHARS,
  SKILL_CONTEXT_LINE_CHARS,
  SPEC_PROMPT_BUDGET_CHARS
} from '@evren-kod/core/shared/constants';
import { createAgent, ScriptedProvider, stub } from '../support/agentHarness';

// Geçici çalışma alanları os.tmpdir() altında yalıtılır; after ile tamamı silinir.
const workspaceRoots: string[] = [];
async function workspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'evren-kod-budget-'));
  workspaceRoots.push(root);
  await fs.mkdir(path.join(root, '.evren-kod'), { recursive: true });
  return root;
}

after(async () => {
  await Promise.all(workspaceRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('Görev durumu blokları: istem bütçeleri (H2)', () => {
  it('tamamlanan plan adımları kimlik listesine sıkışır, açık adımlar tam kalır', () => {
    const planner = new TaskPlanner();
    planner.update({
      goal: 'Uzun görev',
      steps: Array.from({ length: 15 }, (_v, i) => ({
        title: `Bitmiş iş ${i} ${'detay'.repeat(30)}`,
        status: i < 12 ? 'completed' : 'pending'
      }))
    });
    const prompt = planner.formatForPrompt();
    assert.match(prompt, /12 step\(s\) already completed \(do not redo\)/);
    assert.ok(!prompt.includes('Bitmiş iş 0'), 'tamamlanan adımın tam başlığı taşınmamalı');
    assert.ok(prompt.includes('Bitmiş iş 14'), 'açık adım tam bağlamıyla kalmalı');
  });

  it('MAX_PLAN_STEPS üzeri plan reddedilir', () => {
    const planner = new TaskPlanner();
    assert.throws(
      () =>
        planner.update({
          goal: 'Şişirilmiş plan',
          steps: Array.from({ length: MAX_PLAN_STEPS + 1 }, (_v, i) => ({ title: `adım ${i}` }))
        }),
      /at most 60 steps/i
    );
  });

  it('MODÜL MAX_MODULE_COUNT üzeri harita reddedilir', () => {
    const planner = new ModulePlanner();
    assert.throws(
      () =>
        planner.update({
          goal: 'koca harita',
          modules: Array.from({ length: MAX_MODULE_COUNT + 1 }, (_v, i) => ({
            id: `m${i}`,
            name: `modül ${i}`,
            layer: 'domain',
            paths: ['src/x'],
            responsibility: 'r',
            ownerRole: 'backend'
          }))
        }),
      /at most 32 modules/i
    );
  });

  it('alan başına kapı şişmeyi önlerner; toplam bütçe aşılırsa not düşer', () => {
    // Kapı 1: tek başına dev sorumluluk metni satırında kırpılır.
    const clamped = new ModulePlanner();
    clamped.update({
      goal: 'şişkin',
      modules: Array.from({ length: 12 }, (_v, i) => ({
        id: `m${i}`,
        name: `modül ${i}`,
        layer: 'domain',
        paths: ['src/x'],
        responsibility: `sorumluluk ${'uzun'.repeat(300)}`,
        ownerRole: 'backend'
      }))
    });
    const clampedPrompt = clamped.formatForPrompt();
    assert.ok(
      clampedPrompt.length <= MODULE_PROMPT_BUDGET_CHARS,
      `alan kapıları tek başına yetmeli (${clampedPrompt.length})`
    );
    assert.match(clampedPrompt, /responsibility: sorumluluk uzun[^…]*…/);

    // Kapı 2: 30 meşru modülün her satırı kapıdan geçse de toplam taşar → trim + not.
    const many = new ModulePlanner();
    many.update({
      goal: 'kalabalık',
      modules: Array.from({ length: 30 }, (_v, i) => ({
        id: `m${i}`,
        name: `modül ${i}`,
        layer: 'domain',
        paths: ['src/x'],
        responsibility: `sorumluluk ${'dolgu'.repeat(40)}`,
        ownerRole: 'backend'
      }))
    });
    const manyPrompt = many.formatForPrompt();
    assert.ok(
      manyPrompt.length <= MODULE_PROMPT_BUDGET_CHARS + 900,
      `toplam gövde bütçeyi aşamaz (${manyPrompt.length})`
    );
    assert.match(manyPrompt, /compacted to fit the prompt budget/);
  });

  it('dev spec bloğu SPEC_PROMPT_BUDGET_CHARS ile sınırlıdır', async () => {
    const root = await workspace();
    const store = new SpecStore();
    const spec = await store.create(root, {
      goal: 'hedef '.repeat(2_000),
      scope: ['kapsam '.repeat(500)],
      acceptanceCriteria: Array.from({ length: 40 }, (_v, i) => `kriter ${i} ${'x'.repeat(80)}`)
    });
    // Depoda 40 üstü kriter artık kayıt kapısından geçmez; eski sürüm
    // dosyalarından öyle spec'ler yüklenmiş olabilir. Biçimlendiricinin
    // kapıyı ve notu GEÇMİŞTEN GELEN veriye karşı da kurması gerekir.
    spec.acceptanceCriteria.push(
      ...Array.from({ length: 10 }, (_v, i) => ({
        id: `ac-legacy-${i}`,
        text: `eski kriter ${i}`,
        done: false
      }))
    );
    const prompt = store.formatForPrompt(spec.id);
    assert.ok(
      prompt.length <= SPEC_PROMPT_BUDGET_CHARS + 500,
      `spec bloğu bütçeyi aşamaz (${prompt.length})`
    );
    assert.match(prompt, /further criteria exist/);
  });
});

describe('Bilgi tabanı: tek tüketilen bütçe (M2)', () => {
  it('kırk özet bütçenin üstüne çıkamaz; sığmayanlar sayıyla bildirilir', async () => {
    const root = await workspace();
    for (let i = 0; i < 45; i++) {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', `m${i}.ts`), `export const m${i} = ${i};\n`);
    }
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);
    for (let i = 0; i < 45; i++) {
      await store.setSummary(root, `src/m${i}.ts`, `özet ${i} ${'dolgu'.repeat(400)}`);
    }
    const prompt = store.formatForPrompt();
    assert.ok(prompt.length <= 9_500, `bilgi tabanı toplam bütçeyi aşamaz (${prompt.length})`);
    assert.match(prompt, /more summaries available/);
  });
});

describe('Budama gerçek kullanıcı sözünü korur (denetim m.7)', () => {
  it('<system_context> kuyruğu feda edilir, gerçek istek aynen kalır', () => {
    const manager = new ContextManager({ contextWindowTokens: 2_000, compactionTokenRatio: 0 });
    const realRequest = `GERCEK-ISTEK: şunu yap ${'ayrıntı'.repeat(60)}`;
    const messages: ProviderMessage[] = [{ role: 'system', content: 'sistem istemi' }];
    for (let i = 0; i < 6; i++) {
      messages.push({
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: `c${i}`,
            name: 'read_file',
            arguments: { path: `f${i}` }
          }
        ]
      });
      messages.push({ role: 'tool', toolCallId: `c${i}`, content: 'x'.repeat(3_000) });
    }
    messages.push({ role: 'user', content: realRequest });
    messages.push({ role: 'user', content: `<system_context>${'KUYRUK '.repeat(600)}</system_context>` });

    const pruned = manager.pruneMessages(messages);
    assert.ok(
      pruned.some((m) => m.role === 'user' && m.content === realRequest),
      'gerçek kullanıcı mesajı budanmamış hâlde korunmalı'
    );
    assert.ok(
      manager.estimateMessagesTokens(pruned) < manager.estimateMessagesTokens(messages),
      'toplam baskı azalmış olmalı'
    );
  });
});

describe('Kesilen istek muhasebesi (M3)', () => {
  class FailingProvider implements ModelProvider {
    public readonly id = 'failing';
    public readonly name = 'Failing';
    calls = 0;

    constructor(private readonly error: Error) {}

    async sendMessage(): Promise<ModelCompletionResponse> {
      this.calls++;
      throw this.error;
    }
  }

  it('takılan akışın tahmini yakımı görev istatistiklerine işlenir', async () => {
    const root = await workspace();
    const error = new StreamInterruptedError('Model stream stalled for 2 sec; the request was stopped.', {
      promptTokens: 600,
      completionTokens: 100,
      totalTokens: 700,
      estimated: true
    });
    const provider = new FailingProvider(error);
    const { core } = createAgent(provider, root, { autonomy: 'guided' });

    await core.handleSendMessage('bir şey yap');

    const stats = core.getState().stats;
    assert.strictEqual(core.getState().status, 'cancelled', 'kesinti iptal sayılır');
    assert.strictEqual(stats.totalTokens, 700, 'yakılan token buharlaşmamalı');
    assert.strictEqual(stats.estimatedTokens, 700, 'tahmini pay ayrı işaretlenmeli');
    assert.strictEqual(stats.promptTokens, 0, 'tahmini kullanım alt kırılıma yazılmamalı');
  });

  it('sağlayıcının gerçekten saydığı kesinti kırılıma da işlenir', async () => {
    const root = await workspace();
    const error = new StreamInterruptedError('Request cancelled by the user.', {
      promptTokens: 500,
      completionTokens: 200,
      totalTokens: 700
    });
    const provider = new FailingProvider(error);
    const { core } = createAgent(provider, root, { autonomy: 'guided' });

    await core.handleSendMessage('iptal edilecek iş');

    const stats = core.getState().stats;
    assert.strictEqual(stats.totalTokens, 700);
    assert.strictEqual(stats.promptTokens, 500, 'gerçek sayım alt kırılıma yazılmalı');
    assert.strictEqual(stats.completionTokens, 200);
  });
});

describe('Stall mesajı silahlanan zaman aşımını söyler (L3)', () => {
  const originalFetch = globalThis.fetch;

  after(() => {
    globalThis.fetch = originalFetch;
  });

  it('takılma hatası stallTimeoutMs değerini ve tahmini kullanım taşır', async () => {
    // Başlıklar gelir ama gövde hiç veri üretmez → stall zamanlayıcısı düşer.
    // Gerçek fetch abort'ta bekleyen okumayı reddeder; sahte akış da öyle
    // yapmalı, yoksa test zaman aşımına değil sonsuz beklemeye girer.
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const signal = init?.signal;
          const fail = () => controller.error(new Error('stream aborted'));
          if (signal) {
            if (signal.aborted) fail();
            else signal.addEventListener('abort', fail, { once: true });
          }
        }
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      });
    }) as typeof fetch;

    const provider = new OpenAICompatibleProvider({
      id: 'test',
      name: 'Test',
      apiKey: 'k',
      baseURL: 'http://127.0.0.1:9/v1',
      model: 'm',
      stallTimeoutMs: 1_000
    });

    await assert.rejects(
      provider.sendMessage([{ role: 'user', content: 'konuş' }], [], () => undefined),
      (err: unknown) => {
        assert.ok(
          err instanceof StreamInterruptedError,
          `StreamInterruptedError bekleniyordu: ${String(err)}`
        );
        assert.match(err.message, /stalled for 1 sec/, 'mesaj yapılandırılan değeri söylemeli');
        assert.strictEqual(err.usage.estimated, true, 'kullanım tahmini işaretli olmalı');
        assert.ok(err.usage.promptTokens >= estimateTokensFromChars('konuş'.length));
        return true;
      }
    );
  });
});

describe('Sistem istemi bayt-kararlı, görev durumu kuyrukta (M1)', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  // Gerçek zincir: spec → modül haritası → plan → araç → bitiş. Plan tur ORTASINDA
  // doğar; sistem istemi yine de beş çağrıda bayt aynı kalmalı, canlı durum
  // `<system_context>` kuyruğunda tazelenmelidir.
  const specCall: ModelCompletionResponse = {
    text: '',
    toolCalls: [
      {
        id: 'spec_1',
        name: 'write_spec',
        arguments: {
          goal: 'Dosyaları say',
          scope: ['src'],
          acceptanceCriteria: [
            'Dizin listelenir ve sayı raporlanır',
            'Geçersiz yolda hata mesajı gösterilir',
            'Boş dizin sınırında çökmez'
          ]
        }
      }
    ]
  };
  const moduleCall: ModelCompletionResponse = {
    text: '',
    toolCalls: [
      {
        id: 'modules_1',
        name: 'update_module_plan',
        arguments: {
          goal: 'Dosyaları say',
          modules: [
            {
              id: 'sayar',
              name: 'Sayar',
              layer: 'application',
              paths: ['src/a.ts'],
              responsibility: 'Dizini sayar',
              ownerRole: 'backend',
              criteria: ['ac-1']
            }
          ]
        }
      }
    ]
  };
  const planCall: ModelCompletionResponse = {
    text: '',
    toolCalls: [
      {
        id: 'plan_1',
        name: 'update_plan',
        arguments: {
          goal: 'Dosyaları say',
          steps: [{ title: 'Listele', moduleId: 'sayar', criteria: ['ac-1'] }]
        }
      }
    ]
  };

  it('plan tur ortasında doğsa da sistem istemi değişmez; plan kuyrukta taşınır', async () => {
    const root = await workspace();
    const provider = new ScriptedProvider([
      specCall,
      moduleCall,
      planCall,
      { text: '', toolCalls: [{ id: 'ls_1', name: 'list_directory', arguments: { path: '.' } }] },
      { text: 'bitti' }
    ]);
    const { core } = createAgent(provider, root, { autonomy: 'guided' });

    await core.handleSendMessage('dosyaları listele ve raporla');

    assert.strictEqual(core.getState().status, 'completed', `tur bitmeliydi: ${core.getState().status}`);
    assert.ok(core.planner.getPlan(), 'plan gerçek araç zinciriyle kurulmuş olmalı');
    assert.strictEqual(provider.requests.length, 5, 'beş model çağrısı olmalı');
    const systems = provider.requests.map((r) => r[0]);
    const firstSystem = systems[0];
    assert.ok(firstSystem, 'ilk isteğin başı sistem istemi olmalı');
    for (const system of systems) {
      assert.ok(system, 'her isteğin başı sistem istemi olmalı');
      assert.strictEqual(
        system.content,
        firstSystem.content,
        'sistem istemi her adımda bayt-kararlı kalmalı'
      );
      assert.ok(!system.content.includes('ACTIVE TASK PLAN'), 'canlı plan sistem istemine girmemeli');
    }
    const lastRequest = provider.requests[4];
    assert.ok(lastRequest, 'beşinci model çağrısı yapılmış olmalı');
    const lastQueue = lastRequest.filter(
      (m) => m.role === 'user' && m.content.trimStart().startsWith('<system_context>')
    );
    assert.ok(
      lastQueue.some((m) => m.content.includes('ACTIVE TASK PLAN')),
      'canlı plan son çağrının kuyruk bloğunda taşınmalı'
    );
    assert.ok(
      lastQueue.some((m) => m.content.includes('TASK SPEC')),
      'onaylı spec kuyrukta taşınmalı'
    );
  });
});

describe('Kalıcılık kopyası boyut kapısı (M6)', () => {
  it('en yeni 30 sonuç tam kalır, eskiler stublanır; canlı nesne dokunulmaz', () => {
    const task = {
      id: 't1',
      messages: Array.from({ length: 35 }, (_v, i) => ({
        id: `msg${i}`,
        role: 'assistant' as const,
        content: '',
        timestamp: i,
        toolCalls: [
          {
            id: `tc${i}`,
            name: 'read_file' as const,
            args: {},
            requiresApproval: false,
            status: 'completed' as const,
            result: `S${i} ${'gövde'.repeat(500)}`
          }
        ]
      }))
    };
    const slim = slimTaskForPersistence(task as never) as typeof task;

    const stubbed = slim.messages.filter((m) =>
      m.toolCalls?.[0]?.result?.includes('yer tasarrufu için kısaltıldı')
    );
    assert.strictEqual(stubbed.length, 5, '35 sonuçtan eskisi 5 tanesi kısalmalı');
    assert.ok(slim.messages[34]?.toolCalls?.[0]?.result?.startsWith('S34'), 'en yeni sonuç tam kalmalı');
    assert.ok(!slim.messages[34]?.toolCalls?.[0]?.result?.includes('kısaltıldı'));
    assert.strictEqual(
      task.messages[0]?.toolCalls?.[0]?.result?.length,
      'S0 '.length + 'gövde'.repeat(500).length,
      'canlı görev nesnesine dokunulmamalı'
    );
    // Kimlik korunur: stub başı, eski gövdenin ilk 400 karakterini taşır.
    assert.ok(slim.messages[0]?.toolCalls?.[0]?.result?.startsWith('S0 '));
  });
});

describe('Skill açıklama satırı kapısı (L4)', () => {
  it('600 karakterlik açıklama SKILL_CONTEXT_LINE_CHARS ile kapanır', async () => {
    const root = await workspace();
    const skillsDir = path.join(root, '.agents', 'skills');
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsDir, 'gevezelik.md'),
      `---\nname: gevezelik\ndescription: ${'uzun açıklama '.repeat(100)}\n---\nGövde.\n`
    );
    const manager = new SkillManager();
    await manager.loadWorkspaceCustomizations(root);
    const context = manager.getPromptContext();
    const line = context.split('\n').find((l) => l.includes('gevezelik')) || '';
    assert.ok(line.length <= SKILL_CONTEXT_LINE_CHARS + 40, `satır kapalı olmalı (${line.length})`);
    assert.ok(line.endsWith('…'), 'kırpılma işaretli olmalı');
  });
});
