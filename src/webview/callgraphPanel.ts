/**
 * Çağrı grafiği ekranı için sorgu çözücüsü.
 *
 * Motorun çağrı grafiği haritasını arayüz "nereden görülüp incelenecek?"
 * sorusunun cevabıdır: durum, sembol arama ve çağıran/çağrılan komşuları tek
 * istek-yanıt sözleşmesine indirger. SidebarProvider yalnızca taşıyıcıdır;
 * tüm mantık burada ve vscode bağımlılığı olmadan sınanabilir.
 */
import { CallGraphManager } from '@evren-kod/core/core/callgraph/CallGraphManager';
import type { KnowledgeStore } from '@evren-kod/core/core/knowledge/KnowledgeStore';
import { clampDepth, findCallers, findCallees, suggestNodes } from '@evren-kod/core/core/callgraph/query';
import type {
  CallGraphDocument,
  CallGraphNode,
  CallGraphNeighbor
} from '@evren-kod/core/core/callgraph/types';
import {
  CALLGRAPH_MAX_DEPS_PER_FILE,
  CALLGRAPH_MAX_FILE_SYMBOLS,
  CALLGRAPH_MAX_LISTED
} from '@evren-kod/core/shared/constants';
import {
  CallGraphPanelNeighbor,
  CallGraphPanelNode,
  CallGraphPanelRequest,
  CallGraphPanelResult
} from '@evren-kod/core/shared/types';

/** Çözücünün ihtiyaç duyduğu dar yüzey; testler sahte yöneticiyle beslenir. */
export type CallGraphPanelSource = Pick<CallGraphManager, 'ensureReady' | 'getDocument' | 'rebuild'>;

/**
 * Bilgi tabanının panele eşlik eden sayıları. Ekran "Bilgi Grafiği" başlığıyla
 * iki kaynağı birden anlattığı için başlık ile içerik birbirini tutar.
 */
export type CallGraphPanelKnowledge = Pick<KnowledgeStore, 'knowledgeStats'> &
  Partial<Pick<KnowledgeStore, 'findSymbolsByFile'>>;

function toPanelNode(node: CallGraphNode): CallGraphPanelNode {
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    file: node.file,
    startLine: node.startLine,
    exported: node.exported,
    isTest: node.isTest,
    className: node.className
  };
}

function toPanelNeighbor(neighbor: CallGraphNeighbor): CallGraphPanelNeighbor {
  return { ...toPanelNode(neighbor.node), depth: neighbor.depth, lines: neighbor.lines };
}

function statsOf(document: CallGraphDocument | undefined, knowledge?: CallGraphPanelKnowledge) {
  const stats = knowledge?.knowledgeStats();
  if (!document) {
    return stats
      ? {
          files: 0,
          nodes: 0,
          edges: 0,
          incompleteFiles: 0,
          knowledge: {
            files: stats.files,
            symbols: stats.symbols,
            summaries: stats.summaries,
            decisions: stats.decisions,
            notes: stats.notes
          }
        }
      : undefined;
  }
  const files = Object.values(document.files);
  return {
    files: files.length,
    nodes: document.meta.nodeCount,
    edges: document.meta.edgeCount,
    updatedAt: document.meta.updatedAt,
    incompleteFiles: files.filter((file) => file.status !== 'complete').length,
    ...(stats
      ? {
          knowledge: {
            files: stats.files,
            symbols: stats.symbols,
            summaries: stats.summaries,
            decisions: stats.decisions,
            notes: stats.notes
          }
        }
      : {})
  };
}

