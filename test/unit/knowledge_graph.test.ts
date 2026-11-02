import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';

import { KnowledgeStore } from '@evren-kod/core/core/knowledge/KnowledgeStore';
import { extractSignature, extractSymbols } from '@evren-kod/core/core/knowledge/extraction';
import { analyzeGraphImpact, buildGraphCard, neighborsOfFocus } from '@evren-kod/core/core/graph/relations';
import type { GraphSources } from '@evren-kod/core/core/graph/types';
import { buildArchitectureDigest } from '@evren-kod/core/core/graph/architecture';
import { renderGraphCard, resolveBudget } from '@evren-kod/core/core/graph/render';
import type { CallGraphDocument } from '@evren-kod/core/core/callgraph/types';
import { ALL_TOOLS, MODEL_TOOLS } from '@evren-kod/core/tools';
import { DEPRECATED_TOOL_NAMES } from '@evren-kod/core/shared/types';
import type { CallGraphPort } from '@evren-kod/core/tools/contracts';

/** Küçük ama gerçek bir depo: iki katman, tek yön bağımlılık, bir test dosyası. */
const FILES: Record<string, string> = {
  'src/core/service.ts': [
    'export function computeTotal(items: number[]): number {',
    '  return items.length;',
    '}',
    '',
    'export class Ledger {',
    '  constructor(public readonly name: string) {}',
    '}'
  ].join('\n'),
  'src/core/api.ts': [
    "import { computeTotal } from './service';",
    '',
    'export function handleRequest(counts: number[]): number {',
    '  return computeTotal(counts);',
    '}'
  ].join('\n'),
  'src/entry.ts': [
    "import { handleRequest } from './core/api';",
    '',
    'export function main(): number {',
    '  return handleRequest([1, 2]);',
    '}'
  ].join('\n'),
  'test/service.test.ts': [
    "import { computeTotal } from '../src/core/service';",
    '',
    'function testComputeTotal(): void {',
    '  computeTotal([]);',
    '}'
  ].join('\n')
};

const GRAPH: CallGraphDocument = {
  meta: {
    version: 1,
    root: '/fixture',
    createdAt: 1,
    updatedAt: 2,
    languageServers: [],
    nodeCount: 5,
    edgeCount: 3,
    fileCount: 4,
    incompleteFiles: 0
  },
  nodes: [
    {
      id: 'src/core/service.ts#computeTotal',
      name: 'computeTotal',
      kind: 'function',
      file: 'src/core/service.ts',
      startLine: 1,
      endLine: 3,
      exported: true,
      isTest: false
    },
    {
      id: 'src/core/api.ts#handleRequest',
      name: 'handleRequest',
      kind: 'function',
      file: 'src/core/api.ts',
      startLine: 3,
      endLine: 5,
      exported: true,
      isTest: false
    },
    {
      id: 'src/entry.ts#main',
      name: 'main',
      kind: 'function',
      file: 'src/entry.ts',
      startLine: 3,
      endLine: 5,
      exported: true,
      isTest: false
    },
    {
      id: 'test/service.test.ts#testComputeTotal',
      name: 'testComputeTotal',
      kind: 'function',
      file: 'test/service.test.ts',
      startLine: 3,
      endLine: 5,
      exported: false,
      isTest: true
    }
  ],
  edges: [
    {
      from: 'src/core/api.ts#handleRequest',
      to: 'src/core/service.ts#computeTotal',
      lines: [4],
      confidence: 'exact'
    },
    {
      from: 'src/entry.ts#main',
      to: 'src/core/api.ts#handleRequest',
      lines: [4],
      confidence: 'exact'
    },
    {
      from: 'test/service.test.ts#testComputeTotal',
      to: 'src/core/service.ts#computeTotal',
      lines: [4],
      confidence: 'exact'
    }
  ],
  files: {
    'src/core/service.ts': {
      hash: 'a',
      status: 'complete',
      nodeCount: 2,
      edgeCount: 0,
      externalCalls: 0,
      scannedAt: 1
    },
    'src/core/api.ts': {
      hash: 'b',
      status: 'complete',
      nodeCount: 1,
      edgeCount: 1,
      externalCalls: 0,
      scannedAt: 1
    },
    'src/entry.ts': {
      hash: 'c',
      status: 'complete',
      nodeCount: 1,
      edgeCount: 1,
      externalCalls: 0,
      scannedAt: 1
    },
    'test/service.test.ts': {
      hash: 'd',
      status: 'complete',
      nodeCount: 1,
      edgeCount: 1,
      externalCalls: 0,
      scannedAt: 1
    }
  }
};

