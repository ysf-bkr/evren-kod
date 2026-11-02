/**
 * Bilgi grafının token bütçeli metin biçimi.
 *
 * Araç çıktısı, bağlam penceresinin en büyük tek kalemidir. Bu yüzden her kart
 * sabit bir karakter bütçesiyle üretilir: önce ayrıntı katmanları (çağrılanlar,
 * dosya listeleri) budanır, en son kararlar ve tanımlar kalır. Biçim sıkışık
 * ama kopyalanabilir satırlardan oluşur; ajan yolu ve satır aralığını doğrudan
 * `read_file` çağrısında kullanabilir.
 */
import { GRAPH_DEFAULT_BUDGET_CHARS, GRAPH_MAX_BUDGET_CHARS } from '../../shared/constants';
import type { GraphImpact } from './relations';
import type { ArchitectureDigest, GraphSymbolFact, KnowledgeGraphCard } from './types';

/** Bütçeyi araç argümanından güvenli aralığa çeker. */
export function resolveBudget(budget: unknown): number {
  const value = Number(budget);
  if (!Number.isFinite(value) || value <= 0) return GRAPH_DEFAULT_BUDGET_CHARS;
  return Math.min(Math.max(Math.floor(value), 800), GRAPH_MAX_BUDGET_CHARS);
}

