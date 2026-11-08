import React, { useEffect, useRef, useState } from 'react';
import {
  Bug,
  FileSearch,
  GraduationCap,
  Layers,
  Plug,
  ShieldCheck,
  Sparkles,
  Bot,
  Terminal
} from 'lucide-react';
import { ChatMessage, CheckpointSummary, ModelProviderType, ToolCall } from '@shared/types';
import { stripInjectedContext } from '@shared/editorContext';
import { ListButton } from '../ui';
import { Logo } from '../common/Logo';
import { SystemMessage, TurnBlock, UserMessage } from './MessageBubbles';
import { groupMessages } from './chatTurns';
import { SetupWizard } from './SetupWizard';

interface MessageListProps {
  messages: ChatMessage[];
  pendingToolCall?: ToolCall;
  checkpoints?: CheckpointSummary[];
  /** Mesaj içeriği ve kimliği; düzenleme o turdan sonrasını yeniden çalıştırır. */
  onEditMessage?: (content: string, messageId: string) => void;
  /**
   * Hatalı turu aynı sohbette yerinde yeniden çalıştırır (besteciye uğramadan
   * doğrudan gönderim). Yeni sohbet açmak yerine aynı istemden devam edilir.
   */
  onRetryMessage?: (content: string, messageId: string) => void;
  onSuggestionClick?: (prompt: string) => void;
  isConfigured?: boolean;
  isOllamaUnavailable?: boolean;
  ollamaError?: string;
  selectedProvider?: ModelProviderType;
  onRetryConnection?: () => void;
  onSwitchProvider?: (provider: ModelProviderType) => void;
  onOpenSettings?: () => void;
}

const QUICK_ACTIONS = [
  {
    icon: <FileSearch className="evren-kod-icon-md evren-kod-text-brand" />,
    title: 'Projeyi analiz et',
    desc: 'Mimariyi ve dosya yapısını incele',
    prompt:
      'Projenin mimarisini, klasör yapısını ve bağımlılıklarını incele; eksik veya riskli alanları bildir.'
  },
  {
    icon: <Bug className="evren-kod-icon-md evren-kod-text-warning" />,
    title: 'Hataları bul ve düzelt',
    desc: 'Derleme, test ve tip hatalarını gider',
    prompt: 'Projede derleme, test ve tip hatalarını bul; nedenlerini analiz edip düzelt.'
  },
  {
    icon: <ShieldCheck className="evren-kod-icon-md evren-kod-text-success" />,
    title: 'Güvenlik incelemesi',
    desc: 'Riskli kodu ve izinleri denetle',
    prompt:
      'Kod tabanını güvenlik sorunları açısından incele; riskli örüntüleri ve izin sorunlarını bildir, mümkün olanları düzelt.'
  },
  {
    icon: <Terminal className="evren-kod-icon-md evren-kod-text-brand" />,
    title: 'Testleri çalıştır',
    desc: 'Testleri çalıştır ve hataları gider',
    prompt: 'Proje testlerini çalıştır; başarısız testleri ve hata mesajlarını analiz edip düzelt.'
  },
  {
    icon: <GraduationCap className="evren-kod-icon-md evren-kod-text-warning" />,
    title: 'İnteraktif ders',
    desc: 'Eğitim modunda kod ve algoritma öğren',
    prompt:
      'Eğitim modunda bana yinelemeyi (recursion) anlat: sade bir analoji, adım adım küçük bir örnek ve sonunda deneyebileceğim bir alıştırma ver.'
  }
];

const CAPABILITIES = [
  { icon: <Sparkles className="evren-kod-icon-xs" />, label: 'Otonom ReAct' },
  { icon: <Plug className="evren-kod-icon-xs" />, label: 'MCP' },
  { icon: <Layers className="evren-kod-icon-xs" />, label: 'LSP' },
  { icon: <Bot className="evren-kod-icon-xs" />, label: 'Alt ajanlar' }
];

