import React from 'react';
import { CircleHelp, ShieldQuestion } from 'lucide-react';
import { ToolCall, TaskState } from '@shared/types';
import { ApprovalActionButtons } from '../common/ApprovalActionButtons';
import { TOOL_TITLES, toolStepDetail } from '../../utils/toolLabels';

interface PendingActionNoticeProps {
  state: TaskState;
}

/** Tek satıra indirgenmiş araç gerekçesi: onay sebebi balon içinde okunaklı kalsın. */
function approvalReason(toolCall: ToolCall): string | undefined {
  const reason = toolCall.approvalReason?.trim() || toolCall.explanation?.trim();
  if (!reason) return undefined;
  return reason.length > 220 ? `${reason.slice(0, 217)}…` : reason;
}

/**
 * Onay ve soru bildirimi SOHBETİN içinde sabit durur: mesaj yazma alanının
 * hemen üstünde belirir, kullanıcı kaydırıp adım kartı aramadan onayı burada
 * verir. Spec/plan onayının ComposerDock'taki sabit kartıyla aynı davranışı
 * araç izinleri ve sorular için tamamlar.
 */
export const PendingActionNotice: React.FC<PendingActionNoticeProps> = ({ state }) => {
  const pending = state.pendingToolCall;
  const question = state.pendingQuestion;
  if (!pending && !question) return null;

  return (
    <div
      role="region"
      aria-label={pending ? 'Onay bekliyor' : 'Cevap bekleyen soru'}
      className="mx-[var(--evren-kod-pad-inline)] mb-2 rounded-lg border evren-kod-border-warning evren-kod-bg-warning px-3 py-2.5 overflow-hidden"
    >
      {pending ? (
        <>
          <div className="flex items-start gap-2 min-w-0">
            <ShieldQuestion className="evren-kod-icon-xs shrink-0 evren-kod-text-warning mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span className="text-sm font-medium evren-kod-text-fg">
                  Onay bekliyor: {TOOL_TITLES[pending.name] ?? pending.name}
                </span>
                {toolStepDetail(pending) && (
                  <span className="text-2xs font-mono evren-kod-text-muted break-all">
                    {toolStepDetail(pending)}
                  </span>
                )}
              </div>
              {approvalReason(pending) && (
                <p className="text-xs mt-1 leading-relaxed evren-kod-text-muted break-words">
                  {approvalReason(pending)}
                </p>
              )}
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1.5 pt-0.5">
            <ApprovalActionButtons
              toolCallId={pending.id}
              showDiff={pending.name === 'write_file' || pending.name === 'edit_file'}
              diffVariant="ghost"
            />
          </div>
        </>
      ) : (
        <div className="flex items-start gap-2 min-w-0">
          <CircleHelp className="evren-kod-icon-xs mt-0.5 shrink-0 evren-kod-text-warning" />
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium evren-kod-text-fg">Ajanın bir sorusu var</span>
            <p className="text-xs mt-0.5 leading-relaxed evren-kod-text-muted break-words">
              {question?.question}
            </p>
            <p className="text-2xs mt-1 evren-kod-text-muted">
              Yanıtını aşağıdaki kutuya yazıp gönder — ajan kaldığı yerden devam eder.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
