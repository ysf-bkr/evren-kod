import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ContainerSandboxManager } from '@evren-kod/core/core/sandbox/ContainerSandbox';

describe('ContainerSandboxManager: konteyner izolasyonu', () => {
  it('varsayılan yapılandırma ile başlatılabilir ve Dockerfile üretebilir', () => {
    const sandbox = new ContainerSandboxManager();
    const dockerfile = sandbox.generateDockerfile();

    // Sertleştirilmiş güvenlik kurallarını doğrula
    assert.match(dockerfile, /FROM alpine/);
    assert.match(dockerfile, /USER evren/);
    assert.match(dockerfile, /WORKDIR \/workspace/);
  });

  it('güvenli çalıştırma argümanlarını doğru oluşturur', () => {
    const sandbox = new ContainerSandboxManager({
      image: 'custom-sandbox:v1',
      memoryLimit: '4g',
      cpuLimit: '4',
      networkMode: 'none',
      environment: { ENV_VAR: 'test123' }
    });

    const { binary, args } = sandbox.buildExecutionArgs('npm test', '/my/project');

    assert.strictEqual(binary, 'docker');
    assert.ok(args.includes('--rm'));
    assert.ok(args.includes('--network=none'));
    assert.ok(args.includes('--memory=4g'));
    assert.ok(args.includes('--cpus=4'));
    assert.ok(args.includes('--read-only'));
    assert.ok(args.includes('--cap-drop=ALL'));
    assert.ok(args.includes('-e=ENV_VAR=test123'));
    assert.ok(args.includes('custom-sandbox:v1'));
    assert.strictEqual(args[args.length - 1], 'npm test');
  });

  it('devre dışı sandbox çalıştırılmak istendiğinde hata döner', async () => {
    const sandbox = new ContainerSandboxManager({ enabled: false });
    const result = await sandbox.execute('echo hi', '/my/project');

    assert.strictEqual(result.isolated, false);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.stderr, /devre dışı/);
  });
});
