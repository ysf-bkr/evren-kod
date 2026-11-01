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
      className="mx-3 mb-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2.5"
    >
      {pending ? (
        <>
          <div className="flex items-center gap-2">
            <ShieldQuestion className="evren-kod-icon-xs shrink-0 text-amber-400" />
            <span className="text-sm font-medium evren-kod-text-fg">
              Onay bekliyor: {TOOL_TITLES[pending.name] ?? pending.name}
            </span>
            <span className="text-2xs evren-kod-text-muted truncate">{toolStepDetail(pending)}</span>
          </div>
          {approvalReason(pending) && (
            <p className="text-xs mt-1 leading-relaxed evren-kod-text-muted">{approvalReason(pending)}</p>
          )}
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <ApprovalActionButtons
              toolCallId={pending.id}
              showDiff={pending.name === 'write_file' || pending.name === 'edit_file'}
              diffVariant="ghost"
            />
          </div>
        </>
      ) : (
        <div className="flex items-start gap-2">
          <CircleHelp className="evren-kod-icon-xs mt-0.5 shrink-0 text-amber-400" />
          <div className="min-w-0">
            <span className="text-sm font-medium evren-kod-text-fg">Ajanın bir sorusu var</span>
            <p className="text-xs mt-0.5 leading-relaxed evren-kod-text-muted">{question?.question}</p>
            <p className="text-2xs mt-1 evren-kod-text-muted">
              Yanıtını aşağıdaki kutuya yazıp gönder — ajan kaldığı yerden devam eder.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
