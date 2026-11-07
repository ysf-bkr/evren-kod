import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { CLI_TOOLS, READ_ONLY_TOOLS, buildSettings, parseArgs } from '@evren-kod/cli';
import { TOOL_NAMES, ToolName } from '@evren-kod/core/shared/types';

describe('CLI argument parsing and provider configuration', () => {
  it('parses --provider evren correctly and sets default model to auto', () => {
    const prevEnv = process.env.EVREN_API_KEY;
    process.env.EVREN_API_KEY = 'test-evren-kod-key';
    try {
      const options = parseArgs(['--prompt', 'Test task', '--provider', 'evren']);
      assert.strictEqual(options.provider, 'evren');
      assert.strictEqual(options.apiKey, 'test-evren-kod-key');

      const settings = buildSettings(options);
      assert.strictEqual(settings.selectedProvider, 'evren');
      assert.strictEqual(settings.selectedModel, 'auto');
      assert.strictEqual(settings.apiKeys.evren, 'test-evren-kod-key');
    } finally {
      if (prevEnv !== undefined) {
        process.env.EVREN_API_KEY = prevEnv;
      } else {
        delete process.env.EVREN_API_KEY;
      }
    }
  });

  it('parses --provider openrouter and applies default model when omitted', () => {
    const options = parseArgs([
      '--prompt',
      'Review code',
      '--provider',
      'openrouter',
      '--api-key',
      'sk-or-test'
    ]);
    assert.strictEqual(options.provider, 'openrouter');
    assert.strictEqual(options.apiKey, 'sk-or-test');

    const settings = buildSettings(options);
    assert.strictEqual(settings.selectedProvider, 'openrouter');
    assert.strictEqual(settings.selectedModel, 'anthropic/claude-3.5-sonnet');
    assert.strictEqual(settings.apiKeys.openrouter, 'sk-or-test');
  });

  it('honours explicit --model override across providers', () => {
    const options = parseArgs([
      '--prompt',
      'Refactor module',
      '--provider',
      'openrouter',
      '--model',
      'openai/gpt-4o'
    ]);
    assert.strictEqual(options.model, 'openai/gpt-4o');

    const settings = buildSettings(options);
    assert.strictEqual(settings.selectedModel, 'openai/gpt-4o');
  });

  it('defaults to ollama and llama3.1 when provider and model are omitted', () => {
    const options = parseArgs(['--prompt', 'Fix bug']);
    assert.strictEqual(options.provider, 'ollama');

    const settings = buildSettings(options);
    assert.strictEqual(settings.selectedProvider, 'ollama');
    assert.strictEqual(settings.selectedModel, 'llama3.1');
    assert.strictEqual(settings.autoApprove.writeFiles, false);
    assert.strictEqual(settings.autoApprove.executeCommands, false);
  });

  it('enables autoApprove when --yes flag is passed', () => {
    const options = parseArgs(['--prompt', 'Generate tests', '--yes']);
    assert.strictEqual(options.yes, true);

    const settings = buildSettings(options);
    assert.strictEqual(settings.autoApprove.writeFiles, true);
    assert.strictEqual(settings.autoApprove.executeCommands, true);
  });

  it('throws descriptive error when --prompt is missing', () => {
    assert.throws(() => parseArgs(['--provider', 'ollama']), /--prompt is required/);
  });
});

/**
 * CLI araç listesi iki ayrı sabit olarak tutulur. Yeni bir araç eklendiğinde
 * güncellenmeyi unutmak sessiz bir kapsam kaybıdır; bu test onu kırmızıya
 * çevirir. Dışlanan araçların nedeni tek tek yazılır.
 */
const INTENTIONAL_CLI_EXCLUSIONS = new Set<ToolName>([
  // Yalnızca VS Code konak katmanındaki alt ajan/akış orkestrasyonu.
  'invoke_subagent',
  'run_parallel_tasks',
  'ask_followup_question',
  'update_module_plan',
  // Yayın kapısı ve denetim defteri konak iş akışına bağlı (README: Bilinen Sınırlamalar).
  'record_release_gate',
  'write_spec',
  'update_acceptance_criteria',
  // VS Code dil sunucusu istemcisi gerektirir.
  'get_diagnostics',
  'get_definition',
  'get_hover',
  'get_references',
  'get_workspace_symbols',
  // Editör/bilgi tabanı paneli akışı.
  'get_project_knowledge',
  'add_knowledge_note',
  'write_knowledge_file',
  // Worktree birleştirme konak orkestrasyonunda anlamlı.
  'merge_worktree',
  // Yürütme uyumluluğu için tutulan eski adlar; modele şema olarak sunulmaz.
  'get_callers',
  'get_callees',
  'call_graph_impact',
  'find_related_code',
  'call_graph_status'
]);

describe('CLI araç kapsamı: yeni araç sessizce CLI dışında kalamaz', () => {
  it('her araç ya CLI listesinde ya da gerekçeli dışlama listesinde', () => {
    for (const name of TOOL_NAMES) {
      if (CLI_TOOLS.has(name)) continue;
      assert.ok(
        INTENTIONAL_CLI_EXCLUSIONS.has(name),
        `${name} ne CLI_TOOLS içinde ne de gerekçeli dışlama listesinde`
      );
    }
  });

  it('salt-okunur küme CLI kümesinin alt kümesidir', () => {
    for (const name of READ_ONLY_TOOLS) {
      assert.ok(CLI_TOOLS.has(name), `${name} salt-okunur ama CLI kümesinde değil`);
    }
  });
});
