import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert';
import { ModelCompletionResponse, ModelProvider, ProviderMessage } from '@evren-kod/core/providers/base';
import { createAgent, createWorkspaceTracker, stub } from '../support/agentHarness';

/**
 * Token kullanım muhasebesi sözleşmesi.
 *
 * Token bütçesi ayarı bilinçli olarak emekliye ayrıldı: harcama kontrolü
 * kırpma/sıkıştırmayla yapılır, görev asla sayısal bir token limitinde
 * durdurulmaz. Bu test kalan sözleşmeyi korur:
 *
 * 1. Sağlayıcı usage döndürdüğünde toplam/giden/gelen/önbellek kırılımları
 *    tur içi her model çağrısından sonra görev istatistiklerine eklenir.
 * 2. Kullanım bilgisi raporlanmayan yanıtlar sayıları bozmaz.
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

const { create: workspace, cleanup } = createWorkspaceTracker('evren-kod-token-usage-');

// Salt-okunur araç çağrısı: onay gerektirmez, ikinci model çağrısını üretir.
const listCall: ModelCompletionResponse = {
  text: '',
  toolCalls: [{ id: 'ls_1', name: 'list_directory', arguments: { path: '.' } }],
  usage: { promptTokens: 90, completionTokens: 60, totalTokens: 150, cachedTokens: 60 }
};

const finalCall: ModelCompletionResponse = {
  text: 'bitti',
  usage: { promptTokens: 200, completionTokens: 40, totalTokens: 240 }
};

describe('Token kullanım muhasebesi', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  after(async () => {
    await cleanup();
  });

  it('kullanım kırılımları tur içi her model çağrısından toplanır', async () => {
    const root = await workspace();
    const provider = new CountingProvider([listCall, finalCall]);
    const { core } = createAgent(provider, root, { autonomy: 'guided' });

    await core.handleSendMessage('dosyaları listele');

    assert.strictEqual(core.getState().status, 'completed', 'görev normal bitmeli');
    assert.strictEqual(provider.calls, 2, 'tur tamamlanmalı');
    const stats = core.getState().stats;
    assert.strictEqual(stats.totalTokens, 390, 'toplam kullanım toplanmalı');
    assert.strictEqual(stats.promptTokens, 290, 'giden token kırılımı toplanmalı');
    assert.strictEqual(stats.completionTokens, 100, 'gelen token kırılımı toplanmalı');
    assert.strictEqual(stats.cachedTokens, 60, 'önbellek okuması kırılımı toplanmalı');
  });

  it('kullanım raporlanmayan yanıtlarda sayaçları bozmaz', async () => {
    const root = await workspace();
    const provider = new CountingProvider([{ text: 'doğrudan cevap' }]);
    const { core } = createAgent(provider, root, { autonomy: 'guided' });

    await core.handleSendMessage('selam');

    assert.strictEqual(core.getState().status, 'completed', 'görev normal bitmeli');
    assert.strictEqual(core.getState().stats.totalTokens, 0, 'usage yoksa sayaç 0 kalmalı');
  });
});
