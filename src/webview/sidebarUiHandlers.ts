import * as vscode from 'vscode';
import { errorMessage } from '@evren-kod/core/shared/errors';
import { EvrenModelProvider } from '@evren-kod/core/providers/evren';
import { getActiveWorkspaceRoot } from '../core/workspace/workspaceRoot';
import { previewToolDiff } from './sidebarEditorOps';
import { fetchModelIds } from './modelCatalog';
import { resolveCallGraphPanelRequest } from './callgraphPanel';
import { ROLE_ALIASES, getAgentDefinition } from '@evren-kod/core/shared/agents';
import { PROJECT_KIND_IDS, PROJECT_STACK_IDS, ProjectProfile } from '@evren-kod/core/shared/types';
import { profileWorkspace, resolveProfile, saveProfile } from '@evren-kod/core/core/project/ProjectProfiler';
import { invalidateProjectTeamContext } from '../core/agent/projectTeamContext';
import type { SkillManager } from '@evren-kod/core/core/skills/SkillManager';
import type { WebviewMessageHandlerMap, SidebarHandlerContext } from './sidebarMessageHandlers';

type UiHandlerKeys =
  | 'SAVE_SETTINGS'
  | 'FETCH_MODELS'
  | 'FETCH_QUOTA'
  | 'GET_MCP_STATUS'
  | 'OPEN_MCP_CONFIG'
  | 'RESTART_MCP'
  | 'GET_CUSTOMIZATIONS'
  | 'GET_PROJECT_PROFILE'
  | 'SAVE_PROJECT_PROFILE'
  | 'GET_KNOWLEDGE_STATUS'
  | 'REINDEX_KNOWLEDGE'
  | 'CLEAR_KNOWLEDGE'
  | 'ADD_KNOWLEDGE_NOTE'
  | 'INIT_AGENTS_TEMPLATE'
  | 'CLEAR_PROJECT_MEMORY'
  | 'START_SUBAGENT'
  | 'CUSTOMIZE_BUILTIN_AGENT'
  | 'RESET_BUILTIN_AGENT'
  | 'OPEN_AGENTS_FILE'
  | 'OPEN_FILE'
  | 'GET_GIT_CHANGES'
  | 'SHOW_COMMIT'
  | 'SHOW_TOOL_DIFF'
  | 'PREVIEW_TOOL_DIFF'
  | 'SHOW_FILE_DIFF'
  | 'GET_ABOUT_INFO'
  | 'CALLGRAPH_QUERY'
  | 'OPEN_EXTERNAL';

