import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadSettings,
  saveSettings,
  resolveApiKey,
  getWorkspaceSettingsPath
} from '@evren-kod/core/core/settings/SettingsStorage';

describe('SettingsStorage: dosya tabanlı ve env ayar yönetimi', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-settings-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Geçici klasör temizleme
    }
  });

  it('varsayılan ayarları eksiksiz yükler', () => {
    const settings = loadSettings(tempDir);
    assert.strictEqual(settings.selectedProvider, 'ollama');
    assert.strictEqual(settings.selectedModel, 'llama3.1');
    assert.strictEqual(settings.autoApprove.readFiles, true);
    assert.strictEqual(settings.autoApprove.writeFiles, false);
  });

  it('çalışma alanı .evren-kod/settings.json dosyasından ayarları okur', async () => {
    await saveSettings(
      {
        selectedProvider: 'openrouter',
        selectedModel: 'anthropic/claude-3.5-sonnet',
        apiKeys: { openrouter: 'sk-or-saved-test' }
      },
      { workspaceRoot: tempDir }
    );

    const targetFile = getWorkspaceSettingsPath(tempDir);
    assert.ok(fs.existsSync(targetFile));

    const loaded = loadSettings(tempDir);
    assert.strictEqual(loaded.selectedProvider, 'openrouter');
    assert.strictEqual(loaded.selectedModel, 'anthropic/claude-3.5-sonnet');
    assert.strictEqual(loaded.apiKeys.openrouter, 'sk-or-saved-test');
  });

  it('çevre değişkenleri ayarları ezer', () => {
    const prevKey = process.env.EVREN_API_KEY;
    const prevProv = process.env.EVREN_PROVIDER;
    try {
      process.env.EVREN_API_KEY = 'env-evren-secret';
      process.env.EVREN_PROVIDER = 'evren';

      const loaded = loadSettings(tempDir);
      assert.strictEqual(loaded.selectedProvider, 'evren');
      assert.strictEqual(loaded.apiKeys.evren, 'env-evren-secret');
      assert.strictEqual(resolveApiKey('evren', loaded), 'env-evren-secret');
    } finally {
      if (prevKey !== undefined) process.env.EVREN_API_KEY = prevKey;
      else delete process.env.EVREN_API_KEY;

      if (prevProv !== undefined) process.env.EVREN_PROVIDER = prevProv;
      else delete process.env.EVREN_PROVIDER;
    }
  });

  it('parametre overrides her şeyden önceliklidir', () => {
    const loaded = loadSettings(tempDir, {
      selectedProvider: 'openai-compatible',
      selectedModel: 'custom-local'
    });
    assert.strictEqual(loaded.selectedProvider, 'openai-compatible');
    assert.strictEqual(loaded.selectedModel, 'custom-local');
  });
});
