import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  EVREN_KOD_DIR,
  EVREN_KOD_FILES,
  EVREN_KOD_SUBDIRS,
  CLIENT_NAME,
  DEFAULT_PROVIDER_URLS,
  MAX_TOOL_OUTPUT_CHARS,
  REPO_URL,
  USER_AGENT
} from '@evren-kod/core/shared/constants';
import { EXTENSION_VERSION } from '@evren-kod/core/shared/version';

const root = process.cwd();

function read(relative: string): string {
  return fs.readFileSync(path.join(root, relative), 'utf-8');
}

/** Motor paketi + CLI + eklenti konağındaki her TypeScript dosyası; sabitler
 * modülünün kendisi hariç. */
function sourceFiles(dir: string): string[] {
  const absolute = path.join(root, dir);
  const entries = fs.readdirSync(absolute, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    if (!entry.name.endsWith('.ts')) return [];
    if (relative === path.join('packages', 'core', 'src', 'shared', 'constants.ts')) return [];
    return [relative];
  });
}

/** Depo genelindeki kaynak kökler: motor, CLI ve vscode konak katmanı. */
const SOURCE_ROOTS = ['packages/core/src', 'packages/cli/src', 'src'];

function everySourceFile(): string[] {
  return SOURCE_ROOTS.flatMap((dir) => sourceFiles(dir));
}

function webviewSourceFiles(dir = 'webview-ui/src'): string[] {
  const absolute = path.join(root, dir);
  const entries = fs.readdirSync(absolute, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return webviewSourceFiles(relative);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    return [relative];
  });
}

describe('Shared constants: single source of truth', () => {
  it('client name and user agent derived from version', () => {
    assert.strictEqual(CLIENT_NAME, 'Evren');
    assert.strictEqual(USER_AGENT, `${CLIENT_NAME}/${EXTENSION_VERSION}`);
    assert.match(REPO_URL, /^https:\/\/github\.com\/ysf-bkr\/evren-kod/);
  });

  it('.evren-kod paths and file names defined in one place', () => {
    assert.strictEqual(EVREN_KOD_DIR, '.evren-kod');
    assert.strictEqual(EVREN_KOD_SUBDIRS.specs, 'specs');
    assert.strictEqual(EVREN_KOD_FILES.permissions, 'permissions.json');
  });

  it('provider addresses and output limit are constant', () => {
    assert.strictEqual(DEFAULT_PROVIDER_URLS.ollama, 'http://localhost:11434');
    assert.strictEqual(DEFAULT_PROVIDER_URLS.lmstudio, 'http://localhost:1234/v1');
    assert.strictEqual(MAX_TOOL_OUTPUT_CHARS, 15_000);
  });

  it('no module hardcodes .evren-kod path', () => {
    const offenders = everySourceFile().filter((file) => /path\.join\([^)]*'\.evren-kod'/.test(read(file)));
    assert.deepEqual(offenders, [], `.evren-kod path hardcoded: ${offenders.join(', ')}`);
  });

  it('no module hardcodes a client version', () => {
    const offenders = everySourceFile().filter((file) => /Evren\/\d+\.\d+/.test(read(file)));
    assert.deepEqual(offenders, [], `Hardcoded version: ${offenders.join(', ')}`);
  });

  it('provider addresses are not copied to modules', () => {
    const offenders = everySourceFile().filter((file) => /localhost:(11434|1234)/.test(read(file)));
    assert.deepEqual(offenders, [], `Provider address hardcoded: ${offenders.join(', ')}`);
  });
});

describe('Typography: single scale', () => {
  const css = read('webview-ui/src/index.css');

  it('removed very small size does not return', () => {
    assert.doesNotMatch(css, /--evren-kod-text-3xs/);
    assert.doesNotMatch(css, /evren-kod-text-3xs/);
  });

  it('custom evren-kod-text-* typography class not used in components', () => {
    const typographyClassRegex = /\bevren-kod-text-(?:3xs|2xs|xs|sm|md|lg|xl)\b/;
    const offenders = webviewSourceFiles().filter((file) => typographyClassRegex.test(read(file)));
    assert.deepEqual(offenders, [], `Old typography class: ${offenders.join(', ')}`);
  });

  it('Tailwind sizes match CSS token names', () => {
    const config = read('webview-ui/tailwind.config.js');
    for (const token of ['2xs', 'xs', 'sm', 'md']) {
      assert.match(css, new RegExp(`--evren-kod-text-${token}:`), `CSS token missing: ${token}`);
    }
    assert.match(config, /'2xs'/);
    assert.match(config, /--evren-kod-text-2xs/);
  });
});

