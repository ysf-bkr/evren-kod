import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Eye, FileDiff, FolderOpen, Undo2 } from 'lucide-react';
import { ToolCall } from '@shared/types';
import { Button } from '../ui';
import { VisualDiffViewer } from '../diff/VisualDiffViewer';
import { vscode } from '../../utils/vscode';

export interface ModifiedFileItem {
  path: string;
  action: 'create' | 'edit';
  toolCallId: string;
  status: ToolCall['status'];
  diffPreview?: string;
  additions: number;
  deletions: number;
}

/**
 * Araç çağrısından görsel diff metni ve ekleme/silme sayılarını üretir.
 */
function buildDiffPreview(
  tc: ToolCall,
  path: string
): { diffText: string; additions: number; deletions: number } {
  // 1. Fast Apply veya doğrudan iletilen diff parametresi
  if (typeof tc.args?.diff === 'string' && tc.args.diff.trim()) {
    const rawDiff = tc.args.diff.trim();
    const additions = (rawDiff.match(/^\+[^+]/gm) || []).length;
    const deletions = (rawDiff.match(/^-[^-]/gm) || []).length;
    return {
      diffText: rawDiff.startsWith('---') ? rawDiff : `--- a/${path}\n+++ b/${path}\n${rawDiff}`,
      additions: Math.max(additions, 1),
      deletions
    };
  }

  if (tc.name === 'edit_file' || (tc.name as string) === 'apply_diff') {
    const target = String(tc.args?.targetText ?? tc.args?.target ?? '').trim();
    const replacement = String(tc.args?.replacementText ?? tc.args?.replacement ?? '').trim();
    const targetLines = target ? target.split('\n') : [];
    const replLines = replacement ? replacement.split('\n') : [];
    const delBlock = targetLines.map((l) => `-${l}`).join('\n');
    const addBlock = replLines.map((l) => `+${l}`).join('\n');
    const header = `@@ -1,${Math.max(targetLines.length, 1)} +1,${Math.max(replLines.length, 1)} @@`;
    const body = [delBlock, addBlock].filter(Boolean).join('\n');
    return {
      diffText: `--- a/${path}\n+++ b/${path}\n${header}\n${body}`,
      additions: replLines.length,
      deletions: targetLines.length
    };
  }
  if (tc.name === 'write_file') {
    const content = String(tc.args?.content || '');
    const lines = content.length > 0 ? content.split('\n') : [];
    const prefixed = lines.map((l) => `+${l}`).join('\n');
    return {
      diffText: `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${Math.max(lines.length, 1)} @@\n${prefixed}`,
      additions: lines.length,
      deletions: 0
    };
  }
  return { diffText: '', additions: 0, deletions: 0 };
}

/**
 * Asistan mesajındaki araç çağrılarından dosya oluşturan veya değiştiren adımları toplar.
 * Aynı dosya birden fazla kez düzenlendiyse son işlem durumunu korur.
 */
export function extractModifiedFiles(toolCalls?: ToolCall[]): ModifiedFileItem[] {
  if (!toolCalls || toolCalls.length === 0) return [];

  const filesMap = new Map<string, ModifiedFileItem>();

  for (const tc of toolCalls) {
    if (tc.name !== 'write_file' && tc.name !== 'edit_file' && (tc.name as string) !== 'apply_diff') {
      continue;
    }
    const path =
      typeof tc.args?.path === 'string'
        ? tc.args.path
        : typeof tc.args?.filePath === 'string'
          ? tc.args.filePath
          : typeof tc.args?.file === 'string'
            ? tc.args.file
            : typeof tc.args?.targetPath === 'string'
              ? tc.args.targetPath
              : '';
    if (!path) continue;

    const preview = buildDiffPreview(tc, path);

    filesMap.set(path, {
      path,
      action: tc.name === 'write_file' ? 'create' : 'edit',
      toolCallId: tc.id,
      status: tc.status,
      diffPreview: preview.diffText,
      additions: preview.additions,
      deletions: preview.deletions
    });
  }

  return Array.from(filesMap.values());
}

interface TurnChangesReviewProps {
  toolCalls?: ToolCall[];
}

/**
 * Tur boyunca üretilen tüm dosya değişikliklerini Antigravity / Cursor tarzında tek bir
 * inceleme (review) kartında toplar ve kullanıcıya dosya bazlı ya da toplu fark inceleme olanağı sunar.
 */
