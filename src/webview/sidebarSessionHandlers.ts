import type { WebviewMessageHandlerMap, SidebarHandlerContext } from './sidebarMessageHandlers';

type SessionHandlerKeys =
  | 'NEW_SESSION'
  | 'CANCEL_TASK'
  | 'RESUME_TASK'
  | 'RETRY_LAST_TURN'
  | 'LOAD_TASK'
  | 'SELECT_SESSION'
  | 'DELETE_TASK'
  | 'EXPORT_SESSION'
  | 'IMPORT_SESSION'
  | 'GET_TASK_HISTORY'
  | 'REQUEST_SETTINGS'
  | 'REWIND_TO_CHECKPOINT'
  | 'REVERT_LAST_SNAPSHOT'
  | 'REVERT_TOOL_SNAPSHOT'
  | 'REVERT_COMMAND';

/** Oturum yaşam döngüsü ve geçmiş yönetimi handler'larını döner. */
export function createSessionHandlers(
  ctx: SidebarHandlerContext
): Pick<WebviewMessageHandlerMap, SessionHandlerKeys> {
  return {
    NEW_SESSION: async () => {
      await ctx.newSession();
    },

    CANCEL_TASK: async () => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        await agentCore.cancelTask();
      }
    },

    RESUME_TASK: async () => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        await agentCore.resumeTask();
      }
    },

    RETRY_LAST_TURN: async () => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        await agentCore.retryLastTurn();
      }
    },

    LOAD_TASK: async (message) => {
      await ctx.selectSession(message.payload.taskId);
    },

    SELECT_SESSION: async (message) => {
      await ctx.selectSession(message.payload.sessionId);
    },

    DELETE_TASK: async (message) => {
      const registry = ctx.getRegistry();
      const agentCore = ctx.getAgentCore();
      const history = agentCore?.getHistoryManager();
      if (!registry || !history) return;

      const deletingActive = agentCore?.getState().id === message.payload.taskId;

      for (const snapshot of registry.snapshots()) {
        if (snapshot.id !== message.payload.taskId) continue;
        await registry.close(snapshot.key);
      }

      await history.deleteTask(message.payload.taskId);
      if (deletingActive) {
        await ctx.newSession();
      }
      ctx.postMessage({ type: 'TASK_HISTORY_LOADED', payload: { history: history.getSummaries() } });
    },

    EXPORT_SESSION: async (message) => {
      await ctx.exportSession(message.payload.taskId, message.payload.format);
    },

    IMPORT_SESSION: async () => {
      await ctx.importSession();
    },

    GET_TASK_HISTORY: async () => {
      const agentCore = ctx.getAgentCore();
      const history = agentCore?.getHistoryManager().getSummaries() ?? [];
      ctx.postMessage({ type: 'TASK_HISTORY_LOADED', payload: { history } });
    },

    REQUEST_SETTINGS: async () => {
      ctx.postMessage({ type: 'SETTINGS_LOADED', payload: ctx.getSafeSettingsForWebview() });
      ctx.postMessage({ type: 'VSCODE_THEME_CHANGED', payload: ctx.getVsCodeThemeConfig() });
      const active = ctx.getAgentCore();
      const registry = ctx.getRegistry();
      const sessionKey = registry?.active;
      if (active && sessionKey) {
        ctx.postMessage({
          type: 'TASK_STATE_UPDATE',
          payload: active.getState(),
          sessionKey
        });
        ctx.postMessage({ type: 'SESSION_ACTIVATED', payload: { sessionKey } });
      }
    },

    REWIND_TO_CHECKPOINT: async (message) => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        await agentCore.rewindToCheckpoint(message.payload.checkpointId);
      }
    },

    REVERT_LAST_SNAPSHOT: async () => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        await agentCore.revertLastSnapshot();
      }
    },

    REVERT_TOOL_SNAPSHOT: async (message) => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        await agentCore.revertToolSnapshot(message.payload.toolCallId);
      }
    },

    REVERT_COMMAND: async (message) => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        await agentCore.revertCommandEffects(message.payload.toolCallId);
      }
    }
  };
}
