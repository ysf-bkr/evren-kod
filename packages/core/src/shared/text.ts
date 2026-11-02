/**
 * Ajan döngüsü ve terminal çalıştırıcısının paylaştığı küçük metin yardımcıları.
 * `vscode` bağımsız tutulur; eklenti ana bilgisayarı olmadan test edilebilir.
 */

/** Modelin temiz metin okuması için ANSI kaçış dizilerini siler. */
export function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '');
}

/**
 * Metni `maxChars` sınırında keser ve sonuna, kuyruğun sessizce kaybolmadığını
 * modele bildiren bir işaret ekler.
 */
export function limitWithMarker(
  value: string,
  maxChars: number,
  marker = '[... output truncated; narrow the command or redirect output to a file and read the exact range ...]'
): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n${marker}`;
}

/** Slug ve kararlı kimlikler için Türkçe harfleri ASCII karşılıklarına çevirir. */
const TURKISH_ASCII: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  Ç: 'c',
  Ğ: 'g',
  İ: 'i',
  Ö: 'o',
  Ş: 's',
  Ü: 'u'
};

/**
 * Kararlı kimlikler için ASCII `kebab-case` slug üretir; sonuç boşsa
 * `fallback` döner.
 */
export function slugify(value: string, fallback: string, maxLength = 40): string {
  const ascii = String(value || '')
    .split('')
    .map((char) => TURKISH_ASCII[char] ?? char)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
  return ascii || fallback;
}

/** Bilinmeyen bir değerden boş olmayan, kırpılmış dize listesi çıkarır. */
export function cleanStringList(value: unknown, max = 60): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}