export const TurnChangesReview: React.FC<TurnChangesReviewProps> = ({ toolCalls }) => {
  const files = extractModifiedFiles(toolCalls);
  // Tek bir dosya düzenlendiğinde fark doğrudan açık gelsin
  const [activeDiffPath, setActiveDiffPath] = useState<string | null>(
    files.length === 1 ? (files[0]?.path ?? null) : null
  );

  if (files.length === 0) return null;

  const firstCompleted = files.find((f) => f.status === 'completed') ?? files[0];
  const totalAdditions = files.reduce((acc, f) => acc + f.additions, 0);
  const totalDeletions = files.reduce((acc, f) => acc + f.deletions, 0);

  return (
    <div
      data-testid="turn-changes-review"
      className="mt-2 overflow-hidden rounded-lg border evren-kod-border-brand evren-kod-bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b evren-kod-border-surface evren-kod-bg-base px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileDiff className="evren-kod-icon-sm shrink-0 evren-kod-text-brand" />
          <span className="evren-kod-title">Kod Değişiklikleri</span>
          <span className="rounded-full evren-kod-bg-brand-soft px-1.5 py-0.5 font-mono text-2xs font-medium evren-kod-text-brand">
            {files.length} dosya
          </span>
          {(totalAdditions > 0 || totalDeletions > 0) && (
            <span className="flex items-center gap-1 font-mono text-2xs font-semibold">
              {totalAdditions > 0 && <span className="text-emerald-500">+{totalAdditions}</span>}
              {totalDeletions > 0 && <span className="text-rose-500">-{totalDeletions}</span>}
            </span>
          )}
        </div>

        {firstCompleted && (
          <Button
            size="xs"
            variant="primary"
            onClick={() =>
              vscode.postMessage({
                type: 'SHOW_TOOL_DIFF',
                payload: { toolCallId: firstCompleted.toolCallId }
              })
            }
            title="Değişiklikleri editörde fark (diff) görünümünde incele"
            icon={<Eye className="evren-kod-icon-xs" />}
          >
            İncele (Diff)
          </Button>
        )}
      </div>

      <div className="divide-y divide-[var(--evren-kod-surface-border)]">
        {files.map((file) => {
          const isDiffOpen = activeDiffPath === file.path;
          return (
            <div key={`${file.toolCallId}-${file.path}`} className="flex flex-col">
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 transition-colors hover:bg-[var(--evren-kod-hover-bg)]">
                <button
                  type="button"
                  onClick={() => setActiveDiffPath(isDiffOpen ? null : file.path)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  title={isDiffOpen ? 'Satır içi farkı kapat' : 'Satır içi farkı göster'}
                >
                  {isDiffOpen ? (
                    <ChevronDown className="evren-kod-icon-xs shrink-0 text-[var(--evren-kod-brand)]" />
                  ) : (
                    <ChevronRight className="evren-kod-icon-xs shrink-0 text-[var(--evren-kod-text-muted)]" />
                  )}
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-2xs font-medium ${
                      file.action === 'create'
                        ? 'border evren-kod-border-success evren-kod-bg-success evren-kod-text-success'
                        : 'border evren-kod-border-brand evren-kod-bg-brand-soft evren-kod-text-brand'
                    }`}
                  >
                    {file.action === 'create' ? '+ Yeni' : '• Düzenlendi'}
                  </span>
                  <span className="min-w-0 truncate font-mono text-xs evren-kod-text-fg" title={file.path}>
                    {file.path}
                  </span>
                  <div className="flex items-center gap-1 font-mono text-2xs shrink-0 ml-1">
                    {file.additions > 0 && (
                      <span className="text-emerald-500 font-semibold">+{file.additions}</span>
                    )}
                    {file.deletions > 0 && (
                      <span className="text-rose-500 font-semibold">-{file.deletions}</span>
                    )}
                  </div>
                </button>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="xs"
                    variant={isDiffOpen ? 'primary' : 'ghost'}
                    onClick={() => setActiveDiffPath(isDiffOpen ? null : file.path)}
                    title={isDiffOpen ? 'Satır içi farkı kapat' : 'Farkı burada göster'}
                    aria-label="Farkı burada göster"
                    icon={<FileDiff className="evren-kod-icon-xs" />}
                  >
                    {isDiffOpen ? 'Kapat' : 'Fark'}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      vscode.postMessage({
                        type: 'OPEN_FILE',
                        payload: { filePath: file.path, line: 1 }
                      })
                    }
                    title="Dosyayı aç"
                    aria-label="Dosyayı aç"
                    icon={<FolderOpen className="evren-kod-icon-xs" />}
                  >
                    Aç
                  </Button>
                  {file.status === 'completed' && (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        vscode.postMessage({
                          type: 'REVERT_TOOL_SNAPSHOT',
                          payload: { toolCallId: file.toolCallId }
                        })
                      }
                      title="Bu dosyadaki değişikliği geri al"
                      aria-label="Bu dosyadaki değişikliği geri al"
                      icon={<Undo2 className="evren-kod-icon-xs" />}
                    >
                      Geri al
                    </Button>
                  )}
                </div>
              </div>

              {/* Satır içi görsel fark kutusu */}
              {isDiffOpen && file.diffPreview && (
                <div className="px-2 pb-2">
                  <VisualDiffViewer filePath={file.path} diffText={file.diffPreview} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
