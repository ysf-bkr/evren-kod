/**
 * Bilgi grafının mimari görünümü: projenin kuzden haritası.
 *
 * Ajan tek bir çağrıda şunları görür: dizin/katman grupları, en çok kullanılan
 * dosyalar, gruplar arası bağımlılık yönleri, bağımlılık döngüleri ve kabul
 * edilmiş mimari kararlar. Amaç, "projeyi anlamak için dosyaları baştan
 * okuma" alışkanlığını gereksiz kılmaktır; buradaki sayılar belirlenimcidir.
 */
import { SOURCE_EXTENSIONS } from '../knowledge/paths';
import { isTestFile } from '../callgraph/identity';
import { detectDependencyCycle } from '../plan/dependencyCycle';
import { GRAPH_MAX_GROUPS } from '../../shared/constants';
import type { ArchitectureDigest, ArchitectureEdge, ArchitectureGroup, GraphSources } from './types';

/** Bir dosyanın grup anahtarı: en fazla üç dizinlik klasör yoluna indirger. */
function groupOf(relativePath: string): string {
  const parts = relativePath.split('/');
  const directories = parts.slice(0, Math.max(0, parts.length - 1));
  if (directories.length === 0) return '.';
  return directories.slice(0, 3).join('/');
}

/** Soneksiz ve sonekli anahtarlar: `src/a/b` ile `src/a/b.ts` aynı hedefe çıkar. */
function pathKeys(relativePath: string): string[] {
  const keys = new Set<string>([relativePath]);
  for (const extension of SOURCE_EXTENSIONS) {
    if (relativePath.endsWith(extension)) keys.add(relativePath.slice(0, -extension.length));
  }
  return [...keys];
}

/** Dosyadan dosyaya import kenarları; takma adlı (`@scope/...`) yollar da çözülür. */
function resolveImportEdges(files: Array<{ path: string; imports: string[] }>): Map<string, Set<string>> {
  const byKey = new Map<string, string>();
  const byTail = new Map<string, string[]>();
  for (const file of files) {
    for (const key of pathKeys(file.path)) {
      byKey.set(key, file.path);
      const tail = key.split('/').slice(-2).join('/');
      const bucket = byTail.get(tail);
      if (bucket) bucket.push(file.path);
      else byTail.set(tail, [file.path]);
    }
  }

  const edges = new Map<string, Set<string>>();
  for (const file of files) {
    const targets = new Set<string>();
    for (const specifier of file.imports) {
      const direct = byKey.get(specifier);
      if (direct && direct !== file.path) {
        targets.add(direct);
        continue;
      }
      // Yol takma adı (`@shared/types`): kuyruk eşleşmesiyle bulunur.
      const tail = specifier.split('/').slice(-2).join('/');
      const candidates = byTail.get(tail) ?? [];
      const match = candidates.find((candidate) => candidate !== file.path);
      if (match) targets.add(match);
    }
    if (targets.size > 0) edges.set(file.path, targets);
  }
  return edges;
}

/** Dosyadan dosyaya çağrı kenarları: gelen çağrı sayıları haritadan gelir. */
function incomingCallsByFile(sources: GraphSources): Map<string, number> {
  const counts = new Map<string, number>();
  if (!sources.graph) return counts;
  const fileOf = new Map(sources.graph.nodes.map((node) => [node.id, node.file]));
  for (const edge of sources.graph.edges) {
    const from = fileOf.get(edge.from);
    const to = fileOf.get(edge.to);
    if (!from || !to || from === to) continue;
    counts.set(to, (counts.get(to) ?? 0) + 1);
  }
  return counts;
}

/**
 * Mimari özet. Grup derinliği sabittir: üç yol bölümü hem monorepo
 * (`packages` altında paket başına bir grup) hem tek paket düzenlerinde
 * (`src` altında modül başına bir grup) ayırt edici satırlar üretir.
 */
