import React, { useEffect, useRef, useState } from 'react';
import { Plus, CheckCircle2, AlertCircle, Loader2, RotateCcw, Undo2, PauseCircle, Ban } from 'lucide-react';
import { NavigationDestination, TaskState, AgentMode } from '@shared/types';
import { Logo } from '../common/Logo';
import { HeaderMenu } from '../common/HeaderMenu';
import { formatTokens } from '../chat/ChatMetaBar';
import { vscode } from '../../utils/vscode';
import { Badge, Button, IconButton, ListButton, Popover } from '../ui';

/** Görev başlığındaki mod rozetinin Türkçe adları. */
const MODE_LABELS: Record<AgentMode, string> = {
  code: 'Kodlama',
  plan: 'Planlama',
  education: 'Eğitim'
};

interface TaskHeaderProps {
  state: TaskState;
  changedFileCount: number;
  onSelectMenu: (destination: NavigationDestination) => void;
}

export const TaskHeader: React.FC<TaskHeaderProps> = ({ state, changedFileCount, onSelectMenu }) => {
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const checkpointButtonRef = useRef<HTMLSpanElement>(null);
  const checkpointPanelRef = useRef<HTMLDivElement>(null);

  // Her iki açılır panel de Escape ve dışarı tıklamayla kapanır. Checkpoint
  // paneli eskiden açık kalıyordu; bu, yıkıcı bir eylemi bir yanlış tıklamaya
  // yaklaştırıyordu.
  useEffect(() => {
    if (!showMenu && !showCheckpoints) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (showMenu && !menuRef.current?.contains(event.target)) setShowMenu(false);
      if (
        showCheckpoints &&
        !checkpointPanelRef.current?.contains(event.target) &&
        !checkpointButtonRef.current?.contains(event.target)
      ) {
        setShowCheckpoints(false);
        setConfirmRevert(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowMenu(false);
      setShowCheckpoints(false);
      setConfirmRevert(false);
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showMenu, showCheckpoints]);

  useEffect(() => {
    if (!showCheckpoints) setConfirmRevert(false);
  }, [showCheckpoints]);

  const statusBadge = (() => {
    switch (state.status) {
      case 'running':
        return (
          <Badge tone="info">
            <Loader2 className="evren-kod-icon-xs animate-spin" /> Çalışıyor
          </Badge>
        );
      case 'waiting_approval':
        return (
          <Badge tone="warning">
            <AlertCircle className="evren-kod-icon-xs" /> Onay bekleniyor
          </Badge>
        );
      case 'waiting_user_input':
        return (
          <Badge tone="info">
            <AlertCircle className="evren-kod-icon-xs" /> Yanıt bekleniyor
          </Badge>
        );
      case 'completed':
        return (
          <Badge tone="success">
            <CheckCircle2 className="evren-kod-icon-xs" /> Tamamlandı
          </Badge>
        );
      case 'failed':
        return (
          <Badge tone="error">
            <Ban className="evren-kod-icon-xs" /> Başarısız
          </Badge>
        );
      case 'paused':
        return (
          <Badge tone="warning">
            <PauseCircle className="evren-kod-icon-xs" /> Duraklatıldı
          </Badge>
        );
      case 'cancelled':
        return (
          <Badge tone="muted">
            <Ban className="evren-kod-icon-xs" /> İptal edildi
          </Badge>
        );
      default:
        return null;
    }
  })();

  // Görev token rozeti: toplam tüketim görünür, ipucunda giden/gelen kırılımı
  // ve önbellek okuma isabeti — tasarrufun ölçülebilmesi için.
  const tokenBadge = (() => {
    const { totalTokens, promptTokens, completionTokens, cachedTokens } = state.stats;
    if (!totalTokens) return null;
    const hitRate = promptTokens && cachedTokens ? Math.round((cachedTokens / promptTokens) * 100) : null;
    const title = [
      `Görev tüketimi — giden ${formatTokens(promptTokens)} · gelen ${formatTokens(completionTokens)} token`,
      hitRate !== null ? `istem önbelleğinden okunan ${formatTokens(cachedTokens)} (%${hitRate})` : ''
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <Badge tone="neutral" mono title={title} aria-label="Görev token tüketimi">
        Σ {formatTokens(totalTokens)}
      </Badge>
    );
  })();

  return (
    <header className="evren-kod-header">
      <div className="evren-kod-header__row">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="evren-kod-avatar evren-kod-avatar-soft evren-kod-avatar--xs evren-kod-text-brand">
            <Logo className="evren-kod-icon-sm" colored />
          </span>
          <span className="text-sm font-semibold tracking-tight">Evren Kod</span>
          <Badge tone="neutral" aria-label={`Görev modu: ${MODE_LABELS[state.mode] ?? 'Kodlama'}`}>
            {MODE_LABELS[state.mode] ?? 'Kodlama'}
          </Badge>
        </div>

        <div className="evren-kod-header__actions">
          {tokenBadge}
          {statusBadge}

          <span className="evren-kod-divider evren-kod-divider--vertical mx-0.5" aria-hidden="true" />

          <span ref={checkpointButtonRef} className="inline-flex">
            <IconButton
              label="Kontrol noktaları / Geri al"
              active={showCheckpoints}
              aria-haspopup="dialog"
              aria-expanded={showCheckpoints}
              onClick={() => setShowCheckpoints((value) => !value)}
            >
              <RotateCcw className="evren-kod-icon-sm" />
            </IconButton>
          </span>
          <Button
            variant="primary"
            className="evren-kod-btn--square-sm ml-0.5"
            onClick={() => vscode.postMessage({ type: 'NEW_SESSION' })}
            title="Yeni sohbet"
            aria-label="Yeni sohbet"
          >
            <Plus className="evren-kod-icon-sm" />
          </Button>
          <HeaderMenu
            showMenu={showMenu}
            onToggle={() => setShowMenu((value) => !value)}
            onClose={() => setShowMenu(false)}
            menuRef={menuRef}
            changedFileCount={changedFileCount}
            onSelectMenu={onSelectMenu}
          />
        </div>
      </div>

      {showCheckpoints && (
        <Popover
          title="Kontrol noktaları"
          popoverRef={checkpointPanelRef}
          role="dialog"
          aria-label="Kontrol noktaları"
        >
          {!state.checkpoints || state.checkpoints.length === 0 ? (
            <div className="px-1 py-1.5 text-xs evren-kod-text-muted">
              Henüz kontrol noktası yok. İlk görev sırasında otomatik olarak oluşturulur.
            </div>
          ) : (
            <div className="max-h-52 space-y-0.5 overflow-y-auto">
              {[...state.checkpoints].reverse().map((cp) => (
                <ListButton
                  key={cp.id}
                  onClick={() => {
                    vscode.postMessage({ type: 'REWIND_TO_CHECKPOINT', payload: { checkpointId: cp.id } });
                    setShowCheckpoints(false);
                  }}
                  title={cp.preview}
                  description={`Tur #${cp.turnIndex} · ${new Date(cp.timestamp).toLocaleTimeString('tr-TR', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}`}
                />
              ))}
            </div>
          )}

          <Button
            variant={confirmRevert ? 'danger' : 'ghost'}
            block
            className="mt-1 justify-start border-t evren-kod-border-base"
            title={
              confirmRevert
                ? 'Dosya değişikliği kalıcı olarak geri alınacak'
                : 'Son dosya değişikliğini geri almak için tekrar tıklayın'
            }
            onClick={() => {
              if (!confirmRevert) {
                setConfirmRevert(true);
                return;
              }
              vscode.postMessage({ type: 'REVERT_LAST_SNAPSHOT' });
              setConfirmRevert(false);
              setShowCheckpoints(false);
            }}
            icon={<Undo2 className="evren-kod-icon-xs" />}
          >
            {confirmRevert ? 'Geri almayı onayla' : 'Son dosya değişikliğini geri al'}
          </Button>
        </Popover>
      )}
    </header>
  );
};
