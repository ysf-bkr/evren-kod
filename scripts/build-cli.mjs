import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

// packages/cli ve kök package.json "bin": evren-kod → ./dist/cli.js
const outputFile = resolve('packages/cli/dist/cli.js');
const rootOutputFile = resolve('dist/cli.js');

mkdirSync(dirname(outputFile), { recursive: true });
mkdirSync(dirname(rootOutputFile), { recursive: true });

await build({
  entryPoints: ['packages/cli/src/index.ts'],
  bundle: true,
  alias: { '@evren-kod/core': resolve('packages/core/src') },
  platform: 'node',
  format: 'cjs',
  minify: true,
  banner: { js: '#!/usr/bin/env node' },
  outfile: outputFile,
  external: ['vscode', 'readline/promises']
});

copyFileSync(outputFile, rootOutputFile);

if (process.platform !== 'win32') {
  chmodSync(outputFile, 0o755);
  chmodSync(rootOutputFile, 0o755);
}
