import { readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const mode = process.argv.includes('--all') ? 'all' : process.argv.includes('--cache') ? 'cache' : 'build';

const remove = (relative) => {
  rmSync(resolve(root, relative), { recursive: true, force: true });
};

/** Removes every packaged extension artifact, regardless of version. */
const removePackages = () => {
  /** @type {string[]} */
  let entries = [];
  try {
    entries = readdirSync(root);
  } catch {
    // Nothing to clean.
  }
  for (const entry of entries) {
    if (/^evren-kod-.+\.vsix$/.test(entry)) {
      remove(entry);
    }
  }
};

if (mode === 'build' || mode === 'all') {
  remove('dist');
  remove('webview-ui/dist');
  remove('out');
  removePackages();
}

if (mode === 'cache' || mode === 'all') {
  remove('.evren-kod/checkpoints');
  remove('.evren-kod/snapshots');
  remove('.evren-kod/worktrees');
  remove('.evren-kod/verification-baseline.json');
  remove('.evren-kod/audit.log');
  remove('.evren-kod/callgraph.json');
  remove('.evren-kod/callgraph.json.tmp');
  remove('.evren-kod/specs');
  remove('.evren-kod/memory.jsonl');
  remove('.evren-kod/memory.md');

  // Yalnızca üretilen bilgi tabanı indeksi; project.md, conventions.md,
  // decisions.md ve notes.md kullanıcıya aittir ve önbellek temizliğinden sağ çıkmalıdır.
  remove('.evren-kod/knowledge/map.jsonl');
  remove('.evren-kod/knowledge/symbols.jsonl');
  remove('.evren-kod/knowledge/index-state.json');
  remove('.evren-kod/knowledge/embeddings.jsonl');
  remove('.evren-kod/knowledge/modules');
}

if (mode === 'all') {
  // Entegrasyon testlerinin kullandığı indirilmiş VS Code build'leri (büyük, yeniden indirilebilir).
  remove('.vscode-test');
}

process.stdout.write(`Clean finished (${mode}).\n`);
