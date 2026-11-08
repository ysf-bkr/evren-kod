/**
 * Evren Kod Bağımsız Terminal Ajanı (CLI / REPL).
 *
 * VS Code'a ihtiyaç duymadan, doğrudan terminal üzerinde tam ReAct döngüsünü,
 * araç çalıştırmayı, oturum hafızasını ve proje yönetimini yürütür.
 */
import * as path from 'path';
import process from 'process';
import { createInterface } from 'readline/promises';
import { TerminalAgent, TERMINAL_TOOLS, TerminalTurnResult } from '@evren-kod/core/core/agent/TerminalAgent';
import { loadSettings, saveSettings } from '@evren-kod/core/core/settings/SettingsStorage';
import { ModelProviderType, ToolName, UserSettings } from '@evren-kod/core/shared/types';
import { TOOL_TITLES } from '@evren-kod/core/shared/toolLabels';
import { errorMessage } from '@evren-kod/core/shared/errors';
import { EXTENSION_VERSION } from '@evren-kod/core/shared/version';

export const CLI_TOOLS = new Set<ToolName>(TERMINAL_TOOLS);

export const READ_ONLY_TOOLS = new Set<ToolName>([
  'read_file',
  'search_files',
  'list_directory',
  'git_status',
  'git_diff',
  'read_skill',
  'update_plan',
  'index_workspace',
  'find_symbol',
  'analyze_impact',
  'prepare_pr',
  'search_memory',
  'read_notebook',
  'web_fetch',
  'web_search'
]);

export interface CliOptions {
  prompt: string;
  workspace: string;
  provider: ModelProviderType;
  model: string;
  apiKey: string;
  maxSteps: number;
  yes: boolean;
  readOnly: boolean;
}

function usage(): string {
  return [
    `Evren Kod CLI v${EXTENSION_VERSION}`,
    '',
    'Kullanım:',
    '  evren-kod --prompt "Görev" [seçenekler]   Tek seferlik görev çalıştır',
    '  evren-kod                                 Etkileşimli terminal sohbeti (exit ile çık)',
    '',
    'Seçenekler:',
    '  --workspace <yol>    Çalışma alanı (varsayılan: cwd)',
    '  --provider <ad>      evren | ollama | openrouter | openai-compatible',
    '  --model <id>         Model kimliği',
    '  --api-key <anahtar>  API anahtarı (ortam değişkenleri de desteklenir)',
    '  --max-steps <sayı>   Maksimum adım sayısı (varsayılan: 30)',
    '  --yes                Onay gerektiren işlemleri otomatik onayla',
    '  --read-only          Yalnızca salt-okunur araçları etkinleştir',
    '  --help               Bu yardım mesajını göster',
    '',
    'Etkileşimli Komutlar:',
    '  /yardim, /help       Komut listesini göster',
    '  /model <id>          Modeli değiştir',
    '  /saglayici <ad>      Model sağlayıcısını değiştir',
    '  /anahtar <ad> <key>  API anahtarını kaydet',
    '  /durum, /status      Git, model ve tüketim durumunu göster',
    '  /dogrula, /verify    Proje test ve lint kontrollerini koştur',
    '  /temizle, /clear     Sohbet geçmişini ve ekranı temizle',
    '  exit, quit, /cikis   Oturumdan çık'
  ].join('\n');
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    prompt: '',
    workspace: process.cwd(),
    provider: 'ollama',
    model: '',
    apiKey: '',
    maxSteps: 30,
    yes: false,
    readOnly: false
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? '';
    const next = argv[index + 1];
    switch (arg) {
      case '--prompt':
        options.prompt = next || '';
        index++;
        break;
      case '--workspace':
        options.workspace = path.resolve(next || '.');
        index++;
        break;
      case '--provider': {
        const provider = next as ModelProviderType;
        if (
          provider === 'evren' ||
          provider === 'openrouter' ||
          provider === 'ollama' ||
          provider === 'openai-compatible'
        ) {
          options.provider = provider;
        }
        index++;
        break;
      }
      case '--model':
        options.model = next || options.model;
        index++;
        break;
      case '--api-key':
        options.apiKey = next || '';
        index++;
        process.stderr.write(
          'Warning: --api-key is visible in shell history and the process list. ' +
            'Prefer the provider-specific environment variable instead.\n'
        );
        break;
      case '--max-steps':
        options.maxSteps = Math.max(1, Number(next) || 30);
        index++;
        break;
      case '--yes':
        options.yes = true;
        break;
      case '--read-only':
        options.readOnly = true;
        break;
      case '--help':
      case '-h':
        process.stdout.write(`${usage()}\n`);
        process.exit(0);
        break;
      default:
        if (!arg.startsWith('-') && !options.prompt) options.prompt = arg;
        break;
    }
  }

  if (!options.prompt.trim() && !process.stdin.isTTY) {
    throw new Error(`--prompt is required.\n\n${usage()}`);
  }

  const providerKeyEnv =
    options.provider === 'evren'
      ? process.env.EVREN_API_KEY
      : options.provider === 'openrouter'
        ? process.env.OPENROUTER_API_KEY
        : options.provider === 'openai-compatible'
          ? process.env.OPENAI_COMPATIBLE_API_KEY
          : undefined;
  options.apiKey = options.apiKey || providerKeyEnv || '';
  return options;
}

