import { describe, it, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AgentCore } from '../../src/core/agent/AgentCore';
import { ModelCompletionResponse } from '@evren-kod/core/providers/base';
import { UserSettings } from '@evren-kod/core/shared/types';
import { ScriptedProvider, createWorkspaceTracker, stub } from '../support/agentHarness';
import { SubagentManager } from '@evren-kod/core/core/multiagent/SubagentManager';
import { ReleaseGatePort } from '@evren-kod/core/tools/contracts';
import { parsePorcelainStatus, changedPathsBetween } from '../../src/core/agent/toolPipelineController';
import { GitManager } from '@evren-kod/core/core/git/GitManager';
import { execFileSync } from 'node:child_process';

/**
 * Denetim defterinin KABLOLAMA testleri.
 *
 * Saf fonksiyon testleri sözleşmeyi kanıtlar; bu dosya borcun gerçekte
 * NEREDEN doğup nerede kapandığını sınar: alt ajan okuma/yazma olayları,
 * önbek-isyabı okumalar, alt ajan bağlamındaki kapı aracı, gerçek
 * invoke_subagent reviewer turu ve ölçülemeyen komutların gölge borcu.
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
  // Devretme akışının onay kartıyla beklememesi için: kablo testinin
  // sınadığı şey izin motoru değil, defter kablolamasıdır.
  autonomy: 'auto'
};

// İzolasyon: os.tmpdir() tabanlı createWorkspaceTracker kullanılır.
const { create: workspace, cleanup } = createWorkspaceTracker('evren-kod-ledger-');

const invokeQuality: ModelCompletionResponse = {
  text: '',
  toolCalls: [
    { id: 'inv_1', name: 'invoke_subagent', arguments: { role: 'quality', task: 'değiğişiklikleri denetle' } }
  ]
};
const readA: ModelCompletionResponse = {
  text: '',
  toolCalls: [{ id: 'rd_1', name: 'read_file', arguments: { path: 'a.ts' } }]
};

function providerOf(responses: ModelCompletionResponse[]): ScriptedProvider {
  return new ScriptedProvider(responses);
}

after(async () => {
  await cleanup();
});

describe('SubagentManager: dosya erişim olayları konağa ulaşıyor', () => {
  it('okuma ve yazma olayları kind ile bildirilir; önbek-isyabı okuma da sayılır', async () => {
    const root = await workspace();
    await fs.writeFile(path.join(root, 'a.ts'), 'export const a = 1;\n');
    const events: Array<{ role: string; file: string; kind: string }> = [];
    const provider = providerOf([
      readA,
      {
        text: '',
        toolCalls: [
          { id: 'wr_1', name: 'write_file', arguments: { path: 'b.ts', content: 'export const b = 2;\n' } }
        ]
      },
      { text: 'iş bitti' },
      // İkinci tur: a.ts yeniden okunur (ömnbek isabeti) — kanıt yine doğmalı.
      readA,
      { text: 'tamam' }
    ]);
    const manager = new SubagentManager(
      provider,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        onSubagentFileAccess: (event) => events.push(event)
      }
    );

    await manager.runSubagent({ role: 'backend', task: 'oku ve yaz' }, root);
    assert.deepEqual(
      events.map((e) => `${e.kind}:${e.role}:${e.file}`),
      ['read:backend:a.ts', 'write:backend:b.ts']
    );

    events.length = 0;
    await manager.runSubagent({ role: 'quality', task: 'tekrar oku' }, root);
    assert.deepEqual(
      events.map((e) => `${e.kind}:${e.role}:${e.file}`),
      ['read:quality:a.ts'],
      'ömnbekten okunan içerik de inceleme kanıtıdır'
    );
  });

  it('alt ajan bağlamında record_release_gate kapı portuna ulaşıyor', async () => {
    const recorded: Array<{ verdict: string }> = [];
    const gate: ReleaseGatePort = {
      record: async (input) => {
        recorded.push(input);
        return 'Yayın kapısı kararı: BLOCK';
      }
    };
    const provider = providerOf([
      {
        text: '',
        toolCalls: [
          {
            id: 'gate_1',
            name: 'record_release_gate',
            arguments: { verdict: 'block', reasons: ['test eksik'], criteria: [], rollback: 'revert' }
          }
        ]
      },
      { text: 'kapı kaydedildi' }
    ]);
    const manager = new SubagentManager(
      provider,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        releaseGate: () => gate
      }
    );

    const result = await manager.runSubagent({ role: 'release-gate', task: 'kapıyı koş' });
    assert.equal(recorded.length, 1, 'port olmadan araç "service not ready" ile patlardı');
    assert.equal(recorded[0]?.verdict, 'block');
    assert.match(result, /kapı kaydedildi/i);
  });
});

describe('AgentCore: gerçek reviewer turu yalnızca okunan dosyanın borcunu kapatır', () => {
  it('invoke_subagent(quality) → read_file(a.ts) hattı defteri kapsama ile günceller', async () => {
    stub.resetTestState();
    const root = await workspace();
    await fs.writeFile(path.join(root, 'a.ts'), 'export const a = 1;\n');
    await fs.writeFile(path.join(root, 'b.ts'), 'export const b = 2;\n');

    const provider = providerOf([
      invokeQuality, // ana: devret
      readA, // quality: yalnız a.ts'yi okudu
      { text: 'denetim raporu tamam' }, // quality: bitir
      { text: 'bitti' } // ana: turu kapat
    ]);
    const core = new AgentCore(
      stub.createExtensionContext() as never,
      settings,
      () => {},
      () => {},
      undefined,
      { provider } as never
    );
    stub.testState.workspaceRoot = root;

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

    // Önceden yazılmış iki dosyanın borcu var (ör. geçen turlarda).
    core.workflow.recordLedgerWrites('backend', ['a.ts', 'b.ts']);

    await core.handleSendMessage('değişiklikleri denetlet');

    assert.deepEqual(
      core.workflow.unreviewedChanges(),
      ['b.ts'],
      "reviewer yalnız a.ts'yi okudu; b.ts borcu yerinde kalmalı"
    );

    // Borç varken kapı PASS olamaz.
    const blocked = await core.workflow.releaseGatePort.record({
      verdict: 'pass',
      reasons: ['hadi bitirelim'],
      criteriaEvidence: [{ id: 'ac-1', note: 'test' }],
      risks: [],
      rollback: 'git revert'
    });
    assert.match(blocked, /BLOCK/);
    assert.match(blocked, /b\.ts/);

    // Kanıt tazeliği saldırıları — hepsi aynı gerçek kablo üzerinden:
    // 1) reviewer okuduktan SONRA dosya değişirse inceleme bayatlar.
    await fs.writeFile(path.join(root, 'a.ts'), 'export const a = 999; // sinsi değişiklik\n');
    assert.ok(
      core.workflow.unreviewedChanges().includes('a.ts'),
      'okumadan sonra değişen dosyanın borcu yeniden doğmalı'
    );
    // 2) kanıtsız "incelendi" kaydı (defter tahrifi) borca döner.
    const wf = core.getState().workflow!;
    wf.reviewLedger = (wf.reviewLedger ?? []).map((e) =>
      e.file === 'b.ts' ? { ...e, reviewedBy: 'quality', review: undefined } : e
    );
    assert.ok(
      core.workflow.unreviewedChanges().includes('b.ts'),
      'kanıtsız inceleme kaydı güvenilmezdir (fail closed)'
    );
    // 3) dosya silinirse hayalet borç kalmaz; yol geri gelirse yazım yeniden borç açar.
    await fs.rm(path.join(root, 'a.ts'));
    const remaining = core.workflow.unreviewedChanges();
    assert.ok(!remaining.includes('a.ts'), 'silinen dosya hayalet borç üretmemeli');
    assert.ok(remaining.includes('b.ts'));
  });
});

describe('AgentCore: ölçülemeyen komut gölge borcu doğurur', () => {
  it('Git olmayan çalışma alanında komut sonrası denetim borcu oluşur ve denetim turuyla kapanır', async () => {
    stub.resetTestState();
    const root = await workspace(); // .evren-kod var, Git deposu YOK → ölçüm yapılamaz
    const provider = providerOf([
      {
        text: '',
        toolCalls: [{ id: 'cmd_1', name: 'execute_command', arguments: { command: 'touch generated.txt' } }]
      },
      { text: 'olusturuldu' }
    ]);
    const core = new AgentCore(
      stub.createExtensionContext() as never,
      settings,
      () => {},
      () => {},
      undefined,
      { provider } as never
    );
    stub.testState.workspaceRoot = root;
    const spec = await core
      .getSpecStore()
      .create(root, { goal: 'üret', scope: ['src'], acceptanceCriteria: ['a'] });
    await core.getSpecStore().approve(root, spec.id);
    const workflow = core.getState().workflow!;
    workflow.stage = 'build';
    workflow.specId = spec.id;
    workflow.specApproved = true;

    await core.handleSendMessage('kod üret');

    const debts = core.workflow.unreviewedChanges();
    assert.ok(
      debts.some((d) => d.startsWith('command:')),
      `gölge borç bekleniyordu: ${JSON.stringify(debts)}`
    );

    const blocked = await core.workflow.releaseGatePort.record({
      verdict: 'pass',
      reasons: ['oldu bitti'],
      criteriaEvidence: [],
      risks: [],
      rollback: 'revert'
    });
    assert.match(blocked, /BLOCK/);

    // Gölge borç dosya okumayla değil, bir ŞEY okumuş bağımsız denetim
    // turunun ölçülemezlik kanıtıyla kapanır; boş tur denetim sayılmaz.
    core.workflow.completeReviewerRun('security');
    assert.ok(core.workflow.unreviewedChanges().length > 0, 'boş tur gölge borcu kapatamaz');
    core.workflow.recordLedgerRead('quality', 'generated.txt');
    core.workflow.completeReviewerRun('quality');
    assert.deepEqual(core.workflow.unreviewedChanges(), []);
  });
});

describe('porcelain ayrıştırma: komut ve merge sonrası gerçek değişiklik listesi', () => {
  it('durum kodu değişen, eklenen ve kaybolan yolları bulur', () => {
    const before = ' M src/a.ts\n?? src/yeni.ts\n';
    const after = 'MM src/a.ts\nD  src/eski.ts\n';
    assert.deepEqual(changedPathsBetween(before, after), ['src/a.ts', 'src/eski.ts', 'src/yeni.ts']);
  });

  it('durumu değişmeyen dosya değişiklik sayılmaz; yeniden adlandırmada hedef esas alınır', () => {
    assert.deepEqual(changedPathsBetween(' M a.ts\n', ' M a.ts\n'), []);
    const map = parsePorcelainStatus('R  eski.ts -> yeni.ts\n');
    assert.deepEqual([...map.keys()], ['yeni.ts']);
  });

  it('boş ve çöp satırlar güvenle atlanır', () => {
    assert.deepEqual(changedPathsBetween('', '?? x.ts\n\n'), ['x.ts']);
  });

  it('temiz ağaç sentinel metni dosya adı sanılmaz', () => {
    // Regresyon: GitManager.status() boş ağaçta "Working tree is clean."
    // döndürüyordu; porcelain ayrıştırıcısı bunu 'king tree is clean.' adlı
    // hayalet bir dosya olarak deftere yazıyordu.
    assert.deepEqual(changedPathsBetween('', ' M a.ts\n'), ['a.ts']);
    const parsed = parsePorcelainStatus('Working tree is clean.');
    assert.equal(parsed.has('king tree is clean.'), false);
  });

  it('Türkçe/ASCII dışı yollar octal kaçışa düşmeden çözülür', () => {
    const quoted = 'A  "\\303\\247al\\304\\261\\305\\237ma.txt"\n';
    assert.deepEqual([...parsePorcelainStatus(quoted).keys()], ['çalışma.txt']);
  });

  it('NUL ayraçlı `git status -z` çıktısını ve yeniden adlandırmayı çözer', () => {
    // `-z` biçiminde yeniden adlandırma satırı önce YENİ, sonra ESKİ yolu taşır.
    // `-z` yolları tırnaklamaz; Türkçe ad doğrudan gelir.
    const raw = ' M src/a.ts\0R  yeni.ts\0eski.ts\0?? çalışma dosyası.txt\0';
    const map = parsePorcelainStatus(raw);
    assert.deepEqual([...map.keys()].sort(), ['src/a.ts', 'yeni.ts', 'çalışma dosyası.txt'].sort());
  });

  it('gerçek depoda Türkçe dosya adı ham porcelain ile okunur (uçtan uca)', async () => {
    const root = await workspace();
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'test@evren-kod.dev');
    git('config', 'user.name', 'Evren Test');
    const turkish = 'çalışma dosyası.txt';
    await fs.writeFile(path.join(root, turkish), 'ilk\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');

    await fs.writeFile(path.join(root, turkish), 'ikinci\n');
    const raw = await new GitManager().statusPorcelainRaw(root);

    assert.deepEqual([...parsePorcelainStatus(raw).keys()], [turkish]);
    // Eski yol (`git status --short`) dosya adını octal kaçışla tırnaklardı.
    assert.equal(raw.includes('\\303'), false);
  });
});
