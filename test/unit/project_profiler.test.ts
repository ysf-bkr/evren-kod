import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  detectProfile,
  loadProfile,
  profileWorkspace,
  resolveProfile,
  saveProfile
} from '@evren-kod/core/core/project/ProjectProfiler';
import type { ProjectProfile } from '@evren-kod/core/shared/types';

/** Test yardımı: yalnızca ad-listesiyle profil çıkarır. */
async function profileOf(files: string[], contents: Record<string, string> = {}) {
  return detectProfile({ files, read: (f) => contents[f] });
}

describe('ProjectProfiler: uygulama türü ve stack algılama', () => {
  test('React + TypeScript web arayüzü fullstack olmadan bulunur', async () => {
    const profile = await profileOf(['package.json', 'src/App.tsx'], {
      'package.json': JSON.stringify({ dependencies: { react: '^18', typescript: '^5' } })
    });
    assert.ok(profile.kinds.includes('fullstack'), 'web çatısı fullstack sayılır');
    assert.ok(profile.stacks.includes('react'));
    assert.ok(profile.stacks.includes('typescript'));
    assert.ok(profile.confidence > 0);
  });

  test('backend + frontend bir arada fullstack olur', async () => {
    const profile = await profileOf(['package.json', 'server/index.ts'], {
      'package.json': JSON.stringify({
        dependencies: { react: '^18', express: '^4' }
      })
    });
    assert.strictEqual(profile.primaryKind, 'fullstack');
  });

  test('Node.js bağımlılığı tek başına web-backend üretir', async () => {
    const profile = await profileOf(['package.json', 'src/main.ts'], {
      'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '^10' } })
    });
    assert.ok(profile.kinds.includes('web-backend'));
    assert.ok(profile.stacks.includes('nestjs'));
  });

  test('Android Gradle yapılandırması mobil + android verir', async () => {
    const profile = await profileOf(['app/build.gradle.kts', 'app/src/main/AndroidManifest.xml'], {
      'app/build.gradle.kts': 'plugins { id("com.android.application") }'
    });
    assert.ok(profile.kinds.includes('mobile'));
    assert.ok(profile.stacks.includes('android'));
  });

  test('Flutter pubspec mobil + flutter verir', async () => {
    const profile = await profileOf(['pubspec.yaml'], {
      'pubspec.yaml': 'name: app\nflutter:\n  sdk: flutter\n'
    });
    assert.strictEqual(profile.primaryKind, 'mobile');
    assert.ok(profile.stacks.includes('flutter'));
  });

  test('Tauri yapılandırması masaüstü verir', async () => {
    const profile = await profileOf(['src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'package.json'], {
      'package.json': JSON.stringify({ dependencies: { '@tauri-apps/cli': '^2' } })
    });
    assert.ok(profile.kinds.includes('desktop'));
    assert.ok(profile.stacks.includes('tauri'));
  });

  test('iOS proje dosyaları mobil + ios verir', async () => {
    const profile = await profileOf(['App.xcodeproj/project.pbxproj', 'Sources/Main.swift']);
    assert.ok(profile.kinds.includes('mobile'));
    assert.ok(profile.stacks.includes('ios'));
  });

  test('Spring Maven projesi java + spring backend verir', async () => {
    const profile = await profileOf(['pom.xml'], {
      'pom.xml':
        '<project><dependencies><dependency>org.springframework.boot</dependency></dependencies></project>'
    });
    assert.ok(profile.kinds.includes('web-backend'));
    assert.ok(profile.stacks.includes('java'));
    assert.ok(profile.stacks.includes('spring'));
  });

  test('ASP.NET Core csproj backend + dotnet verir', async () => {
    const profile = await profileOf(['Api/Api.csproj'], {
      'Api/Api.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>'
    });
    assert.ok(profile.kinds.includes('web-backend'));
    assert.ok(profile.stacks.includes('dotnet'));
    assert.ok(profile.stacks.includes('aspnet'));
  });

  test('Python FastAPI projesi backend + fastapi verir', async () => {
    const profile = await profileOf(['pyproject.toml'], {
      'pyproject.toml': '[project]\ndependencies = ["fastapi>=0.110"]\n'
    });
    assert.ok(profile.kinds.includes('web-backend'));
    assert.ok(profile.stacks.includes('fastapi'));
  });

  test('bin alanı olan paket cli türü kazanır', async () => {
    const profile = await profileOf(['package.json'], {
      'package.json': JSON.stringify({ bin: { mytool: './dist/cli.js' }, dependencies: { commander: '^12' } })
    });
    assert.ok(profile.kinds.includes('cli'));
  });

  test('monorepo workspaces alanından anlaşılır', async () => {
    const profile = await profileOf(['package.json', 'packages/core/package.json'], {
      'package.json': JSON.stringify({ workspaces: ['packages/*'], dependencies: { typescript: '^5' } }),
      'packages/core/package.json': JSON.stringify({ name: 'core' })
    });
    assert.equal(profile.monorepo, true);
  });

  test('boş depo unknown türü ve düşük güvenle döner', async () => {
    const profile = await profileOf(['README.md']);
    assert.strictEqual(profile.primaryKind, 'unknown');
    assert.ok(profile.confidence < 0.3);
  });

  test('aynı girdi deterministik stack sırası üretir', async () => {
    const files = ['package.json', 'Dockerfile', 'db/schema.prisma'];
    const contents = {
      'package.json': JSON.stringify({ dependencies: { react: '^18', prisma: '^5', redis: '^4' } })
    };
    const a = await profileOf(files, contents);
    const b = await profileOf(files, contents);
    assert.deepEqual(a.stacks, b.stacks);
    assert.deepEqual(a.stacks, [...a.stacks].sort());
  });

  test('Windows Forms csproj masaüstü türü üretir', async () => {
    const profile = await profileOf(['App/App.csproj'], {
      'App/App.csproj':
        '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><UseWindowsForms>true</UseWindowsForms></PropertyGroup></Project>'
    });
    assert.ok(profile.kinds.includes('desktop'));
  });

  test('CI, docker ve terraform sinyalleri stack olarak toplanır', async () => {
    const profile = await profileOf(['.github/workflows/ci.yml', 'Dockerfile', 'infra/main.tf', 'README.md']);
    assert.ok(profile.stacks.includes('ci-github'));
    assert.ok(profile.stacks.includes('docker'));
    assert.ok(profile.stacks.includes('terraform'));
  });
});

