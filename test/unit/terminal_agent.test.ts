import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TerminalAgent, TERMINAL_TOOLS } from '@evren-kod/core/core/agent/TerminalAgent';
import { loadSettings } from '@evren-kod/core/core/settings/SettingsStorage';

describe('TerminalAgent: bağımsız terminal ajan motoru', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-agent-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Temizleme
    }
  });

  it('varsayılan ayarlarla terminal ajanını başlatır ve araçları hazırlar', () => {
    const settings = loadSettings(tempDir);
    const agent = new TerminalAgent({
      workspaceRoot: tempDir,
      settings
    });

    const allowed = agent.getAllowedTools();
    assert.strictEqual(allowed.size, TERMINAL_TOOLS.size);
    assert.ok(allowed.has('read_file'));
    assert.ok(allowed.has('write_file'));
    assert.ok(allowed.has('execute_command'));
  });

  it('salt-okunur modda yazma araçlarını filtreler', () => {
    const settings = loadSettings(tempDir);
    const agent = new TerminalAgent({
      workspaceRoot: tempDir,
      settings,
      readOnly: true
    });

    const allowed = agent.getAllowedTools();
    assert.ok(allowed.has('read_file'));
    assert.ok(allowed.has('search_files'));
    assert.strictEqual(allowed.has('write_file'), false);
    assert.strictEqual(allowed.has('edit_file'), false);
    assert.strictEqual(allowed.has('execute_command'), false);
  });

  it('model ve sağlayıcı dinamik olarak değiştirilebilir', () => {
    const settings = loadSettings(tempDir);
    const agent = new TerminalAgent({
      workspaceRoot: tempDir,
      settings
    });

    agent.switchModel('llama3.2');
    assert.strictEqual(agent.settings.selectedModel, 'llama3.2');

    agent.switchProvider('openrouter', 'anthropic/claude-3.5-sonnet');
    assert.strictEqual(agent.settings.selectedProvider, 'openrouter');
    assert.strictEqual(agent.settings.selectedModel, 'anthropic/claude-3.5-sonnet');
  });

  it('init() sistem istemini ve proje ekibini yükler', async () => {
    const settings = loadSettings(tempDir);
    const agent = new TerminalAgent({
      workspaceRoot: tempDir,
      settings
    });

    await agent.init();
    assert.strictEqual(agent.messages.length, 1);
    const firstMsg = agent.messages[0];
    assert.ok(firstMsg);
    assert.strictEqual(firstMsg.role, 'system');
    assert.ok((firstMsg.content?.length ?? 0) > 100);
  });
});
