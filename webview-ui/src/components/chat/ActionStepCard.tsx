import React, { useEffect, useState } from 'react';
import {
  Terminal,
  FileCode,
  FolderTree,
  Search,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Globe,
  ListChecks,
  Loader2,
  AlertTriangle,
  Bot,
  FileDiff,
  Undo2,
  HelpCircle,
  BookOpen,
  Stethoscope,
  Wrench
} from 'lucide-react';
import { ToolCall, ToolName } from '@shared/types';
import { Button, Disclosure } from '../ui';
import { ApprovalActionButtons } from '../common/ApprovalActionButtons';
import { TOOL_TITLES, subagentRoleName, toolStepDetail } from '../../utils/toolLabels';
import { vscode } from '../../utils/vscode';

interface ActionStepCardProps {
  toolCall: ToolCall;
  stepNumber: number;
  isPendingApproval?: boolean;
}

/** Adım simgesi: aracın kategorisini taşır; renk tonları durum jetonlarındandır. */
const toolStepIcon = (name: ToolName): React.ReactElement => {
  switch (name) {
    case 'execute_command':
    case 'run_tests':
    case 'run_linter':
    case 'run_verification':
    case 'run_parallel_tasks':
    case 'merge_worktree':
      return <Terminal className="evren-kod-icon-sm evren-kod-text-warning" />;
    case 'write_file':
      return <FileCode className="evren-kod-icon-sm evren-kod-text-success" />;
    case 'edit_file':
      return <FileDiff className="evren-kod-icon-sm evren-kod-text-brand" />;
    case 'read_file':
      return <FileCode className="evren-kod-icon-sm evren-kod-text-brand" />;
    case 'read_notebook':
      return <BookOpen className="evren-kod-icon-sm evren-kod-text-brand" />;
    case 'list_directory':
      return <FolderTree className="evren-kod-icon-sm evren-kod-text-info" />;
    case 'web_fetch':
      return <Globe className="evren-kod-icon-sm evren-kod-text-info" />;
    case 'invoke_subagent':
      return <Bot className="evren-kod-icon-sm evren-kod-text-warning" />;
    case 'ask_followup_question':
      return <HelpCircle className="evren-kod-icon-sm evren-kod-text-brand" />;
    case 'get_diagnostics':
      return <Stethoscope className="evren-kod-icon-sm evren-kod-text-error" />;
    case 'update_plan':
    case 'update_module_plan':
    case 'update_acceptance_criteria':
      return <ListChecks className="evren-kod-icon-sm evren-kod-text-brand" />;
    case 'write_spec':
    case 'read_skill':
    case 'write_knowledge_file':
    case 'add_knowledge_note':
      return <BookOpen className="evren-kod-icon-sm evren-kod-text-info" />;
    default:
      break;
  }
  if (name.startsWith('git_') || name === 'prepare_pr') {
    return <GitBranch className="evren-kod-icon-sm evren-kod-text-muted" />;
  }
  if (
    name.startsWith('get_') ||
    name.startsWith('call_graph') ||
    [
      'search_files',
      'web_search',
      'search_memory',
      'find_symbol',
      'find_related_code',
      'analyze_impact',
      'index_workspace'
    ].includes(name)
  ) {
    return <Search className="evren-kod-icon-sm evren-kod-text-brand" />;
  }
  return <Wrench className="evren-kod-icon-sm evren-kod-text-muted" />;
};

