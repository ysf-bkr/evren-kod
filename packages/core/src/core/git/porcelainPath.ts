/**
 * Git porcelain çıktısındaki tırnaklı yolu çözer.
 *
 * `git status --short` (ve `-z` olmayan diğer porcelain biçimleri) ASCII
 * dışı dosya adlarını `"\\303\\247al..."` gibi octal kaçışlarla tırnaklar.
 * Bu çözülmezse arayüzde ve denetim defterinde var olmayan bir yol oluşur;
 * Türkçe adlı dosyalar görünmez hâle gelir. `-z` biçiminde tırnak yoktur,
 * bu fonksiyon tırnaksız metni olduğu gibi döndürür.
 */
export function unquoteGitPath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const inner = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let index = 0; index < inner.length; index++) {
    const char = inner[index] ?? '';
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'));
      continue;
    }
    const next = inner[index + 1];
    if (next === undefined) break;
    // Octal kaçış her zaman üç rakamdır (\303 gibi); diğerleri tek karakter.
    if (/^[0-7]{3}$/.test(inner.slice(index + 1, index + 4))) {
      bytes.push(Number.parseInt(inner.slice(index + 1, index + 4), 8));
      index += 3;
      continue;
    }
    const escapes: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92 };
    bytes.push(escapes[next] ?? next.charCodeAt(0));
    index += 1;
  }
  return Buffer.from(bytes).toString('utf8');
}
