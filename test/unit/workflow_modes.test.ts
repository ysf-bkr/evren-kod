import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { stripInjectedContext } from '@evren-kod/core/shared/editorContext';
import {
  PLAN_MODE_STAGE_ORDER,
  STAGE_ORDER,
  canTransition,
  gateForStage,
  normalizeStageForMode,
  stageOrderForMode,
  createWorkflowState
} from '@evren-kod/core/core/workflow/TaskWorkflow';

describe('editorContext: prompt cleanup for resend', () => {
  it('preserves user own text', () => {
    assert.strictEqual(stripInjectedContext('  Dosyayı düzelt  '), 'Dosyayı düzelt');
  });

  it('removes injected file context', () => {
    const content = 'Şu hatayı düzelt\n\n[Referenced File Context (@src/a.ts)]:\n```\nx\n```';
    assert.strictEqual(stripInjectedContext(content), 'Şu hatayı düzelt');
  });

  it('removes selected code and active file context', () => {
    const selected = 'Kodu açıkla\n\n[Selected Code in Active Editor (src/a.ts, Lines 1-2)]:\n```\ny\n```';
    assert.strictEqual(stripInjectedContext(selected), 'Kodu açıkla');
    assert.strictEqual(
      stripInjectedContext('Test yaz\n\n[Active File]: src/a.ts (Cursor line: 3)'),
      'Test yaz'
    );
  });

  it('returns text as-is when no context', () => {
    const plain = 'Merhaba, bu bir [köşeli] metin';
    assert.strictEqual(stripInjectedContext(plain), plain);
  });
});

describe('Workflow: stages by mode', () => {
  it('code mode includes build and verify stages', () => {
    const ids = stageOrderForMode('code');
    assert.deepStrictEqual(ids, STAGE_ORDER);
    assert.ok(ids.includes('build'));
    assert.ok(ids.includes('verify'));
  });

  it('plan mode does not include build and verify', () => {
    const ids = stageOrderForMode('plan');
    assert.deepStrictEqual(ids, PLAN_MODE_STAGE_ORDER);
    assert.ok(!ids.includes('build'));
    assert.ok(!ids.includes('verify'));
    assert.deepStrictEqual(ids, ['onboard', 'intake', 'review', 'plan', 'done']);
  });

  it('fast mode includes only onboard, build, verify, done', () => {
    const ids = stageOrderForMode('fast');
    assert.deepStrictEqual(ids, ['onboard', 'build', 'verify', 'done']);
    assert.strictEqual(canTransition('onboard', 'build', 'fast').allowed, true);
    assert.strictEqual(canTransition('build', 'verify', 'fast').allowed, true);
    assert.strictEqual(canTransition('verify', 'done', 'fast').allowed, true);
    assert.strictEqual(canTransition('verify', 'build', 'fast').allowed, true);
  });

  it('fast mode build gate does not require spec or plan', () => {
    const base = {
      state: createWorkflowState({ stage: 'onboard' }),
      hasApprovedSpec: false,
      hasPlan: false,
      hasModules: false,
      criteriaMet: false,
      verificationPassed: false,
      releaseGatePassed: false
    };
    assert.strictEqual(gateForStage('build', base, 'fast').allowed, true);
    assert.strictEqual(gateForStage('build', base, 'code').allowed, false);
  });

  it('fast mode done gate requires only verificationPassed', () => {
    const base = {
      state: createWorkflowState({ stage: 'verify' }),
      hasApprovedSpec: false,
      hasPlan: false,
      hasModules: false,
      criteriaMet: false,
      verificationPassed: true,
      releaseGatePassed: false
    };
    assert.strictEqual(gateForStage('done', base, 'fast').allowed, true);
    assert.strictEqual(gateForStage('done', { ...base, verificationPassed: false }, 'fast').allowed, false);
    assert.strictEqual(gateForStage('done', base, 'code').allowed, false);
  });

  it('plan mode can go directly from plan to done with plan approval', () => {
    assert.strictEqual(canTransition('plan', 'done', 'plan').allowed, true);
    assert.strictEqual(canTransition('plan', 'build', 'plan').allowed, false);
    // Kör nokta kapatması (sabotaj koşusu #11): sıra kontrolü KOD modunda da
    // aşama atlamayı reddetmeli — uydurma istekle intake → done olamaz.
    assert.strictEqual(canTransition('build', 'done', 'code').allowed, false);
    assert.match(String(canTransition('build', 'done', 'code').reason), /one stage at a time/);
    assert.strictEqual(canTransition('intake', 'verify', 'code').allowed, false);
  });

  it('plan mode only needs plan for done', () => {
    const base = {
      state: createWorkflowState({ stage: 'plan', planApproved: true }),
      hasApprovedSpec: false,
      hasPlan: true,
      hasModules: true,
      criteriaMet: false,
      verificationPassed: false,
      releaseGatePassed: true
    };
    assert.strictEqual(gateForStage('done', base, 'plan').allowed, true);
    assert.strictEqual(gateForStage('done', base, 'code').allowed, false);
  });

  it('plan mode can go to plan without spec approval', () => {
    const base = {
      state: createWorkflowState({ stage: 'review' }),
      hasApprovedSpec: false,
      hasPlan: false,
      hasModules: false,
      criteriaMet: false,
      verificationPassed: false,
      releaseGatePassed: true
    };
    assert.strictEqual(gateForStage('plan', base, 'plan').allowed, true);
    assert.strictEqual(gateForStage('plan', base, 'code').allowed, false);
  });

  it('code-only stage moves to valid stage on mode change', () => {
    assert.strictEqual(normalizeStageForMode('build', 'plan'), 'review');
    assert.strictEqual(normalizeStageForMode('verify', 'plan'), 'review');
    assert.strictEqual(normalizeStageForMode('plan', 'plan'), 'plan');
    assert.strictEqual(normalizeStageForMode('build', 'code'), 'build');
    assert.strictEqual(normalizeStageForMode('intake', 'fast'), 'build');
    assert.strictEqual(normalizeStageForMode('spec', 'fast'), 'build');
    assert.strictEqual(normalizeStageForMode('plan', 'fast'), 'build');
  });
});

describe('Workflow: post-approval progress (stuck regression)', () => {
  it('review, verify and done accessible in order after build', () => {
    // Bu, tamamlanmış bir build turundan sonra agent'ın otomatik izlediği
    // yoldur; eskiden bunu hiçbir şey yapmıyordu, şerit "Uygulama"'da takılıyordu.
    const order = STAGE_ORDER;
    const start = order.indexOf('build');
    for (let index = start; index < order.length - 1; index++) {
      const from = order[index];
      const to = order[index + 1];
      assert.ok(from && to);
      assert.strictEqual(canTransition(from, to, 'code').allowed, true, `${from} -> ${to}`);
    }
  });

  it('done gate opens when verification passes and criteria marked', () => {
    const context = {
      state: createWorkflowState({ stage: 'verify', planApproved: true }),
      hasApprovedSpec: true,
      hasPlan: true,
      hasModules: true,
      criteriaMet: true,
      verificationPassed: true,
      releaseGatePassed: true
    };
    assert.strictEqual(gateForStage('done', context, 'code').allowed, true);

    const unchecked = { ...context, criteriaMet: false };
    assert.strictEqual(gateForStage('done', unchecked, 'code').allowed, false);
  });
});