export function buildArchitectureDigest(sources: GraphSources, limit = GRAPH_MAX_GROUPS): ArchitectureDigest {
  const files = sources.knowledge?.fileIndex(20_000) ?? [];
  const warnings: string[] = [];
  if (files.length === 0) {
    warnings.push('Bilgi tabanı indeksi boş: `index_workspace` çalıştırıldığında mimari özet dolar.');
  }
  if (!sources.graph) {
    warnings.push('Çağrı haritası yok: özet yalnızca import bağıntılarını içerir.');
  }

  const importEdges = resolveImportEdges(files);
  const incomingCalls = incomingCallsByFile(sources);

  const groups = new Map<string, ArchitectureGroup>();
  const groupEdges = new Map<string, Map<string, number>>();
  const incomingByFile = new Map<string, number>();
  for (const [, targets] of importEdges) {
    for (const target of targets) incomingByFile.set(target, (incomingByFile.get(target) ?? 0) + 1);
  }

  for (const file of files) {
    const group = groupOf(file.path);
    const entry = groups.get(group) ?? { path: group, files: 0, exports: 0, outgoing: 0, incoming: 0 };
    entry.files += 1;
    entry.outgoing += importEdges.get(file.path)?.size ?? 0;
    entry.incoming += incomingByFile.get(file.path) ?? 0;
    groups.set(group, entry);
  }
  for (const file of files) {
    const targets = importEdges.get(file.path);
    if (!targets) continue;
    const from = groupOf(file.path);
    const bucket = groupEdges.get(from) ?? new Map<string, number>();
    for (const target of targets) {
      const to = groupOf(target);
      if (to === from) continue;
      bucket.set(to, (bucket.get(to) ?? 0) + 1);
    }
    groupEdges.set(from, bucket);
  }

  const exportsByGroup = new Map<string, number>();
  for (const file of files) {
    const group = groupOf(file.path);
    exportsByGroup.set(group, (exportsByGroup.get(group) ?? 0) + (file.exports?.length ?? 0));
  }
  for (const [group, entry] of groups) entry.exports = exportsByGroup.get(group) ?? 0;

  const edges: ArchitectureEdge[] = [];
  for (const [from, bucket] of groupEdges) {
    for (const [to, count] of bucket) edges.push({ from, to, count });
  }
  edges.sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const groupNodes = [...groups.values()].map((entry) => ({
    id: entry.path,
    dependsOn: [...(groupEdges.get(entry.path)?.keys() ?? [])]
  }));
  const cycles: string[][] = [];
  const cycle = detectDependencyCycle(groupNodes);
  if (cycle) cycles.push(cycle);

  // HUB = mimarinin çok kullanılan dosyaları. Ham çağrı sayısı yanıltıcıdır
  // (bir test dosyası yüzlerce çağrı üretir); bu yüzden birincil ölçü import
  // bağımlısıdır, çağrı sayısı yalnızca eşitliği bozar. Test dosyaları tüketici,
  // mimari merkez olmadığı için liste dışıdır.
  const hubs = files
    .filter((file) => !isTestFile(file.path))
    .map((file) => ({
      path: file.path,
      incoming: incomingByFile.get(file.path) ?? 0,
      outgoing: importEdges.get(file.path)?.size ?? 0,
      callers: incomingCalls.get(file.path) ?? 0
    }))
    .filter((hub) => hub.incoming > 0 || hub.callers > 0)
    .sort((a, b) => b.incoming - a.incoming || b.callers - a.callers || a.path.localeCompare(b.path))
    .slice(0, 12);

  return {
    groups: [...groups.values()]
      .sort((a, b) => b.files - a.files || a.path.localeCompare(b.path))
      .slice(0, limit),
    hubs,
    edges: edges.slice(0, limit),
    cycles,
    decisions: sources.knowledge?.knowledgeBullets(limit) ?? [],
    indexedFiles: files.length,
    graphFiles: sources.graph ? Object.keys(sources.graph.files).length : 0,
    warnings
  };
}
