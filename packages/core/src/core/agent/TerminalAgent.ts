/**
 * Terminal ve bağımsız arayüzler için gövdesiz ajan motoru (Headless Agent).
 *
 * VS Code eklentisine bağımlı olmadan, tam ReAct döngüsünü, araç çalıştırmayı,
 * izin kontrolünü, otomatik doğrulamayı ve oturum hafızasını yürütür.
 */
import { ModelProvider, ProviderMessage } from '../../providers/base';
import { createModelProvider } from '../../providers';
import { StreamInterruptedError } from '../../providers/openai';
import { ALL_TOOLS } from '../../tools';
import { ToolExecutionContext } from '../../tools/base';
import { runToolCall } from '../toolRunner';
import { generateSystemPrompt } from '../prompts/systemPrompt';
import { PermissionManager } from '../permission/PermissionManager';
import { SnapshotManager } from '../snapshot/SnapshotManager';
import { VerificationManager, VerificationResult } from '../verification/VerificationManager';
import { GitManager } from '../git/GitManager';
import { ProjectMemoryManager } from '../memory/ProjectMemoryManager';
import { TaskPlanner } from '../plan/TaskPlanner';
import { resolveProfile } from '../project/ProjectProfiler';
import { formatTeamContext, selectActiveTeam } from '../../shared/agents/team';
import { ContextManager } from '../context/ContextManager';
import { collapseRepetition, findRepetitionCollapse, StreamRepetitionGuard } from '../../shared/repetition';
import { ModelProviderType, ToolName, UserSettings } from '../../shared/types';
import { resolveApiKey } from '../settings/SettingsStorage';

export const TERMINAL_TOOLS = new Set<ToolName>([
  'read_file',
  'write_file',
  'edit_file',
  'search_files',
  'list_directory',
  'execute_command',
  'run_tests',
  'run_linter',
  'git_status',
  'git_diff',
  'read_skill',
  'undo_change',
  'update_plan',
  'run_verification',
  'index_workspace',
  'find_symbol',
  'analyze_impact',
  'knowledge_graph',
  'graph_callers',
  'graph_callees',
  'graph_impact',
  'graph_search',
  'graph_status',
  'git_create_branch',
  'git_commit',
  'prepare_pr',
  'search_memory',
  'read_notebook',
  'web_fetch',
  'web_search'
]);

export interface TerminalAgentCallbacks {
  onToken?: (chunk: string) => void;
  onToolStart?: (name: ToolName, args: Record<string, unknown>) => void;
  onToolComplete?: (name: ToolName, output: string, ok: boolean) => void;
  onApprovalRequest?: (question: string) => Promise<boolean>;
  onRepetition?: () => void;
}

export interface TerminalTurnResult {
  completed: boolean;
  text: string;
  stepCount: number;
}

export interface TerminalSessionUsage {
  prompt: number;
  completion: number;
  total: number;
  cached: number;
  requests: number;
}

export class TerminalAgent {
  public readonly workspaceRoot: string;
  public settings: UserSettings;
  private provider: ModelProvider;
  public readonly permissionManager: PermissionManager;
  public readonly snapshotManager: SnapshotManager;
  public readonly verificationManager: VerificationManager;
  public readonly gitManager: GitManager;
  public readonly projectMemory: ProjectMemoryManager;
  public readonly planner: TaskPlanner;
  public readonly contextManager: ContextManager;
  public readonly messages: ProviderMessage[] = [];
  public readonly usage: TerminalSessionUsage = {
    prompt: 0,
    completion: 0,
    total: 0,
    cached: 0,
    requests: 0
  };
  private readonly readOnly: boolean;
  private readonly maxSteps: number;
  private readonly abortController = new AbortController();

  constructor(options: {
    workspaceRoot: string;
    settings: UserSettings;
    readOnly?: boolean;
    maxSteps?: number;
  }) {
    this.workspaceRoot = options.workspaceRoot;
    this.settings = options.settings;
    this.readOnly = options.readOnly ?? false;
    this.maxSteps = options.maxSteps ?? 30;

    this.provider = createModelProvider(this.settings);
    this.permissionManager = new PermissionManager(this.settings);
    this.snapshotManager = new SnapshotManager();
    this.verificationManager = new VerificationManager();
    this.verificationManager.setCommandFilter(
      (command) => !this.permissionManager.isToolBlocked('execute_command', { command }).blocked
    );
    this.gitManager = new GitManager();
    this.projectMemory = new ProjectMemoryManager();
    this.planner = new TaskPlanner();

    const allowedTools = this.getAllowedTools();
    const tools = Object.values(ALL_TOOLS).filter((t) => allowedTools.has(t.name));
    this.contextManager = new ContextManager({
      contextWindowTokens: this.settings.contextWindowTokens,
      tools
    });
  }

