import * as vscode from 'vscode';
import {
  ExtensionToWebviewMessage,
  UserSettings,
  VsCodeThemeConfig,
  WebviewToExtensionMessage,
  WorkspaceCustomizations
} from '@evren-kod/core/shared/types';
import { AgentCore } from '../core/agent/AgentCore';
import { SessionRegistry } from '../core/agent/SessionRegistry';
import { createChatHandlers } from './sidebarChatHandlers';
import { createSessionHandlers } from './sidebarSessionHandlers';
import { createToolHandlers } from './sidebarToolHandlers';
import { createUiHandlers } from './sidebarUiHandlers';

export type WebviewMessageHandlerMap = {
  [K in WebviewToExtensionMessage['type']]: (
    message: Extract<WebviewToExtensionMessage, { type: K }>
  ) => Promise<void> | void;
};

export interface SidebarHandlerContext {
  getAgentCore: () => AgentCore | undefined;
  getSettings: () => UserSettings;
  postMessage: (message: ExtensionToWebviewMessage) => void;
  newSession: () => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  updateSettings: (newSettings: Partial<UserSettings>) => Promise<void>;
  openFileInEditor: (filePath: string, line?: number) => Promise<void>;
  postGitChanges: () => Promise<void>;
  showGitFileDiff: (filePath: string) => Promise<void>;
  showSnapshotDiff: (filePath: string, originalContent: string) => Promise<void>;
  exportSession: (taskId: string, format: 'json' | 'markdown') => Promise<void>;
  importSession: () => Promise<void>;
  postKnowledgeStatus: () => Promise<void>;
  buildCustomizationsPayload: (
    workspaceRoot: string | undefined,
    reload?: boolean
  ) => Promise<WorkspaceCustomizations>;
  getSafeSettingsForWebview: () => UserSettings;
  getVsCodeThemeConfig: () => VsCodeThemeConfig;
  getRegistry: () => SessionRegistry | undefined;
  getExtensionContext: () => vscode.ExtensionContext;
}

/**
 * Tüm webview mesaj handler'larını dört gruptan birleştirir.
 * - sidebarChatHandlers    → SEND_MESSAGE, EDIT_MESSAGE, USER_REPLY, SET_MODE
 * - sidebarSessionHandlers → oturum yaşam döngüsü ve geçmiş
 * - sidebarToolHandlers    → araç onay/red
 * - sidebarUiHandlers      → ayarlar, model, bilgi tabanı, git, UI
 */
export function createWebviewMessageHandlers(ctx: SidebarHandlerContext): WebviewMessageHandlerMap {
  return {
    ...createChatHandlers(ctx),
    ...createSessionHandlers(ctx),
    ...createToolHandlers(ctx),
    ...createUiHandlers(ctx)
  } as WebviewMessageHandlerMap;
}