export const ActionStepCard: React.FC<ActionStepCardProps> = ({
  toolCall,
  stepNumber,
  isPendingApproval
}) => {
  const [expanded, setExpanded] = useState(toolCall.status === 'error' || Boolean(isPendingApproval));

  useEffect(() => {
    if (isPendingApproval || toolCall.status === 'error') {
      setExpanded(true);
    }
  }, [isPendingApproval, toolCall.status]);

  // Başlık ve ayrıntı artık tüm araçları kapsayan Türkçe etiket haritasından
  // gelir; ikon yalnızca aracın kategorisini taşır. Böylece hiçbir adım ham
  // İngilizce kimlikle (`update_plan` gibi) ve boş açıklamayla çizilmez.
  const meta = (() => {
    const name = toolCall.name;
    const title =
      name === 'invoke_subagent'
        ? `Alt ajan: ${subagentRoleName(toolCall.args.role)}`
        : (TOOL_TITLES[name] ?? name);
    return { icon: toolStepIcon(name), title, detail: toolStepDetail(toolCall) };
  })();

  const statusChip = (() => {
    switch (toolCall.status) {
      case 'executing':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium evren-kod-text-brand">
            <Loader2 className="evren-kod-icon-xs animate-spin" /> çalışıyor
          </span>
        );
      case 'completed':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium evren-kod-text-success">
            <Check className="evren-kod-icon-xs" /> tamamlandı
          </span>
        );
      case 'error':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium evren-kod-text-error">
            <AlertTriangle className="evren-kod-icon-xs" /> hata
          </span>
        );
      case 'rejected':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium evren-kod-text-muted">
            <X className="evren-kod-icon-xs" /> reddedildi
          </span>
        );
      case 'pending':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium evren-kod-text-warning">
            <AlertTriangle className="evren-kod-icon-xs" /> onay bekliyor
          </span>
        );
      case 'approved':
        return (
          <span className="flex items-center gap-1 text-2xs font-medium evren-kod-text-info">
            <Loader2 className="evren-kod-icon-xs animate-spin" /> onaylandı, çalıştırılıyor
          </span>
        );
      default:
        return null;
    }
  })();

  return (
    <div
      className={`overflow-hidden rounded-md border evren-kod-bg-base transition ${
        isPendingApproval
          ? 'evren-kod-border-warning evren-kod-shadow-sm'
          : 'evren-kod-border-surface hover:border-[var(--evren-kod-focus)]'
      }`}
    >
      {/* Başlık düğmesi ve Diff kısayolu yan yana: düğme içinde düğme geçersiz HTML. */}
      <div className="flex w-full items-center">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left transition hover:bg-[var(--evren-kod-hover-bg)]"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full evren-kod-bg-raised font-mono text-2xs font-semibold evren-kod-text-muted">
            {stepNumber}
          </span>
          <span className="shrink-0">{meta.icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium evren-kod-text-fg">{meta.title}</span>
            {meta.detail && (
              <span className="block truncate font-mono text-2xs evren-kod-text-muted">{meta.detail}</span>
            )}
          </span>
          <span className="shrink-0">{statusChip}</span>
        </button>
        {toolCall.status === 'completed' &&
          (toolCall.name === 'write_file' || toolCall.name === 'edit_file') && (
            <button
              type="button"
              onClick={() =>
                vscode.postMessage({ type: 'SHOW_TOOL_DIFF', payload: { toolCallId: toolCall.id } })
              }
              className="mr-2 flex shrink-0 items-center gap-1 rounded border evren-kod-border-brand evren-kod-bg-brand-soft px-1.5 py-0.5 font-mono text-2xs font-medium evren-kod-text-brand transition hover:bg-[var(--evren-kod-brand-soft)] hover:text-[var(--evren-kod-fg)]"
              title="Değişiklikleri fark (diff) görünümünde incele ve düzenle"
            >
              <FileDiff className="evren-kod-icon-xs" />
              Diff
            </button>
          )}
        <span className="shrink-0 pr-2">
          {expanded ? (
            <ChevronDown className="evren-kod-icon-xs shrink-0 opacity-60" />
          ) : (
            <ChevronRight className="evren-kod-icon-xs shrink-0 opacity-60" />
          )}
        </span>
      </div>

      {toolCall.explanation && !expanded && (
        <div className="border-t evren-kod-border-surface px-2 py-1 text-2xs evren-kod-text-muted">
          {toolCall.explanation}
        </div>
      )}

      {expanded && (
        <div className="border-t evren-kod-border-surface evren-kod-bg-code">
          {toolCall.explanation && (
            <div className="px-2.5 pt-1.5 text-2xs leading-relaxed evren-kod-text-muted">
              {toolCall.explanation}
            </div>
          )}

          {toolCall.result && (
            <div className="p-2">
              <div className="mb-1 evren-kod-overline evren-kod-text-muted">Çıktı</div>
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded border evren-kod-border-surface evren-kod-bg-input p-2 font-mono text-2xs leading-relaxed evren-kod-text-fg">
                {toolCall.result}
              </pre>
            </div>
          )}

          {toolCall.error && (
            <div className="p-2">
              <div className="mb-1 evren-kod-overline evren-kod-text-error">Hata</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border evren-kod-border-error evren-kod-bg-input p-2 font-mono text-2xs leading-relaxed evren-kod-text-error">
                {toolCall.error}
              </pre>
            </div>
          )}

          <div className="border-t evren-kod-border-surface px-2.5 py-1.5">
            <Disclosure summary="Parametreler">
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre rounded border evren-kod-border-surface evren-kod-bg-input p-2 font-mono text-2xs evren-kod-text-muted">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </Disclosure>
          </div>

          {toolCall.status === 'completed' &&
            (toolCall.name === 'execute_command' || toolCall.name === 'run_tests') && (
              <div className="flex items-center justify-between gap-2 border-t evren-kod-border-surface px-2 py-1.5">
                <span className="text-2xs evren-kod-text-muted">
                  Komut çalıştı; dosya etkileri Git kontrol noktasından geri alınabilir.
                </span>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() =>
                    vscode.postMessage({ type: 'REVERT_COMMAND', payload: { toolCallId: toolCall.id } })
                  }
                  title="Bu komutun oluşturduğu ve değiştirdiği dosyaları geri al"
                  icon={<Undo2 className="evren-kod-icon-xs" />}
                >
                  Komut etkisini geri al
                </Button>
              </div>
            )}

          {toolCall.status === 'completed' &&
            (toolCall.name === 'write_file' || toolCall.name === 'edit_file') && (
              <div className="flex items-center justify-end gap-1 border-t evren-kod-border-surface px-2 py-1.5">
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() =>
                    vscode.postMessage({ type: 'SHOW_TOOL_DIFF', payload: { toolCallId: toolCall.id } })
                  }
                  title="Bu adımın dosya değişikliklerini fark olarak göster"
                  icon={<FileDiff className="evren-kod-icon-xs" />}
                >
                  Diff
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() =>
                    vscode.postMessage({ type: 'REVERT_TOOL_SNAPSHOT', payload: { toolCallId: toolCall.id } })
                  }
                  title="Bu dosya değişikliğini geri al"
                  icon={<Undo2 className="evren-kod-icon-xs" />}
                >
                  Bu adımı geri al
                </Button>
              </div>
            )}
        </div>
      )}

      {isPendingApproval && (
        <div className="flex items-center justify-between gap-2 border-t evren-kod-border-warning evren-kod-bg-raised p-2">
          <div
            className="flex min-w-0 items-center gap-1.5 text-xs font-medium evren-kod-text-warning"
            title={toolCall.approvalReason || 'Bu işlem onayınızı bekliyor'}
          >
            <AlertTriangle className="evren-kod-icon-xs shrink-0" />
            <span className="truncate">{toolCall.approvalReason || 'Bu işlem onayınızı bekliyor'}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <ApprovalActionButtons
              toolCallId={toolCall.id}
              showDiff={toolCall.name === 'write_file' || toolCall.name === 'edit_file'}
            />
          </div>
        </div>
      )}
    </div>
  );
};