function fakeCallGraph(document: CallGraphDocument | undefined): CallGraphPort {
  return {
    status: () => ({
      ready: Boolean(document),
      building: false,
      meta: document?.meta,
      message: document ? 'Çağrı haritası hazır.' : 'Çağrı haritası henüz oluşturulmadı.'
    }),
    getDocument: () => document
  };
}

describe('extractSymbols: sınıf metotları ve kontrol sözcükleri', () => {
  it('class methods are indexed with their own signature', () => {
    const source = [
      'export class Ledger {',
      '  private total = 0;',
      '',
      '  add(value: number): void {',
      '    this.total += value;',
      '  }',
      '',
      '  get balance(): number {',
      '    return this.total;',
      '  }',
      '}'
    ].join('\n');
    const symbols = extractSymbols('ledger.ts', source);
    const names = symbols.map((symbol) => symbol.name);
    assert.ok(names.includes('Ledger'), 'sınıf bulunamadı');
    assert.ok(names.includes('add'), 'metot bulunamadı');
    const add = symbols.find((symbol) => symbol.name === 'add');
    assert.strictEqual(add?.kind, 'method');
    assert.match(add?.signature ?? '', /add\(value: number\)/);
  });

  it('control-flow blocks and chained calls are not mistaken for methods', () => {
    const source = [
      'export function run(items: number[]): number {',
      '  let sum = 0;',
      '  for (const item of items) {',
      '    if (item > 0) {',
      '      sum += item;',
      '    }',
      '  }',
      '  items.map((item) => {',
      '    return item;',
      '  });',
      '  return sum;',
      '}'
    ].join('\n');
    const names = extractSymbols('run.ts', source).map((symbol) => symbol.name);
    for (const control of ['if', 'for', 'while', 'switch', 'return']) {
      assert.ok(!names.includes(control), `kontrol sözcüğü sembol olmuş: ${control}`);
    }
    assert.ok(names.includes('run'), 'fonksiyonun kendisi bulunamadı');
  });
});

describe('KnowledgeStore: imza ve bağıntı sorguları', () => {
  let root: string;
  let store: KnowledgeStore;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'evren-kod-graph-'));
    for (const [relative, content] of Object.entries(FILES)) {
      const target = path.join(root, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf-8');
    }
    store = new KnowledgeStore();
    await store.indexWorkspace(root);
    await store.writeHumanFile(
      root,
      'decisions',
      ['# Kararlar', '', '- computeTotal saf kalmalı; giriş/çıkış yan etkisi eklenemez.'].join('\n')
    );
    await store.load(root);
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('extractSignature keeps the declaration and drops the body', () => {
    assert.strictEqual(
      extractSignature('export function computeTotal(items: number[]): number {'),
      'export function computeTotal(items: number[]): number'
    );
    assert.strictEqual(extractSignature('export const limit = 5;'), 'export const limit');
  });

  it('index stores signatures so the agent can skip reading bodies', () => {
    const symbols = store.findSymbols('computeTotal');
    assert.ok(symbols.length > 0, 'sembol indekslenmedi');
    assert.match(symbols[0]!.signature ?? '', /computeTotal\(items: number\[\]\)/);
  });

  it('dependentsOf and importsOf return both directions of the file graph', () => {
    assert.deepEqual(store.dependentsOf('src/core/service.ts'), ['src/core/api.ts', 'test/service.test.ts']);
    assert.deepEqual(store.importsOf('src/core/api.ts'), ['src/core/service.ts']);
  });

  it('knowledgeNotes links recorded decisions to a symbol query', () => {
    const notes = store.knowledgeNotes(['computeTotal']);
    assert.strictEqual(notes.length, 1);
    assert.match(notes[0]!.text, /saf kalmalı/);
    assert.strictEqual(notes[0]!.source, 'decisions.md');
  });
});

