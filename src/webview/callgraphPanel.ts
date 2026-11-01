/**
 * Çağrı grafiği ekranı için sorgu çözücüsü.
 *
 * Motorun çağrı grafiği haritasını arayüz "nereden görülüp incelenecek?"
 * sorusunun cevabıdır: durum, sembol arama ve çağıran/çağrılan komşuları tek
 * istek-yanıt sözleşmesine indirger. SidebarProvider yalnızca taşıyıcıdır;
 * tüm mantık burada ve vscode bağımlılığı olmadan sınanabilir.
 */
import { CallGraphManager } from '@evren-kod/core/core/callgraph/CallGraphManager';
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

function statsOf(document: CallGraphDocument | undefined) {
  if (!document) return undefined;
  const files = Object.values(document.files);
  return {
    files: files.length,
    nodes: document.meta.nodeCount,
    edges: document.meta.edgeCount,
    updatedAt: document.meta.updatedAt,
    incompleteFiles: files.filter((file) => file.status !== 'complete').length
  };
}

export async function resolveCallGraphPanelRequest(
  manager: CallGraphPanelSource,
  workspaceRoot: string | undefined,
  request: CallGraphPanelRequest
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
      stats: statsOf(manager.getDocument(workspaceRoot))
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
      stats: statsOf(document)
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
      stats: statsOf(document),
      matches: suggestNodes(document, request.query || '', CALLGRAPH_MAX_LISTED).map(toPanelNode)
    };
  }

  // files: haritadaki tüm dosyaların özeti (yol, durum, sembol/kenar sayıları).
  if (request.action === 'files') {
    const testFiles = new Set(document.nodes.filter((node) => node.isTest).map((node) => node.file));
    const rows = Object.entries(document.files)
      .map(([path, meta]) => ({
        path,
        status: meta.status,
        nodeCount: meta.nodeCount,
        edgeCount: meta.edgeCount,
        externalCalls: meta.externalCalls,
        isTest: testFiles.has(path),
        reason: meta.reason
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
    return {
      ...base,
      ready: true,
      message: status.message,
      stats: statsOf(document),
      files: rows
    };
  }

  // fileSymbols: tek dosyanın sembolleri, tanım satırı sırasıyla.
  if (request.action === 'fileSymbols') {
    const target = request.path || '';
    const symbols = document.nodes
      .filter((candidate) => candidate.file === target)
      .sort((a, b) => a.startLine - b.startLine)
      .slice(0, CALLGRAPH_MAX_FILE_SYMBOLS)
      .map(toPanelNode);
    return {
      ...base,
      ready: true,
      message: status.message,
      stats: statsOf(document),
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
      stats: statsOf(document),
      path: target,
      deps: rows
    };
  }

  // neighbors: seçili düğümün çağıranları ve çağrılanları.
  const node = document.nodes.find((candidate) => candidate.id === request.nodeId);
  if (!node) {
    return { ...base, ready: true, message: 'Düğüm haritada bulunamadı.', stats: statsOf(document) };
  }
  const depth = clampDepth(request.depth ?? 2);
  return {
    ...base,
    ready: true,
    message: status.message,
    stats: statsOf(document),
    callers: findCallers(document, [node.id], depth).map(toPanelNeighbor),
    callees: findCallees(document, [node.id], depth).map(toPanelNeighbor)
  };
}