export async function resolveCallGraphPanelRequest(
  manager: CallGraphPanelSource,
  workspaceRoot: string | undefined,
  request: CallGraphPanelRequest,
  knowledge?: CallGraphPanelKnowledge
): Promise<CallGraphPanelResult> {
  const base: CallGraphPanelResult = {
    action: request.action,
    ready: false,
    building: false,
    message: ''
  };
  if (!workspaceRoot) {
    return { ...base, message: 'Aktif bir çalışma alanı klasörü yok.' };
  }

  if (request.action === 'rebuild') {
    const status = await manager.rebuild(workspaceRoot);
    return {
      ...base,
      ready: status.ready,
      building: status.building,
      progress: status.progress,
      message: status.message,
      stats: statsOf(manager.getDocument(workspaceRoot), knowledge)
    };
  }

  const status = await manager.ensureReady(workspaceRoot);
  const document = manager.getDocument(workspaceRoot);
  if (request.action === 'status') {
    return {
      ...base,
      ready: status.ready,
      building: status.building,
      progress: status.progress,
      message: status.message,
      stats: statsOf(document, knowledge)
    };
  }

  if (!document) {
    return {
      ...base,
      ready: status.ready,
      building: status.building,
      progress: status.progress,
      message: status.message || 'Çağrı haritası henüz hazır değil.'
    };
  }

  if (request.action === 'search') {
    return {
      ...base,
      ready: true,
      message: status.message,
      stats: statsOf(document, knowledge),
      matches: suggestNodes(document, request.query || '', CALLGRAPH_MAX_LISTED).map(toPanelNode)
    };
  }

  // files: haritadaki tüm dosyaların özeti (yol, durum, sembol/kenar sayıları).
  if (request.action === 'files') {
    const testFiles = new Set(document.nodes.filter((node) => node.isTest).map((node) => node.file));
    const rows = Object.entries(document.files)
      .map(([filePath, meta]) => ({
        path: filePath,
        status: meta.status,
        nodeCount: meta.nodeCount,
        edgeCount: meta.edgeCount,
        externalCalls: meta.externalCalls,
        isTest: testFiles.has(filePath),
        reason: meta.reason
      }))
      .sort((a, b) => a.path.localeCompare(b.path));

    // Bilgi tabanında sembolü olan ancak haritada 0 görünen dosyaları zenginleştir
    if (knowledge && typeof knowledge.findSymbolsByFile === 'function') {
      for (const row of rows) {
        if (row.nodeCount === 0) {
          const kSymbols = knowledge.findSymbolsByFile(row.path);
          if (kSymbols && kSymbols.length > 0) {
            row.nodeCount = kSymbols.length;
            if (row.status === 'skipped') row.status = 'complete';
          }
        }
      }
    }

    return {
      ...base,
      ready: true,
      message: status.message,
      stats: statsOf(document, knowledge),
      files: rows
    };
  }

  // fileSymbols: tek dosyanın sembolleri, tanım satırı sırasıyla.
  if (request.action === 'fileSymbols') {
    const target = request.path || '';
    let symbols = document.nodes
      .filter((candidate) => candidate.file === target)
      .sort((a, b) => a.startLine - b.startLine)
      .slice(0, CALLGRAPH_MAX_FILE_SYMBOLS)
      .map(toPanelNode);

    // Eğer haritada sembol yoksa ancak bilgi tabanında taranmışsa:
    if (symbols.length === 0 && knowledge && typeof knowledge.findSymbolsByFile === 'function') {
      const kSymbols = knowledge.findSymbolsByFile(target);
      if (kSymbols && kSymbols.length > 0) {
        symbols = kSymbols.slice(0, CALLGRAPH_MAX_FILE_SYMBOLS).map((ks) => ({
          id: `${ks.file}#${ks.name}`,
          name: ks.name,
          kind:
            ks.kind === 'class'
              ? 'class'
              : ks.kind === 'method' || ks.kind === 'constructor'
                ? 'method'
                : 'function',
          file: ks.file,
          startLine: ks.line,
          exported: true,
          isTest: false
        }));
      }
    }

    return {
      ...base,
      ready: true,
      message: status.message,
      stats: statsOf(document, knowledge),
      path: target,
      fileSymbols: symbols
    };
  }

  // deps: dosya↔dosya çağrı ilişkileri. `path` verilirse yalnız o dosyanın
  // her iki yöndeki bağlantıları; yoksa en sık bağlantılı ilk çiftler döner.
  if (request.action === 'deps') {
    const fileOf = new Map(document.nodes.map((candidate) => [candidate.id, candidate.file]));
    const pairs = new Map<string, number>();
    for (const edge of document.edges) {
      const from = fileOf.get(edge.from);
      const to = fileOf.get(edge.to);
      // Kendi kendine (dosya içi) çağrılar bağlantı sayılmaz.
      if (!from || !to || from === to) continue;
      const key = `${from}\u0000${to}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
    const target = request.path;
    const rows = [...pairs.entries()]
      .map(([key, count]) => {
        const [from = '', to = ''] = key.split('\u0000');
        return { from, to, count };
      })
      .filter((row) => !target || row.from === target || row.to === target)
      .sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
      .slice(0, target ? CALLGRAPH_MAX_DEPS_PER_FILE : CALLGRAPH_MAX_LISTED);
    return {
      ...base,
      ready: true,
      message: status.message,
      stats: statsOf(document, knowledge),
      path: target,
      deps: rows
    };
  }

  // neighbors: seçili düğümün çağıranları ve çağrılanları.
  const node = document.nodes.find((candidate) => candidate.id === request.nodeId);
  if (!node) {
    return {
      ...base,
      ready: true,
      message: 'Düğüm haritada bulunamadı.',
      stats: statsOf(document, knowledge)
    };
  }
  const depth = clampDepth(request.depth ?? 2);
  return {
    ...base,
    ready: true,
    message: status.message,
    stats: statsOf(document, knowledge),
    callers: findCallers(document, [node.id], depth).map(toPanelNeighbor),
    callees: findCallees(document, [node.id], depth).map(toPanelNeighbor)
  };
}
