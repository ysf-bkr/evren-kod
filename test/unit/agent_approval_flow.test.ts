import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { AgentCore } from '../../src/core/agent/AgentCore';
import { ModelCompletionResponse } from '@evren-kod/core/providers/base';
import {
  ScriptedProvider,
  createAgent,
  createWorkspaceTracker,
  stub,
  waitForState
} from '../support/agentHarness';

/**
 * Onay/iptal akışı uçtan uca testleri: kart beklemeleri, onay sonrası yazma
 * ve iptalin turu durdurması.
 */
const { create: createWorkspace, cleanup } = createWorkspaceTracker('evren-kod-agent-');

/** Oturumu spec/plan kapılarının ötesine geçirir; böylece değiştirici araçlar sunulur. */
function enterBuildStage(core: AgentCore): void {
  const workflow = core.getState().workflow;
  if (!workflow) return;
  workflow.stage = 'build';
  workflow.specApproved = true;
  workflow.planApproved = true;
  workflow.knowledgeReady = true;
  workflow.updatedAt = Date.now();
}

const writeToolCall: ModelCompletionResponse = {
  text: '',
  toolCalls: [
    {
      id: 'call_write_1',
      name: 'write_file',
      arguments: { path: 'src/created.ts', content: 'export const x = 1;\n' }
    }
  ]
};

describe('AgentCore: approval and cancellation', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  after(async () => {
    await cleanup();
  });

  it('pauses for approval before writing and writes only after approval', async () => {
    const root = await createWorkspace();
    const provider = new ScriptedProvider([writeToolCall, { text: 'Wrote the file.' }]);
    const { core, states } = createAgent(provider, root);
    enterBuildStage(core);

    const run = core.handleSendMessage('create src/created.ts');
    const pending = await waitForState(states, (state) => state.status === 'waiting_approval');

    assert.strictEqual(pending.pendingToolCall?.name, 'write_file');
    assert.ok(pending.pendingToolCall?.approvalReason, 'the UI must explain why approval is needed');
    // Kullanıcı yanıtlamadan önce hiçbir şey yazılmaz.
    await assert.rejects(() => fs.access(path.join(root, 'src', 'created.ts')));

    await core.approveTool(pending.pendingToolCall?.id ?? '');
    await run;

    const content = await fs.readFile(path.join(root, 'src', 'created.ts'), 'utf-8');
    assert.strictEqual(content, 'export const x = 1;\n');
    assert.strictEqual(core.getState().status, 'completed');
  });

  it('does not write when the approval is rejected', async () => {
    const root = await createWorkspace();
    const provider = new ScriptedProvider([writeToolCall, { text: 'Understood, no changes.' }]);
    const { core, states } = createAgent(provider, root);
    enterBuildStage(core);

    const run = core.handleSendMessage('create src/created.ts');
    const pending = await waitForState(states, (state) => state.status === 'waiting_approval');
    await core.rejectTool(pending.pendingToolCall?.id ?? '', 'not now');
    await run;

    await assert.rejects(() => fs.access(path.join(root, 'src', 'created.ts')));
    const rejected = core.getState().messages.flatMap((message) => message.toolCalls ?? []);
    assert.strictEqual(rejected.at(-1)?.status, 'rejected');
  });

  it('cancelling while an approval is pending stops the turn', async () => {
    const root = await createWorkspace();
    const provider = new ScriptedProvider([writeToolCall, { text: 'should never run' }]);
    const { core, states } = createAgent(provider, root);
    enterBuildStage(core);

    const run = core.handleSendMessage('create src/created.ts');
    await waitForState(states, (state) => state.status === 'waiting_approval');

    await core.cancelTask();
    await run;

    assert.strictEqual(core.getState().status, 'cancelled');
    await assert.rejects(() => fs.access(path.join(root, 'src', 'created.ts')));
  });

  it('plan mode never offers a write tool for approval', async () => {
    const root = await createWorkspace();
    const provider = new ScriptedProvider([writeToolCall, { text: 'Plan only.' }]);
    const { core, states } = createAgent(provider, root);

    await core.handleSendMessage('plan the change', 'plan');
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.ok(
      !states.some((state) => state.status === 'waiting_approval'),
      'plan mode must not reach the approval gate for a write tool'
    );
    await assert.rejects(() => fs.access(path.join(root, 'src', 'created.ts')));

    const offeredTools = provider.requests[0] ?? [];
    const systemPrompt = offeredTools.find((message) => message.role === 'system')?.content ?? '';
    assert.ok(systemPrompt.length > 0, 'the agent must send a system prompt');
  });

  it('blocks a tool call that the model hallucinated for a locked stage', async () => {
    const root = await createWorkspace();
    const provider = new ScriptedProvider([
      {
        text: '',
        toolCalls: [{ id: 'call_cmd_1', name: 'execute_command', arguments: { command: 'touch hacked.txt' } }]
      },
      { text: 'Stopped.' }
    ]);
    const { core } = createAgent(provider, root);

    await core.handleSendMessage('run a command', 'plan');
    await new Promise((resolve) => setTimeout(resolve, 50));

    await assert.rejects(() => fs.access(path.join(root, 'hacked.txt')));
    const toolCalls = core.getState().messages.flatMap((message) => message.toolCalls ?? []);
    const commandCall = toolCalls.find((call) => call.name === 'execute_command');
    assert.ok(commandCall, 'the attempted call should be recorded');
    assert.strictEqual(commandCall?.status, 'error');
    assert.ok(commandCall?.error?.includes('not allowed'), commandCall?.error);
  });
});
