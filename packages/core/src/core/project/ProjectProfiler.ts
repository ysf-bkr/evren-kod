/**
 * Proje profilleyici: kullanıcının hangi tür uygulamayı geliştirdiğini ve
 * teknoloji yığınını manifest dosyalarından çıkarır.
 *
 * `detectProfile` saf fonksiyondur: dosya listesi ve içerik okuyucu ile
 * çağrılır, böylece test edilebilir kalır. `scanWorkspace` gerçek dosya
 * sistemi taramasını yapar (node_modules gibi paket klasörlerine girmez).
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { EVREN_KOD_DIR, EVREN_KOD_FILES } from '../../shared/constants';
import { ProjectKind, ProjectProfile, StackId } from './types';
import { PROJECT_KIND_LABELS } from '../../shared/projectLabels';

/** Taramada atlanan klasörler: üçüncü taraf kod ve derleme çıktısı. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'out',
  'build',
  'target',
  'vendor',
  '.git',
  '.hg',
  '.svn',
  EVREN_KOD_DIR,
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  'bin',
  'obj',
  'DerivedData',
  'Pods',
  '.gradle',
  '.idea',
  '.vs',
  'unpackage',
  '.expo'
]);

/** Güvenin tavanı: tek bir güçlü sinyal bile %60 güven üretir. */
const CONFIDENCE_CAP = 0.95;

export interface DetectInput {
  /** Depo köküne göreli, `/` ayraçlı dosya yolları. */
  files: readonly string[];
  /** Dosya içeriğini okur; okunamazsa undefined döner. */
  read?: (relativePath: string) => string | undefined | Promise<string | undefined>;
}

type Signal = { stack?: StackId; kind?: ProjectKind; note: string; weight: number };

async function readMaybe(read: DetectInput['read'], file: string): Promise<string | undefined> {
  if (!read) return undefined;
  try {
    return await read(file);
  } catch {
    return undefined;
  }
}