const EmptyState: React.FC<{
  onSuggestionClick?: (prompt: string) => void;
  isConfigured?: boolean;
  isOllamaUnavailable?: boolean;
  ollamaError?: string;
  selectedProvider?: ModelProviderType;
  onRetryConnection?: () => void;
  onSwitchProvider?: (provider: ModelProviderType) => void;
  onOpenSettings?: () => void;
}> = ({
  onSuggestionClick,
  isConfigured = true,
  isOllamaUnavailable = false,
  ollamaError,
  selectedProvider,
  onRetryConnection,
  onSwitchProvider,
  onOpenSettings
}) => (
  <div className="flex h-full flex-col justify-between gap-4 px-[var(--evren-kod-pad-inline)] py-4">
    <div className="space-y-5 pt-2">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="evren-kod-avatar evren-kod-avatar-soft evren-kod-avatar--lg evren-kod-text-brand">
          <Logo className="evren-kod-icon-lg" colored />
        </div>
        <div>
          <h1 className="text-sm font-semibold tracking-tight evren-kod-text-fg">Evren Kod</h1>
          <p className="mt-0.5 max-w-[280px] text-sm leading-relaxed evren-kod-text-muted">
            Türkiye'nin ve dünyanın en güvenli, kurumsal gizliliğe saygılı ve kanıtsız kodu teslim etmeyen
            kalite asistanı. Kodlama, hızlı, planlama ve eğitim modlarında çalışır.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-1">
          {CAPABILITIES.map((cap) => (
            <span
              key={cap.label}
              className="flex items-center gap-1 rounded-full border evren-kod-border-surface evren-kod-bg-raised px-2 py-0.5 text-2xs evren-kod-text-muted"
            >
              {cap.icon}
              {cap.label}
            </span>
          ))}
        </div>
      </div>

      {!isConfigured || isOllamaUnavailable ? (
        <SetupWizard
          selectedProvider={selectedProvider}
          isOllamaUnavailable={isOllamaUnavailable}
          ollamaError={ollamaError}
          onRetryConnection={onRetryConnection}
          onSwitchProvider={onSwitchProvider}
          onOpenSettings={onOpenSettings}
        />
      ) : (
        <div className="space-y-1.5">
          <div className="px-1 evren-kod-overline">Hızlı başlangıç</div>
          <div className="grid grid-cols-1 gap-1.5">
            {QUICK_ACTIONS.map((item) => (
              <ListButton
                key={item.title}
                onClick={() => onSuggestionClick?.(item.prompt)}
                icon={item.icon}
                title={item.title}
                description={item.desc}
              />
            ))}
          </div>
        </div>
      )}
    </div>

    <div className="flex items-center gap-2 rounded-md border evren-kod-border-surface evren-kod-bg-raised px-2.5 py-2 text-xs evren-kod-text-muted">
      <Terminal className="evren-kod-icon-xs evren-kod-text-success" />
      <span>Dosya, terminal ve LSP araçlarını kullanabilir. Değişiklikler onayınıza sunulur.</span>
    </div>
  </div>
);

