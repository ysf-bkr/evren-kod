/**
 * Dosya tabanlı ayar depolama yöneticisi (VS Code bağımsız).
 *
 * Hem CLI hem de eklenti ve uçtan uca testler tarafından kullanılır.
 * Ayarlar sırasıyla birleştirilir:
 * 1. DEFAULT_USER_SETTINGS
 * 2. Global kullanıcı ayarları (~/.evren-kod/settings.json)
 * 3. Çalışma alanı ayarları (<workspace>/.evren-kod/settings.json)
 * 4. Çevre değişkenleri (EVREN_API_KEY, OPENROUTER_API_KEY, vb.)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ModelProviderType, UserSettings } from '../../shared/types';
import { DEFAULT_USER_SETTINGS, EVREN_KOD_DIR, VALID_PROVIDERS } from '../../shared/constants';

/** Global kullanıcı ayar dosyasının yolu (~/.evren-kod/settings.json). */
export function getGlobalSettingsPath(): string {
  return path.join(os.homedir(), EVREN_KOD_DIR, 'settings.json');
}

/** Çalışma alanı ayar dosyasının yolu (<workspace>/.evren-kod/settings.json). */
export function getWorkspaceSettingsPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, EVREN_KOD_DIR, 'settings.json');
}

/** JSON dosyasını güvenle okur; yoksa veya bozuksa boş nesne döner. */
function readJsonFile<T>(filePath: string): Partial<T> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) return {};
    return JSON.parse(content) as Partial<T>;
  } catch {
    return {};
  }
}

/** Çevre değişkenlerinden API anahtarlarını ve uç noktaları toplar. */
export function readEnvOverrides(): {
  provider?: ModelProviderType;
  model?: string;
  apiKeys: Partial<UserSettings['apiKeys']>;
  ollamaBaseUrl?: string;
  openAiCompatibleBaseUrl?: string;
} {
  const env = process.env;
  const apiKeys: Partial<UserSettings['apiKeys']> = {};

  if (env.EVREN_API_KEY) apiKeys.evren = env.EVREN_API_KEY.trim();
  if (env.OPENROUTER_API_KEY) apiKeys.openrouter = env.OPENROUTER_API_KEY.trim();
  if (env.OPENAI_COMPATIBLE_API_KEY) apiKeys.openaiCompatible = env.OPENAI_COMPATIBLE_API_KEY.trim();

  let provider: ModelProviderType | undefined;
  const envProvider = env.EVREN_PROVIDER?.toLowerCase();
  if (envProvider && (VALID_PROVIDERS as readonly string[]).includes(envProvider)) {
    provider = envProvider as ModelProviderType;
  }

  return {
    provider,
    model: env.EVREN_MODEL?.trim() || undefined,
    apiKeys,
    ollamaBaseUrl: env.OLLAMA_BASE_URL?.trim() || undefined,
    openAiCompatibleBaseUrl: env.OPENAI_COMPATIBLE_BASE_URL?.trim() || undefined
  };
}

/**
 * Ayarları diskteki dosyalardan ve çevre değişkenlerinden yükler.
 */
export function loadSettings(workspaceRoot?: string, overrides?: Partial<UserSettings>): UserSettings {
  const globalPath = getGlobalSettingsPath();
  const globalData = readJsonFile<UserSettings>(globalPath);

  const workspaceData = workspaceRoot
    ? readJsonFile<UserSettings>(getWorkspaceSettingsPath(workspaceRoot))
    : {};

  const envOverrides = readEnvOverrides();

  // Birleştirme önceliği: varsayılanlar -> global dosya -> çalışma alanı -> env -> parametre overrides
  const selectedProvider = (overrides?.selectedProvider ||
    envOverrides.provider ||
    workspaceData.selectedProvider ||
    globalData.selectedProvider ||
    DEFAULT_USER_SETTINGS.selectedProvider) as ModelProviderType;

  const defaultModelForProvider =
    selectedProvider === 'evren'
      ? 'auto'
      : selectedProvider === 'ollama'
        ? 'llama3.1'
        : selectedProvider === 'openrouter'
          ? 'anthropic/claude-3.5-sonnet'
          : '';

  const selectedModel =
    overrides?.selectedModel ||
    envOverrides.model ||
    workspaceData.selectedModel ||
    globalData.selectedModel ||
    defaultModelForProvider ||
    DEFAULT_USER_SETTINGS.selectedModel;

  const apiKeys: UserSettings['apiKeys'] = {
    ...DEFAULT_USER_SETTINGS.apiKeys,
    ...globalData.apiKeys,
    ...workspaceData.apiKeys,
    ...envOverrides.apiKeys,
    ...overrides?.apiKeys
  };

  const autoApprove = {
    ...DEFAULT_USER_SETTINGS.autoApprove,
    ...globalData.autoApprove,
    ...workspaceData.autoApprove,
    ...overrides?.autoApprove
  };

  return {
    ...DEFAULT_USER_SETTINGS,
    ...globalData,
    ...workspaceData,
    ...overrides,
    selectedProvider,
    selectedModel,
    apiKeys,
    autoApprove,
    ollamaBaseUrl:
      overrides?.ollamaBaseUrl ||
      envOverrides.ollamaBaseUrl ||
      workspaceData.ollamaBaseUrl ||
      globalData.ollamaBaseUrl ||
      DEFAULT_USER_SETTINGS.ollamaBaseUrl,
    openAiCompatibleBaseUrl:
      overrides?.openAiCompatibleBaseUrl ||
      envOverrides.openAiCompatibleBaseUrl ||
      workspaceData.openAiCompatibleBaseUrl ||
      globalData.openAiCompatibleBaseUrl ||
      DEFAULT_USER_SETTINGS.openAiCompatibleBaseUrl
  };
}

/**
 * Ayarları diskteki ayar dosyasına (global veya çalışma alanı) kaydeder.
 */
export async function saveSettings(
  settings: Partial<UserSettings>,
  options?: { workspaceRoot?: string; global?: boolean }
): Promise<string> {
  const targetPath =
    options?.global || !options?.workspaceRoot
      ? getGlobalSettingsPath()
      : getWorkspaceSettingsPath(options.workspaceRoot);

  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const existing = readJsonFile<UserSettings>(targetPath);
  const merged = { ...existing, ...settings };

  fs.writeFileSync(targetPath, JSON.stringify(merged, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600
  });

  return targetPath;
}

/** Sağlayıcı için etkin API anahtarını döner. */
export function resolveApiKey(provider: ModelProviderType, settings: UserSettings): string {
  switch (provider) {
    case 'evren':
      return (settings.apiKeys.evren || process.env.EVREN_API_KEY || '').trim();
    case 'openrouter':
      return (settings.apiKeys.openrouter || process.env.OPENROUTER_API_KEY || '').trim();
    case 'openai-compatible':
      return (settings.apiKeys.openaiCompatible || process.env.OPENAI_COMPATIBLE_API_KEY || '').trim();
    default:
      return '';
  }
}
