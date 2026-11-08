import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ChatMessage, TaskState, UserSettings } from '@evren-kod/core/shared/types';
import { VerificationController } from '../../src/core/agent/verificationController';
import type { VerificationHost } from '../../src/core/agent/agentHost';
import { VerificationManager } from '@evren-kod/core/core/verification/VerificationManager';

/**
 * Otomatik doğrulama denetleyicisi.
 *
 * Bu yol "testler geçti" iddiasının makine tarafıdır (INVARIANTS 8): yanlış
 * başarı, yanlış onarım bütçesi ve iptal sırasında durum sızması burada
 * yakalanmalı. Testler gerçek `VerificationManager` yerine küçük bir sahte
 * kullanır; amaç doğrulama komutlarını değil karar akışını sınamaktır.
 */

type Result = Awaited<ReturnType<VerificationManager['verify']>>;

function result(partial: Partial<Result> = {}): Result {
  return {
    status: 'passed',
    steps: [],
    failedSteps: [],
    summary: 'ok',
    failureSignature: [],
    durationMs: 1,
    ranAt: Date.now(),
    ...partial
  };
}

const settings: UserSettings = {
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: { readFiles: true, writeFiles: false, executeCommands: false },
  autoVerify: true,
  maxRepairAttempts: 2,
  useIntegratedTerminal: false
};

interface Harness {
  host: VerificationHost;
  notifications: Array<{ level: string; message: string }>;
  saved: number;
  emitted: number;
  state: TaskState;
  verifyCalls: Array<{ kinds?: string[] }>;
}

/**
 * Sahte konak: durum, bildirim ve kalıcılık sayaçları. `verifyQueue`
 * sırayla döner; böylece "önce hata, sonra geçti" akışları kurulabilir.
 */
function harness(verifyQueue: Result[], overrides: Partial<VerificationHost> = {}): Harness {
  const state: TaskState = {
    id: 'task_1',
    prompt: 'deneme',
    mode: 'code',
    status: 'running',
    messages: [] as ChatMessage[],
    stats: {
      totalTokens: 0,
      stepsCount: 0,
      filesModified: [],
      verification: { status: 'not_run', attempts: 0 }
    }
  };
  const notifications: Array<{ level: string; message: string }> = [];
  const verifyCalls: Array<{ kinds?: string[] }> = [];
  let saved = 0;
  let emitted = 0;
  let seq = 0;

  const manager = new VerificationManager();
  manager.verify = (async (_root: string | undefined, options: { kinds?: string[] } = {}) => {
    verifyCalls.push({ kinds: options.kinds });
    return verifyQueue.shift() ?? result();
  }) as VerificationManager['verify'];
  manager.getNewFailures = (r: Result) => r.failureSignature;
  manager.getBaseline = () => undefined;
  manager.formatForPrompt = (r: Result) => `[verify ${r.status}]`;

  const host = {
    context: {} as never,
    state,
    settings,
    isCancelled: false,
    runGeneration: 1,
    notify: (n: { level: string; message: string }) => notifications.push(n),
    emitState: () => {
      emitted += 1;
    },
    saveCurrentState: async () => {
      saved += 1;
    },
    isBusy: () => false,
    nextMessageId: () => `m_${++seq}`,
    verificationManager: manager,
    projectMemory: {
      append: async () => undefined
    } as unknown as VerificationHost['projectMemory'],
    vectorMemory: {
      sync: async () => undefined
    } as unknown as VerificationHost['vectorMemory'],
    repairAttempts: 0,
    lastVerificationSkip: '',
    ...overrides
  } as unknown as VerificationHost;

  return {
    host,
    notifications,
    state,
    verifyCalls,
    get saved() {
      return saved;
    },
    get emitted() {
      return emitted;
    }
  };
}

