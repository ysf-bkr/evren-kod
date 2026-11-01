import * as vscode from 'vscode';
import { SubagentManager, SubagentTaskParams } from '@evren-kod/core/core/multiagent/SubagentManager';
import { ROLE_ALIASES, getAgentDefinition } from '@evren-kod/core/shared/agents';
import { getActiveWorkspaceRoot } from '../workspace/workspaceRoot';
import { logWarning } from '@evren-kod/core/shared/logging';
import { createModelProvider } from '@evren-kod/core/providers';
import { DailyTokenLimitError } from '@evren-kod/core/providers/openai';
import type { AgentCore } from './AgentCore';

/**
 * Alt ajan yöneticisini kurar ve yapılandırır.
 */
export function createSubagentManager(core: AgentCore): SubagentManager {
  return new SubagentManager(
    core.provider,
    (role, status, details) => {
      core.notify({ level: 'info', message: `[Alt Ajan: ${role.toUpperCase()}] ${status}` });
      const resolvedRole = (ROLE_ALIASES[role.toLowerCase()] || role).toLowerCase();
      const def = getAgentDefinition(resolvedRole);
      const displayName = def?.displayName || role;

      if (details?.state === 'completed' || details?.state === 'failed' || details?.state === 'cancelled') {
        core.state.activeSubagent = undefined;
      } else {
        const current = core.state.activeSubagent;
        core.state.activeSubagent = {
          role,
          displayName,
          task: current?.task || '',
          status: details?.state || 'running',
          currentTool: details?.tool,
          step: details?.step,
          maxSteps: details?.maxSteps,
          worktreePath: details?.worktreePath ?? current?.worktreePath,
          isolate: details?.isolate ?? current?.isolate,
          startedAt: current?.startedAt || Date.now(),
          updatedAt: Date.now()
        };
      }
      core.emitState();
    },
    core.skillManager,
    core.lspClient,
    core.snapshotManager,
    core.permissionManager,
    core.checkpointManager,
    (tc, decision, root) => {
      void core.auditTool(tc, root, decision);
    },
    core.worktreeManager,
    () => core.getSandboxConfig(getActiveWorkspaceRoot()),
    () =>
      core.settings.useIntegratedTerminal !== false && !core.getSandboxConfig(getActiveWorkspaceRoot())
        ? (command, root, signal) => core.runInIntegratedTerminal(command, root, signal)
        : undefined,
    core.callGraphManager,
    core.gitManager,
    (role, task) => core.modelRouter.routeForAgent(role, task, core.settings),
    (model) => {
      try {
        return createModelProvider({ ...core.settings, selectedModel: model });
      } catch (err) {
        logWarning(`Could not create provider for agent model ${model}`, err);
        return undefined;
      }
    },
    {
      requestTimeoutSeconds: () => core.settings.requestTimeoutSeconds ?? 180,
      contextWindowTokens: () => core.settings.contextWindowTokens,
      hookRunner: () => core.hookManager,
      dirtyFileReason: (absolutePath) => {
        const dirty = vscode.workspace.textDocuments.find(
          (doc) => doc.uri.fsPath === absolutePath && doc.isDirty
        );
        return dirty
          ? `"${absolutePath}" contains unsaved editor changes. Save or revert them first.`
          : undefined;
      }
    }
  );
}

/**
 * Kullanıcı arayüzünden doğrudan alt ajan görevi başlatır.
 */
export async function runSubagentFromUi(core: AgentCore, params: SubagentTaskParams): Promise<string> {
  if (core.isBusy()) {
    throw new Error('Ajan şu anda meşgul; alt ajan başlatılmadan önce görevi bekleyin veya durdurun.');
  }
  const workspaceRoot = getActiveWorkspaceRoot();
  const task = params.task?.trim();
  if (!task) {
    throw new Error('Alt ajan görevi boş olamaz.');
  }

  const resolvedRole = (ROLE_ALIASES[params.role.toLowerCase()] || params.role).toLowerCase();
  const def = getAgentDefinition(resolvedRole);

  core.state.messages.push({
    id: core.nextMessageId(),
    role: 'system',
    content: `Alt ajan başlatıldı (${def?.displayName || params.role}). Görev: ${task}`,
    timestamp: Date.now()
  });
  core.state.status = 'running';
  core.state.activeSubagent = {
    role: params.role,
    displayName: def?.displayName || params.role,
    task,
    status: 'starting',
    isolate: params.isolate,
    startedAt: Date.now()
  };
  core.emitState();

  core.isCancelled = false;
  core.activeAbortController = new AbortController();
  let isPaused = false;
  try {
    const result = await core.subagentManager.runSubagent(
      { ...params, task },
      workspaceRoot,
      0,
      core.activeAbortController.signal
    );
    core.state.messages.push({
      id: core.nextMessageId(),
      role: 'assistant',
      content: result,
      timestamp: Date.now()
    });
    return result;
  } catch (err) {
    if (err instanceof DailyTokenLimitError) {
      isPaused = true;
      core.notify({ level: 'warning', message: err.message });
      core.state.messages.push({
        id: core.nextMessageId(),
        role: 'assistant',
        content: '',
        error: err.message,
        timestamp: Date.now()
      });
      return err.message;
    }
    throw err;
  } finally {
    core.state.activeSubagent = undefined;
    core.state.status = isPaused ? 'paused' : 'idle';
    core.workflow.syncProgressToState();
    await core.saveCurrentState();
    core.emitState();
  }
}