export function buildSettings(options: CliOptions): UserSettings {
  const loaded = loadSettings(options.workspace);
  const defaultModelForProvider =
    options.provider === 'evren'
      ? 'auto'
      : options.provider === 'ollama'
        ? 'llama3.1'
        : options.provider === 'openrouter'
          ? 'anthropic/claude-3.5-sonnet'
          : '';

  const selectedModel =
    options.model.trim() ||
    (options.provider === loaded.selectedProvider ? loaded.selectedModel : undefined) ||
    defaultModelForProvider;

  return {
    ...loaded,
    selectedProvider: options.provider,
    selectedModel,
    apiKeys: {
      ...loaded.apiKeys,
      evren: options.provider === 'evren' && options.apiKey ? options.apiKey : loaded.apiKeys.evren,
      openrouter:
        options.provider === 'openrouter' && options.apiKey ? options.apiKey : loaded.apiKeys.openrouter,
      openaiCompatible:
        options.provider === 'openai-compatible' && options.apiKey
          ? options.apiKey
          : loaded.apiKeys.openaiCompatible
    },
    autoApprove: {
      ...loaded.autoApprove,
      readFiles: true,
      writeFiles: options.yes || loaded.autoApprove.writeFiles,
      executeCommands: options.yes || loaded.autoApprove.executeCommands
    },
    maxStepsPerTask: options.maxSteps
  };
}

let sharedReadline: ReturnType<typeof createInterface> | undefined;
function getReadline(): ReturnType<typeof createInterface> {
  if (!sharedReadline) {
    sharedReadline = createInterface({ input: process.stdin, output: process.stdout });
  }
  return sharedReadline;
}

async function askApproval(question: string): Promise<boolean> {
  const answer = (await getReadline().question(`\x1b[33m${question} [e/H]\x1b[0m `)).trim().toLowerCase();
  return answer === 'e' || answer === 'evet' || answer === 'y' || answer === 'yes';
}

function printBanner(agent: TerminalAgent): void {
  const c = {
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    reset: '\x1b[0m'
  };
  const provider = agent.settings.selectedProvider;
  const model = agent.settings.selectedModel;
  const ws = agent.workspaceRoot;

  process.stdout.write(
    `\n${c.cyan}${c.bold}🌌 Evren Kod v${EXTENSION_VERSION} — Bağımsız Terminal Geliştirme Ajanı${c.reset}\n`
  );
  process.stdout.write(`${c.dim}Çalışma Alanı : ${ws}${c.reset}\n`);
  process.stdout.write(
    `${c.dim}Sağlayıcı     : ${c.green}${provider}${c.reset} ${c.dim}(${model})${c.reset}\n`
  );
  process.stdout.write(`${c.dim}Yardım için: /yardim · Çıkış için: exit${c.reset}\n\n`);
}

