/**
 * Sıkıştırma + hafıza boru hattı: okunan dosya otomatik indeks kaydı olur,
 * yapısal özet geçmiş sıkıştırmasında gövdenin yerine geçer.
 */
import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { KnowledgeStore } from '@evren-kod/core/core/knowledge/KnowledgeStore';
import { ContextManager } from '@evren-kod/core/core/context/ContextManager';
import type { ProviderMessage } from '@evren-kod/core/providers/base';

async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'evren-kod-memcompact-'));
}

describe('KnowledgeStore.trackFile: okudukça büyüyen hafıza', () => {
  let root: string;

  before(async () => {
    root = await makeWorkspace();
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'src/app.ts'),
      'import { helper } from "./helper";\nexport function main() { return helper(); }\n'
    );
  });
  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('okunan dosya tam indeks olmadan kayda girer; simgeler bulunabilir', async () => {
    const store = new KnowledgeStore();
    await store.trackFile(root, path.join(root, 'src/app.ts'));

    assert.ok(store.getFile('src/app.ts'), 'dosya kaydı oluşmalı');
    assert.ok(store.findSymbols('main').length > 0, 'sembol çıkarılmalı');
    const digest = store.digestFor('src/app.ts');
    assert.ok(digest?.includes('main'), 'yapısal özet sembolü taşımalı');
  });

  it('değişmemiş dosyada no-op, kayıt indeksi bozulmadan kalır', async () => {
    const store = new KnowledgeStore();
    await store.trackFile(root, path.join(root, 'src/app.ts'));
    const before = store.getStatus().fileCount;
    await store.trackFile(root, path.join(root, 'src/app.ts'));
    assert.strictEqual(store.getStatus().fileCount, before);
  });

  it('hassas ve kaynak olmayan uzantılar hafızaya girmez', async () => {
    await fs.writeFile(path.join(root, 'secret.env'), 'TOKEN=x');
    await fs.writeFile(path.join(root, 'data.bin'), 'binary-ish');
    const store = new KnowledgeStore();
    await store.trackFile(root, path.join(root, 'secret.env'));
    await store.trackFile(root, path.join(root, 'data.bin'));
    assert.strictEqual(store.digestFor('secret.env'), undefined);
    assert.strictEqual(store.digestFor('data.bin'), undefined);
  });
});

describe('ContextManager.compactHistory: hafızadan beslenen sıkıştırma', () => {
  function buildReadHistory(count: number): ProviderMessage[] {
    const messages: ProviderMessage[] = [{ role: 'user', content: 'projeyi incele' }];
    for (let i = 0; i < count; i++) {
      messages.push({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: `c${i}`, name: 'read_file', arguments: { path: `src/f${i}.ts` } }]
      });
      messages.push({
        role: 'tool',
        toolCallId: `c${i}`,
        content: `[file:src/f${i}.ts · 400 lines]\n${'export const value = 1;\n'.repeat(80)}`
      });
    }
    return messages;
  }

  it('read_file gövdesi çöp stub ile değil yapısal özetle değişir', () => {
    const manager = new ContextManager({
      contextWindowTokens: 4_000,
      compactionTokenRatio: 0,
      digestFor: (relativePath) => `- [function] handler (${relativePath}:3-9)`
    });
    const compacted = manager.compactHistory(buildReadHistory(12), {
      keepRecent: 2,
      summarizeAfterSteps: 8
    });
    const toolMessages = compacted.filter((m) => m.role === 'tool');
    const oldMessage = toolMessages[0];
    assert.match(oldMessage?.content ?? '', /handler/, 'özet sembolü gövde yerine geçmeli');
    assert.match(oldMessage?.content ?? '', /body compacted/);
    const kept = toolMessages[toolMessages.length - 1];
    assert.match(kept?.content ?? '', /export const value/, 'son çıktılar tam kalmalı');
  });

  it('hafızada karşılığı olmayan çıktı eski stub ile sıkışır', () => {
    const manager = new ContextManager({ contextWindowTokens: 4_000, compactionTokenRatio: 0 });
    const compacted = manager.compactHistory(buildReadHistory(12), {
      keepRecent: 2,
      summarizeAfterSteps: 8
    });
    const first = compacted.filter((m) => m.role === 'tool')[0];
    assert.match(first?.content ?? '', /earlier step output compacted/);
  });
});
