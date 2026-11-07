/**
 * Sürüm yükseltme yardımcısı.
 *
 * Sürüm tek bir yerde yaşamaz: manifest, iki lockfile, iki workspace paketi,
 * motorun `version.ts` sabiti ve yayın dokümanları aynı değeri taşımak
 * zorunda. Biri unutulursa `check:version` build'i kırar; bu betik hepsini
 * tek komutta atomik olarak günceller ve eski VSIX artefaktlarını temizler.
 *
 * Kullanım:
 *   npm run version:bump 0.1.2
 *   npm run version:bump 0.1.2 --release   # CHANGELOG'daki [Yayınlanmadı] başlığını da sabitler
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const write = (file, content) => writeFileSync(resolve(root, file), content);
const readJson = (file) => JSON.parse(read(file));
const writeJson = (file, value) => write(file, `${JSON.stringify(value, null, 2)}\n`);

/** Dokümanlarda geçen paket/tag sürümlerini güncelleyen dosyalar. */
const DOC_FILES = ['README.md', 'docs/ARCHITECTURE.md', 'docs/DEVELOPMENT.md', 'docs/PUBLISHING.md'];

const args = process.argv.slice(2);
const release = args.includes('--release');
const next = args.find((arg) => !arg.startsWith('--'));

if (!next) {
  process.stderr.write('Usage: npm run version:bump <x.y.z> [--release]\n');
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(next)) {
  process.stderr.write(`Geçersiz sürüm: "${next}". Beklenen biçim: 1.2.3\n`);
  process.exit(1);
}

const pkg = readJson('package.json');
const previous = pkg.version;
if (previous === next) {
  process.stdout.write(`Sürüm zaten ${next}; yalnızca temizlik yapılacak.\n`);
}

const changed = [];

/** Değişiklik varsa yazar ve raporlar. */
const update = (file, transform) => {
  const before = read(file);
  const after = transform(before);
  if (after !== before) {
    write(file, after);
    changed.push(file);
  }
};

// 1. Manifestler ve lockfile'lar (JSON yapısıyla; elle metin değiştirmek
// bağımlılık sürümlerini yanlışlıkla eşleştirebilir).
for (const file of [
  'package.json',
  'packages/core/package.json',
  'packages/cli/package.json',
  'webview-ui/package.json'
]) {
  const json = readJson(file);
  if (json.version !== next) {
    json.version = next;
    writeJson(file, json);
    changed.push(file);
  }
}

for (const file of ['package-lock.json', 'webview-ui/package-lock.json']) {
  const lock = readJson(file);
  lock.version = next;
  if (lock.packages?.['']) lock.packages[''].version = next;
  for (const workspace of ['packages/core', 'packages/cli']) {
    if (lock.packages?.[workspace]) lock.packages[workspace].version = next;
  }
  writeJson(file, lock);
  changed.push(file);
}

// 2. Motorun tek sürüm kaynağı.
update('packages/core/src/shared/version.ts', (content) =>
  content.replace(/(EXTENSION_VERSION\s*=\s*')[^']+(')/, `$1${next}$2`)
);

// 3. Dokümanlardaki paket yolu ve etiket örnekleri.
for (const file of DOC_FILES) {
  if (!existsSync(resolve(root, file))) continue;
  update(file, (content) =>
    content
      .replaceAll(`evren-kod-${previous}.vsix`, `evren-kod-${next}.vsix`)
      .replaceAll(`v${previous}`, `v${next}`)
  );
}

// 4. Yayın başlığı: yalnızca açıkça istenirse.
if (release) {
  const today = new Date().toISOString().slice(0, 10);
  update('CHANGELOG.md', (content) =>
    content.replace(/^## \[Yayınlanmadı\] - .*$/m, `## [${next}] - ${today}`)
  );
}

// 5. Eski paket artefaktları: üretilebilir çıktı, geçmiş sürümler kalmasın.
const removed = [];
for (const dir of ['.', 'out']) {
  const absolute = resolve(root, dir);
  if (!existsSync(absolute)) continue;
  for (const entry of readdirSync(absolute)) {
    if (/^evren-kod-.+\.vsix$/.test(entry) && !entry.includes(`-${next}.vsix`)) {
      rmSync(resolve(absolute, entry), { force: true });
      removed.push(dir === '.' ? entry : `${dir}/${entry}`);
    }
  }
}

process.stdout.write(`Sürüm: ${previous} -> ${next}\n`);
if (changed.length > 0) process.stdout.write(`Güncellenen dosyalar:\n- ${changed.join('\n- ')}\n`);
if (removed.length > 0) process.stdout.write(`Silinen eski paketler:\n- ${removed.join('\n- ')}\n`);
if (changed.length === 0 && removed.length === 0) process.stdout.write('Değişiklik yok.\n');
process.stdout.write('Doğrulama: npm run check:version\n');