function printUsage(agent: TerminalAgent): void {
  const u = agent.usage;
  if (u.total === 0 && u.requests === 0) return;
  const dim = '\x1b[2m';
  const reset = '\x1b[0m';
  process.stdout.write(
    `\n${dim}— Tüketim: ${u.total.toLocaleString('tr-TR')} token ` +
      `(giden ${u.prompt.toLocaleString('tr-TR')} · gelen ${u.completion.toLocaleString('tr-TR')}` +
      (u.cached > 0 ? ` · önbellek ${u.cached.toLocaleString('tr-TR')}` : '') +
      `; ${u.requests} istek)${reset}\n`
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const settings = buildSettings(options);

  const agent = new TerminalAgent({
    workspaceRoot: options.workspace,
    settings,
    readOnly: options.readOnly,
    maxSteps: options.maxSteps
  });

  await agent.init();

  const c = {
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    reset: '\x1b[0m'
  };

  const executeTurn = async (promptText: string): Promise<TerminalTurnResult> => {
    return agent.runTurn(promptText, {
      onToken: (chunk) => {
        process.stdout.write(chunk);
      },
      onToolStart: (name, args) => {
        const title = TOOL_TITLES[name] || name;
        let preview = '';
        if (typeof args?.path === 'string') preview = ` · ${args.path}`;
        else if (typeof args?.command === 'string') preview = ` · ${args.command}`;
        else if (typeof args?.query === 'string') preview = ` · ${args.query}`;
        process.stdout.write(`\n${c.cyan}[Araç: ${title}]${c.reset}${c.dim}${preview}${c.reset}\n`);
      },
      onToolComplete: (name, output, ok) => {
        const title = TOOL_TITLES[name] || name;
        if (ok) {
          process.stdout.write(`${c.green}✓ [${title}] Tamamlandı${c.reset}\n`);
        } else {
          process.stdout.write(`${c.red}✗ [${title}] Hata:${c.reset} ${output.slice(0, 300)}\n`);
        }
      },
      onApprovalRequest: async (question) => {
        return askApproval(`[Onay Gerekli] ${question}`);
      },
      onRepetition: () => {
        process.stdout.write(`\n${c.yellow}⚠ Model tekrara girdi; yanıt kesildi.${c.reset}\n`);
      }
    });
  };

  // Tek seferlik görev modu
  if (options.prompt.trim()) {
    const result = await executeTurn(options.prompt);
    process.stdout.write('\n');
    printUsage(agent);
    sharedReadline?.close();
    if (!result.completed) {
      process.exit(1);
    }
    return;
  }

  // Etkileşimli REPL sohbet modu
  printBanner(agent);

  for (;;) {
    const line = (await getReadline().question(`${c.cyan}${c.bold}evren>${c.reset} `)).trim();
    if (!line) continue;

    if (/^(exit|quit|\/exit|\/q|\/cikis)$/i.test(line)) {
      process.stdout.write('Görüşmek üzere!\n');
      break;
    }

    // Eğik çizgi komutları
    if (line.startsWith('/')) {
      const parts = line.split(/\s+/);
      const cmd = (parts[0] || '').toLowerCase();
      const arg = parts.slice(1).join(' ').trim();

      if (cmd === '/yardim' || cmd === '/help') {
        process.stdout.write(`${usage()}\n\n`);
        continue;
      }

      if (cmd === '/model') {
        if (!arg) {
          process.stdout.write(`Mevcut model: ${c.green}${agent.settings.selectedModel}${c.reset}\n`);
        } else {
          agent.switchModel(arg);
          await saveSettings({ selectedModel: arg }, { workspaceRoot: agent.workspaceRoot });
          process.stdout.write(`Model güncellendi: ${c.green}${arg}${c.reset}\n`);
        }
        continue;
      }

      if (cmd === '/saglayici' || cmd === '/provider') {
        if (!arg) {
          process.stdout.write(`Mevcut sağlayıcı: ${c.green}${agent.settings.selectedProvider}${c.reset}\n`);
        } else {
          const prov = arg.toLowerCase() as ModelProviderType;
          agent.switchProvider(prov);
          await saveSettings({ selectedProvider: prov }, { workspaceRoot: agent.workspaceRoot });
          process.stdout.write(`Sağlayıcı güncellendi: ${c.green}${prov}${c.reset}\n`);
        }
        continue;
      }

      if (cmd === '/anahtar' || cmd === '/key') {
        const [targetProv, targetKey] = parts.slice(1);
        if (!targetProv || !targetKey) {
          process.stdout.write('Kullanım: /anahtar <evren|openrouter|openai-compatible> <api_anahtarı>\n');
        } else {
          const provKey = targetProv === 'openai-compatible' ? 'openaiCompatible' : targetProv;
          await saveSettings({ apiKeys: { [provKey]: targetKey } }, { workspaceRoot: agent.workspaceRoot });
          agent.switchProvider(targetProv as ModelProviderType);
          process.stdout.write(`API anahtarı kaydedildi (${targetProv}).\n`);
        }
        continue;
      }

      if (cmd === '/durum' || cmd === '/status') {
        process.stdout.write(`\n${c.bold}Çalışma Alanı:${c.reset} ${agent.workspaceRoot}\n`);
        process.stdout.write(`${c.bold}Sağlayıcı    :${c.reset} ${agent.settings.selectedProvider}\n`);
        process.stdout.write(`${c.bold}Model        :${c.reset} ${agent.settings.selectedModel}\n`);
        printUsage(agent);
        try {
          const status = await agent.getGitStatus();
          process.stdout.write(`\n${c.bold}Git Durumu:${c.reset}\n${status || 'Temiz ağaç'}\n`);
        } catch {
          // Git yoksa atla
        }
        continue;
      }

      if (cmd === '/dogrula' || cmd === '/verify') {
        process.stdout.write(`${c.cyan}Doğrulama (test ve linter) koşturuluyor...${c.reset}\n`);
        try {
          const v = await agent.runVerification();
          if (v.status === 'passed') {
            process.stdout.write(`${c.green}✓ Doğrulama başarılı! (${v.summary})${c.reset}\n`);
          } else if (v.status === 'skipped') {
            process.stdout.write(`${c.dim}Doğrulama atlandı: ${v.skippedReason}${c.reset}\n`);
          } else {
            process.stdout.write(`${c.red}✗ Doğrulama başarısız:${c.reset} ${v.summary}\n`);
          }
        } catch (err) {
          process.stdout.write(`${c.red}Hata:${c.reset} ${errorMessage(err)}\n`);
        }
        continue;
      }

      if (cmd === '/temizle' || cmd === '/clear') {
        await agent.clearHistory();
        console.clear();
        printBanner(agent);
        process.stdout.write('Sohbet geçmişi ve ekran temizlendi.\n');
        continue;
      }

      process.stdout.write(`Bilinmeyen komut: ${cmd}. Yardım için: /yardim\n`);
      continue;
    }

    try {
      const turnResult = await executeTurn(line);
      process.stdout.write('\n');
      if (!turnResult.completed) {
        process.stdout.write(`${c.yellow}Görev tamamlanamadı veya limit aşıldı.${c.reset}\n`);
      }
    } catch (err) {
      process.stdout.write(`\n${c.red}Hata:${c.reset} ${errorMessage(err)}\n`);
    }
  }

  sharedReadline?.close();
  printUsage(agent);
}

function isMainModule(): boolean {
  if (typeof process === 'undefined' || !process.argv[1]) return false;
  const script = process.argv[1].replace(/\\/g, '/');
  return (
    (script.endsWith('/cli.ts') ||
      script.endsWith('/cli.js') ||
      script.endsWith('/index.ts') ||
      script.endsWith('/index.js') ||
      script.endsWith('/evren-kod')) &&
    !process.argv.includes('--test')
  );
}

if (isMainModule()) {
  main().catch((error) => {
    process.stderr.write(`Evren CLI error: ${errorMessage(error)}\n`);
    process.exit(1);
  });
}