/** Ayarlar, model, bilgi tabanı, git ve UI handler'larını döner. */
export function createUiHandlers(ctx: SidebarHandlerContext): Pick<WebviewMessageHandlerMap, UiHandlerKeys> {
  /** Anlık görüntü farkını açar; açılamazsa arayüze Türkçe hata bildirimi gönderir. */
  const showSnapshotDiffOrNotify = async (snapshot: {
    filePath: string;
    originalContent?: string | null;
  }): Promise<void> => {
    try {
      await ctx.showSnapshotDiff(snapshot.filePath, snapshot.originalContent ?? '');
    } catch (err) {
      ctx.postMessage({
        type: 'NOTIFICATION',
        payload: { level: 'error', message: `Fark görünümü açılamadı: ${errorMessage(err)}` }
      });
    }
  };

  /** Ajan özelleştirme eylemlerinin ortak girişi: kök + skill yöneticisi + takma ad çözülmüş rol. */
  const resolveAgentRoleTarget = (role: string | undefined) => {
    const workspaceRoot = getActiveWorkspaceRoot();
    const agentCore = ctx.getAgentCore();
    if (!workspaceRoot || !agentCore || !role) return undefined;
    const resolvedRole = (ROLE_ALIASES[role.toLowerCase()] || role).toLowerCase();
    return { workspaceRoot, skillManager: agentCore.getSkillManager(), role: resolvedRole };
  };

  /** Ajan dosyası değişimlerinden sonra özelleştirme listesini yeniden yükleyip arayüze gönderir. */
  const publishCustomizations = async (skillManager: SkillManager, workspaceRoot: string): Promise<void> => {
    await skillManager.loadWorkspaceCustomizations(workspaceRoot);
    ctx.postMessage({
      type: 'CUSTOMIZATIONS_LOADED',
      payload: await ctx.buildCustomizationsPayload(workspaceRoot)
    });
  };

  return {
    SAVE_SETTINGS: async (message) => {
      await ctx.updateSettings(message.payload);
    },

    FETCH_MODELS: async (message) => {
      const provider = message.payload.provider;
      const settings = ctx.getSettings();
      try {
        const models = await fetchModelIds({
          provider,
          apiKey: message.payload.apiKey,
          baseUrl: message.payload.baseUrl,
          storedKeys: settings.apiKeys,
          storedOllamaBaseUrl: settings.ollamaBaseUrl,
          storedOpenAiCompatibleBaseUrl: settings.openAiCompatibleBaseUrl,
          storedCustomBaseUrl: settings.customBaseUrl
        });
        ctx.postMessage({ type: 'MODELS_LOADED', payload: { provider, models } });
      } catch (err) {
        ctx.postMessage({
          type: 'MODELS_LOADED',
          payload: { provider, models: [], error: errorMessage(err) }
        });
      }
    },

    FETCH_QUOTA: async () => {
      const settings = ctx.getSettings();
      const provider = settings.selectedProvider;
      if (provider !== 'evren') {
        ctx.postMessage({ type: 'QUOTA_LOADED', payload: { provider } });
        return;
      }
      try {
        const quota = await EvrenModelProvider.fetchQuota(
          settings.apiKeys.evren || '',
          settings.customBaseUrl || undefined
        );
        ctx.postMessage({ type: 'QUOTA_LOADED', payload: { provider, quota } });
      } catch (err) {
        ctx.postMessage({
          type: 'QUOTA_LOADED',
          payload: { provider, error: errorMessage(err) }
        });
      }
    },

    GET_MCP_STATUS: async () => {
      const agentCore = ctx.getAgentCore();
      const servers = agentCore ? agentCore.getMcpHub().getServerStatuses() : [];
      ctx.postMessage({ type: 'MCP_STATUS_LOADED', payload: { servers } });
    },

    OPEN_MCP_CONFIG: async () => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        const workspaceRoot = getActiveWorkspaceRoot();
        await agentCore.getMcpHub().openConfigFile(workspaceRoot);
      }
    },

    RESTART_MCP: async () => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        const workspaceRoot = getActiveWorkspaceRoot();
        await agentCore.getMcpHub().initialize(workspaceRoot, { userInitiated: true });
        const servers = agentCore.getMcpHub().getServerStatuses();
        ctx.postMessage({ type: 'MCP_STATUS_LOADED', payload: { servers } });
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'info', message: 'MCP sunucuları yeniden tarandı.' }
        });
      }
    },

    GET_CUSTOMIZATIONS: async (message) => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        const workspaceRoot = getActiveWorkspaceRoot();
        await agentCore.getSkillManager().loadWorkspaceCustomizations(workspaceRoot);
        ctx.postMessage({
          type: 'CUSTOMIZATIONS_LOADED',
          payload: await ctx.buildCustomizationsPayload(workspaceRoot, message.payload?.reload)
        });
      }
    },

    GET_PROJECT_PROFILE: async (message) => {
      const workspaceRoot = getActiveWorkspaceRoot();
      if (!workspaceRoot) {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'warning', message: 'Bir çalışma alanı klasörü açın.' }
        });
        return;
      }
      try {
        // rescan: otomatik taramayı zorla; elle kaydedilmiş profil korunur.
        let profile: ProjectProfile;
        if (message.payload?.rescan) {
          profile = await profileWorkspace(workspaceRoot);
          await saveProfile(workspaceRoot, profile);
          invalidateProjectTeamContext(workspaceRoot);
        } else {
          profile = await resolveProfile(workspaceRoot);
        }
        ctx.postMessage({ type: 'PROJECT_PROFILE_LOADED', payload: { profile } });
      } catch (err) {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'error', message: errorMessage(err, 'Proje profili okunamadı.') }
        });
      }
    },

    SAVE_PROJECT_PROFILE: async (message) => {
      const workspaceRoot = getActiveWorkspaceRoot();
      if (!workspaceRoot) {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'warning', message: 'Bir çalışma alanı klasörü açın.' }
        });
        return;
      }
      const { primaryKind, stacks, monorepo } = message.payload;
      // Webview'dan gelen veri güvenilmezdir: kimlikler çalışma zamanında süzülür.
      if (!PROJECT_KIND_IDS.includes(primaryKind)) {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'error', message: 'Bilinmeyen proje türü seçimi.' }
        });
        return;
      }
      const safeStacks = [...new Set(stacks.filter((s) => PROJECT_STACK_IDS.includes(s)))].sort();
      const profile: ProjectProfile = {
        version: 1,
        generatedAt: new Date().toISOString(),
        source: 'manual',
        kinds: [primaryKind],
        primaryKind,
        stacks: safeStacks,
        monorepo: Boolean(monorepo),
        confidence: 1,
        evidence: ['Proje türü ve yığın kullanıcı tarafından elle seçildi.']
      };
      try {
        await saveProfile(workspaceRoot, profile);
        // Ekip seçimi profile bağlı: önbellek düşürülür ki yeni ekip hemen geçerli olsun.
        invalidateProjectTeamContext(workspaceRoot);
        ctx.postMessage({ type: 'PROJECT_PROFILE_LOADED', payload: { profile } });
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'info', message: 'Proje profili kaydedildi; uzman ekip yeniden seçildi.' }
        });
      } catch (err) {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'error', message: errorMessage(err, 'Proje profili kaydedilemedi.') }
        });
      }
    },

    GET_KNOWLEDGE_STATUS: async () => {
      await ctx.postKnowledgeStatus();
    },

    REINDEX_KNOWLEDGE: async (message) => {
      const workspaceRoot = getActiveWorkspaceRoot();
      const agentCore = ctx.getAgentCore();
      const store = agentCore?.getKnowledgeStore();
      if (workspaceRoot && store) {
        try {
          await store.indexWorkspace(workspaceRoot, { force: message.payload?.force === true });
          await ctx.postKnowledgeStatus();
          ctx.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'info', message: 'Proje bilgi tabanı oluşturuldu.' }
          });
        } catch (err) {
          await ctx.postKnowledgeStatus();
          ctx.postMessage({
            type: 'NOTIFICATION',
            payload: { level: 'error', message: errorMessage(err, 'Bilgi tabanı oluşturulamadı.') }
          });
        }
      } else {
        await ctx.postKnowledgeStatus();
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'warning', message: 'Bir çalışma alanı klasörü açın.' }
        });
      }
    },

    CLEAR_KNOWLEDGE: async () => {
      const workspaceRoot = getActiveWorkspaceRoot();
      const agentCore = ctx.getAgentCore();
      if (workspaceRoot) {
        await agentCore?.getKnowledgeStore().clear(workspaceRoot);
        await ctx.postKnowledgeStatus();
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'info', message: 'Bilgi tabanı temizlendi.' }
        });
      } else {
        await ctx.postKnowledgeStatus();
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'warning', message: 'Bir çalışma alanı klasörü açın.' }
        });
      }
    },

    ADD_KNOWLEDGE_NOTE: async (message) => {
      const workspaceRoot = getActiveWorkspaceRoot();
      const agentCore = ctx.getAgentCore();
      const note = message.payload.note.trim();
      if (!note) {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'warning', message: 'Not boş olamaz.' }
        });
        return;
      }
      if (!workspaceRoot) {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'warning', message: 'Bir çalışma alanı klasörü açın.' }
        });
        return;
      }
      await agentCore?.getKnowledgeStore().appendNote(workspaceRoot, note);
      await ctx.postKnowledgeStatus();
      ctx.postMessage({
        type: 'NOTIFICATION',
        payload: { level: 'info', message: 'Not proje hafızasına eklendi.' }
      });
    },

    INIT_AGENTS_TEMPLATE: async () => {
      const agentCore = ctx.getAgentCore();
      if (!agentCore) {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'warning', message: 'Ajan henüz hazır değil; sohbeti açıp tekrar deneyin.' }
        });
        return;
      }
      const workspaceRoot = getActiveWorkspaceRoot();
      if (workspaceRoot) {
        const sm = agentCore.getSkillManager();
        await sm.createTemplateStructure(workspaceRoot);
        await sm.loadWorkspaceCustomizations(workspaceRoot);
        ctx.postMessage({
          type: 'CUSTOMIZATIONS_LOADED',
          payload: await ctx.buildCustomizationsPayload(workspaceRoot)
        });
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: {
            level: 'info',
            message: 'Çalışma alanında AGENTS.md ve .agents/ şablonları oluşturuldu.'
          }
        });
      } else {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'error', message: 'Şablon oluşturmadan önce bir çalışma alanı klasörü açın.' }
        });
        ctx.postMessage({
          type: 'CUSTOMIZATIONS_LOADED',
          payload: { hasAgentsMd: false, skills: [], agents: [], memoryEntryCount: 0 }
        });
      }
    },

    CLEAR_PROJECT_MEMORY: async () => {
      const agentCore = ctx.getAgentCore();
      if (agentCore) {
        const workspaceRoot = getActiveWorkspaceRoot();
        const cleared = await agentCore.getProjectMemory().clear(workspaceRoot);
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: {
            level: cleared ? 'info' : 'warning',
            message: cleared ? 'Proje hafızası temizlendi.' : 'Proje hafızası temizlenemedi veya zaten boştu.'
          }
        });
        ctx.postMessage({
          type: 'CUSTOMIZATIONS_LOADED',
          payload: await ctx.buildCustomizationsPayload(workspaceRoot, false)
        });
      }
    },

    START_SUBAGENT: async (message) => {
      const agentCore = ctx.getAgentCore();
      if (!agentCore) {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'warning', message: 'Ajan henüz hazır değil; sohbeti açıp tekrar deneyin.' }
        });
        return;
      }
      try {
        await agentCore.runSubagentFromUi({
          role: message.payload.role,
          task: message.payload.task,
          context: message.payload.context,
          isolate: message.payload.isolate === true
        });
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'info', message: 'Alt ajan tamamlandı; rapor sohbete eklendi.' }
        });
      } catch (err) {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'error', message: errorMessage(err, 'Alt ajan çalıştırılamadı.') }
        });
      }
    },

    CUSTOMIZE_BUILTIN_AGENT: async (message) => {
      const role = message.payload?.role;
      const target = resolveAgentRoleTarget(role);
      if (!target) return;
      const def = getAgentDefinition(target.role);
      if (!def) {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'error', message: `'${role}' adında bir yerleşik ajan bulunamadı.` }
        });
        return;
      }

      const filePath = await target.skillManager.customizeBuiltinAgent(target.workspaceRoot, def);
      await publishCustomizations(target.skillManager, target.workspaceRoot);

      await ctx.openFileInEditor(filePath);
      ctx.postMessage({
        type: 'NOTIFICATION',
        payload: {
          level: 'info',
          message: `"${def.displayName}" ajanı .agents/agents/${def.name}.md konumuna aktarıldı. Kurallarını ve araçlarını özgürce düzenleyebilirsiniz.`
        }
      });
    },

    RESET_BUILTIN_AGENT: async (message) => {
      const target = resolveAgentRoleTarget(message.payload?.role);
      if (!target) return;
      await target.skillManager.resetBuiltinAgent(target.workspaceRoot, target.role);
      await publishCustomizations(target.skillManager, target.workspaceRoot);

      ctx.postMessage({
        type: 'NOTIFICATION',
        payload: { level: 'info', message: 'Ajan varsayılan yerleşik ayarlarına sıfırlandı.' }
      });
    },

    OPEN_AGENTS_FILE: async (message) => {
      if (message.payload?.path) {
        await ctx.openFileInEditor(message.payload.path);
      }
    },

    OPEN_FILE: async (message) => {
      await ctx.openFileInEditor(message.payload.filePath, message.payload.line);
    },

    GET_GIT_CHANGES: async () => {
      await ctx.postGitChanges();
    },

    SHOW_COMMIT: async (message) => {
      const workspaceRoot = getActiveWorkspaceRoot();
      const agentCore = ctx.getAgentCore();
      const git = agentCore?.getGitManager();
      if (!workspaceRoot || !git) {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'warning', message: 'Açık bir çalışma alanı yok.' }
        });
        return;
      }
      try {
        const detail = await git.commitDetail(workspaceRoot, message.payload.commitHash);
        const doc = await vscode.workspace.openTextDocument({ content: detail, language: 'diff' });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (err) {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'error', message: `Commit açılamadı: ${errorMessage(err)}` }
        });
      }
    },

    SHOW_TOOL_DIFF: async (message) => {
      const agentCore = ctx.getAgentCore();
      if (!agentCore) return;
      const snapshot = agentCore.getSnapshotManager().getSnapshotByToolCall(message.payload.toolCallId);
      if (!snapshot) {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'warning', message: 'Bu adım için fark anlık görüntüsü bulunamadı.' }
        });
        return;
      }
      await showSnapshotDiffOrNotify(snapshot);
    },

    PREVIEW_TOOL_DIFF: async (message) => {
      await previewToolDiff(message.payload.toolCallId, ctx);
    },

    SHOW_FILE_DIFF: async (message) => {
      const agentCore = ctx.getAgentCore();
      if (!agentCore) return;
      const snapshot = agentCore
        .getSnapshotManager()
        .getSnapshots()
        .filter((item) => item.filePath === message.payload.filePath)
        .sort((a, b) => a.timestamp - b.timestamp)[0];
      if (!snapshot) {
        await ctx.showGitFileDiff(message.payload.filePath);
        return;
      }
      await showSnapshotDiffOrNotify(snapshot);
    },

    GET_ABOUT_INFO: async () => {
      const extContext = ctx.getExtensionContext();
      ctx.postMessage({
        type: 'ABOUT_INFO_LOADED',
        payload: {
          extensionVersion: String(extContext.extension.packageJSON?.version || '0.0.1'),
          vscodeVersion: vscode.version,
          platform: `${process.platform} (${process.arch})`,
          isTrusted: vscode.workspace.isTrusted,
          workspaceFolders: (vscode.workspace.workspaceFolders || []).map((f) => f.name)
        }
      });
    },

    CALLGRAPH_QUERY: async (message) => {
      const workspaceRoot = getActiveWorkspaceRoot();
      const agentCore = ctx.getAgentCore();
      const manager = agentCore?.getCallGraphManager();
      if (!manager) {
        ctx.postMessage({
          type: 'CALLGRAPH_RESULT',
          payload: {
            action: message.payload.action,
            ready: false,
            building: false,
            message: 'Ajan çekirdeği henüz hazır değil.'
          }
        });
        return;
      }
      try {
        const result = await resolveCallGraphPanelRequest(
          manager,
          workspaceRoot,
          message.payload,
          agentCore?.knowledgeStore
        );
        ctx.postMessage({ type: 'CALLGRAPH_RESULT', payload: result });
      } catch (err) {
        ctx.postMessage({
          type: 'CALLGRAPH_RESULT',
          payload: {
            action: message.payload.action,
            ready: false,
            building: false,
            message: errorMessage(err, 'Çağrı grafiği sorgulanamadı.')
          }
        });
      }
    },

    OPEN_EXTERNAL: async (message) => {
      try {
        const url = new URL(message.payload.url);
        if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'mailto:') {
          throw new Error('Yalnızca http/https/mailto bağlantıları açılabilir.');
        }
        await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
      } catch (err) {
        ctx.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'error', message: `Bağlantı açılamadı: ${errorMessage(err)}` }
        });
      }
    }
  };
}
