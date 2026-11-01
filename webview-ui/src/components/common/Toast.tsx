import React from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { ToastLevel, ToastNotification } from '@shared/types';
import { IconButton } from '../ui';

export type { ToastNotification };

interface ToastProps {
  toast: ToastNotification;
  onDismiss: () => void;
}

const LEVEL_STYLES: Record<ToastLevel, { box: string; icon: string }> = {
  error: {
    box: 'evren-kod-border-error evren-kod-bg-error',
    icon: 'evren-kod-bg-error evren-kod-text-error'
  },
  warning: {
    box: 'evren-kod-border-warning evren-kod-bg-warning',
    icon: 'evren-kod-bg-warning evren-kod-text-warning'
  },
  info: {
    box: 'evren-kod-border-info evren-kod-bg-info',
    icon: 'evren-kod-bg-info evren-kod-text-info'
  }
};

/**
 * Geçici bildirim. Çağıran normal akışta plan çubuğunun hemen üstüne yer
 * verir; bildirim hiçbir arayüz katmanının üstüne uçmaz. Uzun metin kendi
 * içinde kaydırılır, sohbet alanını ezmez.
 */
export const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  const style = LEVEL_STYLES[toast.level];
  const Icon = toast.level === 'info' ? CheckCircle2 : AlertCircle;

  return (
    <div
      role={toast.level === 'error' ? 'alert' : 'status'}
      aria-live={toast.level === 'error' ? 'assertive' : 'polite'}
      className={`evren-kod-animate-in evren-kod-shadow-lg flex items-start gap-2 rounded-lg border p-2.5 text-sm evren-kod-text-fg backdrop-blur-sm ${style.box}`}
    >
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${style.icon}`}>
        <Icon className="evren-kod-icon-sm" />
      </span>
      <span
        className="max-h-24 flex-1 overflow-y-auto break-words pt-0.5 leading-relaxed"
        title={toast.message}
      >
        {toast.message}
      </span>
      <IconButton label="Bildirimi kapat" small className="shrink-0" onClick={onDismiss}>
        <X className="evren-kod-icon-sm" />
      </IconButton>
    </div>
  );
};
