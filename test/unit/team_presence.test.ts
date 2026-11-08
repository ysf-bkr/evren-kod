import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import {
  TeamPresenceManager,
  HumanEditingConflictError
} from '@evren-kod/core/core/team/TeamPresenceManager';

describe('TeamPresenceManager: real-time team coordination & conflict avoidance', () => {
  let tmpDir: string;
  let presence: TeamPresenceManager;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'evren-kod-team-'));
    presence = new TeamPresenceManager();
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('records heartbeats for human and agent members', () => {
    presence.heartbeat({
      id: 'dev_yusuf',
      name: 'Yusuf',
      role: 'human',
      currentBranch: 'feature/auth',
      activeFiles: ['src/auth.ts']
    });

    presence.heartbeat({
      id: 'agent_backend',
      name: 'Backend Specialist',
      role: 'agent',
      currentBranch: 'feature/auth',
      activeFiles: ['src/db.ts']
    });

    const active = presence.getActiveMembers();
    assert.strictEqual(active.length, 2);
  });

  it('detects when a human developer is actively editing a file', () => {
    const res = presence.isHumanActiveOnFile('src/auth.ts');
    assert.strictEqual(res.active, true);
    assert.strictEqual(res.member?.name, 'Yusuf');

    const resOther = presence.isHumanActiveOnFile('src/unrelated.ts');
    assert.strictEqual(resOther.active, false);
  });

  it('assertNotConflictingWithHuman throws HumanEditingConflictError to protect human work', () => {
    assert.throws(
      () => presence.assertNotConflictingWithHuman('src/auth.ts'),
      (err: unknown) => {
        assert.ok(err instanceof HumanEditingConflictError);
        assert.strictEqual(err.humanName, 'Yusuf');
        assert.match(err.message, /İnsan-Ajan Çakışması Engellendi/);
        return true;
      }
    );

    // Başka bir dosyada hata vermez
    assert.doesNotThrow(() => presence.assertNotConflictingWithHuman('src/free.ts'));
  });

  it('filters out stale members whose heartbeat has timed out', async () => {
    presence.heartbeat({
      id: 'stale_user',
      name: 'Eski Kullanıcı',
      role: 'human',
      activeFiles: ['src/stale.ts']
    });

    // 10ms threshold ile kontrol
    await new Promise((resolve) => setTimeout(resolve, 15));
    const res = presence.isHumanActiveOnFile('src/stale.ts', 10);
    assert.strictEqual(res.active, false);
  });

  it('threeWayMergeCheck performs 3-way analysis and detects clean vs conflicting changes', () => {
    const base = 'satir 1\nsatir 2\nsatir 3';
    const ours = 'satir 1\nsatir 2 (ajan değistirdi)\nsatir 3';
    const theirsClean = 'satir 1 (insan değistirdi)\nsatir 2\nsatir 3';

    // Temiz durum (farklı satırlar değişti)
    const resClean = presence.threeWayMergeCheck(base, ours, theirsClean);
    assert.strictEqual(resClean.clean, true);
    assert.strictEqual(resClean.conflicts.length, 0);

    // Çakışan durum (aynı satırı ikisi de farklı değiştirdi)
    const theirsConflict = 'satir 1\nsatir 2 (insan da değiştirdi)\nsatir 3';
    const resConflict = presence.threeWayMergeCheck(base, ours, theirsConflict);
    assert.strictEqual(resConflict.clean, false);
    assert.strictEqual(resConflict.conflicts.length, 1);
    assert.strictEqual(resConflict.conflicts[0]?.line, 2);
  });

  it('persists team presence to disk and reloads it', async () => {
    await presence.saveToDisk(tmpDir);

    const reloaded = new TeamPresenceManager();
    await reloaded.loadFromDisk(tmpDir);

    const check = reloaded.isHumanActiveOnFile('src/auth.ts');
    assert.strictEqual(check.active, true);
  });
});