/** Uzun sohbetlerde ilk çizgede tur sayısı; yukarı kaydırdıkça bu kadar daha eklenir. */
const TURNS_PAGE = 25;

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  pendingToolCall,
  checkpoints,
  onEditMessage,
  onRetryMessage,
  onSuggestionClick,
  isConfigured = true,
  isOllamaUnavailable = false,
  ollamaError,
  selectedProvider,
  onRetryConnection,
  onSwitchProvider,
  onOpenSettings
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Yeni çıktı yalnızca kullanıcı zaten en alta yakınken takip edilsin. Önceki
  // bir yanıtı okumak için yukarı kaydırmak, her akış parçasında geri alınmamalı.
  const stickToBottom = useRef(true);
  // Uzun sohbet püf noktası: geçmişin tamamı DOM'a bindirilmez; yalnızca en
  // yeni turlar çizilir, kullanıcı yukarı çıktıkça eski turlar sayfa sayfa
  // gelir. Eski mesajlar aranırken pencere aşağı zıplamasın diye yükleme
  // öncesi yükseklik kayıtlanır ve sonra konum geri verilir.
  const [visibleTurnCount, setVisibleTurnCount] = useState(TURNS_PAGE);
  const visibleTurnCountRef = useRef(TURNS_PAGE);
  const totalTurnsRef = useRef(0);
  const scrollAnchor = useRef<number | null>(null);
  // Kullanıcı yeni bir istem gönderdiğinde konuşma nerede okunuyor olursa
  // olsun görünüm alta döner; aksi halde cevap ekranın dışında kalırdı.
  const lastUserMessageId = useRef<string | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onScroll = () => {
      stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
      if (element.scrollTop < 48 && visibleTurnCountRef.current < totalTurnsRef.current) {
        scrollAnchor.current = element.scrollHeight;
        visibleTurnCountRef.current += TURNS_PAGE;
        setVisibleTurnCount(visibleTurnCountRef.current);
      }
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (scrollAnchor.current !== null) {
      element.scrollTop = element.scrollHeight - scrollAnchor.current;
      scrollAnchor.current = null;
    } else if (
      element.scrollHeight > 0 &&
      element.scrollHeight <= element.clientHeight &&
      visibleTurnCountRef.current < totalTurnsRef.current
    ) {
      // Sayfa ekrana sığıyorsa kaydırma olayı hiç doğmaz; ekranı doldurmak
      // için eski turları kendimiz getiririz.
      visibleTurnCountRef.current += TURNS_PAGE;
      setVisibleTurnCount(visibleTurnCountRef.current);
    }
  }, [visibleTurnCount]);

  useEffect(() => {
    let newestUser: string | null = null;
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index]?.role === 'user') {
        newestUser = messages[index]?.id ?? null;
        break;
      }
    }
    if (newestUser && newestUser !== lastUserMessageId.current) {
      const hadPrevious = lastUserMessageId.current !== null;
      lastUserMessageId.current = newestUser;
      stickToBottom.current = true;
      // Oturum değişti ya da yeni istem gönderildi: görünüm alta döneceği
      // için eski turlar sayfasını ilk sayfaya indir; büyük sohbetler arası
      // geçişte gereksiz tur çizilmesin.
      if (hadPrevious && visibleTurnCountRef.current !== TURNS_PAGE) {
        visibleTurnCountRef.current = TURNS_PAGE;
        setVisibleTurnCount(TURNS_PAGE);
      }
    }
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages, pendingToolCall]);

  if (messages.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmptyState
          onSuggestionClick={onSuggestionClick}
          isConfigured={isConfigured}
          isOllamaUnavailable={isOllamaUnavailable}
          ollamaError={ollamaError}
          selectedProvider={selectedProvider}
          onRetryConnection={onRetryConnection}
          onSwitchProvider={onSwitchProvider}
          onOpenSettings={onOpenSettings}
        />
      </div>
    );
  }

  const turns = groupMessages(messages);
  totalTurnsRef.current = turns.length;
  const lastTurn = turns[turns.length - 1];
  const activeTurnId =
    lastTurn && (lastTurn.assistant.some((message) => message.isStreaming) || Boolean(pendingToolCall))
      ? lastTurn.id
      : undefined;
  const hiddenTurnCount = Math.max(0, turns.length - visibleTurnCount);
  const shownTurns = hiddenTurnCount > 0 ? turns.slice(hiddenTurnCount) : turns;

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto px-[var(--evren-kod-pad-inline)] py-3"
      role="log"
      aria-live="polite"
      aria-label="Sohbet akışı"
    >
      <div className="space-y-3">
        {hiddenTurnCount > 0 && (
          <div className="evren-kod-overline justify-center evren-kod-text-muted">
            Yukarıda {hiddenTurnCount} eski tur var — kaydırdıkça yüklenecek
          </div>
        )}
        {shownTurns.map((turn) => {
          const turnUser = turn.user;
          return (
            <div key={turn.id} className="evren-kod-message space-y-1.5">
              {turnUser && (
                <UserMessage message={turnUser} checkpoints={checkpoints} onEdit={onEditMessage} />
              )}
              {turn.assistant.some((message) => message.role === 'system') && (
                <div className="space-y-1.5">
                  {turn.assistant
                    .filter((message) => message.role === 'system')
                    .map((message) => (
                      <SystemMessage key={message.id} message={message} />
                    ))}
                </div>
              )}
              <TurnBlock
                turn={{ ...turn, assistant: turn.assistant.filter((message) => message.role !== 'system') }}
                active={turn.id === activeTurnId}
                pendingToolCall={pendingToolCall}
                onRetry={
                  (onRetryMessage ?? onEditMessage) &&
                  turnUser &&
                  lastTurn?.id === turn.id &&
                  !turn.assistant.some((message) => message.isStreaming)
                    ? () =>
                        (onRetryMessage ?? onEditMessage)!(
                          stripInjectedContext(turnUser.content),
                          turnUser.id
                        )
                    : undefined
                }
              />
            </div>
          );
        })}

        <div ref={bottomRef} className="h-1" />
      </div>
    </div>
  );
};
