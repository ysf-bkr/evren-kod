/**
 * Bilgi grafı araçları (hepsi salt-okunur).
 *
 * Bilgi grafı iki kaynağı birleştirir: çağrı haritası (kim kimi çağırıyor) ve
 * bilgi tabanı (import'lar, sembol imzaları, mimari kararlar). Amaç, ajanın bir
 * görev için projeyi baştan okumak yerine hazır bağıntıları kullanmasıdır; bu
 * yüzden her çıktı önceden hesaplanmış bir token bütçesiyle döner.
 *
 * Eski çağrı haritası adları (`get_callers`, `call_graph_impact` …) kayıt
 * defterinde alias olarak durur; modele yalnızca yeni adlar sunulur.
 */
import { ToolDefinition, ToolExecutionContext } from './base';
import type { CallGraphPort } from './contracts';
import type { ToolName } from '../shared/types';
import {
  GRAPH_DEFAULT_BUDGET_CHARS,
  GRAPH_MAX_BUDGET_CHARS,
  GRAPH_MAX_LISTED,
  GRAPH_MAX_SUGGESTIONS
} from '../shared/constants';
import { analyzeGraphImpact, buildGraphCard, neighborsOfFocus } from '../core/graph/relations';
import type { GraphSources } from '../core/graph/types';
import { buildArchitectureDigest } from '../core/graph/architecture';
import {
  renderArchitecture,
  renderGraphCard,
  renderGraphImpact,
  renderNeighbors,
  resolveBudget
} from '../core/graph/render';
import { suggestNodes } from '../core/callgraph/query';

/** Araçların iki kaynağı: çağrı haritası belgesi ve bilgi tabanı. */
function sourcesFor(context: ToolExecutionContext): GraphSources {
  return {
    graph: context.callGraph?.getDocument(context.workspaceRoot),
    knowledge: context.knowledgeStore
  };
}

/**
 * İndeksi görev başında tazelemeye çalışır: başarısız olursa grafik mevcut
 * veriyle çalışmaya devam eder, ajanı durdurmaz.
 */
async function freshSources(context: ToolExecutionContext): Promise<GraphSources> {
  const sources = sourcesFor(context);
  if (context.knowledgeStore && context.workspaceRoot) {
    try {
      await context.knowledgeStore.ensureFresh(context.workspaceRoot, { signal: context.signal });
    } catch {
      // Tazeleme başarısız: mevcut indeksle devam edilir.
    }
  }
  return sources;
}

/** Sonuç metnini bütçeye indirger; her araç aynı davranışı gösterir. */
function fit(text: string, budget: number): string {
  return text.length <= budget ? text : `${text.slice(0, budget - 1)}\n… [bütçe aşıldı]`;
}

const depthProperty = {
  type: 'number',
  description: 'How many levels to walk (default depends on tool). 0 = unlimited.'
} as const;

const budgetProperty = {
  type: 'number',
  description: `Output budget in characters (default ${GRAPH_DEFAULT_BUDGET_CHARS}, max ${GRAPH_MAX_BUDGET_CHARS}). Raise it only when you really need a wider view.`
} as const;

export const knowledgeGraphTool: ToolDefinition = {
  name: 'knowledge_graph',
  description:
    'The unified knowledge graph: call relations, file imports, symbol signatures and recorded architecture decisions in one budgeted view. focus can be a symbol, a file path or a directory; mode "architecture" returns the whole-project map. Use it BEFORE reading files: it usually answers what/who-calls-what/what-decisions-apply without opening sources. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      focus: {
        type: 'string',
        description:
          'Symbol name, file#symbol, file path or directory. Required unless mode is "architecture".'
      },
      mode: {
        type: 'string',
        enum: ['card', 'architecture'],
        description: 'card (default) for one focus; architecture for layers, hubs, cycles and decisions.'
      },
      depth: depthProperty,
      limit: { type: 'number', description: `Max rows per list (default ${GRAPH_MAX_LISTED}).` },
      budget: budgetProperty
    },
    required: []
  },
  execute: async (args, context) => {
    const budget = resolveBudget(args.budget);
    const mode = String(args.mode || 'card');

    if (mode === 'architecture') {
      const sources = await freshSources(context);
      const digest = buildArchitectureDigest(sources);
      const graphState = context.callGraph?.status(context.workspaceRoot);
      if (graphState && !graphState.ready) {
        digest.warnings.push(`${graphState.message} Çağrı kenarları eklenince özet zenginleşir.`);
      }
      return fit(renderArchitecture(digest, budget), budget);
    }

    const focus = String(args.focus || '').trim();
    if (!focus) {
      return (
        'focus gerekli: sembol adı, dosya yolu ya da dizin. ' +
        'Tüm proje haritası için mode: "architecture" kullanın.'
      );
    }

    const sources = await freshSources(context);
    const card = buildGraphCard(sources, focus, {
      depth: Number.isFinite(Number(args.depth)) && Number(args.depth) >= 0 ? Number(args.depth) : undefined,
      limit: Number(args.limit) > 0 ? Math.min(Number(args.limit), 200) : undefined
    });
    if ('message' in card) return card.message;
    return fit(renderGraphCard(card, budget), budget);
  }
};

