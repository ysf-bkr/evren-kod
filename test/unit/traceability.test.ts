import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { TraceabilityManager } from '@evren-kod/core/core/spec/TraceabilityManager';

describe('TraceabilityManager: requirement to acceptance verification', () => {
  let tmpDir: string;
  let trace: TraceabilityManager;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'evren-kod-trace-'));
    trace = new TraceabilityManager();
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('adds a requirement and sets initial unmapped status if empty', () => {
    const req = trace.addRequirement({
      id: 'REQ-AUTH-01',
      title: 'Kullanıcı Kimlik Doğrulama',
      description: 'JWT tabanlı oturum yönetimi'
    });

    assert.strictEqual(req.id, 'REQ-AUTH-01');
    assert.strictEqual(req.status, 'unmapped');
    assert.strictEqual(trace.getRequirement('REQ-AUTH-01')?.title, 'Kullanıcı Kimlik Doğrulama');
  });

  it('transitions to in_progress when tasks, files or tests are linked', () => {
    trace.linkTask('REQ-AUTH-01', 'task_jwt_middleware');
    trace.linkFile('REQ-AUTH-01', 'src/auth/jwt.ts');
    trace.linkTestCase('REQ-AUTH-01', 'test/unit/jwt.test.ts');

    const req = trace.getRequirement('REQ-AUTH-01');
    assert.strictEqual(req?.status, 'in_progress');
    assert.deepStrictEqual(req?.taskIds, ['task_jwt_middleware']);
    assert.deepStrictEqual(req?.affectedFiles, ['src/auth/jwt.ts']);
    assert.deepStrictEqual(req?.testCases, ['test/unit/jwt.test.ts']);
  });

  it('transitions to verified when acceptance evidence is recorded', () => {
    trace.recordEvidence('REQ-AUTH-01', 'npm test test/unit/jwt.test.ts: 5 pass, 0 fail');

    const req = trace.getRequirement('REQ-AUTH-01');
    assert.strictEqual(req?.status, 'verified');
    assert.strictEqual(req?.acceptanceEvidence.length, 1);
  });

  it('generates a complete traceability report with metrics', () => {
    trace.addRequirement({
      id: 'REQ-DATA-02',
      title: 'Veri İzolasyonu',
      description: 'Tenant bazlı veri yalıtımı'
    });

    const report = trace.generateReport();
    assert.strictEqual(report.totalRequirements, 2);
    assert.strictEqual(report.verifiedCount, 1);
    assert.strictEqual(report.pendingCount, 1);
    assert.strictEqual(report.coveragePercent, 50);
    assert.ok(report.requirementsMissingTests.includes('REQ-DATA-02'));
    assert.ok(report.requirementsMissingEvidence.includes('REQ-DATA-02'));
  });

  it('generates a human-readable markdown matrix table', () => {
    const md = trace.generateMarkdownMatrix();
    assert.match(md, /Evren Kod Gereksinim ve Kabul İzlenebilirlik Matrisi/);
    assert.match(md, /REQ-AUTH-01/);
    assert.match(md, /✅ Doğrulandı/);
    assert.match(md, /REQ-DATA-02/);
  });

  it('persists matrix and JSON to disk and reloads them', async () => {
    await trace.saveToDisk(tmpDir);

    const reloaded = new TraceabilityManager();
    await reloaded.loadFromDisk(tmpDir);

    assert.strictEqual(reloaded.getAllRequirements().length, 2);
    assert.strictEqual(reloaded.getRequirement('REQ-AUTH-01')?.status, 'verified');
  });
});
