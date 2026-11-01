/**
 * AgentCore tabanlı akış testlerinin ortak iskeleti.
 *
 * Scripted sağlayıcı, vscode test stub'ı, temel ayarlar, geçici çalışma
 * alanı ve AgentCore kurulumu burada toplanır; akış testleri yalnızca
 * senaryo verilerini tanımlar.
 */
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { AgentCore } from '../../src/core/agent/AgentCore';
import { ModelCompletionResponse, ModelProvider, ProviderMessage } from '@evren-kod/core/providers/base';
import { TaskState, UserSettings } from '@evren-kod/core/shared/types';

/** Kuyruktaki yanıtları sırayla döndüren sahte model sağlayıcısı. */
export class ScriptedProvider implements ModelProvider {
  public readonly id = 'scripted';
  public readonly name = 'Scripted';
  public readonly requests: ProviderMessage[][] = [];
  private index = 0;

  constructor(
    private readonly responses: ModelCompletionResponse[],
    private readonly onRequest?: (index: number) => void
  ) {}

  async sendMessage(messages: ProviderMessage[]): Promise<ModelCompletionResponse> {
    this.requests.push(messages);
    this.onRequest?.(this.index);
    const response = this.responses[this.index] ?? { text: 'done' };
    this.index++;
    return response;
  }
}

export interface VscodeTestStub {
  testState: {
    trusted: boolean;
    workspaceRoot?: string;
    warningAnswers: string[];
    infoMessages: string[];
    errorMessages: string[];
  };
  resetTestState(): void;
  createExtensionContext(): unknown;
}

export const stub = vscode as unknown as VscodeTestStub;

export const baseSettings: UserSettings = {
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: { readFiles: true, writeFiles: false, executeCommands: false },
  autoVerify: false,
  maxRepairAttempts: 0,
  useIntegratedTerminal: false,
  sandbox: { mode: 'none', image: 'node:20-bookworm', network: false }
};

/** Geçici çalışma alanları açar; `cleanup` ile hepsi silinir. */
export function createWorkspaceTracker(prefix: string) {
  const roots: string[] = [];
  return {
    roots,
    async create(): Promise<string> {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
      roots.push(root);
      await fs.mkdir(path.join(root, '.evren-kod'), { recursive: true });
      return root;
    },
    async cleanup(): Promise<void> {
      await Promise.all(roots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    }
  };
}

export interface TestAgent {
  core: AgentCore;
  states: TaskState[];
  notifications: string[];
}

/** Yayınlanan durum ve bildirimleri toplayan AgentCore kurulumu. */
export function createAgent(
  provider: ModelProvider,
  root: string,
  overrides: Partial<UserSettings> = {}
): TestAgent {
  const states: TaskState[] = [];
  const notifications: string[] = [];
  const core = new AgentCore(
    stub.createExtensionContext() as never,
    { ...baseSettings, ...overrides },
    (state) => states.push(state),
    (notification) => notifications.push(notification.message),
    undefined,
    { provider }
  );
  stub.testState.workspaceRoot = root;
  return { core, states, notifications };
}

/** Yayınlanan durum üzerinde bir koşulu, katı bir zaman aşımıyla bekler. */
export async function waitForState(
  states: TaskState[],
  predicate: (state: TaskState) => boolean,
  timeoutMs = 5_000
): Promise<TaskState> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const match = states.filter(predicate).at(-1);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for state. Last statuses: ${states
      .slice(-5)
      .map((state) => state.status)
      .join(', ')}`
  );
}
