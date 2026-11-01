import { AgentCore } from '../core/agent/AgentCore';
import { getActiveWorkspaceRoot } from '../core/workspace/workspaceRoot';
import { collectGitChanges } from './gitChanges';
import { ExtensionToWebviewMessage, WorkspaceCustomizations } from '@evren-kod/core/shared/types';

export interface StatusOpsContext {
  getAgentCore: () => AgentCore | undefined;
  postMessage: (message: ExtensionToWebviewMessage) => void;
}

/**
 * Değişiklikler ekranı için canlı Git durumunu toplar ve webview'a yollar.
 */
export async function postGitChanges(context: StatusOpsContext): Promise<void> {
  const payload = await collectGitChanges(getActiveWorkspaceRoot(), context.getAgentCore()?.getGitManager());
  context.postMessage({ type: 'GIT_CHANGES_LOADED', payload });
}

/**
 * Bilgi tabanı durumunu ve insan tarafından okunabilir bilgi dosyalarını
 * arayüze gönderir.
 */
export async function postKnowledgeStatus(context: StatusOpsContext): Promise<void> {
  const store = context.getAgentCore()?.getKnowledgeStore();
  const workspaceRoot = getActiveWorkspaceRoot();
  if (!store || !workspaceRoot) {
    context.postMessage({
      type: 'KNOWLEDGE_STATUS_LOADED',
      payload: {
        ready: false,
        fileCount: 0,
        symbolCount: 0,
        summarizedCount: 0,
        notes: '',
        project: '',
        conventions: '',
        decisions: '',
        modules: []
      }
    });
    return;
  }

  await store.ensureFresh(workspaceRoot);
  const status = store.getStatus();
  context.postMessage({
    type: 'KNOWLEDGE_STATUS_LOADED',
    payload: {
      ...status,
      notes: await store.getHumanFile('notes'),
      project: await store.getHumanFile('project'),
      conventions: await store.getHumanFile('conventions'),
      decisions: await store.getHumanFile('decisions'),
      modules: store.getSummarizedFiles().map((file) => ({
        path: file.path,
        summary: file.summary || ''
      }))
    }
  });
}

/**
 * Ajanlar/Yetenekler görünümü için tek bir tutarlı veri yükü kurar.
 */
export async function buildCustomizationsPayload(
  agentCore: AgentCore | undefined,
  workspaceRoot: string | undefined,
  reload = true
): Promise<WorkspaceCustomizations> {
  if (!agentCore) {
    return { hasAgentsMd: false, skills: [], agents: [], memoryEntryCount: 0 };
  }

  const sm = agentCore.getSkillManager();
  if (reload) {
    await sm.loadWorkspaceCustomizations(workspaceRoot);
  }
  const memory = await agentCore.getProjectMemory().load(workspaceRoot);

  return {
    hasAgentsMd: Boolean(sm.getAgentsMd()),
    agentsMdPath: sm.getAgentsMdPath(),
    agentsMdContent: sm.getAgentsMd(),
    skills: sm.getSkills().map((s) => ({ name: s.name, description: s.description, path: s.path })),
    agents: sm.getCustomAgents().map((a) => ({
      name: a.name,
      role: a.role,
      description: a.description,
      path: a.path,
      tools: a.allowedTools
    })),
    memoryPath: memory.path,
    memoryContent: memory.content,
    memoryEntryCount: memory.entryCount
  };
}
