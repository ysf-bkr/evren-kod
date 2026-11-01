import * as vscode from 'vscode';
import * as path from 'path';
import { AgentCore } from '../core/agent/AgentCore';
import { getActiveWorkspaceRoot } from '../core/workspace/workspaceRoot';
import { errorMessage } from '@evren-kod/core/shared/errors';
import { ExtensionToWebviewMessage } from '@evren-kod/core/shared/types';

export interface SessionOpsContext {
  getAgentCore: () => AgentCore | undefined;
  postMessage: (message: ExtensionToWebviewMessage) => void;
  loadSession: (sessionId: string) => Promise<void>;
}

/**
 * Kayıtlı bir oturumu kullanıcının seçtiği dosyaya dışa aktarır.
 */
export async function exportSession(
  taskId: string,
  format: 'json' | 'markdown',
  context: SessionOpsContext
): Promise<void> {
  const agentCore = context.getAgentCore();
  if (!agentCore) return;

  const content = agentCore.getHistoryManager().exportSession(taskId, format);
  if (content === undefined) {
    context.postMessage({
      type: 'NOTIFICATION',
      payload: { level: 'error', message: 'Dışa aktarılacak oturum bulunamadı.' }
    });
    return;
  }

  const task = agentCore.getHistoryManager().getTask(taskId);
  const slug =
    (task?.prompt || taskId)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'oturum';
  const extension = format === 'markdown' ? 'md' : 'json';

  const workspaceRoot = getActiveWorkspaceRoot();
  const target = await vscode.window.showSaveDialog({
    saveLabel: 'Dışa aktar',
    ...(workspaceRoot
      ? { defaultUri: vscode.Uri.file(path.join(workspaceRoot, `${slug}.${extension}`)) }
      : {}),
    filters: format === 'markdown' ? { Markdown: ['md'] } : { 'Evren Kod oturumu': ['json'] }
  });

  if (!target) return; // Kullanıcı vazgeçti.

  await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf-8'));
  context.postMessage({
    type: 'NOTIFICATION',
    payload: {
      level: 'info',
      message: `Oturum ${format === 'markdown' ? 'Markdown' : 'JSON'} olarak dışa aktarıldı: ${path.basename(target.fsPath)}`
    }
  });
}

/**
 * Bir oturum arşivini içe aktarır ve ona geçer.
 */
export async function importSession(context: SessionOpsContext): Promise<void> {
  const agentCore = context.getAgentCore();
  if (!agentCore) return;

  const selection = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'İçe aktar',
    filters: {
      'Evren Kod oturumu': ['json'],
      'Tüm dosyalar': ['*']
    }
  });
  const file = selection?.[0];
  if (!file) return;

  try {
    const raw = Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf-8');
    const { task } = await agentCore.getHistoryManager().importSession(raw);
    const history = agentCore.getHistoryManager().getSummaries();
    context.postMessage({ type: 'TASK_HISTORY_LOADED', payload: { history } });
    await context.loadSession(task.id);
    context.postMessage({
      type: 'NOTIFICATION',
      payload: { level: 'info', message: 'Oturum içe aktarıldı ve yüklendi.' }
    });
  } catch (err) {
    context.postMessage({
      type: 'NOTIFICATION',
      payload: { level: 'error', message: errorMessage(err, 'Oturum içe aktarılamadı.') }
    });
  }
}