  public getAllowedTools(): Set<ToolName> {
    if (!this.readOnly) {
      return new Set(TERMINAL_TOOLS);
    }
    const readOnlySet = new Set<ToolName>();
    for (const name of TERMINAL_TOOLS) {
      if (
        name.startsWith('read_') ||
        name.startsWith('search_') ||
        name.startsWith('list_') ||
        name.startsWith('find_') ||
        name.startsWith('graph_') ||
        name === 'git_status' ||
        name === 'git_diff' ||
        name === 'analyze_impact' ||
        name === 'knowledge_graph' ||
        name === 'web_fetch' ||
        name === 'web_search'
      ) {
        readOnlySet.add(name);
      }
    }
    return readOnlySet;
  }

  /** Oturumu başlatır ve sistem istemini hazırlar. */
  public async init(): Promise<void> {
    await this.permissionManager.loadProjectPermissions(
      this.workspaceRoot,
      this.settings.autoApprove.writeFiles && this.settings.autoApprove.executeCommands
    );

    let teamContext = '';
    try {
      const profile = await resolveProfile(this.workspaceRoot);
      teamContext = formatTeamContext(selectActiveTeam(profile), profile);
    } catch {
      // Profil çözülemezse takım bağlamı boş kalır
    }

    const systemPrompt = await generateSystemPrompt(
      this.workspaceRoot,
      'code',
      '',
      '',
      this.planner.formatForPrompt(),
      undefined,
      teamContext
    );

    this.messages.length = 0;
    this.messages.push({ role: 'system', content: systemPrompt });
  }

