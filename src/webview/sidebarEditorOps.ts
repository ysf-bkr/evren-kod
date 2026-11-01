import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AgentCore } from '../core/agent/AgentCore';
import { getActiveWorkspaceRoot } from '../core/workspace/workspaceRoot';
import { resolveWorkspacePath } from '@evren-kod/core/tools/pathSafety';
import { errorMessage } from '@evren-kod/core/shared/errors';
import { EvrenDiffContentProvider } from '../shared/diffContentProvider';
import { getLanguageIdForFile } from '@evren-kod/core/shared/languageMap';
import { ExtensionToWebviewMessage, WorkspaceCustomizations } from '@evren-kod/core/shared/types';

export interface EditorOpsContext {
  getAgentCore: () => AgentCore | undefined;
  postMessage: (message: ExtensionToWebviewMessage) => void;
  diffProvider: EvrenDiffContentProvider;
  buildCustomizationsPayload: (workspaceRoot: string | undefined) => Promise<WorkspaceCustomizations>;
}

/**
 * Webview'den seçilen bir dosyayı metin düzenleyicide açar. Yol, çalışma
 * alanı hapsinden geçer; mutlak yollar da kök dışına çıkamaz.
 */
export async function openFileInEditor(
  filePath: string,
  line: number | undefined,
  context: EditorOpsContext
): Promise<void> {
  try {
    const workspaceRoot = getActiveWorkspaceRoot();
    const targetPath = resolveWorkspacePath(filePath, workspaceRoot ?? undefined);

    let fileExists = true;
    try {
      await fs.promises.access(targetPath);
    } catch {
      fileExists = false;
    }

    if (!fileExists) {
      const baseName = path.basename(targetPath).toLowerCase();
      if (baseName === 'agents.md' || baseName === '.agents.md' || baseName === 'agent.md') {
        const agentCore = context.getAgentCore();
        if (workspaceRoot) {
          await agentCore?.getSkillManager().createTemplateStructure(workspaceRoot);
        } else {
          const template = `# Evren Project Guidelines (AGENTS.md)\n\nThis file defines the core principles that the Evren agent must follow.\n`;
          await fs.promises.writeFile(targetPath, template, 'utf-8');
        }
        context.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'info', message: 'Çalışma alanında AGENTS.md oluşturuldu ve açıldı.' }
        });
        if (workspaceRoot) {
          context.postMessage({
            type: 'CUSTOMIZATIONS_LOADED',
            payload: await context.buildCustomizationsPayload(workspaceRoot)
          });
        }
      } else if (baseName === '.evren-kod-rules' || baseName === 'evren-kod-rules') {
        const rulesTemplate = `# Çalışma Alanı Kuralları (.evren-kod-rules)\n# Bu dosyaya projenize özel kodlama ve mimari kurallarını ekleyebilirsiniz.\n`;
        await fs.promises.writeFile(targetPath, rulesTemplate, 'utf-8');
        context.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'info', message: 'Çalışma alanında .evren-kod-rules oluşturuldu ve açıldı.' }
        });
      } else {
        context.postMessage({
          type: 'NOTIFICATION',
          payload: { level: 'warning', message: `Dosya bulunamadı: ${path.basename(targetPath)}` }
        });
        return;
      }
    }

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    const zeroBased = typeof line === 'number' && line >= 1 ? line - 1 : undefined;
    await vscode.window.showTextDocument(doc, {
      ...(zeroBased !== undefined
        ? {
            selection: new vscode.Range(zeroBased, 0, zeroBased, 0),
            preserveFocus: false
          }
        : {})
    });
  } catch (err) {
    context.postMessage({
      type: 'NOTIFICATION',
      payload: { level: 'error', message: `Dosya açılamadı: ${errorMessage(err)}` }
    });
  }
}

