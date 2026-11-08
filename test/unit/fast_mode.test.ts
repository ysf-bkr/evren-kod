import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  isReadOnlyMode,
  isToolAllowedInMode,
  filterToolsForMode
} from '@evren-kod/core/core/agent/modeTools';
import {
  FAST_MODE_STAGE_ORDER,
  canTransition,
  gateForStage,
  normalizeStageForMode,
  stageOrderForMode,
  createWorkflowState,
  formatWorkflowForPrompt
} from '@evren-kod/core/core/workflow/TaskWorkflow';
import { classifyTask } from '@evren-kod/core/core/routing/ModelRouter';
import {
  serializeSessionMarkdown,
  serializeSessionArchive,
  parseSessionArchive
} from '@evren-kod/core/core/memory/sessionArchive';
import { generateSystemPrompt } from '@evren-kod/core/core/prompts/systemPrompt';
import type { TaskState } from '@evren-kod/core/shared/types';

describe('Fast Mode: modeTools and permissions', () => {
  it('isReadOnlyMode returns false for fast mode', () => {
    assert.strictEqual(isReadOnlyMode('fast'), false);
    assert.strictEqual(isReadOnlyMode('code'), false);
    assert.strictEqual(isReadOnlyMode('plan'), true);
    assert.strictEqual(isReadOnlyMode('education'), true);
  });

  it('all editing and execution tools are allowed in fast mode', () => {
    const tools = [
      'read_file',
      'write_file',
      'edit_file',
      'execute_command',
      'run_tests',
      'run_verification',
      'search_files',
      'git_diff'
    ];
    for (const tool of tools) {
      assert.strictEqual(isToolAllowedInMode(tool, 'fast'), true, `${tool} should be allowed in fast mode`);
    }
  });

  it('filterToolsForMode retains mutating tools in fast mode', () => {
    const tools = [{ name: 'read_file' }, { name: 'edit_file' }, { name: 'execute_command' }];
    const filtered = filterToolsForMode(tools, 'fast').map((t) => t.name);
    assert.deepStrictEqual(filtered, ['read_file', 'edit_file', 'execute_command']);
  });
});

describe('Fast Mode: TaskWorkflow progression and gates', () => {
  it('stage order is strictly onboard -> build -> verify -> done', () => {
    const stages = stageOrderForMode('fast');
    assert.deepStrictEqual(stages, FAST_MODE_STAGE_ORDER);
    assert.deepStrictEqual(stages, ['onboard', 'build', 'verify', 'done']);
  });

  it('allows stepwise progression and repair loop', () => {
    assert.strictEqual(canTransition('onboard', 'build', 'fast').allowed, true);
    assert.strictEqual(canTransition('build', 'verify', 'fast').allowed, true);
    assert.strictEqual(canTransition('verify', 'done', 'fast').allowed, true);
    assert.strictEqual(canTransition('verify', 'build', 'fast').allowed, true, 'verify -> build repair loop');
  });

  it('forbids stage skipping in fast mode', () => {
    assert.strictEqual(canTransition('onboard', 'verify', 'fast').allowed, false);
    assert.strictEqual(canTransition('onboard', 'done', 'fast').allowed, false);
    assert.strictEqual(canTransition('build', 'done', 'fast').allowed, false);
  });

  it('build gate allows entry without spec or module plan', () => {
    const context = {
      state: createWorkflowState({ stage: 'onboard' }),
      hasApprovedSpec: false,
      hasPlan: false,
      hasModules: false,
      criteriaMet: false,
      verificationPassed: false,
      releaseGatePassed: false
    };
    const gate = gateForStage('build', context, 'fast');
    assert.strictEqual(gate.allowed, true);
  });

  it('done gate enforces verification proof discipline', () => {
    const unverifiedContext = {
      state: createWorkflowState({ stage: 'verify' }),
      hasApprovedSpec: false,
      hasPlan: false,
      hasModules: false,
      criteriaMet: false,
      verificationPassed: false,
      releaseGatePassed: false
    };
    const unverifiedGate = gateForStage('done', unverifiedContext, 'fast');
    assert.strictEqual(unverifiedGate.allowed, false);
    assert.match(String(unverifiedGate.reason), /Verification must pass/);

    const verifiedContext = { ...unverifiedContext, verificationPassed: true };
    const verifiedGate = gateForStage('done', verifiedContext, 'fast');
    assert.strictEqual(verifiedGate.allowed, true, 'Fast mode finishes once verification passes');
  });

  it('normalizes alien stages (intake, spec, review) to build in fast mode', () => {
    assert.strictEqual(normalizeStageForMode('intake', 'fast'), 'build');
    assert.strictEqual(normalizeStageForMode('spec', 'fast'), 'build');
    assert.strictEqual(normalizeStageForMode('plan', 'fast'), 'build');
    assert.strictEqual(normalizeStageForMode('review', 'fast'), 'build');
    assert.strictEqual(normalizeStageForMode('build', 'fast'), 'build');
    assert.strictEqual(normalizeStageForMode('verify', 'fast'), 'verify');
    assert.strictEqual(normalizeStageForMode('done', 'fast'), 'done');
  });

  it('formats prompt workflow with fast mode rules and proof discipline', () => {
    const state = createWorkflowState({ stage: 'build' });
    const formatted = formatWorkflowForPrompt(state, 'fast');
    assert.match(formatted, /Mode: fast/);
    assert.match(formatted, /Apply targeted changes with edit_file\/write_file/);
    assert.match(formatted, /Verify changes with tests\/lint before completing/);
    assert.match(formatted, /Never claim the task is done without verifying your changes/);
  });
});

describe('Fast Mode: routing and prompts', () => {
  it('classifies fast mode tasks as simple complexity for fast routing', () => {
    assert.strictEqual(classifyTask('Fix bug in auth.ts', 'fast'), 'simple');
  });

  it('generates system prompt tailored for fast mode', async () => {
    const prompt = await generateSystemPrompt('/workspace', 'fast');
    assert.match(prompt, /=== FAST \(QUICK PATCH\) MODE ACTIVE ===/);
    assert.match(prompt, /SKIP intake questions/);
    assert.match(prompt, /CRAFT & PROOF DISCIPLINE IS PRESERVED/);
    assert.match(prompt, /Do NOT delegate to subagents or release-gate in this mode/);
  });
});

describe('Fast Mode: session archive persistence', () => {
  it('serializes session markdown with fast mode label', () => {
    const task: TaskState = {
      id: 'task-fast-1',
      prompt: 'Quick fix for typo',
      mode: 'fast',
      status: 'completed',
      messages: [{ id: 'm1', role: 'user', content: 'Fix typo', timestamp: Date.now() }],
      stats: { totalTokens: 100, stepsCount: 2, filesModified: ['src/a.ts'] }
    };
    const md = serializeSessionMarkdown(task);
    assert.match(md, /- \*\*Mod:\*\* Hızlı/);
  });

  it('parses session archive preserving fast mode', () => {
    const original: TaskState = {
      id: 'task-fast-archive',
      prompt: 'Quick test',
      mode: 'fast',
      status: 'completed',
      messages: [{ id: 'm1', role: 'user', content: 'test message', timestamp: Date.now() }],
      stats: { totalTokens: 10, stepsCount: 1, filesModified: [] }
    };
    const rawArchive = serializeSessionArchive(original);
    const parsed = parseSessionArchive(rawArchive);
    assert.strictEqual(parsed.mode, 'fast');
  });
});
