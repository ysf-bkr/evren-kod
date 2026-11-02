/**
 * Bilgi grafının bağıntı katmanı.
 *
 * Çağrı haritası (kim kimi çağırıyor) ile bilgi tabanını (import'lar, sembol
 * imzaları, kararlar) tek bir odak kartında birleştirir. Saf fonksiyonlardır:
 * disk okumaz, model çağırmaz; iki kaynak da opsiyoneldir ve eksik olan
 * uyarıya dönüşür.
 *
 * Kartın varoluş amacı: ajan bir sembolü veya dosyayı düzenlerken dosyanın
 * tamamını okumak zorunda kalmasın — imza, satır aralığı, kullananlar ve
 * ilgili mimari kararı tek çağrıda görür.
 */
import {
  analyzeCallGraphImpact,
  findCallees,
  findCallers,
  resolveNodes,
  suggestNodes
} from '../callgraph/query';
import type { CallGraphNode } from '../callgraph/types';
import type { KnowledgeNoteMatch } from '../knowledge/extraction';
import {
  GRAPH_MAX_FILES,
  GRAPH_MAX_LISTED,
  GRAPH_MAX_NOTES,
  GRAPH_MAX_SUGGESTIONS
} from '../../shared/constants';
import type { GraphFileFacts, GraphSources, GraphSymbolFact, KnowledgeGraphCard } from './types';

/** Yol benzeri bir odak mı: ayraç içeriyor ya da uzantıyla bitiyor. */
const PATH_LIKE = /(^|\/)[\w.-]+\.[A-Za-z]\w*$|\//;

/** Bir odak kartı isteğinin ayarları. */
export interface GraphQueryOptions {
  /** Kaç seviye yukarı/aşağı gezileceği; varsayılan 1. */
  depth?: number;
  /** Liste başına satır sınırı. */
  limit?: number;
}

/** Kart ya da ajana gösterilecek tek cümlelik neden. */
export type GraphCardResult = KnowledgeGraphCard | { message: string };

/** Bilgi tabanının bir sembol için verdiği imzalı kayıt. */
interface KnowledgeSymbolLike {
  name: string;
  kind: string;
  file: string;
  line: number;
  endLine?: number;
  signature?: string;
}

/** `dosya#ad` anahtarı: iki kaynağın sembollerini birleştirmek için. */
function symbolKey(file: string, name: string): string {
  return `${file}#${name}`;
}

/** Yolun son iki bölümü; uzun yollarda bile okunabilir kalır. */
function fileBasename(relativePath: string): string {
  const parts = relativePath.split('/');
  return parts[parts.length - 1] || relativePath;
}

/** Özetin ilk cümlesi: tam özet yerine kart satırına sığan kadarı. */
function firstSentence(summary: string | undefined): string | undefined {
  const head = summary?.split(/[.\n]/)[0]?.trim();
  return head || undefined;
}

/** Bir harita düğümünü, bilgi tabanındaki imzasıyla birlikte karta çevirir. */
function factFromNode(
  node: CallGraphNode,
  knowledge: Map<string, KnowledgeSymbolLike>,
  extra?: Partial<GraphSymbolFact>
): GraphSymbolFact {
  const known = knowledge.get(symbolKey(node.file, node.name));
  return {
    name: node.name,
    kind: node.className ? `${node.kind}:${node.className}` : node.kind,
    file: node.file,
    line: node.startLine,
    endLine: node.endLine,
    signature: known?.signature,
    exported: node.exported,
    isTest: node.isTest,
    ...extra
  };
}

/** Bilgi tabanı sembolünü karta çevirir (haritanın görmediği tanımlar için). */
function factFromKnowledge(symbol: KnowledgeSymbolLike, extra?: Partial<GraphSymbolFact>): GraphSymbolFact {
  return {
    name: symbol.name,
    kind: symbol.kind,
    file: symbol.file,
    line: symbol.line,
    endLine: symbol.endLine,
    signature: symbol.signature,
    ...extra
  };
}

