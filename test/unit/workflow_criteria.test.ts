import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert';
import { ModelCompletionResponse } from '@evren-kod/core/providers/base';
import { ScriptedProvider, createAgent, createWorkspaceTracker, stub } from '../support/agentHarness';

/**
 * Kabul kriterleri dürüstlük sözleşmesi.
 *
 * Doğrulama geçtiğinde bile kriterler kendiliğinden işaretlenmez: bir kriter
 * yalnızca modelin açık `update_acceptance_criteria` kararıyla tamamlandı
 * sayılır. "Testler geçer" gibi metni doğrulamayla örtüşen bir kriter otomatik
 * işaretlenirse görev gerçekte tamamlanmamışken "bitti" kapanır — bu regresyon
 * testi o davranışı yasaklar.
 */
const { create: workspace, cleanup } = createWorkspaceTracker('evren-kod-criteria-flow-');

const specCall: ModelCompletionResponse = {
  text: '',
  toolCalls: [
    {
      id: 'spec_1',
      name: 'write_spec',
      arguments: {
        goal: 'Ekran ekle',
        scope: ['webview-ui'],
        // İkinci kriter bilinçli olarak doğrulama sözleri içeriyor.
        acceptanceCriteria: [
          'Ekran görünür',
          'Testler geçer',
          'Geçersiz girdide hata gösterilir',
          'Boş liste sınırında çökmez'
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
        goal: 'Ekran ekle',
        modules: [
          {
            id: 'ui-screen',
            name: 'Ekran',
            layer: 'interface',
            paths: ['webview-ui'],
            responsibility: 'Ekranı çizer',
            ownerRole: 'frontend',
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
        goal: 'Ekran ekle',
        steps: [
          {
            title: 'Bileşeni yaz',
            files: ['webview-ui/src/App.tsx'],
            moduleId: 'ui-screen',
            criteria: ['ac-1']
          }
        ]
      }
    }
  ]
};

const markFirstCriterionOnly: ModelCompletionResponse = {
  text: '',
  toolCalls: [
    {
      id: 'criteria_1',
      name: 'update_acceptance_criteria',
      arguments: { criteria: [{ id: 'ac-1', done: true }] }
    }
  ]
};

describe('Kabul kriterleri: doğrulama geçse de otomatik işaretlenmez', () => {
  beforeEach(() => {
    stub.resetTestState();
  });

  after(async () => {
    await cleanup();
  });

  it('işaretlenmemiş kriter kalırsa doğrulama geçmiş olsa bile görev kapanmaz', async () => {
    const root = await workspace();
    const { core } = createAgent(
      new ScriptedProvider([specCall, moduleCall, planCall, markFirstCriterionOnly, { text: 'bitti' }]),
      root,
      { autonomy: 'guided' }
    );

    // Doğrulama "geçti" sayılır (atlandı değil): tek engel işaretsiz kriter olmalı.
    core.getState().stats.verification = {
      status: 'skipped',
      attempts: 0,
      summary: 'otomatik doğrulama kapalı',
      skippedReason: 'no-workspace'
    };

    // Tur 1: spec + plan onayları otomatik, ilk kriter işaretlenir, tur biter.
    await core.handleSendMessage('ekran ekle');
    assert.strictEqual(core.getState().workflow?.stage, 'review', 'tur sonunda inceleme aşamasına geçmeli');

    // Tur 2: inceleme → doğrulama; bitti kapısı işaretsiz kriter yüzünden kapalı kalmalı.
    await core.handleSendMessage('devam et');

    const criteria = core.getState().spec?.acceptanceCriteria ?? [];
    const testCriterion = criteria.find((criterion) => criterion.id === 'ac-2');
    assert.ok(testCriterion, 'ikinci kriter spec içinde olmalı');
    assert.strictEqual(
      testCriterion?.done,
      false,
      '"Testler geçer" kriteri doğrulama geçti diye otomatik işaretlenmemeli'
    );
    assert.strictEqual(
      criteria.find((criterion) => criterion.id === 'ac-1')?.done,
      true,
      'modelin açıkça işaretlediği kriter tamamlanmış kalmalı'
    );

    const workflow = core.getState().workflow;
    assert.notStrictEqual(workflow?.stage, 'done', 'görev kapanmamalı');
    assert.match(workflow?.blockedReason ?? '', /kabul kriterleri/, 'engel dürüstçe bildirilmeli');
  });
});