function parseJson(content: string | undefined): Record<string, unknown> | undefined {
  if (!content) return undefined;
  try {
    const parsed: unknown = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function depsOf(manifest: Record<string, unknown> | undefined): string[] {
  if (!manifest) return [];
  const buckets = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  const names: string[] = [];
  for (const bucket of buckets) {
    const value = manifest[bucket];
    if (value && typeof value === 'object') names.push(...Object.keys(value as Record<string, unknown>));
  }
  return names;
}

/** package.json içeriğinden stack ve tür sinyalleri çıkarır. */
function nodeSignals(manifest: Record<string, unknown> | undefined, file: string): Signal[] {
  const out: Signal[] = [];
  if (!manifest) return out;
  const deps = depsOf(manifest);
  const has = (needle: string) => deps.some((d) => d === needle || d.startsWith(`${needle}/`));

  if (has('typescript'))
    out.push({ stack: 'typescript', note: `${file}: typescript bağımlılığı`, weight: 2 });
  else out.push({ stack: 'javascript', note: `${file}: Node.js paketi`, weight: 1 });

  const kindsFor: Array<[() => boolean, ProjectKind, string]> = [
    [() => has('react-native') || has('expo'), 'mobile', 'react-native/expo'],
    [() => has('electron'), 'desktop', 'electron'],
    [() => has('@tauri-apps/api') || has('@tauri-apps/cli'), 'desktop', 'tauri'],
    [
      () => has('next') || has('nuxt') || has('react') || has('vue') || has('@angular/core') || has('svelte'),
      'fullstack',
      'web çatısı'
    ],
    [
      () => has('@nestjs/core') || has('express') || has('fastify') || has('koa'),
      'web-backend',
      'sunucu çatısı'
    ]
  ];
  for (const [check, kind, label] of kindsFor) {
    if (check()) {
      out.push({ kind, note: `${file}: ${label}`, weight: 3 });
      break;
    }
  }

  const stacks: Array<[() => boolean, StackId, string]> = [
    [() => has('react'), 'react', 'react'],
    [() => has('next'), 'nextjs', 'next.js'],
    [() => has('nuxt') || has('nuxt3'), 'nuxt', 'nuxt'],
    [() => has('vue'), 'vue', 'vue'],
    [() => has('@angular/core'), 'angular', 'angular'],
    [() => has('svelte'), 'svelte', 'svelte'],
    [() => has('react-native'), 'react-native', 'react-native'],
    [() => has('electron'), 'electron', 'electron'],
    [() => has('@tauri-apps/cli') || has('@tauri-apps/api'), 'tauri', 'tauri'],
    [() => has('@nestjs/core'), 'nestjs', 'nestjs'],
    [() => has('express'), 'express', 'express'],
    [() => has('@prisma/client') || has('prisma'), 'prisma', 'prisma'],
    [() => has('redis') || has('ioredis'), 'redis', 'redis'],
    [() => has('mongodb') || has('mongoose'), 'mongodb', 'mongodb'],
    [() => has('pg') || has('postgres'), 'postgres', 'postgres'],
    [() => has('mysql2'), 'mysql', 'mysql'],
    [() => has('better-sqlite3') || has('sqlite3'), 'sqlite', 'sqlite'],
    [() => has('graphql') || has('apollo-server-core') || has('@apollo/server'), 'graphql', 'graphql'],
    [() => has('@grpc/grpc-js'), 'grpc', 'grpc'],
    [() => has('@modelcontextprotocol/sdk'), 'mcp', 'mcp']
  ];
  for (const [check, stack, label] of stacks) {
    if (check()) out.push({ stack, note: `${file}: ${label} bağımlılığı`, weight: 2 });
  }

  if (manifest.bin && typeof manifest.bin === 'object' && Object.keys(manifest.bin as object).length > 0) {
    out.push({ kind: 'cli', note: `${file}: bin girdisi (komut aracı)`, weight: 2 });
  }
  return out;
}

/** Ad ve içerikten sinyal üreten basit kural seti. */
function fileSignals(file: string, content: string | undefined, signals: Signal[]): void {
  const base = path.posix.basename(file).toLowerCase();
  const lower = file.toLowerCase();
  const push = (s: Signal) => signals.push(s);

  if (base === 'tsconfig.json') push({ stack: 'typescript', note: `${file} bulundu`, weight: 2 });
  if (base === 'go.mod') push({ stack: 'go', kind: 'web-backend', note: `${file} bulundu`, weight: 3 });
  if (base === 'cargo.toml')
    push({
      stack: 'rust',
      kind: lower.includes('src-tauri') ? undefined : 'library',
      note: `${file} bulundu`,
      weight: 3
    });
  if (base === 'cmakelists.txt') push({ stack: 'cpp', kind: 'desktop', note: `${file} bulundu`, weight: 3 });
  if (/\.pro$/.test(base) || /\.qrc$/.test(base) || lower.includes('/qt/') || /\.qmake/.test(lower))
    push({ stack: 'qt', kind: 'desktop', note: `${file} Qt göstergesi`, weight: 3 });
  if (base === 'androidmanifest.xml')
    push({ stack: 'android', kind: 'mobile', note: `${file} bulundu`, weight: 4 });
  if (/\.kt$|\.kts$/.test(base) && base !== 'build.gradle.kts')
    push({ stack: 'kotlin', note: `${file} Kotlin kaynağı`, weight: 1 });
  if (/build\.gradle(\.kts)?$/.test(base)) {
    push({ stack: 'java', kind: 'mobile', note: `${file} Gradle derlemesi`, weight: 3 });
    if (
      content &&
      /(org.jetbrains.kotlin.android|com.android.application|android \{|android\{)/i.test(content)
    )
      push({ stack: 'android', kind: 'mobile', note: `${file}: Android Gradle yapılandırması`, weight: 4 });
    if (content && /org\.springframework/i.test(content))
      push({ stack: 'spring', kind: 'web-backend', note: `${file}: Spring yapılandırması`, weight: 4 });
  }
  if (base === 'pom.xml') {
    push({ stack: 'java', kind: 'web-backend', note: `${file} Maven projesi`, weight: 3 });
    if (content && /springframework/i.test(content))
      push({ stack: 'spring', kind: 'web-backend', note: `${file}: Spring bağımlılığı`, weight: 4 });
  }
  if (/\.csproj$/.test(base) || /\.sln$/.test(base)) {
    push({ stack: 'dotnet', note: `${file} .NET projesi`, weight: 3 });
    push({ stack: 'csharp', note: `${file}: C# proje dosyası`, weight: 2 });
    if (content && /Microsoft\.NET\.Sdk\.Web|Microsoft.AspNetCore/i.test(content))
      push({ stack: 'aspnet', kind: 'web-backend', note: `${file}: ASP.NET Core`, weight: 4 });
    if (content && /UseWindowsForms|UseWPF|OutputType.*WinExe/i.test(content))
      push({ kind: 'desktop', note: `${file}: Windows masaüstü uygulaması`, weight: 4 });
  }
  if (base === 'composer.json') {
    const manifest = parseJson(content);
    push({ stack: 'php', note: `${file} Composer projesi`, weight: 3 });
    const deps = depsOf(manifest).filter((d) => d.startsWith('laravel/'));
    if (deps.length > 0) push({ stack: 'laravel', kind: 'web-backend', note: `${file}: Laravel`, weight: 4 });
  }
  if (base === 'artisan')
    push({ stack: 'laravel', kind: 'web-backend', note: `${file} Laravel göstergesi`, weight: 3 });
  if (base === 'requirements.txt' || base === 'pyproject.toml' || base === 'setup.py') {
    push({ stack: 'python', note: `${file} Python projesi`, weight: 3 });
    if (content && /django/i.test(content))
      push({ stack: 'django', kind: 'web-backend', note: `${file}: Django`, weight: 4 });
    if (content && /fastapi/i.test(content))
      push({ stack: 'fastapi', kind: 'web-backend', note: `${file}: FastAPI`, weight: 4 });
    if (content && /\bflask\b/i.test(content))
      push({ stack: 'flask', kind: 'web-backend', note: `${file}: Flask`, weight: 4 });
    if (content && /(torch|tensorflow|scikit-learn|transformers|langchain|openai)/i.test(content))
      push({ stack: 'ml-python', note: `${file}: makine öğrenmesi bağımlılıkları`, weight: 3 });
    if (content && /mcp|modelcontextprotocol/i.test(content))
      push({ stack: 'mcp', note: `${file}: MCP bağımlılığı`, weight: 2 });
  }
  if (base === 'manage.py')
    push({ stack: 'django', kind: 'web-backend', note: `${file} Django göstergesi`, weight: 4 });
  if (base === 'pubspec.yaml') {
    push({ stack: 'dart', note: `${file} Dart projesi`, weight: 2 });
    if (content && /^flutter:/m.test(content))
      push({ stack: 'flutter', kind: 'mobile', note: `${file}: Flutter`, weight: 4 });
  }
  if (/\.xcodeproj\/project.pbxproj$/.test(lower) || base === 'podfile' || base === 'package.pins')
    push({ stack: 'ios', kind: 'mobile', note: `${file} iOS projesi`, weight: 4 });
  if (lower.endsWith('.swift')) push({ stack: 'swift', note: `${file} Swift kaynağı`, weight: 1 });
  if (base === 'tauri.conf.json' || lower.endsWith('/src-tauri/cargo.toml'))
    push({ stack: 'tauri', kind: 'desktop', note: `${file} Tauri uygulaması`, weight: 4 });
  if (
    /^dockerfile([^/]*)$/.test(base) ||
    /^docker-compose[^/]*\.ya?ml$/.test(base) ||
    base === 'compose.yaml' ||
    base === 'compose.yml'
  )
    push({ stack: 'docker', note: `${file} konteyner yapılandırması`, weight: 2 });
  if (/(^|\/)(k8s|kubernetes|helm)\//.test(lower))
    push({ stack: 'kubernetes', note: `${file} Kubernetes düzeni`, weight: 2 });
  if (/\.tf$|\.tfvars$/.test(base) || lower.includes('/terraform/'))
    push({ stack: 'terraform', note: `${file} Terraform tanımı`, weight: 2 });
  if (lower.includes('playbooks/') || /(^|\/)ansible[^/]*\.ya?ml$/.test(lower))
    push({ stack: 'ansible', note: `${file} Ansible yapılandırması`, weight: 2 });
  if (lower.startsWith('.github/workflows/'))
    push({ stack: 'ci-github', note: `${file} CI akışı`, weight: 1 });
  if (/\.sql$/.test(base)) push({ stack: 'sql', note: `${file} SQL varlığı`, weight: 1 });
  if (base === 'prisma' && lower.includes('/schema.prisma'))
    push({ stack: 'prisma', note: `${file} Prisma şeması`, weight: 2 });
  if (lower.endsWith('/schema.prisma')) push({ stack: 'prisma', note: `${file} Prisma şeması`, weight: 3 });
  if (lower.includes('/migrations/') && /\.(sql|py|js|ts)$/.test(base))
    push({ stack: 'sql', note: `${file} migration dosyası`, weight: 1 });
  if (lower.endsWith('.graphql') || lower.endsWith('.gql'))
    push({ stack: 'graphql', note: `${file} GraphQL şeması`, weight: 2 });
  if (/\.proto$/.test(base)) push({ stack: 'grpc', note: `${file} protobuf sözleşmesi`, weight: 2 });
}

/** Sinyal listesinden deterministik profil üretir. */
export async function detectProfile(input: DetectInput): Promise<ProjectProfile> {
  const files = [...input.files].map((f) => f.replace(/\\/g, '/')).sort();
  const signals: Signal[] = [];

  const manifests = files.filter((f) => /(^|\/)package\.json$/.test(f));
  const kindVotes = new Map<ProjectKind, number>();
  const stackVotes = new Map<StackId, number>();
  let totalWeight = 0;

  const manifestJson = new Map<string, Record<string, unknown> | undefined>();
  for (const file of manifests) {
    const content = await readMaybe(input.read, file);
    const manifest = parseJson(content);
    manifestJson.set(file, manifest);
    const before = signals.length;
    signals.push(...nodeSignals(manifest, file));
    if (signals.length === before && file === 'package.json') {
      signals.push({ stack: 'javascript', kind: 'web-frontend', note: `${file} bulundu`, weight: 2 });
    }
  }

  for (const file of files) {
    if (/(^|\/)package\.json$/.test(file)) continue;
    const content = await readMaybe(input.read, file);
    fileSignals(file, content ?? undefined, signals);
  }

  // workspaces alanı monorepo'nun en sağlam kanıtıdır.
  const monorepo = manifests.length >= 2 || manifests.some((f) => Boolean(manifestJson.get(f)?.workspaces));

  for (const signal of signals) {
    totalWeight += signal.weight;
    if (signal.kind) kindVotes.set(signal.kind, (kindVotes.get(signal.kind) ?? 0) + signal.weight);
    if (signal.stack) stackVotes.set(signal.stack, (stackVotes.get(signal.stack) ?? 0) + signal.weight);
  }

  // Tür oylarını normalize et; mobile/desktop web oylarını bastırır çünkü
  // React Native da react sinyali üretir ama proje mobil uygulamadır.
  const mobileWeight = kindVotes.get('mobile') ?? 0;
  const desktopWeight = kindVotes.get('desktop') ?? 0;
  if (mobileWeight > 0) kindVotes.delete('fullstack');
  if (desktopWeight >= 4) kindVotes.delete('fullstack');

  const frontend = kindVotes.get('web-frontend') ?? kindVotes.get('fullstack') ?? 0;
  const backend = kindVotes.get('web-backend') ?? 0;
  if (frontend > 0 && backend > 0 && !kindVotes.has('fullstack')) {
    kindVotes.delete('web-frontend');
    kindVotes.delete('web-backend');
    kindVotes.set('fullstack', frontend + backend);
  }

  const rankedKinds = [...kindVotes.entries()]
    .filter(([kind]) => !(kind === 'web-frontend' && frontend <= 2 && backend > frontend))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([kind]) => kind);
  const primaryKind: ProjectKind = rankedKinds[0] ?? 'unknown';
  const kinds = rankedKinds.length > 0 ? rankedKinds : [primaryKind];

  const stacks = [...stackVotes.keys()].sort() as StackId[];
  const confidence = Math.min(CONFIDENCE_CAP, Math.min(totalWeight, 19) / 20);

  const evidence: string[] = [];
  evidence.push(`Tür: ${PROJECT_KIND_LABELS[primaryKind]}`);
  for (const stack of stacks.slice(0, 8)) evidence.push(`Yığın: ${stack}`);
  if (monorepo) evidence.push('Monorepo: birden fazla bağımsız manifest bulundu');

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'auto',
    kinds,
    primaryKind,
    stacks,
    monorepo,
    confidence: Math.round(confidence * 100) / 100,
    evidence
  };
}

/** Depo kökünü sınırlı derinlikte tarar; paket/çıktı klasörlerine girmez. */
export async function collectWorkspaceFiles(
  root: string,
  options: { maxFiles?: number; maxDepth?: number } = {}
): Promise<string[]> {
  const maxFiles = options.maxFiles ?? 4000;
  const maxDepth = options.maxDepth ?? 8;
  const out: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (out.length >= maxFiles || depth > maxDepth) return;
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        out.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  }

  await walk(root, 0);
  return out.sort();
}

/** Gerçek dosya sistemiyle profil üretir. */
export async function profileWorkspace(
  root: string,
  options: { maxFiles?: number } = {}
): Promise<ProjectProfile> {
  const files = await collectWorkspaceFiles(root, options);
  // İçerik yalnızca manifest adayı dosyalar için okunur; tarama ucuz kalır.
  const candidates = new Set(
    files.filter(
      (f) =>
        /(^|\/)(package\.json|composer\.json|pyproject\.toml|requirements\.txt|pom\.xml|pubspec\.yaml|schema\.prisma|project\.pbxproj|Podfile)$/.test(
          f
        ) ||
        /build\.gradle(\.kts)?$/.test(f) ||
        /\.csproj$/.test(f)
    )
  );
  const contents = new Map<string, string>();
  for (const file of [...candidates].slice(0, 60)) {
    try {
      const text = await fs.readFile(path.join(root, file), 'utf8');
      contents.set(file, text.slice(0, 200_000));
    } catch {
      // okunamayan dosya sinyal değildir.
    }
  }
  return detectProfile({
    files,
    read: async (relativePath) => contents.get(relativePath)
  });
}

/** Profili `.evren-kod/project-profile.json` yoluna yazar. */
export async function saveProfile(root: string, profile: ProjectProfile): Promise<string> {
  const target = path.join(root, EVREN_KOD_DIR, EVREN_KOD_FILES.projectProfile);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  return target;
}

/** Kayıtlı profili okur; yoksa veya bozuksa null döner. */
export async function loadProfile(root: string): Promise<ProjectProfile | null> {
  try {
    const raw = await fs.readFile(path.join(root, EVREN_KOD_DIR, EVREN_KOD_FILES.projectProfile), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const profile = parsed as Partial<ProjectProfile>;
    if (!Array.isArray(profile.kinds) || !Array.isArray(profile.stacks) || !profile.primaryKind) return null;
    return {
      version: 1,
      generatedAt: profile.generatedAt ?? new Date(0).toISOString(),
      source: profile.source === 'manual' ? 'manual' : 'auto',
      kinds: profile.kinds as ProjectKind[],
      primaryKind: profile.primaryKind as ProjectKind,
      stacks: profile.stacks as StackId[],
      monorepo: Boolean(profile.monorepo),
      confidence: typeof profile.confidence === 'number' ? profile.confidence : 0,
      evidence: Array.isArray(profile.evidence) ? profile.evidence.map(String) : []
    };
  } catch {
    return null;
  }
}

/**
 * Profil çözümleme kuralı: elle düzenlenmiş profil korunur; otomatik profil
 * yeniden taranarak tazelenir ve diske yazılır.
 */
export async function resolveProfile(
  root: string,
  options: { refresh?: boolean } = {}
): Promise<ProjectProfile> {
  const stored = await loadProfile(root);
  if (stored?.source === 'manual') return stored;
  if (stored && !options.refresh && Date.now() - Date.parse(stored.generatedAt) < 1000 * 60 * 60 * 24) {
    return stored;
  }
  const fresh = await profileWorkspace(root);
  await saveProfile(root, fresh);
  return fresh;
}
