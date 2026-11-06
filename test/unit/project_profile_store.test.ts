import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  profileWorkspace,
  loadProfile,
  saveProfile,
  resolveProfile
} from '@evren-kod/core/core/project/ProjectProfiler';

async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'evren-kod-profiler-'));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
  return root;
}

describe('Proje profili kalıcılığı', () => {
  test('gerçek klasör taranır, diske yazılır ve geri okunur', async () => {
    const root = await makeWorkspace({
      'package.json': JSON.stringify({ dependencies: { react: '^18', next: '^14' } }),
      'app/page.tsx': 'export default function Page() { return null }'
    });
    try {
      const profile = await profileWorkspace(root);
      assert.ok(profile.stacks.includes('react'));
      assert.ok(profile.stacks.includes('nextjs'));

      await saveProfile(root, profile);
      const stored = await loadProfile(root);
      assert.ok(stored);
      assert.deepEqual(stored?.stacks, profile.stacks);
      assert.equal(stored?.source, 'auto');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('node_modules ve çıktı klasörleri taramaya girmez', async () => {
    const root = await makeWorkspace({
      'package.json': JSON.stringify({ name: 'app' }),
      'node_modules/evil/package.json': JSON.stringify({ name: 'evil' }),
      'dist/bundle.js': 'x',
      'vendor/go.mod': 'module x'
    });
    try {
      const profile = await profileWorkspace(root);
      // node_modules/go.mod görülse go yığını sızardı.
      assert.ok(!profile.stacks.includes('go'));
      assert.equal(profile.monorepo, false, 'yalnızca kök manifest sayılır');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('elle düzenlenmiş profil otomatik taramayla ezilmez', async () => {
    const root = await makeWorkspace({
      'package.json': JSON.stringify({ dependencies: { react: '^18' } })
    });
    try {
      const manual = {
        version: 1 as const,
        generatedAt: new Date().toISOString(),
        source: 'manual' as const,
        kinds: ['cli' as const],
        primaryKind: 'cli' as const,
        stacks: [] as never[],
        monorepo: false,
        confidence: 1,
        evidence: ['kullanıcı seçti']
      };
      await saveProfile(root, manual);

      const resolved = await resolveProfile(root, { refresh: true });
      assert.equal(resolved.source, 'manual');
      assert.equal(resolved.primaryKind, 'cli', 'elle seçim korunmalı');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('bozuk profil dosyası null döner, akışı kırmez', async () => {
    const root = await makeWorkspace({ '.evren-kod/project-profile.json': '{bozuk' });
    try {
      assert.equal(await loadProfile(root), null);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
