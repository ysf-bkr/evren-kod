import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { TechDebtTracker } from '@evren-kod/core/core/lifecycle/TechDebtTracker';
import { MigrationManager, CURRENT_SCHEMA_VERSION } from '@evren-kod/core/core/lifecycle/MigrationManager';

describe('Lifecycle: TechDebtTracker & MigrationManager', () => {
  let tmpDir: string;
  let tracker: TechDebtTracker;
  let migrator: MigrationManager;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'evren-kod-lifecycle-'));
    tracker = new TechDebtTracker();
    migrator = new MigrationManager();
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('scans content and categorizes TODO, FIXME, HACK, and deprecated tags', () => {
    const code = `
      // TODO: bu metodu daha sonra yeniden yapılandır
      function test() {
        // FIXME: bellek sızıntısı giderilmeli
        // HACK: eski api için geçici yama
        // @deprecated yerine yeniAuth kullanın
        return 42;
      }
    `;

    const items = tracker.scanContent('src/sample.ts', code);
    assert.strictEqual(items.length, 4);

    const types = items.map((i) => i.type);
    assert.ok(types.includes('todo'));
    assert.ok(types.includes('fixme'));
    assert.ok(types.includes('hack'));
    assert.ok(types.includes('deprecated'));
  });

  it('detects excessively large files (>500 lines) violating SRP', () => {
    const hugeContent = Array(600).fill('const x = 1;').join('\n');
    const items = tracker.scanContent('src/monolith.ts', hugeContent);

    const largeFileItem = items.find((i) => i.type === 'large_file');
    assert.ok(largeFileItem);
    assert.match(largeFileItem.description, /Dosya boyutu aşırı büyük/);
  });

  it('creates comprehensive tech debt report with health score', () => {
    const files = [
      {
        filePath: 'src/a.ts',
        content: '// TODO: log kaydı ekle\nconst a = 1;'
      },
      {
        filePath: 'src/b.ts',
        content: '// FIXME: çökmeyi düzelt\nconst b = 2;'
      }
    ];

    const report = tracker.createReport(files);
    assert.strictEqual(report.totalIssues, 2);
    assert.strictEqual(report.categoryCounts.todo, 1);
    assert.strictEqual(report.categoryCounts.fixme, 1);
    assert.ok(report.score < 100);
    assert.ok(['A+', 'A', 'B'].includes(report.grade));
  });

  it('generates markdown report and saves to disk', async () => {
    const report = tracker.createReport([
      { filePath: 'src/clean.ts', content: 'export const clean = true;' }
    ]);

    await tracker.saveReport(tmpDir, report);

    const savedJson = await fs.readFile(
      path.join(tmpDir, '.evren-kod', 'reports', 'tech-debt.json'),
      'utf-8'
    );
    assert.ok(savedJson.includes('"score": 100'));

    const savedMd = await fs.readFile(path.join(tmpDir, '.evren-kod', 'reports', 'tech-debt.md'), 'utf-8');
    assert.match(savedMd, /Evren Kod Teknik Borç ve Kod Sağlığı Raporu/);
  });

  it('MigrationManager checks schema version and runs migration cleanly', async () => {
    const checkBefore = await migrator.checkMigrationNeeded(tmpDir);
    assert.strictEqual(checkBefore.needed, true);
    assert.strictEqual(checkBefore.targetVersion, CURRENT_SCHEMA_VERSION);

    const migrationResult = await migrator.runMigration(tmpDir);
    assert.strictEqual(migrationResult.success, true);
    assert.strictEqual(migrationResult.migratedTo, CURRENT_SCHEMA_VERSION);
    assert.ok(migrationResult.actions.length > 0);

    // Tekrar kontrol edildiğinde göç gerekmemeli
    const checkAfter = await migrator.checkMigrationNeeded(tmpDir);
    assert.strictEqual(checkAfter.needed, false);
  });

  it('scans workspace directories and ignores build and vendor folders', async () => {
    const srcDir = path.join(tmpDir, 'src');
    const nodeModulesDir = path.join(tmpDir, 'node_modules');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(nodeModulesDir, { recursive: true });

    await fs.writeFile(
      path.join(srcDir, 'app.ts'),
      '// TODO: write app logic\nexport const ok = 1;',
      'utf-8'
    );
    await fs.writeFile(
      path.join(nodeModulesDir, 'vendor.ts'),
      '// FIXME: vendor bug\nexport const v = 2;',
      'utf-8'
    );

    const report = await tracker.scanWorkspace(tmpDir);
    assert.ok(report.scannedFilesCount >= 1);
    assert.strictEqual(report.categoryCounts.fixme, 0); // node_modules hariç tutulmalıdır!
    assert.strictEqual(report.categoryCounts.todo, 1);
  });
});
