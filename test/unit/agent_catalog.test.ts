import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_AGENT_DEFINITIONS,
  UMBRELLA_AGENT_DEFINITIONS,
  BUILT_IN_SUBAGENT_ROLES,
  ROLE_ALIASES,
  getAgentDefinition
} from '@evren-kod/core/shared/agents';
import { ALL_SPECIALIST_DEFINITIONS, SPECIALISTS_BY_CATEGORY } from '@evren-kod/core/shared/agents/catalog';
import { ALL_TOOLS } from '@evren-kod/core/tools';
import { STACK_IDS, isProjectKind } from './catalogSupport';

describe('Uzman kataloğu: bütünlük kuralları', () => {
  test('kayıtta benzersiz adlar vardır ve şemsiyeler + uzmanlar toplamı eşleşir', () => {
    const names = ALL_AGENT_DEFINITIONS.map((agent) => agent.name);
    assert.strictEqual(new Set(names).size, names.length, 'rol adı çakışması var');
    assert.strictEqual(
      ALL_AGENT_DEFINITIONS.length,
      UMBRELLA_AGENT_DEFINITIONS.length + ALL_SPECIALIST_DEFINITIONS.length
    );
  });

  test('katalog vizyonu karşılanır: en az 100 kayıtlı uzman ajan', () => {
    assert.ok(ALL_AGENT_DEFINITIONS.length >= 100, `kayıt büyüklüğü ${ALL_AGENT_DEFINITIONS.length}`);
  });

  test('her uzman gerçek bir araç listesine sahiptir ve araçlar kayıtlıdır', () => {
    for (const agent of ALL_AGENT_DEFINITIONS) {
      assert.ok(agent.tools.length > 0, `${agent.name} araçsız`);
      for (const tool of agent.tools) {
        assert.ok(tool in ALL_TOOLS, `${agent.name} bilinmeyen araç kullanıyor: ${tool}`);
      }
    }
  });

  test('katalog alanları eksiksiz: kategori, Türkçe UI metinleri, İngilizce tanım', () => {
    for (const agent of ALL_AGENT_DEFINITIONS) {
      assert.ok(agent.category, `${agent.name} category eksik`);
      assert.ok(agent.uiDescription.trim().length > 0, `${agent.name} uiDescription boş`);
      assert.ok(agent.displayName.trim().length > 0, `${agent.name} displayName boş`);
      assert.notStrictEqual(
        agent.uiDescription,
        agent.description,
        `${agent.name} UI açıklaması İngilizce kopya`
      );
      assert.ok(agent.instructions.mission.length > 20, `${agent.name} mission zayıf`);
      assert.ok(agent.instructions.rules.length >= 2, `${agent.name} disiplin kuralı eksik`);
      for (const stack of agent.stacks ?? []) {
        assert.ok(STACK_IDS.includes(stack), `${agent.name} bilinmeyen stack: ${stack}`);
        assert.ok(!isProjectKind(stack), `${agent.name} stack alanına tür sızmış: ${stack}`);
      }
    }
  });

  test('on iki katalog kategorisinin hepsi doludur', () => {
    const categories = Object.keys(SPECIALISTS_BY_CATEGORY);
    assert.strictEqual(categories.length, 12);
    for (const category of categories) {
      assert.ok((SPECIALISTS_BY_CATEGORY[category] ?? []).length > 0, `${category} boş`);
    }
  });

  test('hiçbir katalog uzmanı alt ajan açma yetkisi devralmaz', () => {
    for (const agent of ALL_SPECIALIST_DEFINITIONS) {
      assert.ok(!agent.tools.includes('invoke_subagent'), `${agent.name} delege etmemeli`);
      assert.ok(!agent.tools.includes('run_parallel_tasks'), `${agent.name} paralel görev başlatmamalı`);
    }
  });

  test('lead takma adları şemsiye rollere çözülür', () => {
    const expected: Record<string, string> = {
      'master-orchestrator': 'manager',
      'frontend-lead': 'frontend',
      'backend-lead': 'backend',
      'mobile-lead': 'mobile',
      'desktop-lead': 'native',
      'qa-lead': 'quality',
      'security-lead': 'security',
      'devops-lead': 'devops'
    };
    for (const [alias, target] of Object.entries(expected)) {
      assert.strictEqual(ROLE_ALIASES[alias], target);
      assert.ok(getAgentDefinition(alias), `${alias} kayıt defterinde çözülmeli`);
    }
  });

  test('UI rol kartları katalog dahil tüm kayıttan türetilir ve kategori taşır', () => {
    assert.strictEqual(BUILT_IN_SUBAGENT_ROLES.length, ALL_AGENT_DEFINITIONS.length);
    for (const info of BUILT_IN_SUBAGENT_ROLES) {
      assert.ok(info.category, `${info.role} kartında kategori yok`);
    }
  });
});