/** Odak dosyalarının dosya düzeyi bağları: kim import ediyor, ne import ediyor. */
function fileFactsFor(sources: GraphSources, paths: string[], limit: number): GraphFileFacts[] {
  const unique = [...new Set(paths)].slice(0, GRAPH_MAX_FILES);
  return unique.map((path) => {
    const record = sources.knowledge?.getFile(path);
    const meta = sources.graph?.files[path];
    return {
      path,
      importers: sources.knowledge?.dependentsOf(path, limit) ?? [],
      imports: sources.knowledge?.importsOf(path, limit) ?? [],
      summary: firstSentence(record?.summary),
      exported: record?.exports.slice(0, 8),
      isTest: /\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|Test\.(java|kt|cs)$/.test(path),
      reason: meta && meta.status !== 'complete' ? meta.reason : undefined
    };
  });
}

/** Kaynakların tazelik ve kapsam sınırları; ajan neyin görünmediğini bilmeli. */
function collectWarnings(sources: GraphSources): string[] {
  const warnings: string[] = [];
  if (!sources.graph) {
    warnings.push(
      'Çağrı haritası yok: çağıran/çağrılan ilişkileri görünmez, yalnızca import bağıntıları vardır.'
    );
  } else if (sources.graph.meta.incompleteFiles > 0) {
    warnings.push(
      `${sources.graph.meta.incompleteFiles} dosya eksik tarandı; etki alanı olduğundan dar görünebilir.`
    );
  }
  if (!sources.knowledge) {
    warnings.push("Bilgi tabanı indeksi yok: imzalar, dosya import'ları ve kararlar görünmez.");
  }
  const indexedAt = sources.knowledge?.knowledgeStats().indexedAt;
  if (sources.graph && typeof indexedAt === 'number' && indexedAt > sources.graph.meta.updatedAt) {
    warnings.push('Bilgi tabanı haritadan daha yeni: son düzenlemeler haritada henüz görünmeyebilir.');
  }
  return warnings;
}

/** Karta iliştirilecek karar/kural maddeleri için anahtar sözcükler. */
function noteTerms(focus: string, definitions: GraphSymbolFact[], files: GraphFileFacts[]): string[] {
  const terms = new Set<string>();
  for (const token of focus.split(/[^A-Za-z0-9]+/)) {
    if (token.length >= 4) terms.add(token.toLowerCase());
  }
  for (const symbol of definitions.slice(0, 6)) terms.add(symbol.name.toLowerCase());
  for (const file of files.slice(0, 4)) terms.add(fileBasename(file.path).toLowerCase());
  return [...terms];
}

/**
 * Küçük yazım farklarını tolere eden aday eşiği: alt dize eşleşmesi ya da
 * (uzun sorgularda) karakterlerin sırayla geçmesi. Ajan sembolü tam hatırla-
 * madığında boş yanıt yerine "bunu mu demek istedin" görebilsin diye var.
 */
function isNearMatch(name: string, needle: string): boolean {
  const lower = name.toLowerCase();
  if (lower.includes(needle)) return true;
  if (needle.length < 5) return false;
  let index = 0;
  for (const character of lower) {
    if (character === needle[index]) index++;
    if (index >= needle.length) return true;
  }
  return false;
}

/** Odak bulunamadığında ajana gösterilecek adaylar. */
function suggestionMessage(sources: GraphSources, focus: string): { message: string } {
  const lines: string[] = [`Bilgi grafında "${focus}" bulunamadı.`];
  const lowerFocus = focus.trim().toLowerCase();
  const graphMatches = sources.graph ? suggestNodes(sources.graph, focus, GRAPH_MAX_SUGGESTIONS) : [];
  const nearNodes =
    graphMatches.length === 0 && sources.graph
      ? sources.graph.nodes
          .filter((node) => isNearMatch(node.name, lowerFocus))
          .slice(0, GRAPH_MAX_SUGGESTIONS)
      : [];
  const shownNodes = graphMatches.length > 0 ? graphMatches : nearNodes;
  if (shownNodes.length > 0) {
    lines.push('Benzer semboller:');
    lines.push(...shownNodes.map((node) => `- ${node.file}:${node.startLine} ${node.name} [${node.kind}]`));
  }
  const knowledgeMatches = sources.knowledge?.findSymbols(focus, GRAPH_MAX_SUGGESTIONS) ?? [];
  if (knowledgeMatches.length > 0) {
    lines.push('Bilgi tabanındaki adaylar:');
    lines.push(...knowledgeMatches.map((symbol) => `- ${symbol.file}:${symbol.line} ${symbol.name}`));
  }
  const needle = focus.split('/').pop() || focus;
  const knownFiles = sources.knowledge?.findFiles(needle, 5) ?? [];
  if (knownFiles.length > 0) {
    lines.push('Benzer dosyalar:');
    lines.push(...knownFiles.map((path) => `- ${path}`));
  }
  if (lines.length === 1) {
    lines.push(
      'Sorguyu kısaltın ya da `graph_search` ile anahtar sözcük arayın; harita henüz hazırlanıyor olabilir (`graph_status`).'
    );
  }
  return { message: lines.join('\n') };
}