describe('Bilgi grafı: kart, etki ve komşular', () => {
  let root: string;
  let sources: GraphSources;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'evren-kod-card-'));
    for (const [relative, content] of Object.entries(FILES)) {
      const target = path.join(root, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf-8');
    }
    const store = new KnowledgeStore();
    await store.indexWorkspace(root);
    await store.writeHumanFile(
      root,
      'decisions',
      ['# Kararlar', '', '- computeTotal saf kalmalı; yan etek eklenemez.'].join('\n')
    );
    sources = { graph: GRAPH, knowledge: store };
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('symbol card carries ranges, signatures, callers and decisions', () => {
    const card = buildGraphCard(sources, 'computeTotal', { depth: 2 });
    if ('message' in card) assert.fail(card.message);

    const definition = card.definitions.find((fact) => fact.name === 'computeTotal');
    assert.ok(definition, 'tanım çözülmedi');
    assert.strictEqual(definition.file, 'src/core/service.ts');
    assert.strictEqual(definition.line, 1);
    assert.match(definition.signature ?? '', /computeTotal/);

    assert.ok(card.callers.some((fact) => fact.name === 'handleRequest'));
    assert.ok(
      card.callers.some((fact) => fact.isTest),
      'test çağıranı görünmüyor'
    );
    assert.ok(
      card.files.some((file) => file.path === 'src/core/service.ts'),
      'dosya bağıntıları yok'
    );
    assert.ok(card.notes.length > 0, 'ilgili karar eklenmedi');
  });

  it('file focus lists every symbol with its own range', () => {
    const card = buildGraphCard(sources, 'src/core/service.ts');
    if ('message' in card) assert.fail(card.message);
    assert.strictEqual(card.kind, 'file');
    assert.ok(card.definitions.some((fact) => fact.name === 'Ledger'));
    assert.ok(card.callers.some((fact) => fact.file === 'src/core/api.ts'));
  });

  it('unknown focus returns candidates instead of an empty answer', () => {
    const result = buildGraphCard(sources, 'computeTotl');
    assert.ok('message' in result);
    assert.match((result as { message: string }).message, /Benzer semboller/);
  });

  it('impact adds import dependents the call graph cannot see', () => {
    const impact = analyzeGraphImpact(sources, ['computeTotal'], { depth: 2 });
    if ('message' in impact) assert.fail(impact.message);
    assert.ok(impact.directCallers.some((fact) => fact.name === 'handleRequest'));
    assert.ok(impact.indirectCallers.some((fact) => fact.name === 'main'));
    assert.ok(impact.dependents.includes('src/core/api.ts'));
    assert.ok(impact.tests.length > 0);
  });

  it('neighborsOfFocus walks one direction only', () => {
    const callers = neighborsOfFocus(sources, 'computeTotal', 'callers', { depth: 1 });
    assert.ok(Array.isArray(callers));
    if (!Array.isArray(callers)) assert.fail('çözümlenemedi');
    assert.deepEqual(callers.map((fact) => fact.name).sort(), ['handleRequest', 'testComputeTotal']);
  });

  it('architecture digest groups files and surfaces dependency direction', () => {
    const digest = buildArchitectureDigest(sources);
    assert.ok(digest.indexedFiles >= 4);
    assert.ok(digest.groups.some((group) => group.path === 'src/core'));
    assert.ok(digest.hubs.some((hub) => hub.path === 'src/core/service.ts'));
    assert.ok(digest.decisions.length > 0);
  });

  it('rendered cards respect the token budget', () => {
    const card = buildGraphCard(sources, 'computeTotal', { depth: 3, limit: 50 });
    if ('message' in card) assert.fail(card.message);
    const text = renderGraphCard(card, 900);
    assert.ok(text.length <= 900, `bütçe aşıldı: ${text.length}`);
    assert.match(text, /GRAPH SYMBOL/);
  });

  it('budget argument is clamped to the safe range', () => {
    assert.strictEqual(resolveBudget(undefined), 7_000);
    assert.strictEqual(resolveBudget(-1), 7_000);
    assert.strictEqual(resolveBudget(1_000_000), 12_000);
  });
});

