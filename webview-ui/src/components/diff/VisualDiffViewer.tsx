import React, { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, FileDiff } from 'lucide-react';
import { Button } from '../ui';
import { vscode } from '../../utils/vscode';

export interface DiffLine {
  type: 'add' | 'delete' | 'context' | 'header';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface VisualDiffViewerProps {
  filePath: string;
  diffText: string;
  onAccept?: () => void;
  onReject?: () => void;
  defaultExpanded?: boolean;
}

/**
 * Ham unified diff metnini görsel satırlara ayrıştırır.
 */
export function parseUnifiedDiff(diffText: string): DiffLine[] {
  const lines = diffText.split('\n');
  const result: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1] || '1', 10);
        newLine = parseInt(match[2] || '1', 10);
      }
      result.push({ type: 'header', content: line });
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      result.push({
        type: 'add',
        newLineNumber: newLine++,
        content: line.slice(1)
      });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      result.push({
        type: 'delete',
        oldLineNumber: oldLine++,
        content: line.slice(1)
      });
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      // Dosya başlığı satırları
      result.push({ type: 'header', content: line });
    } else {
      result.push({
        type: 'context',
        oldLineNumber: oldLine++,
        newLineNumber: newLine++,
        content: line.startsWith(' ') ? line.slice(1) : line
      });
    }
  }

  return result;
}

/**
 * Görsel Kod Farkı (Diff) Görüntüleyici.
 *
 * Kullanıcının veya ajanın yaptığı dosya değişikliklerini ve çakışma durumlarını
 * webview arayüzünde satır bazında ve renkli olarak inceler.
 */
export const VisualDiffViewer: React.FC<VisualDiffViewerProps> = ({
  filePath,
  diffText,
  onAccept,
  onReject,
  defaultExpanded = true
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);
  const parsedLines = parseUnifiedDiff(diffText);

  const handleCopy = () => {
    navigator.clipboard?.writeText(diffText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenInEditor = () => {
    const firstChangeLine =
      parsedLines.find((l) => l.type === 'add' || l.type === 'delete')?.newLineNumber ??
      parsedLines.find((l) => l.type === 'add' || l.type === 'delete')?.oldLineNumber ??
      1;
    vscode.postMessage({
      type: 'OPEN_FILE',
      payload: { filePath, line: firstChangeLine }
    });
  };

  const additions = parsedLines.filter((l) => l.type === 'add').length;
  const deletions = parsedLines.filter((l) => l.type === 'delete').length;

  return (
    <div
      data-testid="visual-diff-viewer"
      className="my-2 overflow-hidden rounded-lg border border-[var(--evren-kod-surface-border)] bg-[var(--evren-kod-bg-base)] text-xs font-mono"
    >
      {/* Başlık çubuğu */}
      <div className="flex items-center justify-between gap-1.5 flex-wrap border-b border-[var(--evren-kod-surface-border)] bg-[var(--evren-kod-surface-bg)] px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 items-center gap-2 text-left hover:opacity-80"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-[var(--evren-kod-text-muted)]" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-[var(--evren-kod-text-muted)]" />
          )}
          <FileDiff className="h-4 w-4 shrink-0 text-[var(--evren-kod-brand)]" />
          <span className="truncate font-sans font-medium text-[var(--evren-kod-text-primary)]">
            {filePath}
          </span>
          <div className="flex items-center gap-1 font-mono text-2xs shrink-0">
            <span className="text-emerald-500 font-semibold">+{additions}</span>
            <span className="text-rose-500 font-semibold">-{deletions}</span>
            <span className="text-[var(--evren-kod-text-muted)] ml-1">({additions + deletions} satır)</span>
          </div>
        </button>

        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant="ghost"
            onClick={handleCopy}
            title="Diff çıktısını panoya kopyala"
            icon={copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          >
            {copied ? 'Kopyalandı' : 'Kopyala'}
          </Button>

          <Button
            size="xs"
            variant="ghost"
            onClick={handleOpenInEditor}
            title="Dosyayı doğrudan editörde aç"
            data-testid="diff-open-in-editor"
            icon={<ExternalLink className="h-3 w-3" />}
          >
            Aç
          </Button>

          {onAccept && (
            <Button size="xs" variant="primary" onClick={onAccept}>
              Onayla
            </Button>
          )}

          {onReject && (
            <Button size="xs" variant="secondary" onClick={onReject}>
              Reddet
            </Button>
          )}
        </div>
      </div>

      {/* Diff Satırları */}
      {expanded && (
        <div className="max-h-96 overflow-x-auto overflow-y-auto divide-y divide-[var(--evren-kod-surface-border)]">
          {parsedLines.map((line, idx) => {
            if (line.type === 'header') {
              return (
                <div
                  key={`hdr-${idx}`}
                  className="bg-[var(--evren-kod-hover-bg)] px-3 py-1 font-bold text-[var(--evren-kod-text-muted)] select-none text-2xs"
                >
                  {line.content}
                </div>
              );
            }

            const isAdd = line.type === 'add';
            const isDel = line.type === 'delete';

            const bgClass = isAdd
              ? 'bg-emerald-950/20 text-emerald-400'
              : isDel
                ? 'bg-rose-950/20 text-rose-400'
                : 'text-[var(--evren-kod-text-primary)]';

            const prefix = isAdd ? '+' : isDel ? '-' : ' ';

            return (
              <div key={`line-${idx}`} className={`flex items-start ${bgClass} hover:opacity-90`}>
                <div className="w-10 shrink-0 select-none text-right pr-2 text-2xs text-[var(--evren-kod-text-muted)] border-r border-[var(--evren-kod-surface-border)]">
                  {line.oldLineNumber ?? ''}
                </div>
                <div className="w-10 shrink-0 select-none text-right pr-2 text-2xs text-[var(--evren-kod-text-muted)] border-r border-[var(--evren-kod-surface-border)]">
                  {line.newLineNumber ?? ''}
                </div>
                <div className="w-4 shrink-0 select-none text-center font-bold">{prefix}</div>
                <pre className="flex-1 overflow-x-auto px-1 py-0.5 whitespace-pre font-mono text-2xs">
                  {line.content}
                </pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