describe('Brand assets', () => {
  it('packaged icons exist and are valid', () => {
    assert.ok(fs.existsSync(path.join(root, 'resources/icon.png')));
    assert.ok(fs.existsSync(path.join(root, 'resources/logo.svg')));
    assert.ok(fs.existsSync(path.join(root, 'resources/logo.png')));
    assert.ok(fs.existsSync(path.join(root, 'resources/icon.svg')));
    assert.ok(fs.existsSync(path.join(root, 'resources/icon-color.svg')));

    const manifest = JSON.parse(read('package.json')) as {
      icon?: string;
      contributes?: { viewsContainers?: { secondarySidebar?: Array<{ icon?: string }> } };
    };
    assert.strictEqual(manifest.icon, 'resources/icon.png');
    assert.strictEqual(
      manifest.contributes?.viewsContainers?.secondarySidebar?.[0]?.icon,
      'resources/icon.svg'
    );
  });

  it('uses monochrome icon theme color', () => {
    const svg = read('resources/icon.svg');
    assert.match(svg, /"currentColor"/, 'Amblem tema rengini miras almalı (fill ya da stroke)');
    assert.doesNotMatch(svg, /#[0-9a-fA-F]{6}/, 'Activity bar icon must not have color coding');
  });

  it('README logo is Marketplace-safe and theme variants exist', () => {
    const readme = read('README.md');
    // VS Code Marketplacesi <picture>/<source> etiketlerini siler ve göreli
    // yolları çözümlemez; bu yüzden başlık logosu tek bir MUTLAK https adresi
    // olmalı ve adres, hem açık hem koyu zeminde okunan tema-nötr logoyu göstermeli.
    const logo = readme.match(/<img\s+[^>]*src="(https:\/\/raw\.githubusercontent\.com\/[^"]+)"/);
    assert.ok(logo, 'README logosu mutlak https adresi olmalı (Marketplace göreli yolu çözemez)');
    assert.ok(/logo-safe/.test(logo[1]!), 'Marketplace yedek logosu tema-nötr olmalı');
    // Adres deposundaki gerçek bir varlığa işaret etmeli; ayrıca açık/koyu tema
    // varyantları marka kütüphanesinde durmaya devam etmeli.
    const file = logo[1]!.slice(logo[1]!.lastIndexOf('/') + 1);
    assert.ok(fs.existsSync(path.join(root, 'resources', file)), `Eksik marka varlığı: ${file}`);
    for (const variant of ['logo.png', 'logo-dark.png', 'logo-safe.png']) {
      assert.ok(fs.existsSync(path.join(root, 'resources', variant)), `Eksik tema varyantı: ${variant}`);
    }
    // Eski <picture> düzeni geri gelmesin: Marketplace onu sessizce düşürür.
    assert.doesNotMatch(readme, /<picture>/, 'README başlığında <picture> kullanılamaz (Marketplace siler)');
  });

  it('webview logo uses the monochrome-safe brand mark', () => {
    const logo = read('webview-ui/src/components/common/Logo.tsx');
    // Marka geometrisi tek bileşik yoldur; dışa aktarılan içe gömülü görsel yok.
    assert.match(logo, /fillRule="evenodd"/);
    assert.doesNotMatch(logo, /<image\b/, 'Logo bileşeni raster görsel gömmemeli');
  });
});