describe('VerificationController: görev sonu doğrulaması', () => {
  it('geçen doğrulama "done" döner ve onarım sayacını sıfırlar', async () => {
    const h = harness([result({ status: 'passed' })]);
    h.host.repairAttempts = 1;
    const controller = new VerificationController(h.host);

    const outcome = await controller.runEndOfTaskVerification('/ws', 1);

    assert.equal(outcome, 'done');
    assert.equal(h.host.repairAttempts, 0);
    assert.equal(h.state.stats.verification?.status, 'passed');
    assert.equal(h.state.stats.verification?.summary, 'ok');
  });

  it('yeni hata varsa onarım talimatı enjekte eder ve "retry" döner', async () => {
    const failed = result({ status: 'failed', failureSignature: ['tsc: hata'] });
    const h = harness([failed]);
    const controller = new VerificationController(h.host);

    const outcome = await controller.runEndOfTaskVerification('/ws', 1);

    assert.equal(outcome, 'retry');
    assert.equal(h.host.repairAttempts, 1);
    const repair = h.state.messages.at(-1);
    assert.equal(repair?.role, 'system');
    assert.match(repair?.content ?? '', /verify failed/);
    assert.ok(h.notifications.some((n) => n.level === 'warning' && /1\/2/.test(n.message)));
  });

  it('onarım bütçesi tükenince görevi "failed" yapar ve "abort" döner', async () => {
    const failed = result({ status: 'failed', failureSignature: ['tsc: hata'] });
    const h = harness([failed]);
    h.host.repairAttempts = 2; // varsayılan bütçe 2
    const controller = new VerificationController(h.host);

    const outcome = await controller.runEndOfTaskVerification('/ws', 1);

    assert.equal(outcome, 'abort');
    assert.equal(h.state.status, 'failed');
    assert.ok(h.notifications.some((n) => n.level === 'error' && /onarım sınırına/.test(n.message)));
  });

  it('yalnızca önceden var olan hatalar bütçeyi tüketmez', async () => {
    const failed = result({ status: 'failed', failureSignature: ['eski hata'] });
    const h = harness([failed]);
    h.host.verificationManager.getBaseline = () => result({ status: 'failed' });
    h.host.verificationManager.getNewFailures = () => []; // hepsi başlangıçta vardı
    const controller = new VerificationController(h.host);

    const outcome = await controller.runEndOfTaskVerification('/ws', 1);

    assert.equal(outcome, 'done');
    assert.equal(h.host.repairAttempts, 0);
  });

  it('iptal edilen doğrulama sonucu durumu değiştirmeden "abort" döner', async () => {
    const h = harness([result({ status: 'failed', failureSignature: ['x'] })]);
    h.host.isCancelled = true;
    const controller = new VerificationController(h.host);

    const outcome = await controller.runEndOfTaskVerification('/ws', 1);

    assert.equal(outcome, 'abort');
    assert.notEqual(h.state.status, 'failed');
  });

  it('oturum nesli değiştiyse eski sonuç yeni oturuma yazılmaz', async () => {
    const h = harness([result({ status: 'failed', failureSignature: ['x'] })]);
    const controller = new VerificationController(h.host);

    const outcome = await controller.runEndOfTaskVerification('/ws', 999);

    assert.equal(outcome, 'abort');
    assert.equal(h.host.repairAttempts, 0);
  });
});

describe('VerificationController: hızlı doğrulama', () => {
  it('yalnızca typecheck ve lint türlerini ister', async () => {
    const h = harness([result()]);
    const controller = new VerificationController(h.host);

    const outcome = await controller.runQuickVerification('/ws', 1);

    assert.equal(outcome, 'proceed');
    assert.deepEqual(h.verifyCalls[0]?.kinds, ['typecheck', 'lint']);
  });

  it('geçen doğrulamada durumu "passed" yazar ve sayaç sıfırlanır', async () => {
    const h = harness([result({ status: 'passed' })]);
    h.host.repairAttempts = 1;
    const controller = new VerificationController(h.host);

    await controller.runQuickVerification('/ws', 1);

    assert.equal(h.host.repairAttempts, 0);
    assert.equal(h.state.stats.verification?.status, 'passed');
  });

  it('atlanan doğrulamayı yalnızca bir kez bildirir (tekrar gürültüsü yok)', async () => {
    const skipped = result({ status: 'skipped', summary: 'test komutu yok' });
    const h = harness([skipped, skipped]);
    const controller = new VerificationController(h.host);

    await controller.runQuickVerification('/ws', 1);
    await controller.runQuickVerification('/ws', 1);

    const skipNotes = h.notifications.filter((n) => n.message === 'test komutu yok');
    assert.equal(skipNotes.length, 1);
  });

  it('önceden var olan hatalar notunu her turda çoğaltmaz, yerinde tazeler', async () => {
    const failed = result({ status: 'failed', failureSignature: ['eski'] });
    const h = harness([failed, failed]);
    h.host.verificationManager.getBaseline = () => result({ status: 'failed' });
    h.host.verificationManager.getNewFailures = () => [];
    const controller = new VerificationController(h.host);

    await controller.runQuickVerification('/ws', 1);
    await controller.runQuickVerification('/ws', 1);

    const notes = h.state.messages.filter((m) => m.content.includes('These errors existed before'));
    assert.equal(notes.length, 1, 'aynı öğüt her turda yeniden eklenmemeli');
  });

  it('yeni hata varsa onarım enjekte eder ve "retry" döner', async () => {
    const failed = result({ status: 'failed', failureSignature: ['yeni'] });
    const h = harness([failed]);
    const controller = new VerificationController(h.host);

    const outcome = await controller.runQuickVerification('/ws', 1);

    assert.equal(outcome, 'retry');
    assert.equal(h.host.repairAttempts, 1);
  });

  it('bütçe tükenince "abort" döner ve görev başarısız işaretlenir', async () => {
    const failed = result({ status: 'failed', failureSignature: ['yeni'] });
    const h = harness([failed]);
    h.host.repairAttempts = 2;
    const controller = new VerificationController(h.host);

    const outcome = await controller.runQuickVerification('/ws', 1);

    assert.equal(outcome, 'abort');
    assert.equal(h.state.status, 'failed');
  });

  it('iptal sırasında durum yazılmadan "abort" döner', async () => {
    const h = harness([result({ status: 'failed', failureSignature: ['x'] })]);
    h.host.isCancelled = true;
    const controller = new VerificationController(h.host);

    const outcome = await controller.runQuickVerification('/ws', 1);

    assert.equal(outcome, 'abort');
    assert.equal(h.state.status, 'running');
  });
});
