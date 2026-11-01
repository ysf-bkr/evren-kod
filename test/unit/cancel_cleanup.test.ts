import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert';
import { AgentCore } from '../../src/core/agent/AgentCore';
import { ModelCompletionResponse } from '@evren-kod/core/providers/base';
import { UserSettings } from '@evren-kod/core/shared/types';
import { ScriptedProvider, createWorkspaceTracker, stub } from '../support/agentHarness';

/**
 * İptal akışının kalıntı bırakmaması gerektiğini doğrular.
 *
 * Gerçek hata: `cancelTask` spec/plan onay kartını (`pendingApproval`)
 * temizlemiyordu. Kullanıcı kart görünürken "Durdur" dedikten sonra yeni
 * mesaj göndermeye çalışınca ajan "Onay bekleyen bir spec var" diye reddediyor
 * ve kullanıcıyı kilitliyordu.
 */
const settings: UserSettings = {
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: { readFiles: true, writeFiles: false, executeCommands: false },
  autoVerify: false,
  maxRepairAttempts: 0,
  useIntegratedTerminal: false
};

const { create: workspace, cleanup } = createWorkspaceTracker('evren-kod-cancel-');

const specCall: ModelCompletionResponse = {
  text: '',
  toolCalls: [
    {
      id: 'c1',
      name: 'write_spec',
      arguments: { goal: 'hedef', scope: ['src'], acceptanceCriteria: ['kriter'] }
    }
  ]
};

describe('İptal akışı: kalıntı temizliği', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  after(async () => {
    await cleanup();
  });

  it('cancelling while an approval card is pending unlocks new messages', async () => {
    const root = await workspace();
    const notifications: string[] = [];
    const core = new AgentCore(
      stub.createExtensionContext() as never,
      settings,
      () => {},
      (n) => notifications.push(n.message),
      undefined,
      { provider: new ScriptedProvider([specCall, { text: 'bitti' }]) }
    );
    stub.testState.workspaceRoot = root;

    await core.handleSendMessage('görev');
    assert.strictEqual(core.getState().pendingApproval?.kind, 'spec', 'spec kartı beklemeli');

    await core.cancelTask();
    assert.strictEqual(core.getState().status, 'cancelled');
    assert.strictEqual(core.getState().pendingApproval, undefined, 'iptal, onay kartını da temizlemeli');

    // Yeni mesaj reddedilmemeli.
    await core.handleSendMessage('yeni görev');
    const refused = notifications.some((message) => message.includes('Onay bekleyen'));
    assert.strictEqual(refused, false, 'iptal sonrası yeni mesaj onay kartına takılmamalı');
  });

  it('normalizes interrupted task to paused and allows resumeTask', async () => {
    const root = await workspace();
    stub.testState.workspaceRoot = root;
    const core = new AgentCore(
      stub.createExtensionContext() as never,
      settings,
      () => {},
      () => {},
      undefined,
      { provider: new ScriptedProvider([{ text: 'devam edildi ve bitti' }]) }
    );

    const savedState = {
      ...core.getState(),
      status: 'running' as const,
      messages: [{ id: 'm1', role: 'user' as const, content: 'ilk görev', timestamp: Date.now() }]
    };

    // Yeniden açılışta yarıda kalan görev duraklatılmış olarak geri yüklenir
    const restored = core.normalizeRestoredState(savedState);
    assert.strictEqual(restored.status, 'paused', 'kesintiye uğrayan görev paused olarak kurtarılmalı');

    core.state = restored;
    await core.resumeTask();
    assert.strictEqual(core.getState().status, 'completed', 'resumeTask görevi tamamlamalı');
    const lastMsg = core.getState().messages.slice(-1)[0];
    assert.strictEqual(lastMsg?.content, 'devam edildi ve bitti');
  });
});
