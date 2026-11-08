import React, { useState } from 'react';
import { ModelProviderType } from '@shared/types';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import {
  AlertTriangle,
  Check,
  Cloud,
  Copy,
  Cpu,
  RotateCcw,
  Settings,
  Sparkles,
  Terminal
} from 'lucide-react';

export interface SetupWizardProps {
  selectedProvider?: ModelProviderType;
  isOllamaUnavailable?: boolean;
  ollamaError?: string;
  onRetryConnection?: () => void;
  onSwitchProvider?: (provider: ModelProviderType) => void;
  onOpenSettings?: () => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({
  selectedProvider: _selectedProvider = 'ollama',
  isOllamaUnavailable = false,
  ollamaError,
  onRetryConnection,
  onSwitchProvider,
  onOpenSettings
}) => {
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const command = 'ollama run qwen2.5-coder:7b';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Pano erişimi engellendiğinde sessizce geç
    }
  };

  const handleRetry = () => {
    setRetrying(true);
    onRetryConnection?.();
    setTimeout(() => setRetrying(false), 1200);
  };

  return (
    <div className="space-y-4 rounded-xl border evren-kod-border-warning/40 evren-kod-bg-raised/70 p-4 text-left shadow-sm">
      {/* Başlık ve Durum */}
      <div className="flex items-start gap-3">
        <div className="evren-kod-avatar evren-kod-avatar--md evren-kod-bg-warning/20 text-warning shrink-0 mt-0.5">
          <AlertTriangle className="evren-kod-icon-md text-amber-500" />
        </div>
        <div className="space-y-1">
          <h2 className="text-sm font-semibold evren-kod-text-fg">
            {isOllamaUnavailable
              ? 'Yerel Model (Ollama) Tespit Edilemedi'
              : 'Model Ayarları Yapılandırılmadı'}
          </h2>
          <p className="text-xs evren-kod-text-muted leading-relaxed">
            {isOllamaUnavailable
              ? 'Evren Kod varsayılan olarak gizliliğinizi korumak için bilgisayarınızda yerel Ollama motorunu arar. Ancak localhost:11434 adresinde çalışan bir servis bulunamadı.'
              : 'Evren ile sohbete başlayabilmek için lütfen bir model sağlayıcısı (Yerel Ollama, EVREN LLM, OpenRouter vb.) seçip yapılandırın.'}
          </p>
          {ollamaError && (
            <div className="font-mono text-3xs text-amber-500/90 truncate max-w-[280px]">{ollamaError}</div>
          )}
        </div>
      </div>

      {/* Seçenekler */}
      <div className="grid grid-cols-1 gap-2.5 pt-1">
        {/* Seçenek 1: Yerel Model (Ollama) */}
        <Card className="p-3 space-y-2 border evren-kod-border-surface evren-kod-bg-base/80">
          <div className="flex items-center gap-2">
            <Cpu className="evren-kod-icon-sm text-sky-500 shrink-0" />
            <span className="text-xs font-medium evren-kod-text-fg">
              Seçenek 1: Yerel Ollama ile Devam Et
            </span>
            <span className="ml-auto text-3xs rounded px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 font-medium">
              %100 Gizli
            </span>
          </div>
          <p className="text-2xs evren-kod-text-muted">
            Kodunuz makinenizde kalır, hiçbir yere veri gitmez. Terminalden modeli başlatın:
          </p>

          <div className="flex items-center justify-between gap-2 rounded bg-black/40 px-2.5 py-1.5 font-mono text-2xs evren-kod-text-fg border evren-kod-border-surface">
            <div className="flex items-center gap-1.5 truncate">
              <Terminal className="evren-kod-icon-xs text-muted-foreground shrink-0" />
              <span className="truncate">{command}</span>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="text-xs text-muted-foreground hover:text-foreground shrink-0 transition-colors p-1"
              title="Komutu Kopyala"
            >
              {copied ? (
                <Check className="evren-kod-icon-xs text-emerald-400" />
              ) : (
                <Copy className="evren-kod-icon-xs" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="secondary"
              size="xs"
              className="w-full justify-center"
              onClick={handleRetry}
              disabled={retrying}
              icon={<RotateCcw className={`evren-kod-icon-xs ${retrying ? 'animate-spin' : ''}`} />}
            >
              {retrying ? 'Kontrol Ediliyor...' : 'Bağlantıyı Yeniden Kontrol Et'}
            </Button>
          </div>
        </Card>

        {/* Seçenek 2: Bulut Modeli */}
        <Card className="p-3 space-y-2 border evren-kod-border-surface evren-kod-bg-base/80">
          <div className="flex items-center gap-2">
            <Cloud className="evren-kod-icon-sm text-indigo-400 shrink-0" />
            <span className="text-xs font-medium evren-kod-text-fg">
              Seçenek 2: Bulut Modeli ile Devam Et
            </span>
            <span className="ml-auto text-3xs rounded px-1.5 py-0.5 bg-indigo-500/10 text-indigo-400 font-medium">
              Hızlı
            </span>
          </div>
          <p className="text-2xs evren-kod-text-muted">
            Donanımınız yerel model için yeterli değilse veya kurulum yapmadan hemen başlamak istiyorsanız:
          </p>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              variant="primary"
              size="xs"
              className="justify-center"
              onClick={() => onSwitchProvider?.('evren')}
              icon={<Sparkles className="evren-kod-icon-xs" />}
            >
              EVREN LLM
            </Button>
            <Button
              variant="secondary"
              size="xs"
              className="justify-center"
              onClick={() => onSwitchProvider?.('openrouter')}
              icon={<Cloud className="evren-kod-icon-xs" />}
            >
              OpenRouter
            </Button>
          </div>
        </Card>
      </div>

      {/* Alt Bilgi */}
      <div className="flex items-center justify-between pt-1 border-t evren-kod-border-surface/40 text-2xs evren-kod-text-muted">
        <span>Gelişmiş ayarlar veya farklı sunucu adresleri için:</span>
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex items-center gap-1 text-sky-400 hover:underline font-medium"
          >
            <Settings className="evren-kod-icon-xs" />
            Ayarları Yapılandır
          </button>
        )}
      </div>
    </div>
  );
};
