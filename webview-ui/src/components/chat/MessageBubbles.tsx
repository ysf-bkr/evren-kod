import React, { useState } from 'react';
import { Check, Copy, Layers, Pencil, RotateCcw, Undo2 } from 'lucide-react';
import { ChatMessage, CheckpointSummary, ToolCall } from '@shared/types';
import { stripInjectedContext } from '@shared/editorContext';
import { Button, Disclosure } from '../ui';
import { vscode } from '../../utils/vscode';
import { ActionStepCard } from './ActionStepCard';
import { Logo } from '../common/Logo';
import { Markdown } from '../common/Markdown';
import { MessageError, MessageStatus } from './MessageStatus';
import { TurnChangesReview } from './TurnChangesReview';
import { ChatTurn, findCheckpointForMessage } from './chatTurns';
import { CONFIRM_RESET_MS, COPY_FEEDBACK_MS } from '../../utils/uiTiming';

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

export const CopyMessageButton: React.FC<{ content: string; label?: string }> = ({
  content,
  label = 'Yanıtı kopyala'
}) => {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={() => {
        navigator.clipboard
          .writeText(content)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
          })
          .catch(() => {});
      }}
      aria-label={copied ? 'Yanıt kopyalandı' : label}
      title={copied ? 'Yanıt kopyalandı' : label}
      icon={
        copied ? (
          <Check className="evren-kod-icon-xs evren-kod-text-success" />
        ) : (
          <Copy className="evren-kod-icon-xs" aria-hidden="true" />
        )
      }
    >
      <span>{copied ? 'Kopyalandı' : 'Kopyala'}</span>
    </Button>
  );
};

interface UserMessageProps {
  message: ChatMessage;
  checkpoints?: CheckpointSummary[];
  onEdit?: (content: string, messageId: string) => void;
}

export const UserMessage: React.FC<UserMessageProps> = ({ message, checkpoints, onEdit }) => {
  const [copied, setCopied] = useState(false);
  // İki adımlı satır içi onay. VS Code webview'leri `allow-modals` olmadan
  // korumalı alanda çalışır; bu yüzden `window.confirm()` hiçbir iletişim
  // kutusu göstermez ve her zaman false döner — düğme ölü görünüyordu.
  const [confirmRewind, setConfirmRewind] = useState(false);
  const checkpoint = findCheckpointForMessage(message, checkpoints);
  // Kullanıcı balonunda ajanın eklediği editör bağlamı görünmez; kopyalama da
  // kullanıcının kendi sözlerini alır.
  const visibleContent = stripInjectedContext(message.content);

  const copy = () => {
    navigator.clipboard
      .writeText(visibleContent)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
      })
      .catch(() => {});
  };

  const requestRewind = () => {
    if (!checkpoint) return;
    if (!confirmRewind) {
      setConfirmRewind(true);
      setTimeout(() => setConfirmRewind(false), CONFIRM_RESET_MS);
      return;
    }
    setConfirmRewind(false);
    vscode.postMessage({
      type: 'REWIND_TO_CHECKPOINT',
      payload: { checkpointId: checkpoint.id }
    });
  };

  return (
    <div className="group/message flex flex-col items-end">
      <div className="evren-kod-bubble evren-kod-bubble--user">
        <div className="evren-kod-overline mb-1 justify-end">
          <span>Sen</span>
        </div>
        <div className="whitespace-pre-wrap break-words evren-kod-text-fg">{visibleContent}</div>
      </div>

      {/* Zaman ve mesaj başına eylemler balonun altında; görünene kadar
          soluk durur, böylece sohbetin gürültüsünü artırmez. */}
      <div className="text-2xs mt-1 flex items-center gap-1 pr-0.5 opacity-60 evren-kod-text-muted transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
        <span className="font-mono opacity-70">{formatTime(message.timestamp)}</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={copy}
          aria-label={copied ? 'Mesaj kopyalandı' : 'Mesajı kopyala'}
          title={copied ? 'Mesaj kopyalandı' : 'Mesajı kopyala'}
          icon={
            copied ? (
              <Check className="evren-kod-icon-xs evren-kod-text-success" />
            ) : (
              <Copy className="evren-kod-icon-xs" aria-hidden="true" />
            )
          }
        >
          {copied ? 'Kopyalandı' : 'Kopyala'}
        </Button>
        {onEdit && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onEdit(visibleContent, message.id)}
            aria-label="Mesajı düzenle ve yeniden gönder"
            title="Mesajı düzenle ve yeniden gönder"
            icon={<Pencil className="evren-kod-icon-xs" aria-hidden="true" />}
          >
            Düzenle
          </Button>
        )}
        {checkpoint && (
          <Button
            variant="ghost"
            size="xs"
            onClick={requestRewind}
            aria-label="Bu mesajdan sonraki değişiklikleri geri al"
            title="Bu mesajdan sonraki değişiklikleri geri al"
            className={confirmRewind ? 'evren-kod-text-error' : ''}
            icon={<Undo2 className="evren-kod-icon-xs" aria-hidden="true" />}
          >
            {confirmRewind ? 'Emin misin?' : 'Geri al'}
          </Button>
        )}
      </div>
    </div>
  );
};

