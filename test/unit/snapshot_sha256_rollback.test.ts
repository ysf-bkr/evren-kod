import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { SnapshotManager } from '@evren-kod/core/core/snapshot/SnapshotManager';

describe('SnapshotManager: SHA-256 conflict detection & rollback safety', () => {
  let tmpDir: string;
  let manager: SnapshotManager;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'evren-kod-sha-snapshot-'));
    manager = new SnapshotManager();
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('computes and stores SHA-256 hash when snapshot is created', async () => {
    const file = path.join(tmpDir, 'hash_test.txt');
    await fs.writeFile(file, 'orijinal içerik', 'utf-8');

    const id = await manager.createSnapshot('hash_test.txt', tmpDir, 'call_hash');
    const snapshot = manager.getSnapshots().find((s) => s.id === id);

    assert.ok(snapshot);
    assert.strictEqual(snapshot.filePath, 'hash_test.txt');
    assert.ok(snapshot.originalSha256.length === 64, 'SHA-256 hash 64 karakter olmalı');
  });

  it('records post-execution hash after an agent writes to file', async () => {
    const file = path.join(tmpDir, 'agent_write.txt');
    await fs.writeFile(file, 'eski hal', 'utf-8');

    const id = await manager.createSnapshot('agent_write.txt', tmpDir, 'call_write');
    // Ajan dosyayı değiştirir
    await fs.writeFile(file, 'ajanın yazdığı yeni kod', 'utf-8');

    const postHash = await manager.recordPostExecutionHash(id, tmpDir);
    assert.ok(postHash);
    assert.strictEqual(postHash.length, 64);

    const snapshot = manager.getSnapshots().find((s) => s.id === id);
    assert.strictEqual(snapshot?.postExecutionSha256, postHash);
  });

  it('reverts smoothly if no external change occurred after agent edit', async () => {
    const file = path.join(tmpDir, 'clean_revert.txt');
    await fs.writeFile(file, 'v1', 'utf-8');

    const id = await manager.createSnapshot('clean_revert.txt', tmpDir);
    await fs.writeFile(file, 'v2_agent', 'utf-8');
    await manager.recordPostExecutionHash(id, tmpDir);

    // Rollback yap
    const res = await manager.revertSnapshot(id, tmpDir);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.conflict, undefined);
    assert.strictEqual(await fs.readFile(file, 'utf-8'), 'v1');
  });

  it('detects external user modification, blocks rollback, and provides diff', async () => {
    const file = path.join(tmpDir, 'conflict_file.ts');
    await fs.writeFile(file, 'const x = 1;', 'utf-8');

    const id = await manager.createSnapshot('conflict_file.ts', tmpDir);
    // Ajan yazdı
    await fs.writeFile(file, 'const x = 2; // agent code', 'utf-8');
    await manager.recordPostExecutionHash(id, tmpDir);

    // KULLANICI araya girdi ve dosyayı manuel düzenledi:
    await fs.writeFile(file, 'const x = 999; // USER MANUAL EDIT', 'utf-8');

    // Şimdi rollback çağrıldığında kullanıcının verisi korunmalı:
    const res = await manager.revertSnapshot(id, tmpDir);

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.conflict, true);
    assert.match(res.message, /Çakışma tespit edildi/);
    assert.ok(res.diff, 'Kullanıcıya görsel diff sunulmalı');
    assert.match(res.diff, /USER MANUAL EDIT/);

    // Dosya içeriği hala kullanıcının düzenlediği gibi kalmalı!
    assert.strictEqual(await fs.readFile(file, 'utf-8'), 'const x = 999; // USER MANUAL EDIT');
  });

  it('allows forced rollback when force: true is explicitly passed', async () => {
    const file = path.join(tmpDir, 'force_file.ts');
    await fs.writeFile(file, 'base', 'utf-8');

    const id = await manager.createSnapshot('force_file.ts', tmpDir);
    await fs.writeFile(file, 'agent_mod', 'utf-8');
    await manager.recordPostExecutionHash(id, tmpDir);

    // Harici değişiklik
    await fs.writeFile(file, 'external_change', 'utf-8');

    // Zorunlu geri alma (kullanıcı onay verdi)
    const res = await manager.revertSnapshot(id, { workspaceRoot: tmpDir, force: true });
    assert.strictEqual(res.success, true);
    assert.strictEqual(await fs.readFile(file, 'utf-8'), 'base');
  });
});
