/**
 * Bilgi tabanının saf çıkarım fonksiyonları.
 *
 * Dosya sistemi ve `vscode` bağımlılığı yoktur; doğrudan test edilebilir.
 * `KnowledgeStore` bu fonksiyonları kullanır ve geriye dönük uyumluluk için
 * yeniden dışa aktarır.
 */
import * as path from 'path';
import { createHash } from 'crypto';
import { KnowledgeSymbolRecord } from './types';
import { SENSITIVE_PATTERNS, SOURCE_EXTENSIONS } from './paths';

export function isSensitivePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function sha256Content(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

export function toRelativePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).replace(/\\/g, '/');
}

function symbolKindFor(line: string): string {
  if (/\b(class|module|defmodule|namespace)\b/.test(line)) return 'class';
  if (/\b(interface|protocol|trait)\b/.test(line)) return 'interface';
  if (/\benum\b/.test(line)) return 'enum';
  if (/\b(type|struct|record|union)\b/.test(line)) return 'type';
  if (/\b(function|def|defp|fn|func|fun|proc|procedure)\b/.test(line)) {
    if (/^[ \t]{2,}/.test(line)) return 'method';
    return 'function';
  }
  if (/\b(const|let|var|val)\b/.test(line)) return 'variable';
  return 'function';
}

const SYMBOL_PATTERNS: RegExp[] = [
  // 1. Anahtar kelimeli bildirimler: TS/JS/PHP/Rust/Java/C#/Kotlin/Swift/C++/Go
  // class, interface, enum, struct, trait, record, type, protocol, extension, union, namespace, module, defmodule
  /^\s*(?:(?:export|default|pub(?:\([^)]*\))?|public|private|protected|internal|static|final|abstract|override|virtual|sealed|readonly|async|inline|mutating|open|data)\s+)*(?:class|interface|enum|type|struct|trait|record|protocol|extension|union|namespace|module|defmodule)\s+([A-Za-z_$][\w$]*)/,

  // 2. Python def ve async def (örn. def foo(...) veya async def foo(...))
  /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/,

  // 3. Go func (örn. func Foo(...) veya func (s *Server) Start(...))
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,

  // 4. Rust fn (örn. fn foo(), pub fn foo(), pub(crate) async fn foo(), const fn foo())
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:unsafe\s+)?(?:extern(?:\s+"[^"]+")?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,

  // 5. Kotlin/Swift fun/func (örn. fun foo(), suspend fun foo(), private func foo())
  /^\s*(?:(?:public|private|protected|internal|suspend|override|open|inline|mutating|final|static)\s+)*(?:fun|func)\s+([A-Za-z_]\w*)/,

  // 6. Ruby metotları (örn. def foo veya def self.foo)
  /^\s*def\s+(?:self\.)?([A-Za-z_]\w*)/,

  // 7. PHP / JS / TS / Lua function (örn. function foo(), public function foo(), local function foo())
  /^\s*(?:(?:export|default|public|private|protected|internal|static|final|abstract|async|local)\s+)*function\s+(?:[A-Za-z_$][\w$]*[:.])?([A-Za-z_$][\w$]*)/,

  // 8. JS/TS/Go/Rust değişken ve sabit bildirimleri (örn. const MAX = 10, export let foo = () =>)
  /^\s*(?:export\s+)?(?:const|let|var|val)\s+([A-Za-z_$][\w$]*)\s*(?::|=)/,

  // 9. Java/C#/C++/C/Dart tip bildirimli fonksiyon ve metotlar
  // Örn: public static void main(), public Task<Result> ExecuteAsync(), int calculate(int x), void init()
  /^\s*(?:(?:public|private|protected|internal|static|final|abstract|override|virtual|sealed|async|inline|extern)\s+)*(?:[A-Za-z_][\w<>[\]*&?,]*\s+)+([A-Za-z_]\w*)\s*\([^;{()]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:throws\s+[^{;]+)?(?:where\s+[^{;]+)?\{.*$/,

  // 10. Shell script fonksiyonları (örn. function foo { veya foo() {)
  /^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\s*\)\s*\{.*$/,

  // 11. SQL fonksiyon, yordam ve tabloları (örn. CREATE PROCEDURE foo, CREATE FUNCTION bar)
  /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:PROCEDURE|FUNCTION|TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_]\w*)/i,

  // 12. Elixir def/defp
  /^\s*(?:def|defp)\s+([A-Za-z_]\w*)/
];

/** Gövde anahtar kelimeleri: metot deseni bunları asla sembol saymaz. */
const CONTROL_WORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'typeof',
  'await',
  'yield',
  'new',
  'else',
  'do',
  'try',
  'finally',
  'case',
  'delete',
  'void',
  'super',
  'import',
  'export',
  'from',
  'with',
  'as',
  'break',
  'continue',
  'default',
  'throw',
  'package',
  'using',
  'namespace'
]);