export const SystemMessage: React.FC<{ message: ChatMessage }> = ({ message }) => (
  <Disclosure
    summary="Bağlam özeti"
    className="evren-kod-soft-card rounded-md border border-dashed evren-kod-border-surface px-2.5 py-1.5"
  >
    <div className="mt-1.5 border-t evren-kod-border-surface pt-1.5 opacity-90">
      <Markdown content={message.content} />
    </div>
  </Disclosure>
);

const ToolSteps: React.FC<{ toolCalls: ToolCall[]; pendingToolCall?: ToolCall }> = ({
  toolCalls,
  pendingToolCall
}) => {
  // Adım listesi varsayılan KAPALI: ekranı araç gürültüsü değil, yanıt metni
  // kaplar. Onay bekleyen bir adım varsa bölüm kendini açar — onay kartı
  // katlanmış listenin içinde gömülü kalamaz.
  const needsAttention =
    pendingToolCall !== undefined ||
    toolCalls.some((call) => call.status === 'pending' || call.status === 'approved');
  // Onayla açılmış bir bölüm, onay bitince kullanıcının önünden kendiliğinden
  // kapanmasın: açılış kararı ilk görünürlükte kilitlenir.
  const [openedAtMount] = useState(needsAttention);
  return (
    <Disclosure
      summary={`Araç adımları (${toolCalls.length})`}
      icon={<Layers className="evren-kod-icon-xs evren-kod-text-brand" />}
      defaultOpen={needsAttention || openedAtMount}
      className="evren-kod-soft-card rounded-md border evren-kod-border-surface px-2.5 py-1.5"
    >
      {/* Uzun görevlerde yüzlerce adım birikiyor: liste kendi yükseklik
          sınırlı kaydırma alanıda çizilir, akordeon sayfayı boy veremez.
          overscroll-contain: adım içinde tekerlek, sohbeti kaydırmasın. */}
      <div className="mt-1.5 max-h-72 space-y-1 overflow-y-auto overscroll-contain border-t evren-kod-border-surface pt-1.5 pr-1">
        {toolCalls.map((toolCall, index) => (
          <ActionStepCard
            key={toolCall.id}
            toolCall={toolCall}
            stepNumber={index + 1}
            isPendingApproval={pendingToolCall?.id === toolCall.id}
          />
        ))}
      </div>
    </Disclosure>
  );
};

interface TurnBlockProps {
  turn: ChatTurn;
  /** Tur şu anda çalışıyor; hata olsa bile "tekrar dene" gösterilmez. */
  active: boolean;
  pendingToolCall?: ToolCall;
  /**
   * Son turun hatalı yanıtını aynı sohbette yerinde yeniden çalıştırır.
   * Yalnızca son tur, hata varsa ve ajan çalışmıyorken verilir; yeni sohbet
   * açmak yerine aynı istem üzerinden devam etmeyi sağlar.
   */
  onRetry?: () => void;
}

