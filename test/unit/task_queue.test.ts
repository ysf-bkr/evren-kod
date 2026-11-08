import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { TaskQueueManager } from '@evren-kod/core/core/tasks/TaskQueueManager';

describe('TaskQueueManager: centralized task queue & dependency DAG', () => {
  let tmpDir: string;
  let queue: TaskQueueManager;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'evren-kod-queue-'));
    queue = new TaskQueueManager();
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('adds tasks with priorities and dependencies', () => {
    const t1 = queue.addTask({
      id: 'TASK-DB',
      title: 'Veritabanı Şeması',
      priority: 'P0'
    });

    const t2 = queue.addTask({
      id: 'TASK-API',
      title: 'REST API Uç Noktası',
      priority: 'P1',
      dependsOn: ['TASK-DB']
    });

    assert.strictEqual(t1.id, 'TASK-DB');
    assert.strictEqual(t2.dependsOn[0], 'TASK-DB');
  });

  it('detects circular dependencies and rejects cyclic tasks', () => {
    queue.addTask({
      id: 'TASK-A',
      title: 'A',
      dependsOn: []
    });

    queue.addTask({
      id: 'TASK-B',
      title: 'B',
      dependsOn: ['TASK-A']
    });

    // TASK-A'yı TASK-B'ye bağımlı yaparak döngü oluşturmaya çalışalım
    assert.throws(
      () =>
        queue.addTask({
          id: 'TASK-A',
          title: 'A Döngü',
          dependsOn: ['TASK-B']
        }),
      /döngü tespit edildi/
    );
  });

  it('canStartTask returns false when prerequisite tasks are not verified or done', () => {
    const checkBefore = queue.canStartTask('TASK-API');
    assert.strictEqual(checkBefore.canStart, false);
    assert.deepStrictEqual(checkBefore.blockingTasks, ['TASK-DB']);

    // TASK-DB tamamlanınca
    queue.updateTaskStatus('TASK-DB', 'verified');

    const checkAfter = queue.canStartTask('TASK-API');
    assert.strictEqual(checkAfter.canStart, true);
    assert.strictEqual(checkAfter.blockingTasks.length, 0);
  });

  it('getNextExecutableTasks returns tasks ordered by priority (P0 -> P1 -> P2)', () => {
    queue.addTask({ id: 'TASK-LOW', title: 'Belgelendirme', priority: 'P3' });
    queue.addTask({ id: 'TASK-CRIT', title: 'Güvenlik Yaması', priority: 'P0' });

    const next = queue.getNextExecutableTasks();
    assert.ok(next.length >= 2);
    // P0 olan görev en başta olmalı
    assert.strictEqual(next[0]?.priority, 'P0');
  });

  it('generates a Kanban markdown board', () => {
    const md = queue.generateKanbanMarkdown();
    assert.match(md, /Evren Kod Merkezi Görev Panosu/);
    assert.match(md, /TASK-DB/);
    assert.match(md, /TASK-CRIT/);
  });

  it('persists queue to disk and reloads it', async () => {
    await queue.saveToDisk(tmpDir);

    const reloaded = new TaskQueueManager();
    await reloaded.loadFromDisk(tmpDir);

    assert.ok(reloaded.getAllTasks().length >= 3);
    assert.strictEqual(reloaded.getTask('TASK-DB')?.status, 'verified');
  });
});
