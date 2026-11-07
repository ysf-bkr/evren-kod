import { after, describe, it } from 'node:test';
import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AgentCore } from '../../src/core/agent/AgentCore';
import { GitManager } from '@evren-kod/core/core/git/GitManager';
import { gitCommitTool } from '@evren-kod/core/tools/git';
import type { ToolExecutionContext } from '@evren-kod/core/tools/base';
import { UserSettings } from '@evren-kod/core/shared/types';
import { ScriptedProvider, createWorkspaceTracker, stub } from '../support/agentHarness';

/**
 * Adım İki — commit atomik güven sınırı testleri.
 *
 * Değişmez 5 (INVARIANTS.md): "Gate atlatılarak commit oluşturulamaz."
 * Akış: hazırla → dondur → kapı → yeniden doğrula → commit → tree doğrula.
 * Uydurma portlarla "kontrol kaldırılmış olsun" sabotajları da sınanır.
 */
const settings: UserSettings = {
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: { readFiles: true, writeFiles: true, executeCommands: true },
  autoVerify: false,
  maxRepairAttempts: 0,
  useIntegratedTerminal: false,
  callGraph: { enabled: false },
  autonomy: 'auto'
};

const { create: workspace, cleanup } = createWorkspaceTracker('evren-kod-commitgate-');