/**
 * Bir asistan turu: yanıt metni HER ZAMAN görünürdür.
 *
 * Kullanıcı isteği: sohbet akordeon olmaz — okunacak şey metnin kendisidir.
 * Katlanabilir tek bölüm araç adımlarıdır (ToolSteps); böylece gürültü
 * daralırken anlatım hiç saklanmaz.
 */
export const TurnBlock: React.FC<TurnBlockProps> = ({ turn, active, pendingToolCall, onRetry }) => {
  const last = turn.assistant[turn.assistant.length - 1];
  const toolCalls = turn.assistant.flatMap((message) => message.toolCalls ?? []);
  const hasError = turn.assistant.some((message) => message.error);
  const content = turn.assistant
    .map((message) => message.content)
    .filter((text) => text.trim())
    .join('\n\n');
  // İçerikli son mesaj turun teslimidir; ondan önceki kısa metinler arac
  // araları arasındaki ara anlatımdır. Anlatım, balon boşluklarıyla ekranı
  // seyrekleştirmesin diye tek satırlık soluk izleme çizgisine indirgenir.
  // Boşluk-only metinler içerik sayılmaz: boş balon boşuna yer kaplar.
  const lastContentIndex = turn.assistant.reduce(
    (acc, message, index) => (message.content.trim() ? index : acc),
    -1
  );
  // Ara anlatımlar sohbeti "şimdi şunu inceleyeceğim" satırlarıyla doldurmasın:
  // yalnızca EN SON anlatım, canlı durum satırı olarak çizilir; eskiye karışan
  // anlatımlar geçmiştir ve ayrı satır işgal etmez.
  const lastNarrationIndex = turn.assistant.reduce(
    (acc, message, index) =>
      message.content.trim() && index < lastContentIndex && !message.isStreaming ? index : acc,
    -1
  );

  if (turn.assistant.length === 0) return null;

  return (
    <div className="evren-kod-turn-card rounded-lg border evren-kod-border-surface evren-kod-bg-surface">
      <div className="evren-kod-turn-card__header flex items-center gap-2 px-2.5 py-1.5">
        <span className="evren-kod-avatar evren-kod-avatar-soft evren-kod-avatar--sm evren-kod-text-brand">
          <Logo className="evren-kod-icon-xs" />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-xs font-semibold evren-kod-text-fg">Evren Kod</span>
          {last && <MessageStatus message={last} />}
          <span className="font-mono text-2xs evren-kod-text-muted opacity-70">
            {formatTime(turn.assistant[0].timestamp)}
          </span>
        </span>
        {onRetry && hasError && !active && (
          <Button
            variant="secondary"
            size="xs"
            onClick={onRetry}
            aria-label="Son yanıtı bu sohbette yeniden dene"
            title="Yanıt alınamadı; aynı istemi bu sohbette yeniden çalıştırır"
            icon={<RotateCcw className="evren-kod-icon-xs" aria-hidden="true" />}
          >
            Tekrar dene
          </Button>
        )}
        {content && <CopyMessageButton content={content} />}
      </div>

      <div className="space-y-2 border-t evren-kod-border-surface px-2.5 py-2">
        {turn.assistant.map((message, index) => {
          const hasText = Boolean(message.content.trim());
          const isNarration = hasText && index === lastNarrationIndex && !message.isStreaming;
          const isFinal = hasText && index === lastContentIndex;
          return (
            <div key={message.id} className="evren-kod-turn-msg space-y-1.5">
              {(isFinal || isNarration || message.isStreaming) &&
                (isNarration ? (
                  <p
                    data-testid="narration-line"
                    className="text-2xs leading-relaxed evren-kod-text-muted opacity-85"
                  >
                    {message.content}
                  </p>
                ) : (
                  <div className="evren-kod-bubble evren-kod-bubble--flush">
                    <Markdown content={message.content} isStreaming={message.isStreaming} />
                  </div>
                ))}
              {message.error && <MessageError error={message.error} />}
            </div>
          );
        })}

        {turn.assistant.some((message) => message.toolCalls?.length) && (
          <TurnChangesReview toolCalls={toolCalls} />
        )}

        {toolCalls.length > 0 && <ToolSteps toolCalls={toolCalls} pendingToolCall={pendingToolCall} />}
      </div>
    </div>
  );
};