/**
 * Sınıf metotları: girintili ve görünen bir gövde bloğu açan bildirimler.
 * Çağrı satırları noktalı virgülle bittiği için desen onları yakalamaz; bitiş
 * süslü parantezi bu yüzden zorunludur. Desen öncesi sınıf üyeleri indekste hiç
 * görünmüyor, ajan bir metot için `find_symbol`'dan aralık alamıyordu.
 */
const METHOD_PATTERN =
  /^[ \t]+(?:(?:public|private|protected|internal|static|async|readonly|abstract|override|virtual|final|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*(?::\s*[^{;]+)?\{[ \t]*$/;

const IMPORT_PATTERNS: RegExp[] = [
  /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /export\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require_relative\s*['"]([^'"]+)['"]/g,
  /from\s+([A-Za-z0-9_.]+)\s+import/g,
  /^\s*import\s+([A-Za-z0-9_.]+)/gm,
  /^\s*import\s+["']([^"']+)["']/gm,
  /^\s*use\s+([A-Za-z0-9_:\\]+)/gm,
  /^\s*using\s+([A-Za-z0-9_.]+)/gm,
  /^\s*#include\s+[<"]([^>"]+)[>"]/gm,
  /^\s*mod\s+([A-Za-z0-9_]+);/gm
];

/** İmza olarak saklanacak en uzun bildirim satırı. */
export const MAX_SIGNATURE_CHARS = 200;

/**
 * Bir bildirimin imzası: boşluklar tek boşluğa iner, atama ve gövde açılışı
 * kesilir, tür bildirimleri korunur. Ajan bu tek satırdan adı ve imzayı görür;
 * çağrı yerini düzeltmek için gövdeyi okuması gerekmez.
 */
export function extractSignature(line: string): string {
  const compact = line.trim().replace(/\s+/g, ' ');
  // Atama işaretini ok işaretiyle (=>) karıştırma: ok, atamanın parçasıdır.
  const assignment = compact.search(/(?<!=)=(?!=)/);
  const head = assignment > 0 ? compact.slice(0, assignment) : compact;
  const closed = head.replace(/[,{\s]+$/, '');
  return closed.length > MAX_SIGNATURE_CHARS ? `${closed.slice(0, MAX_SIGNATURE_CHARS - 1)}…` : closed;
}

export function extractSymbols(relativePath: string, content: string): KnowledgeSymbolRecord[] {
  const symbols: KnowledgeSymbolRecord[] = [];
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    for (const pattern of SYMBOL_PATTERNS) {
      const match = line.match(pattern);
      if (match?.[1]) {
        const name = match[1];
        if (CONTROL_WORDS.has(name)) continue;
        symbols.push({
          name,
          kind: symbolKindFor(line),
          file: relativePath,
          line: index + 1,
          signature: extractSignature(line)
        });
        return;
      }
    }
    // Sınıf metotları: girintili, bloğu açan bildirim. Desen çağrı satırlarını
    // (noktalı virgülle biter) ve zincirli çağrıları (nokta içerir) dışarıda
    // bırakır; kontrol anahtarları ayrıca elenir.
    if (/^[ \t]/.test(line)) {
      const method = line.match(METHOD_PATTERN);
      const name = method?.[1];
      if (name && !CONTROL_WORDS.has(name)) {
        symbols.push({
          name,
          kind: name === 'constructor' ? 'constructor' : 'method',
          file: relativePath,
          line: index + 1,
          signature: extractSignature(line)
        });
      }
    }
  });
  // Bitiş satırları, modelin dosyanın tamamı yerine read_file offset/limit
  // ile tek bir sembolü okumasını sağlar. Bir sembol sonraki sembolün
  // başladığı satıra (veya EOF) kadar uzanır; bu bir yaklaşımdır, LSP
  // zenginleştirmesi daha sonra kesin aralıklarla değiştirir.
  symbols.forEach((symbol, index) => {
    const next = symbols[index + 1];
    symbol.endLine = next ? Math.max(symbol.line, next.line - 1) : lines.length;
  });
  return symbols;
}

export function extractImports(content: string): string[] {
  const imports = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    // Bazı desenler global olduğu ve yeniden kullanıldığı için lastIndex sıfırlanır.
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1]) imports.add(match[1]);
    }
  }
  return [...imports];
}

/**
 * Göreli belirticiyi çalışma alanına göreli yola çözümler; böylece import
 * grafiğinde gezinilebilir. Çıplak paket belirticileri olduğu gibi döner.
 */