describe('Module graph: layering rules', () => {
  interface Edge {
    from: string;
    to: string;
    typeOnly: boolean;
  }

  function allSourceFiles(dir?: string): string[] {
    const roots = dir ? [dir] : SOURCE_ROOTS;
    return roots.flatMap((sourceRoot) => sourceFiles(sourceRoot)).map((file) => file.replace(/\\/g, '/'));
  }

  function resolveRelative(from: string, specifier: string): string | undefined {
    if (specifier.startsWith('@evren-kod/core/')) {
      const base = `packages/core/src/${specifier.slice('@evren-kod/core/'.length)}`;
      for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
        if (fs.existsSync(path.join(root, candidate))) return candidate;
      }
      return undefined;
    }
    if (!specifier.startsWith('.')) return undefined;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (fs.existsSync(path.join(root, candidate))) return candidate;
    }
    return undefined;
  }

  function edges(): Edge[] {
    const result: Edge[] = [];
    for (const from of allSourceFiles()) {
      const source = read(from);
      const pattern = /(?:^|\n)\s*(import|export)\s+(type\s+)?([\s\S]*?)from\s+['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        const typeOnly = Boolean(match[2]) || /^\s*type\s/.test(match[3] ?? '');
        const to = resolveRelative(from, match[4] ?? '');
        if (to) result.push({ from, to, typeOnly });
      }
    }
    return result;
  }

  it('has no import cycles', () => {
    const graph = new Map<string, string[]>();
    for (const edge of edges()) {
      if (edge.typeOnly) continue;
      const list = graph.get(edge.from) ?? [];
      list.push(edge.to);
      graph.set(edge.from, list);
    }

    const state = new Map<string, 'visiting' | 'visited'>();
    const stack: string[] = [];
    const cycles: string[] = [];

    const visit = (node: string): void => {
      state.set(node, 'visiting');
      stack.push(node);
      for (const next of graph.get(node) ?? []) {
        const current = state.get(next);
        if (current === 'visiting') {
          cycles.push([...stack.slice(stack.indexOf(next)), next].join(' -> '));
        } else if (!current) {
          visit(next);
        }
      }
      stack.pop();
      state.set(node, 'visited');
    };

    for (const file of graph.keys()) {
      if (!state.has(file)) visit(file);
    }

    assert.deepEqual(cycles, [], `Import cycle detected:\n${cycles.join('\n')}`);
  });

  it('tools do not value-import vscode-dependent core modules', () => {
    // Araçlar VS Code ana bilgisayarı olmadan (CLI) çalışabilmelidir. Değer
    // importu `vscode`a zincirlenirse CLI ve birim testleri kırılır; tip
    // importları derlemede silindiği için serbesttir.
    const vscodeFiles = new Set(allSourceFiles().filter((file) => /from ['"]vscode['"]/.test(read(file))));

    const dependents = new Map<string, string[]>();
    for (const edge of edges()) {
      if (edge.typeOnly) continue;
      const list = dependents.get(edge.from) ?? [];
      list.push(edge.to);
      dependents.set(edge.from, list);
    }

    const reachesVscode = (start: string): string[] => {
      const seen = new Set<string>();
      const queue = [start];
      const hits: string[] = [];
      while (queue.length > 0) {
        const current = queue.pop();
        if (!current || seen.has(current)) continue;
        seen.add(current);
        if (vscodeFiles.has(current)) {
          hits.push(current);
          continue;
        }
        queue.push(...(dependents.get(current) ?? []));
      }
      return hits;
    };

    const offenders = allSourceFiles('packages/core/src/tools').filter(
      (file) => reachesVscode(file).length > 0
    );
    assert.deepEqual(offenders, [], `Tool module pulls in vscode: ${offenders.join(', ')}`);
  });

  it('agent tool lists reference real tools', () => {
    // Tanımlardaki araç adları `ToolName` birleşimiyle uyuşmazsa model
    // çağrı yapar, yürütücü "bilinmeyen araç" döner. Bu sessiz bozulmayı
    // derleme yakalamaz; burada yakalanır.
    const toolNames = new Set(
      [
        ...read('packages/core/src/shared/types.ts')
          .split('export type ToolName =')[1]!
          .split(';')[0]!
          .matchAll(/'([^']+)'/g)
      ].map((match) => match[1])
    );

    const offenders: string[] = [];
    for (const file of allSourceFiles('packages/core/src/shared/agents/registry')) {
      const toolsBlock = read(file).match(/tools: \[([\s\S]*?)\]/);
      if (!toolsBlock) continue;
      for (const match of toolsBlock[1]!.matchAll(/'([^']+)'/g)) {
        if (!toolNames.has(match[1]!)) offenders.push(`${file}: ${match[1]}`);
      }
    }

    assert.deepEqual(offenders, [], `Unknown tool names in agent definitions: ${offenders.join(', ')}`);
  });

  it('the orchestrator can delegate', () => {
    // Yönetici ajanın işi devretmek; araç listesinde delege araçları yoksa
    // "manager" yalnızca kıdemli bir işçi olur.
    const managerTools = read('packages/core/src/shared/agents/registry/manager.ts');
    assert.match(managerTools, /'invoke_subagent'/);
    assert.match(managerTools, /'run_parallel_tasks'/);
  });

  it('tools only value-import pure core modules', () => {
    // Araçlar çekirdeğe yalnızca saf (vscode'suz, yan etkisiz) yardımcılar için
    // bağlanabilir. Yeni bir değer importu eklenirse burada bilinçli olarak
    // listelenmeli; aksi hâlde araç katmanı çekirdeğin içine sızar.
    const ALLOWED = new Set([
      'packages/core/src/core/callgraph/query.ts', // saf sorgu fonksiyonları
      // Bilgi grafının saf katmanı: disk okumaz, model çağırmaz, durum tutmaz.
      'packages/core/src/core/graph/relations.ts',
      'packages/core/src/core/graph/architecture.ts',
      'packages/core/src/core/graph/render.ts',
      'packages/core/src/core/verification/CommandRunner.ts' // süreç yürütme ilkelleri
    ]);

    const offenders = edges()
      .filter((edge) => !edge.typeOnly)
      .filter(
        (edge) =>
          edge.from.startsWith('packages/core/src/tools/') && edge.to.startsWith('packages/core/src/core/')
      )
      .filter((edge) => !ALLOWED.has(edge.to))
      .map((edge) => `${edge.from} -> ${edge.to}`);

    assert.deepEqual(offenders, [], `Tool layer value-imports core: ${offenders.join(', ')}`);
  });

  it('providers depend on tool types, not on the tool registry', () => {
    const offenders = edges()
      .filter((edge) => !edge.typeOnly)
      .filter(
        (edge) =>
          edge.from.startsWith('packages/core/src/providers/') &&
          edge.to.startsWith('packages/core/src/tools/')
      )
      .map((edge) => `${edge.from} -> ${edge.to}`);

    assert.deepEqual(offenders, [], `Provider layer value-imports tools: ${offenders.join(', ')}`);
  });

  it('core package stays free of vscode and the extension host', () => {
    // Motor paketi terminalde de yaşayacak: vscode modülüne veya eklenti
    // konağının (src/) herhangi bir dosyasına uzanan kenar bu sözleşmeyi kırar.
    const coreFiles = allSourceFiles('packages/core/src');
    const vscodeFiles = coreFiles.filter((file) => /from ['"]vscode['"]/.test(read(file)));
    assert.deepEqual(vscodeFiles, [], `Core paket vscode import ediyor: ${vscodeFiles.join(', ')}`);

    const escapees = edges()
      .filter((edge) => edge.from.startsWith('packages/core/'))
      .filter((edge) => edge.to.startsWith('src/') || edge.to.startsWith('packages/cli/'))
      .map((edge) => `${edge.from} -> ${edge.to}`);
    assert.deepEqual(escapees, [], `Core paket konağa/CLI'ya sızıyor: ${escapees.join(', ')}`);
  });

  it('cli package rides only on the core engine', () => {
    const cliFiles = allSourceFiles('packages/cli/src');
    const vscodeFiles = cliFiles.filter((file) => /from ['"]vscode['"]/.test(read(file)));
    assert.deepEqual(vscodeFiles, [], `CLI vscode import ediyor: ${vscodeFiles.join(', ')}`);

    const escapees = edges()
      .filter((edge) => edge.from.startsWith('packages/cli/'))
      .filter((edge) => edge.to.startsWith('src/'))
      .map((edge) => `${edge.from} -> ${edge.to}`);
    assert.deepEqual(escapees, [], `CLI eklenti konağına bağımlı: ${escapees.join(', ')}`);
  });
});

/**
 * Denetleyiciler tek bir dev `AgentHost` yerine kendi dar portlarına bağlanır.
 * Bu test, refactor'ın sessizce geri dönmesini engeller: bir denetleyici
 * yeniden `AgentHost` import ederse imza genişler ve bağımlılık görünmez olur.
 */
describe('Agent host portları: her denetleyici kendi dar yüzeyine bağlı', () => {
  const EXPECTED: Array<[file: string, port: string]> = [
    ['src/core/agent/workflowController.ts', 'WorkflowHost'],
    ['src/core/agent/sessionController.ts', 'SessionHost'],
    ['src/core/agent/toolPipelineController.ts', 'ToolPipelineHost'],
    ['src/core/agent/verificationController.ts', 'VerificationHost'],
    ['src/core/agent/agentLoop.ts', 'AgentLoopHost']
  ];

  it('denetleyiciler AgentHost yerine kendi portunu import eder', () => {
    for (const [file, port] of EXPECTED) {
      const source = read(file);
      assert.match(
        source,
        new RegExp(`import type \\{[^}]*\\b${port}\\b[^}]*\\} from '\\./agentHost'`),
        `${file} ${port} import etmeli`
      );
      assert.doesNotMatch(
        source,
        /import type \{[^}]*\bAgentHost\b[^}]*\} from '\.\/agentHost'/,
        `${file} yeniden tam AgentHost import etmemeli`
      );
    }
  });

  it('AgentHost portların birleşimidir; portlar ortak tabandan türer', () => {
    const source = read('src/core/agent/agentHost.ts');
    for (const port of [
      'WorkflowHost',
      'SessionHost',
      'ToolPipelineHost',
      'AgentLoopHost',
      'VerificationHost'
    ]) {
      assert.match(
        source,
        new RegExp(`export interface ${port} extends AgentHostBase`),
        `${port} tabandan türemeli`
      );
    }
    assert.match(source, /export interface AgentHost\s+extends[\s\S]*?WorkflowHost[\s\S]*?VerificationHost/);
  });

  it('denetleyicilerde bracket ile private alan erişimi kalmaz', () => {
    const offenders = EXPECTED.map(([file]) => file).filter((file) =>
      /\bcore\['[a-zA-Z]+'\]|host\['[a-zA-Z]+'\]/.test(read(file))
    );
    assert.deepEqual(offenders, [], `Bracket erişimi kalan dosyalar: ${offenders.join(', ')}`);
  });
});
