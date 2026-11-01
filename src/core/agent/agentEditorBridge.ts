import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { getActiveWorkspaceRoot } from '../workspace/workspaceRoot';
import { resolveWorkspacePath } from '@evren-kod/core/tools/pathSafety';
import { collectMentionSnippets } from '@evren-kod/core/core/agent/fileMentions';
import { logWarning } from '@evren-kod/core/shared/logging';
import { EvrenDiffContentProvider } from '../../shared/diffContentProvider';
import { getLanguageIdForFile } from '@evren-kod/core/shared/languageMap';
import { PermissionManager } from '@evren-kod/core/core/permission/PermissionManager';

export interface EditorBridgeContext {
  permissionManager: PermissionManager;
}

/**
 * Prompt'u @file referansları ve etkin editör/seçim içeriğiyle zenginleştirir
 */
export async function buildEditorContext(
  userText: string,
  workspaceRoot: string | undefined,
  context: EditorBridgeContext
): Promise<string> {
  const contextSnippets: string[] = [];

  // 1. @path ile referans verilen dosyalar. Reddetme kuralları ve hassas dosya
  // koruması burada da tıpkı read_file aracında olduğu gibi uygulanır.
  if (workspaceRoot) {
    contextSnippets.push(
      ...(await collectMentionSnippets(userText, {
        workspaceRoot,
        isBlocked: (relPath: string) =>
          context.permissionManager.isToolBlocked('read_file', { path: relPath }).blocked
      }))
    );
  }

  // 2. Etkin editör dosyası ve seçimi
  const editor = vscode.window.activeTextEditor;
  // Çalışma alanı dışında açılmış bir dosya asla prompt'a sızdırılmamalı:
  // yol tamamen sandbox sınırı dışında olabilir (çalışma alanı kökünün
  // olmaması, danışılacak izin kuralının da olmaması demektir).
  const editorInsideWorkspace = Boolean(
    editor?.document &&
      workspaceRoot &&
      (() => {
        const relative = path.relative(workspaceRoot, editor.document.uri.fsPath);
        return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
      })()
  );

  if (editor && editor.document && editorInsideWorkspace && workspaceRoot) {
    const docPath = editor.document.uri.fsPath;
    const relPath = path.relative(workspaceRoot, docPath);
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    const cursorLine = selection.active.line + 1;

    const selectionBlocked = context.permissionManager.isToolBlocked('read_file', {
      path: relPath
    }).blocked;

    if (selectedText.trim() && !selectionBlocked) {
      const maxSelectionChars = 12000;
      const snippetText =
        selectedText.length > maxSelectionChars
          ? `${selectedText.slice(0, maxSelectionChars)}\n... [${selectedText.length - maxSelectionChars} selection characters truncated]`
          : selectedText;
      contextSnippets.push(
        `[Selected Code in Active Editor (${relPath}, Lines ${selection.start.line + 1}-${selection.end.line + 1})]:\n\`\`\`\n${snippetText}\n\`\`\``
      );
    } else {
      contextSnippets.push(`[Active File]: ${relPath} (Cursor line: ${cursorLine})`);
    }
  }

  if (contextSnippets.length === 0) return '';
  return '\n\n' + contextSnippets.join('\n\n');
}

/** Önerilen içeriği mevcut dosyayla karşılaştıran sanal diff görünümü açar. */
export async function openDiffPreview(filePath: string, proposedContent: string): Promise<void> {
  const workspaceRoot = getActiveWorkspaceRoot();

  try {
    const fullPath = workspaceRoot ? resolveWorkspacePath(filePath, workspaceRoot) : filePath;
    const language = getLanguageIdForFile(fullPath);
    const diffProvider = EvrenDiffContentProvider.getInstance();

    let originalUri: vscode.Uri;
    let label: string;
    try {
      await fs.access(fullPath);
      originalUri = vscode.Uri.file(fullPath);
      label = `${path.basename(fullPath)} ↔ Evren (Önerilen Fark)`;
    } catch {
      const emptyUri = vscode.Uri.from({
        scheme: EvrenDiffContentProvider.scheme,
        path: '/' + filePath,
        query: 'empty'
      });
      diffProvider.setDocumentContent(emptyUri, '');
      originalUri = emptyUri;
      label = `${path.basename(fullPath)} (Yeni Dosya) ↔ Evren`;
    }

    const proposedUri = vscode.Uri.from({
      scheme: EvrenDiffContentProvider.scheme,
      path: '/' + filePath,
      query: 'proposed'
    });
    diffProvider.setDocumentContent(proposedUri, proposedContent);

    try {
      const virtualDoc = await vscode.workspace.openTextDocument(proposedUri);
      if (virtualDoc.languageId !== language) {
        await vscode.languages.setTextDocumentLanguage(virtualDoc, language);
      }
    } catch {
      // Dil atanmasa da diff açılır
    }

    await vscode.commands.executeCommand('vscode.diff', originalUri, proposedUri, label);
  } catch (err) {
    logWarning('Could not open the diff view automatically', err);
  }
}

/** Değiştirilen veya yazılan dosyayı doğrudan VS Code editöründe açar ve odaklar. */
export async function openFileInEditor(filePath: string, workspaceRoot?: string): Promise<void> {
  try {
    const root = workspaceRoot ?? getActiveWorkspaceRoot();
    const fullPath = root ? resolveWorkspacePath(filePath, root) : filePath;
    const fileUri = vscode.Uri.file(fullPath);
    const doc = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
  } catch (err) {
    logWarning('Could not open file in editor automatically', err);
  }
}