  /** Kullanıcı istemini çalıştırır. */
  public async runTurn(promptText: string, callbacks?: TerminalAgentCallbacks): Promise<TerminalTurnResult> {
    if (this.messages.length === 0) {
      await this.init();
    }

    this.messages.push({ role: 'user', content: promptText });
    const allowedTools = this.getAllowedTools();
    const tools = Object.values(ALL_TOOLS).filter((t) => allowedTools.has(t.name));

    const context: ToolExecutionContext = {
      workspaceRoot: this.workspaceRoot,
      snapshotManager: this.snapshotManager,
      permissionManager: this.permissionManager,
      verificationManager: this.verificationManager,
      gitManager: this.gitManager,
      projectMemory: this.projectMemory,
      signal: this.abortController.signal
    };

    let lastText = '';
    let repetitionHit = false;
    let stepCount = 0;
    let lastFailure: { key: string; count: number } | undefined;

    for (let step = 0; step < this.maxSteps; step++) {
      stepCount++;
      const outbound = this.contextManager.pruneMessages(
        this.contextManager.compactHistory(this.messages),
        tools
      );
      const guard = new StreamRepetitionGuard();
      repetitionHit = false;

      const stepAbort = new AbortController();
      const stepSignal =
        typeof AbortSignal.any === 'function'
          ? AbortSignal.any([this.abortController.signal, stepAbort.signal])
          : this.abortController.signal;

      let assistantProbe = '';
      let response;

      try {
        response = await this.provider.sendMessage(
          outbound,
          tools,
          (chunk) => {
            if (repetitionHit) return;
            callbacks?.onToken?.(chunk);
            assistantProbe += chunk;
            if (guard.check(assistantProbe)) {
              repetitionHit = true;
              callbacks?.onRepetition?.();
              stepAbort.abort();
            }
          },
          stepSignal
        );
      } catch (err) {
        if (err instanceof StreamInterruptedError) {
          this.usage.total += err.usage.totalTokens;
          this.usage.requests += 1;
        }
        if (repetitionHit) {
          this.messages.push({
            role: 'assistant',
            content: '[Yanıt tekrara girdiği için istemci tarafından kesildi.]'
          });
          this.messages.push({
            role: 'user',
            content: 'Önceki cevabınız tekrara girdi. Lütfen tekrarlamadan özetle devam edin.'
          });
          continue;
        }
        throw err;
      }

      if (response.usage) {
        this.usage.prompt += response.usage.promptTokens;
        this.usage.completion += response.usage.completionTokens;
        this.usage.total += response.usage.totalTokens;
        this.usage.cached += response.usage.cachedTokens ?? 0;
        this.usage.requests += 1;
      }

      if (response.text) {
        if (!repetitionHit && findRepetitionCollapse(response.text)) {
          response = { ...response, text: collapseRepetition(response.text) };
        }
        lastText = response.text;
      }

      this.messages.push({
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls
      });

      if (!response.toolCalls || response.toolCalls.length === 0) {
        return { completed: true, text: lastText, stepCount };
      }

      for (const toolCall of response.toolCalls) {
        const toolName = toolCall.name as ToolName;
        const toolArgs = toolCall.arguments ?? {};
        callbacks?.onToolStart?.(toolName, toolArgs);

        const outcome = await runToolCall(
          {
            id: toolCall.id,
            name: toolName,
            args: toolArgs,
            requiresApproval: false,
            status: 'pending'
          },
          {
            workspaceRoot: this.workspaceRoot,
            permissionManager: this.permissionManager,
            snapshotManager: this.snapshotManager,
            planner: this.planner,
            context,
            allowedTools,
            approve: async (explanation) => {
              if (
                this.settings.autoApprove.writeFiles &&
                (toolName === 'write_file' || toolName === 'edit_file')
              ) {
                return true;
              }
              if (
                this.settings.autoApprove.executeCommands &&
                (toolName === 'execute_command' || toolName === 'run_tests' || toolName === 'run_linter')
              ) {
                return true;
              }
              if (callbacks?.onApprovalRequest) {
                return callbacks.onApprovalRequest(explanation);
              }
              return false;
            }
          }
        );

        callbacks?.onToolComplete?.(toolName, outcome.output, outcome.ok);

        this.messages.push({
          role: 'tool',
          toolCallId: toolCall.id,
          content: this.contextManager.truncateToolOutput(outcome.output, toolName)
        });

        if (!outcome.ok) {
          const key = `${toolName}::${JSON.stringify(toolArgs)}`;
          lastFailure =
            lastFailure && lastFailure.key === key
              ? { key, count: lastFailure.count + 1 }
              : { key, count: 1 };
          if (lastFailure.count >= 3) {
            return {
              completed: false,
              text: `“${toolName}” aracı art arda 3 kez hata verdi; döngü durduruldu.`,
              stepCount
            };
          }
        } else {
          lastFailure = undefined;
        }
      }
    }

    return { completed: false, text: lastText, stepCount };
  }

  /** Modeli anında değiştirir. */
  public switchModel(modelId: string): void {
    this.settings.selectedModel = modelId;
    this.provider = createModelProvider(this.settings);
  }

  /** Sağlayıcıyı ve isteğe bağlı olarak modeli değiştirir. */
  public switchProvider(provider: ModelProviderType, modelId?: string): void {
    this.settings.selectedProvider = provider;
    if (modelId) {
      this.settings.selectedModel = modelId;
    }
    const resolvedKey = resolveApiKey(provider, this.settings);
    if (resolvedKey) {
      if (provider === 'evren') this.settings.apiKeys.evren = resolvedKey;
      if (provider === 'openrouter') this.settings.apiKeys.openrouter = resolvedKey;
      if (provider === 'openai-compatible') this.settings.apiKeys.openaiCompatible = resolvedKey;
    }
    this.provider = createModelProvider(this.settings);
  }

  /** Oturum geçmişini sıfırlar. */
  public async clearHistory(): Promise<void> {
    await this.init();
  }

  /** Doğrulamayı (test ve lint) çalıştırır. */
  public async runVerification(): Promise<VerificationResult> {
    return this.verificationManager.verify(this.workspaceRoot, {
      signal: this.abortController.signal
    });
  }

  /** Git durumunu alır. */
  public async getGitStatus(): Promise<string> {
    return this.gitManager.status(this.workspaceRoot);
  }
}
