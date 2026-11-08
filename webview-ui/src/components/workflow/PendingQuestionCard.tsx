import React, { useState } from 'react';
import { HelpCircle, Send, X } from 'lucide-react';
import { PendingQuestion } from '@shared/types';
import { vscode } from '../../utils/vscode';
import { Button, TextareaField } from '../ui';

export type PendingQuestionCardProps = PendingQuestion;

/** Ajanın sorduğu engelleyici soru; bestecinin üzerinde gösterilir. */
export const PendingQuestionCard: React.FC<PendingQuestionCardProps> = ({ question, toolCallId }) => {
  const [reply, setReply] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = reply.trim();
    if (!value) return;
    vscode.postMessage({
      type: 'USER_REPLY',
      payload: { toolCallId, reply: value }
    });
    setReply('');
  };

  return (
    <div className="evren-kod-question-card rounded-lg border evren-kod-bg-raised p-2.5 evren-kod-shadow-sm">
      <div className="text-sm mb-1.5 flex items-center gap-1.5 font-semibold evren-kod-text-brand">
        <HelpCircle className="evren-kod-icon-sm shrink-0" />
        Evren bir cevap bekliyor
      </div>
      <div className="text-sm mb-2 rounded-md border evren-kod-border-surface evren-kod-bg-input px-2.5 py-2 leading-relaxed evren-kod-text-fg break-words whitespace-pre-wrap">
        {question}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-1.5">
        <TextareaField
          autoFocus
          rows={2}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
          placeholder="Yanıtınızı yazın... (Göndermek için Enter'a basın)"
          aria-label="Ajanın sorusuna yanıt"
        />
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="secondary"
            size="xs"
            onClick={() => vscode.postMessage({ type: 'CANCEL_TASK' })}
            icon={<X className="evren-kod-icon-xs" />}
          >
            İptal
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="xs"
            disabled={!reply.trim()}
            icon={<Send className="evren-kod-icon-xs" />}
          >
            Yanıtla
          </Button>
        </div>
      </form>
    </div>
  );
};