export function normalizeImport(fromFile: string, specifier: string): string {
  if (!specifier.startsWith('.')) {
    // Noktalı Python import'ları (örn. app.services.auth) yol benzerine dönüşür.
    if (!specifier.includes('/') && specifier.includes('.')) {
      return specifier.replace(/\./g, '/');
    }
    return specifier;
  }

  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  const extensions = [...SOURCE_EXTENSIONS];
  for (const extension of extensions) {
    if (resolved.endsWith(extension)) return resolved;
  }
  // "src/b", "src/b.ts"yi kastediyor olabilir; çıplak yolu koru, sonekle eşleştir.
  return resolved;
}

/**
 * Bir import belirticisinin hedef dosyayı adresleyip adreslemediği. Import'lar
 * soneksiz çözümlendiği için eşleştirme toleranslıdır; bilgi tabanındaki tüm
 * dosya-dosya bağıntıları bu tek kuralı kullanır.
 */
export function importMatches(imported: string, target: string): boolean {
  const extensions = [...SOURCE_EXTENSIONS].join('|');
  const targetNoExt = target.replace(new RegExp(`(?:${extensions})$`), '');
  return (
    imported === target ||
    imported === targetNoExt ||
    target.startsWith(`${imported}/`) ||
    targetNoExt.endsWith(`/${imported}`)
  );
}

/** Bir markdown satırının madde çizgisi içeriği; değilse undefined. */
function bulletText(line: string): string | undefined {
  const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
  const text = match?.[1]?.trim();
  return text && text.length > 0 ? text : undefined;
}

export interface KnowledgeNoteMatch {
  /** Kaynak dosyanın kök adı (ör. `decisions.md`). */
  source: string;
  /** Eşleşen madde satırı. */
  text: string;
  /** Anahtar sözcüklerden kaçının geçtiği. */
  hits: number;
}

/**
 * İnsan bakımındaki bilgi dosyalarında (kararlar, notlar, kurallar) anahtar
 * sözcüklerle eşleşen maddeler. Ajan bir sembolü düzenlerken ilgili mimari
 * kararı kendisi aramak zorunda kalmasın diye grafik çıktısına iliştirilir.
 */
export function matchKnowledgeNotes(
  sources: Array<{ name: string; content: string }>,
  terms: string[],
  limit = 6
): KnowledgeNoteMatch[] {
  const needles = [
    ...new Set(terms.map((term) => term.trim().toLowerCase()).filter((term) => term.length >= 3))
  ];
  if (needles.length === 0) return [];

  const matches: KnowledgeNoteMatch[] = [];
  for (const source of sources) {
    const content = (source.content || '').trim();
    if (!content) continue;
    for (const line of content.split('\n')) {
      const text = bulletText(line) || line.match(/^#{2,4}\s+(.*)$/)?.[1]?.trim();
      if (!text) continue;
      const lower = text.toLowerCase();
      const hits = needles.filter((needle) => lower.includes(needle)).length;
      if (hits > 0) matches.push({ source: source.name, text: text.slice(0, 300), hits });
    }
  }
  return matches.sort((a, b) => b.hits - a.hits || a.source.localeCompare(b.source)).slice(0, limit);
}

/** Yalnızca adlandırılmış export'lar; modülü gövdesini göndermeden tanımlamak için. */
export function extractExports(content: string): string[] {
  const exports = new Set<string>();
  const declarationPattern =
    /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|enum|type|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  const listPattern = /export\s*\{([^}]+)\}/g;

  let match: RegExpExecArray | null;
  while ((match = declarationPattern.exec(content)) !== null) {
    if (match[1]) exports.add(match[1]);
  }
  while ((match = listPattern.exec(content)) !== null) {
    const group = match[1];
    if (!group) continue;
    for (const part of group.split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) exports.add(name);
    }
  }
  return [...exports].slice(0, 200);
}

export function parseJsonl<T>(raw: string): T[] {
  const items: T[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed) as T);
    } catch {
      // Bozuk tek bir satır indeksin geri kalanını çöpe atmamalı.
    }
  }
  return items;
}

export function toJsonl(items: unknown[]): string {
  return items.map((item) => JSON.stringify(item)).join('\n') + (items.length > 0 ? '\n' : '');
}

/**
 * Dosya tabanlı proje bilgi tabanı.
 *
 * İki katman:
 * - statik: semboller, import'lar, export'lar ve içerik hash'leri (model maliyeti yok)
 * - model: bir dosya ilk kez derinlemesine kullanıldığında tembel üretilen özetler
 *
 * Güncellik içerik hash'leri ve `git diff` üzerinden belirlenir; böylece oturum
 * tüm projeyi yeniden taramak yerine yalnızca değişenleri tazeler.
 */
