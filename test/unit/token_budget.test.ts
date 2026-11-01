import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert';
import { ModelCompletionResponse, ModelProvider, ProviderMessage } from '@evren-kod/core/providers/base';
import { createAgent, createWorkspaceTracker, stub } from '../support/agentHarness';

/**
 * Token bütçesi sözleşmesi (`evren-kod.maxTokensPerTask`).
 *
 * 1. Bütçe kontrolü bir sonraki model çağrısından ÖNCE yapılır: duraklatılan
 *    turda model çağrısı yapılmaz, yarım işlenmiş araç çağrısı ve boşa
 *    harcanan yanıt kalmaz.
 * 2. Kullanım bilgisi ancak yanıtın sonunda geldiği için aşım en fazla bir
 *    model yanıtıyla sınırlıdır.
 * 3. 0 (varsayılan) sınırsız demektir; bütçe aşılmadıkça görev normal biter.
 */
class CountingProvider implements ModelProvider {
  public readonly id = 'counting';
  public readonly name = 'Counting';
  public calls = 0;

  constructor(private readonly responses: ModelCompletionResponse[]) {}

  async sendMessage(_messages: ProviderMessage[]): Promise<ModelCompletionResponse> {
    const response = this.responses[this.calls] ?? { text: 'done' };
    this.calls++;
    return response;
  }
}

const { create: workspace, cleanup } = createWorkspaceTracker('evren-kod-token-budget-');

// Salt-okunur araç çağrısı: onay gerektirmez, bütçe kontrolünü tur içinde
// ikinci model çağrısına taşımak için kullanılır.
const listCall: ModelCompletionResponse = {
  text: '',
  toolCalls: [{ id: 'ls_1', name: 'list_directory', arguments: { path: '.' } }],
  usage: { promptTokens: 90, completionTokens: 60, totalTokens: 150, cachedTokens: 60 }
};

describe('Token bütçesi (maxTokensPerTask)', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  after(async () => {
    await cleanup();
  });

  it('bütçe aşıldığında sonraki model çağrısından önce duraklatır', async () => {
    const root = await workspace();
    const provider = new CountingProvider([listCall, { text: 'bitti' }]);
    const { core, notifications } = createAgent(provider, root, {
      autonomy: 'guided',
      maxTokensPerTask: 100
    });

    await core.handleSendMessage('dosyaları listele');

    assert.strictEqual(core.getState().status, 'paused', 'görev duraklatılmış olmalı');
    assert.strictEqual(
      provider.calls,
      1,
      'ikinci model çağrısı yapılmamalı: duraklatılan turda token harcanmaz'
    );
    assert.strictEqual(core.getState().stats.totalTokens, 150, 'kullanım toplanmalı');
    const stats = core.getState().stats;
    assert.strictEqual(stats.promptTokens, 90, 'giden token kırılımı toplanmalı');
    assert.strictEqual(stats.completionTokens, 60, 'gelen token kırılımı toplanmalı');
    assert.strictEqual(stats.cachedTokens, 60, 'önbellek okuması kırılımı toplanmalı');
    assert.ok(
      notifications.some((message) => message.includes('Token bütçesi')),
      'kullanıcıya neden duraklatıldığı bildirilmeli'
    );
    // Yarım tur kalmamalı: duraklatma, akış mesajı eklenmeden önce olur.
    const lastMessage = core.getState().messages[core.getState().messages.length - 1];
    assert.ok(lastMessage, 'en az bir mesaj olmalı');
    assert.notStrictEqual(
      lastMessage?.role === 'assistant' && lastMessage?.content === '' && lastMessage?.isStreaming,
      true,
      'boş bir akış mesajı bırakılmamalı'
    );
  });

  it('0 (sınırsız) bütçede görevi duraklatmaz', async () => {
    const root = await workspace();
    const provider = new CountingProvider([listCall, { text: 'bitti' }]);
    const { core, notifications } = createAgent(provider, root, {
      autonomy: 'guided',
      maxTokensPerTask: 0
    });

    await core.handleSendMessage('dosyaları listele');

    assert.strictEqual(core.getState().status, 'completed', 'görev normal bitmeli');
    assert.strictEqual(provider.calls, 2, 'tur tamamlanmalı');
    assert.ok(
      !notifications.some((message) => message.includes('Token bütçesi')),
      'sınırsız bütçede bütçe uyarısı olmamalı'
    );
  });

  it('bütçe aşılmadığında görevi duraklatmaz', async () => {
    const root = await workspace();
    const provider = new CountingProvider([listCall, { text: 'bitti' }]);
    const { core } = createAgent(provider, root, {
      autonomy: 'guided',
      maxTokensPerTask: 100_000
    });

    await core.handleSendMessage('dosyaları listele');

    assert.strictEqual(core.getState().status, 'completed', 'görev normal bitmeli');
    assert.strictEqual(provider.calls, 2, 'tur tamamlanmalı');
  });
});
