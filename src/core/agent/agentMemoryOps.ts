import * as path from 'path';
import { ProjectMemoryStatus } from '@evren-kod/core/core/memory/ProjectMemoryManager';
import type { AgentCore } from './AgentCore';

/**
 * Görev sonucunu proje hafızasına ve anlamsal belleğe işler.
 */
export async function recordProjectMemory(
  core: AgentCore,
  turnId: string,
  prompt: string,
  status: ProjectMemoryStatus,
  summary: string | undefined,
  workspaceRoot: string | undefined
): Promise<void> {
  if (!workspaceRoot || !core.state.id) return;
  await core.projectMemory.append(workspaceRoot, {
    taskId: turnId,
    mode: core.state.mode,
    status,
    prompt,
    files: core.state.stats.filesModified,
    summary
  });
  void core.vectorMemory.sync(workspaceRoot, true);
}

/**
 * Oturumun anlık görüntü ve checkpoint kayıtlarını diskten yükler.
 * Oturum/kök çifti başına yalnızca bir kez çalışır.
 */
export async function ensureSessionPersistence(core: AgentCore, workspaceRoot: string): Promise<void> {
  if (!core.state.id) return;
  const resolvedRoot = path.resolve(workspaceRoot);

  const { managersChanged, rootChanged } = await core.persistence.ensure(
    workspaceRoot,
    core.state.id,
    resolvedRoot
  );

  if (managersChanged) {
    core.rebuildPersistenceDependents();
  }

  await core.verificationManager.attachWorkspace(workspaceRoot);
  if (core.verificationManager.getBaseline()) {
    core.baselineCaptured = true;
  }
  core.state.checkpoints = core.checkpointManager.getSummaries();
  core.planner.hydrate(core.state.plan);
  core.modulePlanner.hydrate(core.state.modules);

  if (rootChanged) {
    core.notify({
      level: 'info',
      message: `Çalışma alanı kökü değişti. Bu kök için geri alma kayıtları yüklendi: ${path.basename(workspaceRoot)}`
    });
  }
}
