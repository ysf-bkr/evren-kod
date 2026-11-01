import * as vscode from 'vscode';
import { UserSettings } from '@evren-kod/core/shared/types';
import { HistoryManager } from '../memory/HistoryManager';
import { McpHub } from '../mcp/McpHub';
import { SkillManager } from '@evren-kod/core/core/skills/SkillManager';
import { LspClient } from '../lsp/LspClient';
import { ProjectMemoryManager } from '@evren-kod/core/core/memory/ProjectMemoryManager';
import { KnowledgeStore } from '@evren-kod/core/core/knowledge/KnowledgeStore';
import { SpecStore } from '@evren-kod/core/core/spec/SpecStore';
import { WorkspaceRuleManager } from '@evren-kod/core/core/rules/WorkspaceRuleManager';
import { WorktreeManager } from '@evren-kod/core/core/worktree/WorktreeManager';
import { GitManager } from '@evren-kod/core/core/git/GitManager';
import { CallGraphManager } from '@evren-kod/core/core/callgraph/CallGraphManager';
import { createLspLanguageService } from '@evren-kod/core/core/callgraph/languageService';

/**
 * Aynı çalışma alanında yaşayan oturumların ortak servisleri.
 *
 * Bilinçli olarak yalnızca "tek örnek olması gereken" şeyler buradadır:
 * süreç açan (MCP), ağ/indeks tutan (bilgi tabanı, çağrı haritası, LSP) ve
 * dosya sistemi kaydı tutan (spec, worktree, git) servisler. Oturuma özel
 * durum (plan, snapshot, doğrulama baseline'ı) her `AgentCore` içinde kalır.
 */
export interface SharedServices {
  historyManager: HistoryManager;
  mcpHub: McpHub;
  skillManager: SkillManager;
  lspClient: LspClient;
  projectMemory: ProjectMemoryManager;
  knowledgeStore: KnowledgeStore;
  specStore: SpecStore;
  workspaceRules: WorkspaceRuleManager;
  worktreeManager: WorktreeManager;
  gitManager: GitManager;
  callGraphManager: CallGraphManager;
  /** Ayarlar değiştiğinde paylaşılan servislerin gördüğü güncel değer. */
  currentSettings: () => UserSettings;
}

/**
 * Tek bir eklenti ömrü boyunca paylaşılan servisleri kurar.
 *
 * `callGraphManager` ayar okuyucusu canlı bir referans üzerinden çalışır;
 * böylece ayar değişince ikinci bir harita kurulmaz.
 */
export function createSharedServices(
  context: vscode.ExtensionContext,
  currentSettings: () => UserSettings
): SharedServices {
  const lspClient = new LspClient();
  return {
    historyManager: new HistoryManager(context),
    mcpHub: new McpHub(context.workspaceState),
    skillManager: new SkillManager(),
    lspClient,
    projectMemory: new ProjectMemoryManager(),
    knowledgeStore: new KnowledgeStore(),
    specStore: new SpecStore(),
    workspaceRules: new WorkspaceRuleManager(),
    worktreeManager: new WorktreeManager(),
    gitManager: new GitManager(),
    callGraphManager: new CallGraphManager({
      enabled: () => currentSettings().callGraph?.enabled !== false,
      language: (workspaceRoot) => createLspLanguageService(lspClient, workspaceRoot)
    }),
    currentSettings
  };
}