/** Tek dosyanın commit edilmemiş farkını düzenlenebilir diff görünümünde gösterir. */
export async function showGitFileDiff(filePath: string, context: EditorOpsContext): Promise<void> {
  try {
    const root = getActiveWorkspaceRoot();
    if (!root) throw new Error('Çalışma alanı kökü bulunamadı.');
    const fullPath = resolveWorkspacePath(filePath, root);
    const relPath = path.relative(root, fullPath).replace(/\\/g, '/');

    let headContent = '';
    try {
      const gm = context.getAgentCore()?.getGitManager();
      if (gm) {
        headContent = await gm.getFileHeadContent(root, relPath);
      }
    } catch {
      headContent = '';
    }

    const originalUri = vscode.Uri.from({
      scheme: EvrenDiffContentProvider.scheme,
      path: '/' + relPath,
      query: 'git-head'
    });
    context.diffProvider.setDocumentContent(originalUri, headContent);

    try {
      const langId = getLanguageIdForFile(relPath);
      const virtualDoc = await vscode.workspace.openTextDocument(originalUri);
      if (virtualDoc.languageId !== langId) {
        await vscode.languages.setTextDocumentLanguage(virtualDoc, langId);
      }
    } catch {
      // Renklendirme başarısız olsa da diff açılır
    }

    const fileUri = vscode.Uri.file(fullPath);
    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      fileUri,
      `${path.basename(filePath)} (HEAD ↔ Çalışma Kopyası [Düzenlenebilir])`
    );
  } catch (err) {
    context.postMessage({
      type: 'NOTIFICATION',
      payload: { level: 'warning', message: `Fark görünümü açılamadı: ${errorMessage(err)}` }
    });
  }
}

/** Snapshot farkını diff penceresinde açar. */
export async function showSnapshotDiff(
  filePath: string,
  originalContent: string,
  context: EditorOpsContext
): Promise<void> {
  const root = getActiveWorkspaceRoot();
  const fullPath = root ? resolveWorkspacePath(filePath, root) : filePath;
  const fileUri = vscode.Uri.file(fullPath);

  const originalUri = vscode.Uri.from({
    scheme: EvrenDiffContentProvider.scheme,
    path: '/' + filePath,
    query: 'snapshot'
  });
  context.diffProvider.setDocumentContent(originalUri, originalContent);

  try {
    const langId = getLanguageIdForFile(filePath);
    const virtualDoc = await vscode.workspace.openTextDocument(originalUri);
    if (virtualDoc.languageId !== langId) {
      await vscode.languages.setTextDocumentLanguage(virtualDoc, langId);
    }
  } catch {
    // Renklendirme başarısız olsa da diff açılır
  }

  await vscode.commands.executeCommand(
    'vscode.diff',
    originalUri,
    fileUri,
    `${path.basename(filePath)} (Ajan Öncesi ↔ Çalışma Kopyası)`
  );
}

/**
 * Bekleyen araç adımının diff önizlemesini açar. Handler bağlamıyla
 * uyumlu olacak şekilde yalnızca gereken iki yetkinlik istenir.
 */
export async function previewToolDiff(
  toolCallId: string,
  context: Pick<EditorOpsContext, 'getAgentCore' | 'postMessage'>
): Promise<void> {
  const agentCore = context.getAgentCore();
  if (!agentCore) return;

  const pending = agentCore.getState().pendingToolCall;
  const targetTool =
    pending && pending.id === toolCallId
      ? pending
      : agentCore
          .getState()
          .messages.flatMap((m) => m.toolCalls || [])
          .find((tc) => tc.id === toolCallId);

  if (!targetTool) {
    context.postMessage({
      type: 'NOTIFICATION',
      payload: { level: 'warning', message: 'Önizlenecek araç adımı bulunamadı.' }
    });
    return;
  }

  const targetPath =
    typeof targetTool.args?.path === 'string'
      ? targetTool.args.path
      : typeof targetTool.args?.filePath === 'string'
        ? targetTool.args.filePath
        : '';

  if (!targetPath) return;

  try {
    const root = getActiveWorkspaceRoot();
    if (targetTool.name === 'write_file') {
      const content = typeof targetTool.args?.content === 'string' ? targetTool.args.content : '';
      await agentCore.openDiffPreview(targetPath, content);
    } else if (targetTool.name === 'edit_file') {
      const safePath = root ? resolveWorkspacePath(targetPath, root) : targetPath;
      const current = await fs.promises.readFile(safePath, 'utf-8');
      const targetText = typeof targetTool.args?.targetText === 'string' ? targetTool.args.targetText : '';
      const replacementText =
        typeof targetTool.args?.replacementText === 'string' ? targetTool.args.replacementText : '';
      const allowMultiple = Boolean(targetTool.args?.allowMultiple);
      const modified = allowMultiple
        ? current.split(targetText).join(replacementText)
        : current.replace(targetText, () => replacementText);
      await agentCore.openDiffPreview(targetPath, modified);
    }
  } catch (err) {
    context.postMessage({
      type: 'NOTIFICATION',
      payload: { level: 'error', message: `Diff önizlemesi açılamadı: ${errorMessage(err)}` }
    });
  }
}