describe('ProjectProfiler: profil kalıcılığı', () => {
  const tmpRoots: string[] = [];

  after(async () => {
    await Promise.all(tmpRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function tempWorkspace(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'evren-kod-profile-'));
    tmpRoots.push(root);
    // Otomatik tarama react bulsun; elle seçim bunu ezmeli.
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ dependencies: { react: '^18', typescript: '^5' } })
    );
    return root;
  }

  test('kayıt-okuma gidiş-dönüşü profili korur', async () => {
    const root = await tempWorkspace();
    const profile = await profileWorkspace(root);
    await saveProfile(root, profile);
    const loaded = await loadProfile(root);
    assert.deepEqual(loaded, profile);
  });

  test('bozuk kayıt null döner, profil çözümlemeyi kırmaz', async () => {
    const root = await tempWorkspace();
    await fs.mkdir(path.join(root, '.evren-kod'), { recursive: true });
    await fs.writeFile(path.join(root, '.evren-kod', 'project-profile.json'), '{ bozuk json');
    assert.equal(await loadProfile(root), null);
    const resolved = await resolveProfile(root);
    assert.ok(resolved.stacks.includes('react'));
  });

  test('manual profil taze tarama istemine rağmen korunur', async () => {
    const root = await tempWorkspace();
    const manual: ProjectProfile = {
      version: 1,
      generatedAt: new Date(0).toISOString(),
      source: 'manual',
      kinds: ['cli'],
      primaryKind: 'cli',
      stacks: ['rust'],
      monorepo: false,
      confidence: 1,
      evidence: ['Proje türü ve yığın kullanıcı tarafından elle seçildi.']
    };
    await saveProfile(root, manual);
    // Bayat zaman damgasına ve refresh isteğine rağmen elle seçim kazanır.
    const resolved = await resolveProfile(root, { refresh: true });
    assert.deepEqual(resolved, manual);
  });

  test('auto profil bayatladığında yeniden taranır ve diske yazılır', async () => {
    const root = await tempWorkspace();
    const stale: ProjectProfile = {
      version: 1,
      generatedAt: new Date(0).toISOString(),
      source: 'auto',
      kinds: ['unknown'],
      primaryKind: 'unknown',
      stacks: [],
      monorepo: false,
      confidence: 0,
      evidence: []
    };
    await saveProfile(root, stale);
    const resolved = await resolveProfile(root);
    assert.ok(resolved.stacks.includes('react'));
    assert.notEqual(resolved.primaryKind, 'unknown');
  });
});
