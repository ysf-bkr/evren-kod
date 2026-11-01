import { AgentMode, TaskState, UserSettings } from '@evren-kod/core/shared/types';
import { HistoryManager } from '../memory/HistoryManager';
import { EmbeddingIndex } from '@evren-kod/core/core/knowledge/EmbeddingIndex';
import { DEFAULT_PROVIDER_URLS } from '@evren-kod/core/shared/constants';
import * as vscode from 'vscode';

/**
 * Ayarlara göre yerel/anlamsal arama indeksini kurar ya da undefined döner.
 */
export function buildEmbeddingIndex(settings: UserSettings): EmbeddingIndex | undefined {
  const config = settings.knowledgeEmbeddings;
  if (!config?.enabled) {
    return undefined;
  }
  const customBase = (config.baseUrl || '').trim();
  if (customBase) {
    const apiKey =
      settings.selectedProvider === 'evren' ? settings.apiKeys.evren : settings.apiKeys.openaiCompatible;
    return new EmbeddingIndex({
      baseUrl: customBase,
      model: config.model || 'qwen3-embedding-8b',
      style: 'openai',
      apiKey
    });
  }
  return new EmbeddingIndex({
    baseUrl: settings.ollamaBaseUrl || DEFAULT_PROVIDER_URLS.ollama,
    model: config.model || 'nomic-embed-text'
  });
}

/**
 * Kaydedilmiş bir oturum durumunu geçerli şemaya uyarlar.
 */
export function normalizeRestoredState(
  saved: TaskState,
  getInitialState: (mode?: AgentMode) => TaskState
): TaskState {
  const transientStatuses = ['running', 'waiting_approval', 'waiting_user_input', 'paused'];
  return {
    ...getInitialState(saved.mode || 'code'),
    ...saved,
    status: transientStatuses.includes(saved.status) ? 'paused' : saved.status,
    pendingToolCall: undefined,
    pendingQuestion: undefined,
    checkpoints: undefined,
    stats: {
      totalTokens: saved.stats?.totalTokens ?? 0,
      stepsCount: saved.stats?.stepsCount ?? 0,
      filesModified: Array.isArray(saved.stats?.filesModified) ? saved.stats.filesModified : [],
      lastModel: saved.stats?.lastModel,
      modelRoutingReason: saved.stats?.modelRoutingReason,
      verification: saved.stats?.verification
    },
    messages: Array.isArray(saved.messages)
      ? saved.messages
          .filter((m) => m.role !== 'assistant' || Boolean(m.content) || Boolean(m.toolCalls?.length))
          .map((m) => ({
            ...m,
            isStreaming: false,
            toolCalls: m.toolCalls?.map((tc) =>
              tc.status === 'pending' || tc.status === 'approved' || tc.status === 'executing'
                ? {
                    ...tc,
                    status: 'error' as const,
                    error: tc.error || 'The operation was interrupted while the extension was reloading.'
                  }
                : tc
            )
          }))
      : []
  };
}

/**
 * Başlangıç durumu: verilen oturum, son etkin oturum ya da boş oturum.
 */
export function restoreInitialState(
  initialSessionId: string | null | undefined,
  context: vscode.ExtensionContext,
  historyManager: HistoryManager,
  getInitialState: (mode?: AgentMode) => TaskState
): TaskState {
  const sessionId =
    initialSessionId === null
      ? undefined
      : (initialSessionId ?? context.workspaceState.get<string>('evren_kod_active_session_id'));
  const saved = sessionId ? historyManager.getTask(sessionId) : undefined;
  return saved ? normalizeRestoredState(saved, getInitialState) : getInitialState();
}