/** Test amaçlı gerçek Git deposu: init + ilk commit. */
async function gitRepo(): Promise<string> {
  const root = await workspace();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@evren-kod.dev');
  git('config', 'user.name', 'Evren Test');
  await fs.writeFile(path.join(root, 'README.md'), '# fixture\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return root;
}

function head(root: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function porcelain(root: string): string {
  return execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
}

async function buildCore(root: string): Promise<AgentCore> {
  const provider = new ScriptedProvider([{ text: 'boş' }]);
  const core = new AgentCore(
    stub.createExtensionContext() as never,
    settings,
    () => {},
    () => {},
    undefined,
    { provider } as never
  );
  stub.testState.workspaceRoot = root;
  return core;
}

async function commitToolResult(core: AgentCore, root: string, message = 'iş: değişiklik'): Promise<string> {
  const ctx = {
    gitManager: new GitManager(),
    workspaceRoot: root,
    releaseGate: core.workflow.releaseGatePort
  } as unknown as ToolExecutionContext;
  return gitCommitTool.execute!({ message }, ctx);
}

describe('Commit güven sınırı: gate atlatılarak commit oluşturulamaz', () => {
  it('görev sürerken taze PASS yokken commit reddedilir ve HEAD değişmez', async () => {
    stub.resetTestState();
    const root = await gitRepo();
    const core = await buildCore(root);
    const spec = await core.getSpecStore().create(root, {
      goal: 'test',
      scope: ['src'],
      acceptanceCriteria: ['a']
    });
    await core.getSpecStore().approve(root, spec.id);
    const workflow = core.getState().workflow!;
    workflow.stage = 'build';
    workflow.specId = spec.id;
    workflow.specApproved = true;

    await fs.writeFile(path.join(root, 'a.ts'), 'export const a = 1;\n');
    core.workflow.recordLedgerWrites('backend', ['a.ts']);

    const before = head(root);
    const out = await commitToolResult(core, root);
    assert.match(out, /COMMIT REDDEDILDI/);
    assert.match(out, /yayın kapısı/i);
    assert.equal(head(root), before, 'reddedilen commit HEADi oynatmamalı');
    assert.match(porcelain(root), /a\.ts/, 'değişiklik stiller yerinde durmalı');
  });

  it('taze PASS ile commit oluşur ve commitlenen ağaç doğrulanan anlık görüntüyle eşleşir', async () => {
    stub.resetTestState();
    const root = await gitRepo();
    const core = await buildCore(root);
    const spec = await core.getSpecStore().create(root, {
      goal: 'test',
      scope: ['src'],
      acceptanceCriteria: ['a']
    });
    await core.getSpecStore().approve(root, spec.id);
    const workflow = core.getState().workflow!;
    workflow.stage = 'verify';
    workflow.specId = spec.id;
    workflow.specApproved = true;
    for (const c of spec.acceptanceCriteria) {
      await core.getSpecStore().setCriterionDone(root, spec.id, c.id, true);
    }
    core.getState().stats.verification = { status: 'passed', attempts: 0, summary: 'ok' };

    await fs.writeFile(path.join(root, 'a.ts'), 'export const a = 1;\n');
    core.workflow.recordLedgerWrites('backend', ['a.ts']);
    core.workflow.recordLedgerReview('quality', ['a.ts']); // gerçek içerik hash'i ile kapanır

    const recorded = await core.workflow.releaseGatePort.record({
      verdict: 'pass',
      reasons: ['denetim tamam'],
      criteriaEvidence: [{ id: 'ac-1', note: 'test geçti' }],
      risks: [],
      rollback: 'git revert'
    });
    assert.match(recorded, /PASS/);

    const out = await commitToolResult(core, root);
    assert.match(out, /Commit created/);
    assert.match(out, /Ağaç doğrulaması.*birebir aynı/s);
    assert.equal(porcelain(root).trim(), '', 'commit sonrası çalışma ağacı temiz olmalı');
  });

  it('PASS sonrası dosya değişirse commit reddedilir (bayat PASS ile teslim yok)', async () => {
    stub.resetTestState();
    const root = await gitRepo();
    const core = await buildCore(root);
    const spec = await core.getSpecStore().create(root, {
      goal: 'test',
      scope: ['src'],
      acceptanceCriteria: ['a']
    });
    await core.getSpecStore().approve(root, spec.id);
    const workflow = core.getState().workflow!;
    workflow.stage = 'verify';
    workflow.specId = spec.id;
    workflow.specApproved = true;
    for (const c of spec.acceptanceCriteria) {
      await core.getSpecStore().setCriterionDone(root, spec.id, c.id, true);
    }
    core.getState().stats.verification = { status: 'passed', attempts: 0, summary: 'ok' };
    await fs.writeFile(path.join(root, 'a.ts'), 'export const a = 1;\n');
    core.workflow.recordLedgerWrites('backend', ['a.ts']);
    core.workflow.recordLedgerReview('quality', ['a.ts']);
    await core.workflow.releaseGatePort.record({
      verdict: 'pass',
      reasons: ['denetim tamam'],
      criteriaEvidence: [{ id: 'ac-1', note: 'test' }],
      risks: [],
      rollback: 'git revert'
    });

    // Sinsi saldırı: karar taze iken tek bayt değişlik (touch ile maskelense
    // de fark etmez — kanıt içerik hash'idir, mtime değildir).
    await fs.writeFile(path.join(root, 'a.ts'), 'export const a = 2;\n');

    const before = head(root);
    const out = await commitToolResult(core, root);
    assert.match(out, /COMMIT REDDEDILDI/);
    assert.equal(head(root), before, 'bayat PASS commit üretmemeli');
    assert.match(porcelain(root), /a\.ts/);
  });

  it('yeniden doğrulama atlanamaz: evaluate portu yoksa commit fail-closed reddedilir', async () => {
    stub.resetTestState();
    const root = await gitRepo();
    await fs.writeFile(path.join(root, 'a.ts'), 'x\n');
    await new GitManager().stage(root);
    // "Commit öncesi gate atlatılsın" sabotajı: guard geçer ama yeniden
    // doğrulama portu kaldırılmış → commit yine de yapılmaz.
    const ctx = {
      gitManager: new GitManager(),
      workspaceRoot: root,
      releaseGate: {
        record: async () => '',
        preCommitGuard: () => ({ required: true, ok: true })
      }
    } as unknown as ToolExecutionContext;
    const before = head(root);
    const out = await gitCommitTool.execute!({ message: 'sinsice' }, ctx);
    assert.match(out, /COMMIT REDDEDILDI/);
    assert.equal(head(root), before);
  });

  it('görev dışı commit geçer ama kapı dışı olduğu dürüstçe etiketlenir', async () => {
    stub.resetTestState();
    const root = await gitRepo();
    const core = await buildCore(root); // spec yok: görev kapısı kapsamı dışı
    await fs.writeFile(path.join(root, 'notes.md'), 'hızlı not\n');
    const out = await commitToolResult(core, root, 'docs: not');
    assert.match(out, /Commit created/);
    assert.match(out, /görev kapısı dışındadır/);
  });

  it('ağaç kimliği kontrolleri gerçek güce sahiptir: staging değişimi ayırt edilir', async () => {
    stub.resetTestState();
    const root = await gitRepo();
    const gm = new GitManager();
    const t1 = await gm.treeHash(root);
    const h1 = await gm.headTreeHash(root);
    assert.equal(t1, h1, 'temiz depoda indeks ağacı HEAD ile aynı');
    await fs.writeFile(path.join(root, 'yeni.txt'), 'veri\n');
    await gm.stage(root);
    const t2 = await gm.treeHash(root);
    assert.notEqual(t2, h1, 'yeniden doğrulama sahte eşleşme üretemez');
    assert.match(await gm.commit(root, 'test: yeni dosya'), /Commit created/);
    assert.equal(await gm.headTreeHash(root), t2, 'commit buzlanmış anlık görüntüyü taşımalı');
  });
});

after(async () => {
  await cleanup();
});