/** Yol olarak çözülebiliyorsa göreli dosya ya da dizin döndürür. */
function resolveFileFocus(sources: GraphSources, focus: string): { file?: string; directory?: string } {
  const value = focus.trim().replace(/^\.\//, '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!value) return {};

  if (sources.knowledge?.getFile(value) || sources.graph?.files[value]) return { file: value };

  // Soneksiz yazılmış TS dosyaları (`src/core/agent/agentLoop` gibi).
  const candidates = sources.knowledge?.findFiles(value, 40) ?? [];
  const implicit = candidates.find(
    (path) => path === `${value}.ts` || path === `${value}.tsx` || path === `${value}.js`
  );
  if (implicit) return { file: implicit };

  if ((sources.knowledge?.filesUnder(value, 1) ?? []).length > 0) return { directory: value };
  return {};
}

/** Odak sembolünün çözülmüş hâli: tanımlar, imzalar ve harita kimlikleri. */
interface ResolvedSymbolFocus {
  definitions: GraphSymbolFact[];
  knowledgeIndex: Map<string, KnowledgeSymbolLike>;
  /** Çağrı haritasındaki düğüm kimlikleri; boşsa harita sembolü görmüyor. */
  ids: string[];
}

type ResolveResult = ResolvedSymbolFocus | { message: string };

/**
 * Sembol odasını çözer: çağrı haritasındaki kesin aralıklar ile bilgi
 * tabanındaki imzaları birleştirir. Çözümlenemezse adayları listeleyen mesaj
 * döner; araçların ortak davranışı budur.
 */
function resolveSymbolFocus(sources: GraphSources, focus: string): ResolveResult {
  const value = focus.trim();
  if (!value) return { message: 'Sembol adı gerekli.' };
  if (!sources.graph && !sources.knowledge) {
    return {
      message:
        'Bilgi grafı henüz hazır değil. `index_workspace` ile bilgi tabanını kurun; çağrı haritası arka planda kendiliğinden oluşur.'
    };
  }

  const knowledgeSymbols = sources.knowledge?.findSymbols(value, 40) ?? [];
  const knowledgeIndex = new Map<string, KnowledgeSymbolLike>();
  for (const symbol of knowledgeSymbols) knowledgeIndex.set(symbolKey(symbol.file, symbol.name), symbol);

  const graphNodes = resolveNodes(sources.graph ?? { nodes: [] }, value);
  const definitions: GraphSymbolFact[] = graphNodes.map((node) => factFromNode(node, knowledgeIndex));
  for (const symbol of knowledgeSymbols.filter((item) => item.name.toLowerCase() === value.toLowerCase())) {
    if (!definitions.some((fact) => fact.file === symbol.file && fact.name === symbol.name)) {
      definitions.push(factFromKnowledge(symbol));
    }
  }

  if (definitions.length === 0) return suggestionMessage(sources, value);
  return { definitions, knowledgeIndex, ids: graphNodes.map((node) => node.id) };
}

/** Komşu listesini karta çevirir (çağıran ya da çağrılan yönü). */
function neighborFacts(
  sources: GraphSources,
  ids: string[],
  direction: 'callers' | 'callees',
  knowledgeIndex: Map<string, KnowledgeSymbolLike>,
  depth: number,
  limit: number
): GraphSymbolFact[] {
  if (!sources.graph || ids.length === 0) return [];
  const neighbors =
    direction === 'callers' ? findCallers(sources.graph, ids, depth) : findCallees(sources.graph, ids, depth);
  return neighbors.slice(0, limit).map((neighbor) =>
    factFromNode(neighbor.node, knowledgeIndex, {
      depth: neighbor.depth,
      lines: neighbor.lines,
      confidence: neighbor.confidence
    })
  );
}

/** Sembol odaklı kart: tanımlar, iki yönlü çağrılar, dosya bağları, kararlar. */
function symbolCard(
  sources: GraphSources,
  focus: string,
  resolved: ResolvedSymbolFocus,
  options: GraphQueryOptions
): KnowledgeGraphCard {
  const limit = options.limit ?? GRAPH_MAX_LISTED;
  const depth = options.depth ?? 1;
  const callerFacts = neighborFacts(sources, resolved.ids, 'callers', resolved.knowledgeIndex, depth, limit);
  const calleeFacts = neighborFacts(sources, resolved.ids, 'callees', resolved.knowledgeIndex, depth, limit);

  const files = fileFactsFor(
    sources,
    resolved.definitions.map((fact) => fact.file),
    limit
  );
  const notes =
    sources.knowledge?.knowledgeNotes(noteTerms(focus, resolved.definitions, files), GRAPH_MAX_NOTES) ?? [];

  return {
    focus,
    kind: 'symbol',
    definitions: resolved.definitions,
    callers: callerFacts,
    callees: calleeFacts,
    tests: callerFacts.filter((fact) => fact.isTest),
    files,
    notes,
    warnings: collectWarnings(sources)
  };
}

/** Dosya odaklı kart: dosyanın tüm sembolleri imzalarıyla, iki yönlü bağlar. */
function fileCard(sources: GraphSources, path: string, options: GraphQueryOptions): KnowledgeGraphCard {
  const limit = options.limit ?? GRAPH_MAX_LISTED;
  const knowledgeSymbols = sources.knowledge?.symbolsOf(path, limit * 4) ?? [];
  const graphNodes = (sources.graph?.nodes ?? []).filter((node) => node.file === path);
  const knowledgeIndex = new Map(
    knowledgeSymbols.map((symbol) => [symbolKey(path, symbol.name), symbol as KnowledgeSymbolLike])
  );

  // Harita kesin aralıkları verir; bilgi tabanı haritanın görmediği
  // bildirimleri (arayüz, sabit) tamamlar. İkisi birleşerek tek listeyi verir.
  const definitions: GraphSymbolFact[] = graphNodes
    .slice(0, limit)
    .map((node) => factFromNode(node, knowledgeIndex));
  for (const symbol of knowledgeSymbols) {
    if (definitions.length >= limit) break;
    if (!definitions.some((fact) => fact.name === symbol.name)) definitions.push(factFromKnowledge(symbol));
  }
  definitions.sort((a, b) => a.line - b.line);

  // Bu dosyadaki sembolleri dışarıdan çağıranlar: dosyayı silmeden/düzenlemeden
  // önce bakılması gereken gerçek etki alanı.
  const ids = graphNodes.map((node) => node.id);
  const callerFacts: GraphSymbolFact[] = [];
  const tests: GraphSymbolFact[] = [];
  if (sources.graph && ids.length > 0) {
    for (const neighbor of findCallers(sources.graph, ids, options.depth ?? 1)) {
      const fact = factFromNode(neighbor.node, knowledgeIndex, {
        depth: neighbor.depth,
        lines: neighbor.lines,
        confidence: neighbor.confidence
      });
      if (fact.file === path) continue;
      if (fact.isTest) tests.push(fact);
      else if (callerFacts.length < limit) callerFacts.push(fact);
    }
  }

  const files = fileFactsFor(sources, [path], limit);
  const notes = sources.knowledge?.knowledgeNotes(noteTerms(path, definitions, files), GRAPH_MAX_NOTES) ?? [];
  return {
    focus: path,
    kind: 'file',
    definitions,
    callers: callerFacts,
    callees: [],
    tests,
    files,
    notes,
    warnings: collectWarnings(sources)
  };
}

/** Dizin odaklı kart: dosya listesi ve dosya başına tek satır bilgi. */
function directoryCard(sources: GraphSources, directory: string): KnowledgeGraphCard {
  const indexed = sources.knowledge?.filesUnder(directory, GRAPH_MAX_FILES * 6) ?? [];
  const files: GraphFileFacts[] = indexed.slice(0, GRAPH_MAX_FILES * 4).map((file) => ({
    path: file.path,
    importers: sources.knowledge?.dependentsOf(file.path, 5) ?? [],
    imports: sources.knowledge?.importsOf(file.path, 5) ?? [],
    summary: firstSentence(file.summary),
    exported: file.exports.slice(0, 6)
  }));

  const definitions: GraphSymbolFact[] = [];
  for (const file of indexed.slice(0, 4)) {
    definitions.push(
      ...(sources.knowledge?.symbolsOf(file.path, 12) ?? []).map((symbol) => factFromKnowledge(symbol))
    );
  }

  return {
    focus: directory,
    kind: 'directory',
    definitions,
    callers: [],
    callees: [],
    tests: files
      .filter((file) => file.isTest)
      .map((file) => ({
        name: fileBasename(file.path),
        kind: 'file',
        file: file.path,
        line: 1,
        isTest: true
      })),
    files,
    notes: sources.knowledge?.knowledgeNotes(noteTerms(directory, definitions, files), GRAPH_MAX_NOTES) ?? [],
    warnings: collectWarnings(sources)
  };
}

/**
 * Odak sembolün tek yönlü komşularını döndürür. `graph_callers` ve
 * `graph_callees` araçlarının ortak çekirdeğidir.
 */
export function neighborsOfFocus(
  sources: GraphSources,
  focus: string,
  direction: 'callers' | 'callees',
  options: GraphQueryOptions = {}
): GraphSymbolFact[] | { message: string } {
  const resolved = resolveSymbolFocus(sources, focus);
  if ('message' in resolved) return resolved;
  return neighborFacts(
    sources,
    resolved.ids,
    direction,
    resolved.knowledgeIndex,
    options.depth ?? 1,
    options.limit ?? GRAPH_MAX_LISTED
  );
}

/**
 * Odak için birleşik kart üretir. Odak sembol, dosya ya da dizin olabilir;
 * hiçbiri çözülemezse adayları listeleyen bir mesaj döner.
 */
export function buildGraphCard(
  sources: GraphSources,
  focus: string,
  options: GraphQueryOptions = {}
): GraphCardResult {
  const value = focus.trim();
  if (!value) return { message: 'Odak gerekli: sembol adı, dosya yolu ya da dizin.' };

  if (!sources.graph && !sources.knowledge) {
    return {
      message:
        'Bilgi grafı henüz hazır değil. `index_workspace` ile bilgi tabanını kurun; çağrı haritası arka planda kendiliğinden oluşur.'
    };
  }

  const fileFocus = PATH_LIKE.test(value) ? resolveFileFocus(sources, value) : {};
  const fileOnly = /\.[A-Za-z][\w]*$/.test(value) && !value.includes('#');
  if (fileFocus.directory) return directoryCard(sources, fileFocus.directory);
  if (fileFocus.file && fileOnly) return fileCard(sources, fileFocus.file, options);

  const resolved = resolveSymbolFocus(sources, value);
  if ('message' in resolved) {
    if (fileFocus.file) return fileCard(sources, fileFocus.file, options);
    return resolved;
  }
  return symbolCard(sources, value, resolved, options);
}

/** Etki kartının içeriği: çağrı + import + test + karar boyutları birlikte. */
export interface GraphImpact {
  symbols: GraphSymbolFact[];
  directCallers: GraphSymbolFact[];
  indirectCallers: GraphSymbolFact[];
  tests: GraphSymbolFact[];
  /** Çağrı haritasında etkilenen dosyalar. */
  affectedFiles: string[];
  /** Bu dosyaları import edenler (haritanın görmediği kısım). */
  dependents: string[];
  /** Dışa aktarılan sembole haritada geri dönüş yok: paket dışı kullanım olasılığı. */
  exportedUntracked: boolean;
  notes: KnowledgeNoteMatch[];
  warnings: string[];
}

export type ImpactResult = GraphImpact | { message: string };

/**
 * Etki analizi: bir ya da birden çok sembol değişirse nelerin etkilendiğini
 * çağrı haritasından, dosya bağımlılıklarından ve testlerden toplar. Çağrı
 * haritasının göremediği import bağımlıları ayrıca listelenir; böylece ajan
 * "haritada görünmüyor" ile "etkilenmez" arasına kesin bir çizgi çekebilir.
 */
export function analyzeGraphImpact(
  sources: GraphSources,
  foci: string[],
  options: GraphQueryOptions = {}
): ImpactResult {
  const definitions: GraphSymbolFact[] = [];
  const ids: string[] = [];
  const unresolved: string[] = [];
  const knowledgeIndex = new Map<string, KnowledgeSymbolLike>();

  for (const focus of foci) {
    const resolved = resolveSymbolFocus(sources, focus);
    if ('message' in resolved) {
      unresolved.push(focus.trim());
      continue;
    }
    definitions.push(...resolved.definitions);
    ids.push(...resolved.ids);
    for (const [key, symbol] of resolved.knowledgeIndex) {
      if (!knowledgeIndex.has(key)) knowledgeIndex.set(key, symbol);
    }
  }

  if (definitions.length === 0) {
    return { message: `Çağrı grafında çözümlenecek sembol yok: ${unresolved.join(', ') || '(boş liste)'}` };
  }

  const depth = options.depth ?? 2;
  const limit = options.limit ?? GRAPH_MAX_LISTED;
  const warnings = collectWarnings(sources);
  if (unresolved.length > 0) {
    warnings.push(`Çözümlenemeyen girdiler: ${unresolved.join(', ')}`);
  }

  const directCallers: GraphSymbolFact[] = [];
  const indirectCallers: GraphSymbolFact[] = [];
  const tests: GraphSymbolFact[] = [];
  let affectedFiles: string[] = [];
  let exportedUntracked = false;

  if (sources.graph) {
    const impact = analyzeCallGraphImpact(sources.graph, ids, depth);
    for (const neighbor of impact.directCallers.slice(0, limit)) {
      directCallers.push(
        factFromNode(neighbor.node, knowledgeIndex, {
          depth: neighbor.depth,
          lines: neighbor.lines,
          confidence: neighbor.confidence
        })
      );
    }
    for (const neighbor of impact.indirectCallers.slice(0, limit)) {
      indirectCallers.push(
        factFromNode(neighbor.node, knowledgeIndex, {
          depth: neighbor.depth,
          lines: neighbor.lines,
          confidence: neighbor.confidence
        })
      );
    }
    for (const neighbor of impact.affectedTests.slice(0, limit)) {
      tests.push(factFromNode(neighbor.node, knowledgeIndex, { lines: neighbor.lines }));
    }
    affectedFiles = impact.affectedFiles;
    exportedUntracked = impact.exportedChange;
    warnings.push(...impact.warnings.filter((warning) => !warnings.includes(warning)));
  }

  const dependents = new Set<string>();
  for (const file of new Set(definitions.map((fact) => fact.file))) {
    for (const dependent of sources.knowledge?.dependentsOf(file, limit) ?? []) dependents.add(dependent);
  }

  const files = fileFactsFor(sources, [...new Set(definitions.map((fact) => fact.file))], limit);
  const noteTermsList = noteTerms(foci.join(' '), definitions, files);
  for (const caller of directCallers.slice(0, 4)) noteTermsList.push(caller.name.toLowerCase());

  return {
    symbols: definitions,
    directCallers,
    indirectCallers,
    tests,
    affectedFiles,
    dependents: [...dependents].sort((a, b) => a.localeCompare(b)).slice(0, limit),
    exportedUntracked,
    notes: sources.knowledge?.knowledgeNotes(noteTermsList, GRAPH_MAX_NOTES) ?? [],
    warnings
  };
}
