import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const testDir = resolve(root, 'test/unit');
const errors = [];

// Kalıcı yazma yapan API'ler: promise, callback ve sync varyantları.
const WRITE_METHODS = [
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'mkdir',
  'mkdirSync',
  'rm',
  'rmSync',
  'unlink',
  'unlinkSync',
  'cp',
  'cpSync',
  'rename',
  'renameSync',
  'createWriteStream'
].join('|');

// `fs.writeFile(...)`, `fsp.rm(...)` gibi takma adlı import'ları da yakala.
const writePattern = new RegExp(`\\.\\s*(?:${WRITE_METHODS})\\s*\\(`);
// `import { writeFileSync } from 'node:fs'` gibi doğrudan adlandırılmış import'lar.
const bareWritePattern = new RegExp(
  `\\b(?:writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|cpSync|renameSync|createWriteStream|writeFile|appendFile|mkdir|rm|unlink|cp|rename)\\s*\\(`
);
// `open`/`openSync` yalnızca yazma bayrağıyla kalıcı yazma sayılır.
const openWritePattern = /\.\s*open(?:Sync)?\s*\([^)]*['"](?:w|a|wx|ax|w\+|a\+|r\+)['"]/;
/**
 * Geçici dizin izolasyonu iki yoldan sağlanır: doğrudan `os.tmpdir()` ya da
 * onu sarmalayan `createWorkspaceTracker`. İkincisi tercih edilen yoldur;
 * guard yalnızca birebir metne bakarsa doğru kullanan testleri yanlış
 * pozitifle kırar. Sarmalayıcının kendisi aşağıda ayrıca doğrulanır, böylece
 * "yardımcı adı var ama tmpdir kullanmıyor" oyunu da kapalı kalır.
 */
const tempPattern = /tmpdir\(\)/;
/**
 * `createWorkspaceTracker` yalnızca gerçekten içe aktarılıp çağrıldığında
 * izolasyon kanıtıdır. Metinde adının geçmesi (örneğin bir yorum) yetmez;
 * aksi hâlde guard yorumla oynanabilir bir kurala dönüşür.
 */
const trackerImport = /import\s*\{[^}]*\bcreateWorkspaceTracker\b[^}]*\}\s*from\s*['"][^'"]*agentHarness['"]/;
const trackerCall = /createWorkspaceTracker\s*\(/;
const TEMP_TRACKER = resolve(testDir, '..', 'support', 'agentHarness.ts');

/** Alt klasörlerdeki testleri de tara: yeni bir klasör sessizce atlanmasın. */
function collectTestFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectTestFiles(full));
    } else if (entry.endsWith('.test.ts')) {
      found.push(full);
    }
  }
  return found;
}

// Sarmalayıcı kendi sözünü tutuyor mu? Testler `createWorkspaceTracker`
// kullandığında izolasyon garantisi bu dosyaya devredilir; burada
// doğrulanmazsa guard yalnızca bir ada güvenmiş olur.
try {
  const tracker = readFileSync(TEMP_TRACKER, 'utf-8');
  if (!/os\.tmpdir\(\)/.test(tracker) || !/mkdtemp\(/.test(tracker)) {
    errors.push('test/support/agentHarness.ts: createWorkspaceTracker os.tmpdir()/mkdtemp kullanmıyor');
  }
} catch {
  errors.push('test/support/agentHarness.ts: geçici çalışma alanı yardımcısı bulunamadı');
}

for (const file of collectTestFiles(testDir)) {
  const relative = file.slice(testDir.length + 1);
  const content = readFileSync(file, 'utf-8');
  const writes =
    writePattern.test(content) || bareWritePattern.test(content) || openWritePattern.test(content);
  const usesTempTracker = trackerImport.test(content) && trackerCall.test(content);
  if (writes && !tempPattern.test(content) && !usesTempTracker) {
    errors.push(`${relative}: writes files without os.tmpdir()`);
  }
  if (writes && /process\.cwd\(\)/.test(content)) {
    errors.push(`${relative}: file write relative to process.cwd()`);
  }
}

if (errors.length > 0) {
  process.stderr.write(`Test isolation errors:\n- ${errors.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write('Test isolation verified: persistent writes stay under os.tmpdir().\n');