describe('Bilgi grafı araçları', () => {
  let root: string;
  let store: KnowledgeStore;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'evren-kod-tool-'));
    for (const [relative, content] of Object.entries(FILES)) {
      const target = path.join(root, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf-8');
    }
    store = new KnowledgeStore();
    await store.indexWorkspace(root);
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('registers new names and keeps old names as execution-only aliases', () => {
    for (const name of [
      'knowledge_graph',
      'graph_callers',
      'graph_callees',
      'graph_impact',
      'graph_search',
      'graph_status'
    ] as const) {
      assert.ok(ALL_TOOLS[name], `kayıt defterinde eksik: ${name}`);
    }
    const modelNames = new Set(MODEL_TOOLS.map((tool) => tool.name));
    for (const legacy of DEPRECATED_TOOL_NAMES) {
      assert.ok(ALL_TOOLS[legacy], `alias kaydı eksik: ${legacy}`);
      assert.ok(!modelNames.has(legacy), `eski ad modele sunuluyor: ${legacy}`);
    }
  });

  it('knowledge_graph answers a symbol focus without reading files', async () => {
    const output = await ALL_TOOLS.knowledge_graph.execute(
      { focus: 'computeTotal', depth: 2 },
      { workspaceRoot: root, knowledgeStore: store, callGraph: fakeCallGraph(GRAPH) }
    );
    assert.match(output, /GRAPH SYMBOL · computeTotal/);
    assert.match(output, /src\/core\/service\.ts:1-3/);
    assert.match(output, /CALLERS/);
    assert.match(output, /read_file path=src\/core\/service\.ts offset=1/);
  });

  it('architecture mode reports groups and hubs', async () => {
    const output = await ALL_TOOLS.knowledge_graph.execute(
      { mode: 'architecture' },
      { workspaceRoot: root, knowledgeStore: store, callGraph: fakeCallGraph(GRAPH) }
    );
    assert.match(output, /ARCHITECTURE/);
    assert.match(output, /GROUPS/);
    assert.match(output, /HUBS/);
  });

  it('graph_callers explains an empty result instead of staying silent', async () => {
    const output = await ALL_TOOLS.graph_callers.execute(
      { symbol: 'Ledger' },
      { workspaceRoot: root, knowledgeStore: store, callGraph: fakeCallGraph(GRAPH) }
    );
    assert.match(output, /CALLERS · Ledger \(0\)/);
    assert.match(output, /anlamına gelmez/);
  });

  it('legacy alias still runs and points at the new name', async () => {
    const output = await ALL_TOOLS.get_callers.execute(
      { symbol: 'computeTotal' },
      { workspaceRoot: root, knowledgeStore: store, callGraph: fakeCallGraph(GRAPH) }
    );
    assert.match(output, /handleRequest/);
    assert.match(ALL_TOOLS.get_callers.description, /graph_callers/);
  });

  it('graph_status reports both sources honestly', async () => {
    const output = await ALL_TOOLS.graph_status.execute(
      {},
      { workspaceRoot: root, knowledgeStore: store, callGraph: fakeCallGraph(GRAPH) }
    );
    assert.match(output, /CALL GRAPH · Çağrı haritası hazır\./);
    assert.match(output, /KNOWLEDGE BASE/);
    assert.match(output, /files \d+ · symbols \d+/);
  });

  it('missing call graph degrades to knowledge facts with a warning', async () => {
    const output = await ALL_TOOLS.knowledge_graph.execute(
      { focus: 'src/core/api.ts' },
      { workspaceRoot: root, knowledgeStore: store, callGraph: fakeCallGraph(undefined) }
    );
    assert.match(output, /GRAPH FILE/);
    assert.match(output, /handleRequest/);
  });
});