/** Çağıran/çağrılan araçlarının ortak gövdesi. */
async function runNeighborTool(
  context: ToolExecutionContext,
  args: Record<string, unknown>,
  direction: 'callers' | 'callees'
): Promise<string> {
  const budget = resolveBudget(args.budget);
  const symbol = String(args.symbol || '').trim();
  if (!symbol) return 'Sembol adı gerekli.';

  const sources = sourcesFor(context);
  const facts = neighborsOfFocus(sources, symbol, direction, {
    depth: Number.isFinite(Number(args.depth)) && Number(args.depth) >= 0 ? Number(args.depth) : undefined,
    limit: Number(args.limit) > 0 ? Math.min(Number(args.limit), 200) : undefined
  });
  if ('message' in facts) return facts.message;
  const title = direction === 'callers' ? 'CALLERS' : 'CALLEES';
  const text = renderNeighbors(facts, `${title} · ${symbol}`, budget, true);
  if (facts.length === 0) {
    return (
      `${text}\n\nBu, grafiğin dışından (başka paket, dinamik çağrı) kullanılmadığı anlamına gelmez. ` +
      'Dosya düzeyi bağımlılar için knowledge_graph veya analyze_impact bakın.'
    );
  }
  return text;
}

export const graphCallersTool: ToolDefinition = {
  name: 'graph_callers',
  description:
    'Who calls a symbol, grouped by file with signatures and call sites, inside a token budget. Read from the knowledge graph; safe in plan mode. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Symbol name, file#name, or an exact node id.' },
      depth: depthProperty,
      limit: { type: 'number', description: `Max rows per list (default ${GRAPH_MAX_LISTED}).` },
      budget: budgetProperty
    },
    required: ['symbol']
  },
  execute: async (args, context) => runNeighborTool(context, args, 'callers')
};

export const graphCalleesTool: ToolDefinition = {
  name: 'graph_callees',
  description: 'What a symbol calls, grouped by file with signatures, inside a token budget. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Symbol name, file#name, or an exact node id.' },
      depth: depthProperty,
      limit: { type: 'number', description: `Max rows per list (default ${GRAPH_MAX_LISTED}).` },
      budget: budgetProperty
    },
    required: ['symbol']
  },
  execute: async (args, context) => runNeighborTool(context, args, 'callees')
};

export const graphImpactTool: ToolDefinition = {
  name: 'graph_impact',
  description:
    'Blast radius for one or more symbols: direct/indirect callers, affected tests and files, import dependents the call graph cannot see, plus related recorded decisions. Use before touching shared functions, types or API contracts. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      symbols: {
        type: 'array',
        description: 'Symbol names or ids to analyze.',
        items: { type: 'string' }
      },
      depth: depthProperty,
      limit: { type: 'number', description: `Max rows per list (default ${GRAPH_MAX_LISTED}).` },
      budget: budgetProperty
    },
    required: ['symbols']
  },
  execute: async (args, context) => {
    const budget = resolveBudget(args.budget);
    const raw = Array.isArray(args.symbols) ? args.symbols : [];
    const foci = raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    if (foci.length === 0) return 'En az bir sembol adı gerekli.';

    const sources = await freshSources(context);
    const impact = analyzeGraphImpact(sources, foci, {
      depth: Number.isFinite(Number(args.depth)) && Number(args.depth) >= 0 ? Number(args.depth) : undefined,
      limit: Number(args.limit) > 0 ? Math.min(Number(args.limit), 200) : undefined
    });
    if ('message' in impact) return impact.message;
    return fit(renderGraphImpact(impact, budget), budget);
  }
};