/** İmzayı kart satırına sığacak uzunluğa indirger. */
function shortSignature(signature: string | undefined, max = 120): string {
  if (!signature) return '';
  const single = signature.replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

/** Yolun baş kısmını kısaltır: yalnızca son iki bölüm korunur. */
function tailPath(relativePath: string, keep = 2): string {
  const parts = relativePath.split('/');
  return parts.length <= keep ? relativePath : `…/${parts.slice(-keep).join('/')}`;
}

/** Aynı dosyadaki düğümler tek başlık altında toplanır; yol tekrar etmez. */
function groupByFile(facts: GraphSymbolFact[]): Array<{ file: string; facts: GraphSymbolFact[] }> {
  const groups = new Map<string, GraphSymbolFact[]>();
  for (const fact of facts) {
    const list = groups.get(fact.file);
    if (list) list.push(fact);
    else groups.set(fact.file, [fact]);
  }
  return [...groups.entries()]
    .map(([file, items]) => ({ file, facts: items }))
    .sort((a, b) => b.facts.length - a.facts.length || a.file.localeCompare(b.file));
}

/** Bir bölüm: öncelik düştükçe önce budanır. */
interface Section {
  title: string;
  lines: () => string[];
  /** Kaç satır gösterileceği; budama bunu küçültür. */
  max: number;
  priority: number;
}

function factLine(fact: GraphSymbolFact, withSignature: boolean): string {
  const marker = fact.isTest ? ' [test]' : fact.exported ? ' [export]' : '';
  const estimated = fact.confidence === 'estimated' ? ' [tahmini]' : '';
  const signature = withSignature ? shortSignature(fact.signature) : '';
  const calls = fact.lines && fact.lines.length > 0 ? ` @${fact.lines.slice(0, 3).join(',')}` : '';
  return `  ${fact.line}${marker}${calls} ${fact.name}${signature ? ` — ${signature}` : ''}${estimated}`;
}

/** Kartı okunabilir ama sıkışık metne çevirir. */
export function renderGraphCard(card: KnowledgeGraphCard, budget: number): string {
  const header = [
    `GRAPH ${card.kind.toUpperCase()} · ${card.focus}`,
    ...card.definitions
      .slice(0, 6)
      .map(
        (fact) =>
          `DEF ${fact.file}:${fact.line}${fact.endLine && fact.endLine > fact.line ? `-${fact.endLine}` : ''} [${fact.kind}]` +
          (fact.signature ? ` ${shortSignature(fact.signature)}` : '')
      ),
    ...(card.definitions.length > 6 ? [`  …${card.definitions.length - 6} tanım daha`] : [])
  ];

  const callers = groupByFile(card.callers);
  const callees = groupByFile(card.callees);
  const sections: Section[] = [
    {
      title: `CALLERS (${card.callers.length})`,
      max: 14,
      priority: 1,
      lines: () =>
        callers.flatMap((group) => [
          `  ${group.file} (${group.facts.length})`,
          ...group.facts.slice(0, 4).map((fact) => factLine(fact, true))
        ])
    },
    {
      title: `DECISIONS / NOTES (${card.notes.length})`,
      max: 6,
      priority: 1,
      lines: () => card.notes.map((note) => `  [${note.source}] ${note.text}`)
    },
    {
      title: `TESTS (${card.tests.length})`,
      max: 6,
      priority: 2,
      lines: () =>
        groupByFile(card.tests).flatMap((group) =>
          group.facts
            .slice(0, 3)
            .map(
              (fact) =>
                `  ${group.file}:${fact.line} ${fact.name}${fact.signature ? ` — ${shortSignature(fact.signature)}` : ''}`
            )
        )
    },
    {
      title: `CALLEES (${card.callees.length})`,
      max: 10,
      priority: 3,
      lines: () =>
        callees.flatMap((group) => [
          `  ${group.file} (${group.facts.length})`,
          ...group.facts.slice(0, 3).map((fact) => factLine(fact, false))
        ])
    },
    {
      title: `FILES (${card.files.length})`,
      max: 6,
      priority: 4,
      lines: () =>
        card.files.flatMap((file) => {
          const lines = [
            `  ${file.path}`,
            `    importers (${file.importers.length}): ${file.importers.slice(0, 8).map(tailPath).join(', ') || '—'}`,
            `    imports (${file.imports.length}): ${file.imports.slice(0, 8).map(tailPath).join(', ') || '—'}`
          ];
          if (file.summary) lines.push(`    summary: ${file.summary}`);
          if (file.reason) lines.push(`    scan: ${file.reason}`);
          return lines;
        })
    },
    {
      title: 'WARNINGS',
      max: 6,
      priority: 0,
      lines: () => card.warnings.map((warning) => `  ${warning}`)
    }
  ];

  const readPlan = card.definitions
    .slice(0, 4)
    .map(
      (fact) =>
        `  read_file path=${fact.file} offset=${fact.line} limit=${Math.max(1, (fact.endLine ?? fact.line) - fact.line + 1)} // ${fact.name}`
    );

  // Bütçe aşılırsa ayrıntı katmanları sırayla kısalır; kararlar ve tanımlar en son kalır.
  for (let guard = 0; guard < 8; guard++) {
    const body = sections
      .filter((section) => section.max > 0)
      .map((section) => {
        const lines = section.lines().slice(0, section.max);
        return lines.length > 0 ? `${section.title}\n${lines.join('\n')}` : '';
      })
      .filter(Boolean)
      .join('\n');
    const footer = readPlan.length > 0 ? `READ (yalnızca gövde gerekirse):\n${readPlan.join('\n')}` : '';
    const text = [header.join('\n'), body, footer].filter(Boolean).join('\n');
    if (text.length <= budget) return text;

    const prunable = sections
      .filter((section) => section.priority > 0 && section.max > 1)
      .sort((a, b) => b.priority - a.priority || sectionLength(b) - sectionLength(a))[0];
    if (!prunable) {
      return `${text.slice(0, budget - 1)}\n… [bütçe aşıldı: kapsamı daraltın ya da budget yükseltin]`;
    }
    prunable.max = Math.max(1, Math.floor(prunable.max / 2));
  }
  return '';
}

function sectionLength(section: Section): number {
  return section.lines().length;
}

/** Komşu listesinin sıkışık biçimi: yol başlık, altına satır ve imzalar. */
export function renderNeighbors(
  facts: GraphSymbolFact[],
  title: string,
  budget: number,
  withSignature: boolean
): string {
  if (facts.length === 0) return `${title} (0)`;
  const groups = groupByFile(facts);
  const lines: string[] = [`${title} (${facts.length})`];
  for (const group of groups) {
    lines.push(`  ${group.file} (${group.facts.length})`);
    for (const fact of group.facts.slice(0, 6)) lines.push(factLine(fact, withSignature));
    if (group.facts.length > 6) lines.push(`    …${group.facts.length - 6} daha`);
  }
  const text = lines.join('\n');
  return text.length <= budget ? text : `${text.slice(0, budget - 1)}\n… [bütçe aşıldı: depth küçültün]`;
}
/** Etki kartının metni: çağrı, import, test ve karar bölümleri. */
export function renderGraphImpact(impact: GraphImpact, budget: number): string {
  const sections: string[] = [
    `IMPACT · ${impact.symbols
      .slice(0, 8)
      .map((fact) => `${fact.file}:${fact.line} ${fact.name}`)
      .join(', ')}`
  ];

  const push = (title: string, facts: GraphSymbolFact[]): void => {
    if (facts.length === 0) return;
    const lines = [`${title} (${facts.length})`];
    for (const group of groupByFile(facts)) {
      lines.push(`  ${group.file} (${group.facts.length})`);
      lines.push(...group.facts.slice(0, 5).map((fact) => factLine(fact, true)));
      if (group.facts.length > 5) lines.push(`    …${group.facts.length - 5} daha`);
    }
    sections.push(lines.join('\n'));
  };

  push('DIRECT CALLERS', impact.directCallers);
  push('INDIRECT CALLERS', impact.indirectCallers);
  push('TESTS', impact.tests);
  if (impact.dependents.length > 0) {
    sections.push(
      `IMPORT DEPENDENTS (${impact.dependents.length})\n` +
        impact.dependents.map((path) => `  ${path}`).join('\n')
    );
  }
  if (impact.affectedFiles.length > 0) {
    sections.push(
      `AFFECTED FILES (${impact.affectedFiles.length})\n` +
        impact.affectedFiles
          .slice(0, 20)
          .map((path) => `  ${path}`)
          .join('\n')
    );
  }
  if (impact.notes.length > 0) {
    sections.push(
      `DECISIONS / NOTES\n` + impact.notes.map((note) => `  [${note.source}] ${note.text}`).join('\n')
    );
  }
  if (impact.warnings.length > 0) {
    sections.push('WARNINGS\n' + impact.warnings.map((warning) => `  ${warning}`).join('\n'));
  }
  sections.push(
    'Not: Bu liste grafın gördüğüdür; dinamik çağrılar ve paket dışı kullanımlar görünmez. "Etkilenmez" değil, "grafta etkisi yok" denir.'
  );

  const text = sections.join('\n\n');
  return text.length <= budget ? text : `${text.slice(0, budget - 1)}\n… [bütçe aşıldı: sembolleri daraltın]`;
}

/** Mimari özeti metne çevirir. */
export function renderArchitecture(digest: ArchitectureDigest, budget: number): string {
  const lines: string[] = [
    `ARCHITECTURE · ${digest.indexedFiles} indeksli dosya · ${digest.graphFiles} haritalanmış dosya`,
    'GROUPS (dosya · export · gelen/giden import):'
  ];
  for (const group of digest.groups) {
    lines.push(
      `  ${group.path} · ${group.files} dosya · ${group.exports} export · ↓${group.incoming} ↑${group.outgoing}`
    );
  }
  lines.push('HUBS (en çok kullanılan dosyalar):');
  for (const hub of digest.hubs) {
    lines.push(`  ${hub.path} · ↓${hub.incoming} import · ${hub.callers} çağrı`);
  }
  if (digest.edges.length > 0) {
    lines.push('GROUP DEPENDENCIES:');
    lines.push(...digest.edges.map((edge) => `  ${edge.from} → ${edge.to} (${edge.count})`));
  }
  if (digest.cycles.length > 0) {
    lines.push('CYCLES:');
    lines.push(...digest.cycles.map((cycle) => `  ${cycle.join(' → ')}`));
  }
  if (digest.decisions.length > 0) {
    lines.push(`DECISIONS (${digest.decisions.length}):`);
    lines.push(...digest.decisions.map((note) => `  [${note.source}] ${note.text}`));
  }
  if (digest.warnings.length > 0) {
    lines.push('WARNINGS:');
    lines.push(...digest.warnings.map((warning) => `  ${warning}`));
  }
  const text = lines.join('\n');
  return text.length <= budget
    ? text
    : `${text.slice(0, budget - 1)}\n… [bütçe aşıldı: groups/edges azaltıldı]`;
}
