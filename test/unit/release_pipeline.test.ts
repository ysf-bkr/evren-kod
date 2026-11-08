import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { ReleasePipelineManager } from '@evren-kod/core/core/cicd/ReleasePipelineManager';

describe('ReleasePipelineManager: CI/CD & production release assurance', () => {
  let tmpDir: string;
  let pipeline: ReleasePipelineManager;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'evren-kod-pipeline-'));
    pipeline = new ReleasePipelineManager();
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('generates multi-language pre-commit scripts with strict proof checks', () => {
    const nodeScript = pipeline.generatePreCommitScript('node');
    assert.match(nodeScript, /npm run typecheck/);
    assert.match(nodeScript, /npm test/);
    assert.match(nodeScript, /FIXME/);

    const pyScript = pipeline.generatePreCommitScript('python');
    assert.match(pyScript, /ruff check/);
    assert.match(pyScript, /pytest/);

    const dotnetScript = pipeline.generatePreCommitScript('dotnet');
    assert.match(dotnetScript, /dotnet test/);
  });

  it('installs pre-commit hook into .git/hooks directory with executable permissions', async () => {
    // Sahte bir git deposu simüle edelim
    await fs.mkdir(path.join(tmpDir, '.git', 'hooks'), { recursive: true });

    const res = await pipeline.installGitHook(tmpDir, 'node');
    assert.strictEqual(res.installed, true);

    const hookContent = await fs.readFile(res.hookPath, 'utf-8');
    assert.match(hookContent, /Kanıtsız kod depoya gönderilemez/);

    if (process.platform !== 'win32') {
      const stat = await fs.stat(res.hookPath);
      // 0755 izin bayraklarını denetle
      assert.ok((stat.mode & 0o111) !== 0, 'Hook çalıştırılabilir olmalı');
    }
  });

  it('inspectCI identifies CI configuration files in workspace', async () => {
    const checkEmpty = await pipeline.inspectCI(tmpDir);
    assert.strictEqual(checkEmpty.hasCI, false);

    // GitHub workflows oluştur
    const ghDir = path.join(tmpDir, '.github', 'workflows');
    await fs.mkdir(ghDir, { recursive: true });
    await fs.writeFile(path.join(ghDir, 'ci.yml'), 'name: CI', 'utf-8');

    const checkWithCI = await pipeline.inspectCI(tmpDir);
    assert.strictEqual(checkWithCI.hasCI, true);
    assert.deepStrictEqual(checkWithCI.providers, ['github-actions']);
  });

  it('generates a secure GitHub Actions workflow YAML', () => {
    const yaml = pipeline.generateGitHubWorkflow({
      workflowName: 'Evren Production Gate',
      nodeVersion: '20'
    });

    assert.match(yaml, /name: Evren Production Gate/);
    assert.match(yaml, /permissions:\s+contents: read/);
    assert.match(yaml, /npm run format:check/);
    assert.match(yaml, /npm test/);
  });

  it('generates production release notes with proof summary', () => {
    const notes = pipeline.generateReleaseNotes({
      version: '0.1.4',
      projectName: 'Evren Kod',
      changedFiles: ['src/core/index.ts'],
      passedCriteria: ['Güvenlik onaylandı', 'Testler %100 geçti'],
      testResults: { total: 1081, passed: 1081, failed: 0 }
    });

    assert.match(notes, /Sürüm 0\.1\.4 Dağıtım Raporu/);
    assert.match(notes, /Toplam Test:\*\*\s*1081/);
    assert.match(notes, /Kanıt Durumu:\*\*\s*%100 Başarı/);
  });
});