export const graphSearchTool: ToolDefinition = {
  name: 'graph_search',
  description:
    'Finds symbols and files by keyword across the knowledge graph and returns exact file:line-endLine ranges with signatures. Cheaper first step than search_files when you know a name; read only the returned range if the body is needed. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keyword, partial symbol name or path fragment.' },
      limit: { type: 'number', description: `Max rows per group (default ${GRAPH_MAX_SUGGESTIONS}).` }
    },
    required: ['query']
  },
  execute: async (args, context) => {
    const budget = resolveBudget(args.budget ?? 6_000);
    const query = String(args.query || '').trim();
    if (!query) return 'Arama metni gerekli.';
    const limit = Math.min(Number(args.limit) > 0 ? Number(args.limit) : GRAPH_MAX_SUGGESTIONS, 40);

    const sources = await freshSources(context);
    const lines: string[] = [`SEARCH · ${query}`];

    const graphMatches = sources.graph ? suggestNodes(sources.graph, query, limit) : [];
    if (graphMatches.length > 0) {
      lines.push(`SYMBOLS (${graphMatches.length})`);
      lines.push(
        ...graphMatches.map(
          (node) =>
            `  ${node.file}:${node.startLine}-${node.endLine} ${node.name} [${node.kind}]` +
            `${node.exported ? ' export' : ''}${node.isTest ? ' test' : ''}`
        )
      );
    }

    const knowledgeSymbols = sources.knowledge?.findSymbols(query, limit) ?? [];
    const extra = knowledgeSymbols.filter(
      (symbol) => !graphMatches.some((node) => node.file === symbol.file && node.name === symbol.name)
    );
    if (extra.length > 0) {
      lines.push(`INDEX SYMBOLS (${extra.length})`);
      lines.push(
        ...extra.map(
          (symbol) =>
            `  ${symbol.file}:${symbol.line}${symbol.endLine ? `-${symbol.endLine}` : ''} ${symbol.name} [${symbol.kind}]` +
            (symbol.signature ? ` ${symbol.signature}` : '')
        )
      );
    }

    const files = sources.knowledge?.findFiles(query, limit) ?? [];
    if (files.length > 0) {
      lines.push(`FILES (${files.length})`);
      lines.push(
        ...files.map((path) => {
          const record = sources.knowledge?.getFile(path);
          const summary = record?.summary?.split(/[.\n]/)[0]?.trim();
          const dependents = sources.knowledge?.dependentsOf(path, 3).length ?? 0;
          return `  ${path}${summary ? ` — ${summary}` : ` (${record?.exports.length ?? 0} export, ${dependents}+ importer)`}`;
        })
      );
    }

    if (lines.length === 1) {
      return (
        `"${query}" bilgi grafında bulunamadı. ` +
        (context.callGraph?.status(context.workspaceRoot).message ||
          'Harita henüz hazırlanıyor olabilir; `graph_status` durumunu kontrol edin.')
      );
    }
    return fit(lines.join('\n'), budget);
  }
};

export const graphStatusTool: ToolDefinition = {
  name: 'graph_status',
  description:
    'Reports knowledge graph readiness: call graph scan state, knowledge index freshness, symbol/signature coverage and recorded decisions. Read-only.',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (_args, context) => {
    const lines: string[] = [];
    const manager: CallGraphPort | undefined = context.callGraph;
    if (manager) {
      const status = manager.status(context.workspaceRoot);
      lines.push(`CALL GRAPH · ${status.message}`);
      if (status.meta) {
        lines.push(
          `  nodes ${status.meta.nodeCount} · edges ${status.meta.edgeCount} · files ${status.meta.fileCount}`,
          `  incomplete files ${status.meta.incompleteFiles}`,
          `  last update ${new Date(status.meta.updatedAt).toISOString()}`
        );
      }
      if (status.building) lines.push(`  scan in progress: %${status.progress ?? 0}`);
    } else {
      lines.push('CALL GRAPH · bu çalışma alanında kapalı (evren-kod.callGraphEnabled).');
    }

    const knowledge = context.knowledgeStore;
    if (knowledge) {
      const stats = knowledge.knowledgeStats();
      lines.push(
        'KNOWLEDGE BASE',
        `  files ${stats.files} · symbols ${stats.symbols} · summaries ${stats.summaries}`,
        `  decisions ${stats.decisions} · conventions ${stats.conventions} · notes ${stats.notes}`,
        `  indexed ${stats.indexedAt ? new Date(stats.indexedAt).toISOString() : 'never'}${stats.lastCommit ? ` · commit ${stats.lastCommit}` : ''}`
      );
      if (stats.files === 0) lines.push('  run index_workspace to build it.');
    } else {
      lines.push('KNOWLEDGE BASE · kullanılamıyor.');
    }
    return lines.join('\n');
  }
};

/**
 * Eski adların gölge araçları: oturumlar ve modeller eski adı çağırırsa
 * çalışsın diye kayıt defterinde durur, ancak modele şema olarak listelenmez.
 */
function aliasOf(name: ToolName, target: ToolDefinition): ToolDefinition {
  return {
    ...target,
    name,
    description: `Deprecated alias of ${target.name}. Call ${target.name} instead.`
  };
}

/** Modele sunulan altı araç index.ts üzerinden; burada yalnız yürütme kaydı durur. */

/** Yalnızca yürütme kaydı olarak kalan eski adlar. */
export type LegacyGraphToolName =
  | 'get_callers'
  | 'get_callees'
  | 'call_graph_impact'
  | 'find_related_code'
  | 'call_graph_status';

export const LEGACY_GRAPH_TOOLS: Record<LegacyGraphToolName, ToolDefinition> = {
  get_callers: aliasOf('get_callers', graphCallersTool),
  get_callees: aliasOf('get_callees', graphCalleesTool),
  call_graph_impact: aliasOf('call_graph_impact', graphImpactTool),
  find_related_code: aliasOf('find_related_code', graphSearchTool),
  call_graph_status: aliasOf('call_graph_status', graphStatusTool)
};
