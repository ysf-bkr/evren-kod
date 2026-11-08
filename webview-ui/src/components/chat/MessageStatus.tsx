import React from 'react';
import { AlertCircle, CheckCircle2, Loader2, Sparkles, Wrench } from 'lucide-react';
import { ChatMessage, ToolCall } from '@shared/types';
import { humanizeErrorMessage } from '../../utils/toolErrors';
import { TOOL_TITLES, toolStepDetail } from '../../utils/toolLabels';

export type MessagePhase = 'thinking' | 'writing' | 'working' | 'done' | 'error';

interface PhaseMeta {
  label: string;
  className: string;
  icon: React.ReactNode;
}

const PHASE_META: Record<MessagePhase, PhaseMeta> = {
  thinking: {
    label: 'düşünüyor',
    className: 'evren-kod-text-brand',
    icon: <Sparkles className="evren-kod-icon-xs animate-pulse" />
  },
  writing: {
    label: 'yazıyor',
    className: 'evren-kod-text-brand',
    icon: <Loader2 className="evren-kod-icon-xs animate-spin" />
  },
  working: {
    label: 'çalışıyor',
    className: 'evren-kod-text-brand',
    icon: <Wrench className="evren-kod-icon-xs animate-pulse" />
  },
  done: {
    label: 'tamamlandı',
    className: 'evren-kod-text-success',
    icon: <CheckCircle2 className="evren-kod-icon-xs" />
  },
  error: {
    label: 'hata',
    className: 'evren-kod-text-error',
    icon: <AlertCircle className="evren-kod-icon-xs" />
  }
};

const ACTIVE_STATUSES: ReadonlyArray<ToolCall['status']> = ['pending', 'approved', 'executing'];

export interface MessagePhaseInfo {
  phase: MessagePhase;
  /** Şu anda çalışan aracın adı, varsa. */
  tool?: string;
  /** Kullanıcıya gösterilen anlamlı araç başlığı veya adı. */
  toolTitle?: string;
  /** Aracın parametresinden çıkarılan kısa detay (dosya adı, komut, arama terimi). */
  toolDetail?: string;
  /** Etkin aracın turdaki araç çağrıları arasındaki 1 tabanlı konumu. */
  step?: number;
  totalSteps?: number;
  /** Araç ipucu olarak gösterilen daha uzun açıklama. */
  detail?: string;
}

/**
 * Asistanın gerçekte ne yaptığını mesajın kendisinden çıkarır.
 *
 * Arayüz, bir araç çalışırken asla "yazıyor" dememeli: o durumda model
 * metin üretmiyor, bir komutun veya dosya düzenlemesinin bitmesini bekliyor.
 */
export function resolveMessagePhase(message: ChatMessage): MessagePhaseInfo | undefined {
  const toolCalls: ToolCall[] = message.toolCalls ?? [];
  const activeIndex = toolCalls.findIndex((call) => ACTIVE_STATUSES.includes(call.status));
  const activeTool = activeIndex >= 0 ? toolCalls[activeIndex] : undefined;

  if (message.error) {
    return { phase: 'error', detail: message.error };
  }

  if (activeTool) {
    const step = activeIndex + 1;
    const name = String(activeTool.name || 'araç');
    const toolTitle = TOOL_TITLES[activeTool.name] || name;
    const toolDetail = toolStepDetail(activeTool);
    const explanation = activeTool.explanation ? ` — ${activeTool.explanation}` : '';
    const detailPart = toolDetail ? `: ${toolDetail}` : '';
    return {
      phase: 'working',
      tool: name,
      toolTitle,
      toolDetail,
      step,
      totalSteps: toolCalls.length,
      detail: `${toolTitle}${detailPart} (adım ${step}/${toolCalls.length})${explanation}`
    };
  }

  if (message.isStreaming) {
    return message.content
      ? { phase: 'writing', detail: 'Yanıt metni akıyor.' }
      : { phase: 'thinking', detail: 'Model yanıtı hazırlıyor.' };
  }

  if (toolCalls.length > 0) {
    const failed = toolCalls.filter((call) => call.status === 'error').length;
    return {
      phase: 'done',
      totalSteps: toolCalls.length,
      detail:
        failed > 0
          ? `Tur bitti; ${failed} araç adımı hata verdi.`
          : `Tur bitti; ${toolCalls.length} araç adımı tamamlandı.`
    };
  }

  return undefined;
}

interface MessageStatusProps {
  message: ChatMessage;
}

/** Tur durumunu mesajdan türetilen küçük satır içi simge + etiket. */
export const MessageStatus: React.FC<MessageStatusProps> = ({ message }) => {
  const info = resolveMessagePhase(message);
  if (!info) return null;

  const meta = PHASE_META[info.phase];
  const shortDetail = info.toolDetail ? ` · ${info.toolDetail}` : '';
  const suffix =
    info.phase === 'working' && info.tool
      ? `: ${info.tool}${shortDetail}${info.totalSteps ? ` (${info.step}/${info.totalSteps})` : ''}`
      : '';

  return (
    <span
      className={`flex max-w-[320px] items-center gap-1 truncate text-2xs ${meta.className}`}
      role="status"
      aria-live="polite"
      title={info.detail}
    >
      {meta.icon}
      <span className="shrink-0">{meta.label}</span>
      <span className="truncate">{suffix}</span>
    </span>
  );
};

/** Hata metnini içeren genişletilmiş hata bloğu. */
export const MessageError: React.FC<{ error: string }> = ({ error }) => {
  // Sağlayıcı/araç hatası çoğu zaman İngilizce teknik metindir. Bilinen
  // mesajlar Türkçeye çevrilir; çevrilemeyen serbest metin ham ve etiketli
  // kalır, böylece kullanıcı ne okuduğunu bilir.
  const humanized = humanizeErrorMessage(error);
  return (
    <div className="flex items-start gap-1.5 rounded-md border evren-kod-border-error evren-kod-bg-error px-2.5 py-1.5">
      <AlertCircle className="evren-kod-icon-xs mt-0.5 shrink-0 evren-kod-text-error" />
      <span className="text-2xs whitespace-pre-wrap break-words leading-relaxed evren-kod-text-fg">
        {humanized?.technical && <span className="evren-kod-text-muted">Teknik ayrıntı: </span>}
        {humanized?.text ?? error}
      </span>
    </div>
  );
};
