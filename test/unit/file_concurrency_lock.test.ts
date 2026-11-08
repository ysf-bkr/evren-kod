import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import { FileLockManager, FileLockConflictError } from '@evren-kod/core/core/concurrency/FileLockManager';

describe('FileLockManager: concurrency and file ownership', () => {
  let lockManager: FileLockManager;

  beforeEach(() => {
    lockManager = new FileLockManager();
  });

  it('allows an owner to acquire a lock on a file', () => {
    const lock = lockManager.acquire('src/service.ts', 'agent-main', 10_000);
    assert.strictEqual(lock.filePath, 'src/service.ts');
    assert.strictEqual(lock.ownerId, 'agent-main');
    assert.strictEqual(lockManager.isLocked('src/service.ts'), true);
  });

  it('allows the same owner to re-acquire / extend the lock lease', () => {
    const lock1 = lockManager.acquire('src/service.ts', 'agent-main', 5_000);
    const lock2 = lockManager.acquire('src/service.ts', 'agent-main', 15_000);
    assert.strictEqual(lock2.ownerId, 'agent-main');
    assert.ok(lock2.expiresAt >= lock1.expiresAt);
  });

  it('prevents a different owner from acquiring a locked file (throws FileLockConflictError)', () => {
    lockManager.acquire('src/service.ts', 'agent-main', 10_000);

    assert.throws(
      () => lockManager.acquire('src/service.ts', 'subagent-backend', 10_000),
      (err: unknown) => {
        assert.ok(err instanceof FileLockConflictError);
        assert.strictEqual(err.currentOwner, 'agent-main');
        assert.strictEqual(err.requestedBy, 'subagent-backend');
        return true;
      }
    );
  });

  it('tryAcquire returns false with currentOwner without throwing', () => {
    lockManager.acquire('src/utils.ts', 'agent-1', 10_000);
    const res = lockManager.tryAcquire('src/utils.ts', 'agent-2', 5_000);
    assert.strictEqual(res.acquired, false);
    assert.strictEqual(res.currentOwner, 'agent-1');
  });

  it('allows releasing the lock only by its owner', () => {
    lockManager.acquire('src/app.ts', 'agent-1', 10_000);

    // Başka sahip serbest bırakamaz
    const releasedWrong = lockManager.release('src/app.ts', 'agent-2');
    assert.strictEqual(releasedWrong, false);
    assert.strictEqual(lockManager.isLocked('src/app.ts'), true);

    // Gerçek sahip serbest bırakabilir
    const releasedRight = lockManager.release('src/app.ts', 'agent-1');
    assert.strictEqual(releasedRight, true);
    assert.strictEqual(lockManager.isLocked('src/app.ts'), false);
  });

  it('automatically unlocks after TTL expires (prevents deadlock)', async () => {
    lockManager.acquire('src/temp.ts', 'agent-crash', 50); // 50ms TTL
    assert.strictEqual(lockManager.isLocked('src/temp.ts'), true);

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.strictEqual(lockManager.isLocked('src/temp.ts'), false);
    // Artık başka bir sahip alabilir
    const lock = lockManager.acquire('src/temp.ts', 'agent-new', 5_000);
    assert.strictEqual(lock.ownerId, 'agent-new');
  });

  it('releaseAllForOwner releases all locks held by a worker', () => {
    lockManager.acquire('src/a.ts', 'subagent-quality', 10_000);
    lockManager.acquire('src/b.ts', 'subagent-quality', 10_000);
    lockManager.acquire('src/c.ts', 'agent-main', 10_000);

    const released = lockManager.releaseAllForOwner('subagent-quality');
    assert.strictEqual(released, 2);
    assert.strictEqual(lockManager.isLocked('src/a.ts'), false);
    assert.strictEqual(lockManager.isLocked('src/b.ts'), false);
    assert.strictEqual(lockManager.isLocked('src/c.ts'), true);
  });

  it('withLock runs action under lock and automatically releases on completion or error', async () => {
    let executed = false;
    await lockManager.withLock('src/critical.ts', 'worker-1', async () => {
      assert.strictEqual(lockManager.isLocked('src/critical.ts'), true);
      executed = true;
    });

    assert.strictEqual(executed, true);
    assert.strictEqual(lockManager.isLocked('src/critical.ts'), false);
  });
});
