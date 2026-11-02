import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert';
import { ModelCompletionResponse, ModelProvider, ProviderMessage } from '@evren-kod/core/providers/base';
import { createAgent, createWorkspaceTracker, stub } from '../support/agentHarness';

/**
 * Alt ajan raporu kırpma sözleşmesi.
 *
 * Alt ajan ve paralel görev raporları ana ajanın geçmişine yazılır ve her
 * adımda yeniden gönderilir. Diğer tüm araç çıktılarının geçtiği merkezi
 * kırpma tüneli (`truncateToolOutput`) bu özel yollardan da geçmelidir;
 * aksi hâlde `TOOL_OUTPUT_LIMITS.invoke_subagent` / `run_parallel_tasks`
 * ölü ayar olur ve uzun bir rapor tüm oturum boyunca taşınır.
 */
class ScriptedFlowProvider implements ModelProvider {
  public readonly id = 'flow';
  public readonly name = 'Flow';
  public calls = 0;

  constructor(private readonly responses: ModelCompletionResponse[]) {}

  async sendMessage(_messages: ProviderMessage[]): Promise<ModelCompletionResponse> {
    const response = this.responses[this.calls] ?? { text: 'done' };
    this.calls++;
    return response;
  }
}

const { create: workspace, cleanup } = createWorkspaceTracker('evren-kod-report-trim-');

// Çeşitli satırlardan ~30 KB rapor: tekrar çökmesi bekçisini tetiklemeden
// kırpma eşiğinin açıkça üstünde kalır.
const verboseReport = Array.from(
  { length: 500 },
  (_, i) => `bulgu ${i}: ${(i * 7919).toString(36)} numaralı inceleme_notu ${(i * 104729).toString(36)}`
).join('\n');

describe('Alt ajan raporu kırpma tüneli', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  after(async () => {
    await cleanup();
  });

  it('invoke_subagent sonucu merkezi araç çıktı sınırından geçer', async () => {
    const root = await workspace();
    const invoke = new ScriptedFlowProvider([
      {
        text: '',
        toolCalls: [
          { id: 'sub_1', name: 'invoke_subagent', arguments: { role: 'security', task: 'depoyu incele' } }
        ]
      },
      { text: verboseReport },
      { text: 'bitti' }
    ]);
    const { core } = createAgent(invoke, root, { autonomy: 'guided' });

    await core.handleSendMessage('güvenlik incelemesi yap');

    assert.strictEqual(core.getState().status, 'completed', 'görev normal bitmeli');
    const subagentCall = core
      .getState()
      .messages.flatMap((m) => m.toolCalls || [])
      .find((tc) => tc.name === 'invoke_subagent');
    assert.ok(subagentCall, 'invoke_subagent çağrısı bulunmalı');
    assert.strictEqual(subagentCall?.status, 'completed', 'alt ajan tamamlanmalı');
    assert.ok(subagentCall?.result, 'sonuç saklanmalı');
    assert.ok(
      subagentCall!.result!.length < verboseReport.length,
      `uzun rapor kırpılmalıydı: ${subagentCall!.result!.length} / ${verboseReport.length}`
    );
    assert.match(subagentCall!.result!, /truncated/, 'kırpma işareti modele görünmeli');
  });
});
