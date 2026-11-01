import React from 'react';
import {
  Trash2,
  Clock,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Ban,
  History,
  RotateCcw,
  Download,
  Upload,
  FileJson,
  ArrowDownWideNarrow,
  Plus
} from 'lucide-react';
import { NavigationDestination, TaskSummary } from '@shared/types';
import { ScreenHeader } from '../../common/ScreenHeader';
import { Button, Card, Chip, EmptyState, IconButton, SearchField } from '../../ui';
import { vscode } from '../../../utils/vscode';
import { SortOrder, StatusFilter, useHistoryView } from './useHistoryView';

interface HistoryViewProps {
  onBack: () => void;
  onSelectTask?: () => void;
  onSelectMenu?: (destination: NavigationDestination) => void;
  changedFileCount?: number;
}

const statusMeta = (status: TaskSummary['status']) => {
  switch (status) {
    case 'completed':
      return {
        label: 'Tamamlandı',
        icon: <CheckCircle2 className="evren-kod-icon-xs" />,
        className: 'evren-kod-text-success'
      };
    case 'failed':
      return {
        label: 'Başarısız',
        icon: <AlertCircle className="evren-kod-icon-xs" />,
        className: 'evren-kod-text-error'
      };
    case 'cancelled':
      return {
        label: 'İptal edildi',
        icon: <Ban className="evren-kod-icon-xs" />,
        className: 'evren-kod-text-muted'
      };
    case 'running':
      return {
        label: 'Çalışıyor',
        icon: <Loader2 className="evren-kod-icon-xs animate-spin" />,
        className: 'evren-kod-text-info'
      };
    default:
      return { label: status, icon: null, className: 'evren-kod-text-muted' };
  }
};

const formatDate = (timestamp: number) => {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('tr-TR', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
};

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'Tümü' },
  { id: 'completed', label: 'Tamamlanan' },
  { id: 'failed', label: 'Başarısız' },
  { id: 'cancelled', label: 'İptal' }
];

const SORT_LABELS: Record<SortOrder, string> = {
  recent: 'En yeni',
  oldest: 'En eski',
  largest: 'En uzun'
};

/**
 * Oturum kütüphanesi: kayıtlı oturumların aranabilir, filtrelenebilir listesi.
 * `workspaceState` üzerinde küçük bir yerel veritabanı gibi davranır.
 */
export const HistoryView: React.FC<HistoryViewProps> = ({
  onBack,
  onSelectTask,
  onSelectMenu,
  changedFileCount
}) => {
  const {
    history,
    search,
    setSearch,
    status,
    setStatus,
    sort,
    setSort,
    loading,
    pendingDelete,
    setPendingDelete,
    handleSelectTask,
    handleDeleteTask,
    stats,
    filtered,
    filtersActive
  } = useHistoryView({ onBack, onSelectTask });

  return (
    <div className="evren-kod-screen">
      <ScreenHeader
        title="Oturum kütüphanesi"
        subtitle={
          history.length > 0
            ? `${stats.total} oturum · ${stats.messages} mesaj · ${stats.completed} tamamlandı`
            : 'Kayıtlı oturum yok'
        }
        onSelectMenu={onSelectMenu}
        activeDestination="history"
        changedFileCount={changedFileCount}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="primary"
              size="xs"
              onClick={() => {
                vscode.postMessage({ type: 'NEW_SESSION' });
                if (onSelectTask) {
                  onSelectTask();
                } else {
                  onBack();
                }
              }}
              icon={<Plus className="evren-kod-icon-xs" />}
            >
              Yeni sohbet
            </Button>
            <IconButton
              label="Oturum içe aktar (JSON)"
              onClick={() => vscode.postMessage({ type: 'IMPORT_SESSION' })}
            >
              <Upload className="evren-kod-icon-xs" />
            </IconButton>
            <IconButton label="Yenile" onClick={() => vscode.postMessage({ type: 'GET_TASK_HISTORY' })}>
              <RotateCcw className="evren-kod-icon-xs" />
            </IconButton>
          </div>
        }
      />

      <div className="flex shrink-0 flex-col gap-1.5 border-b evren-kod-border-base p-2">
        <SearchField
          value={search}
          onValueChange={setSearch}
          placeholder="Oturumlarda ara..."
          aria-label="Oturumlarda ara"
        />

        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
          {STATUS_FILTERS.map((filter) => {
            const count =
              filter.id === 'all'
                ? undefined
                : filter.id === 'completed'
                  ? stats.completed
                  : filter.id === 'failed'
                    ? stats.failed
                    : history.filter((t) => t.status === 'cancelled').length;
            return (
              <Chip
                key={filter.id}
                onClick={() => setStatus(filter.id)}
                active={status === filter.id}
                count={count}
              >
                {filter.label}
              </Chip>
            );
          })}

          <Chip
            className="ml-auto"
            title="Sıralamayı değiştir"
            aria-label={`Sıralama: ${SORT_LABELS[sort]}. Değiştirmek için etkinleştir`}
            onClick={() =>
              setSort((current) =>
                current === 'recent' ? 'oldest' : current === 'oldest' ? 'largest' : 'recent'
              )
            }
          >
            <ArrowDownWideNarrow className="evren-kod-icon-xs" />
            {SORT_LABELS[sort]}
          </Chip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
        {loading ? (
          <div className="evren-kod-caption flex flex-col items-center gap-2 py-10">
            <Loader2 className="evren-kod-icon-md animate-spin" /> Geçmiş yükleniyor...
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={
              <span className="evren-kod-toggle-row__icon evren-kod-text-muted">
                <History className="evren-kod-icon-md" />
              </span>
            }
            title={filtersActive ? 'Eşleşen oturum bulunamadı' : 'Henüz oturum yok'}
            description={
              filtersActive
                ? 'Arama terimini veya filtreyi değiştirmeyi deneyin.'
                : 'İlk görevinizi gönderdikten sonra oturumunuz buraya otomatik olarak kaydedilir.'
            }
            action={
              filtersActive ? (
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => {
                    setSearch('');
                    setStatus('all');
                  }}
                >
                  Filtreleri temizle
                </Button>
              ) : undefined
            }
          />
        ) : (
          filtered.map((task) => {
            const meta = statusMeta(task.status);
            const confirming = pendingDelete === task.id;

            return (
              <Card key={task.id} interactive className="group p-2.5 hover:bg-[var(--evren-kod-hover-bg)]">
                <div className="flex items-start justify-between gap-2">
                  {/* Tıklama hedefi kartın kendisi değil satırdır: eylem düğmelerini
                      saran bir button role geçersiz ARIA olurdu ve Enter'da ikinci
                      bir eylem tetikliyordu. */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectTask(task.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleSelectTask(task.id);
                      }
                    }}
                    aria-label={`Oturumu aç: ${task.prompt || '(başlıksız görev)'}`}
                    className="min-w-0 flex-1 cursor-pointer rounded focus-visible:outline focus-visible:outline-1"
                  >
                    <div className="text-sm line-clamp-2 font-medium leading-snug evren-kod-text-fg">
                      {task.prompt || '(başlıksız görev)'}
                    </div>
                    <div className="text-2xs mt-1.5 flex flex-wrap items-center gap-2 evren-kod-text-muted">
                      <span className={`flex items-center gap-1 ${meta.className}`}>
                        {meta.icon}
                        {meta.label}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageSquare className="evren-kod-icon-xs" /> {task.messageCount}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="evren-kod-icon-xs" /> {formatDate(task.timestamp)}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    <IconButton
                      small
                      label="JSON olarak dışa aktar"
                      title="JSON olarak dışa aktar (yeniden içe aktarılabilir)"
                      onClick={(e) => {
                        e.stopPropagation();
                        vscode.postMessage({
                          type: 'EXPORT_SESSION',
                          payload: { taskId: task.id, format: 'json' }
                        });
                      }}
                    >
                      <FileJson className="evren-kod-icon-xs" />
                    </IconButton>
                    <IconButton
                      small
                      label="Markdown olarak dışa aktar"
                      title="Markdown olarak dışa aktar"
                      onClick={(e) => {
                        e.stopPropagation();
                        vscode.postMessage({
                          type: 'EXPORT_SESSION',
                          payload: { taskId: task.id, format: 'markdown' }
                        });
                      }}
                    >
                      <Download className="evren-kod-icon-xs" />
                    </IconButton>
                    <IconButton
                      small
                      label={confirming ? 'Silmeyi onayla' : 'Görevi sil'}
                      title={confirming ? 'Silmeyi onayla' : 'Görevi sil'}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTask(task.id);
                      }}
                      onBlur={() => setPendingDelete(null)}
                      className={
                        confirming
                          ? 'evren-kod-bg-error-solid evren-kod-text-on-accent hover:bg-[var(--status-error-fg)]'
                          : 'hover:text-[var(--status-error-fg)]'
                      }
                    >
                      <Trash2 className="evren-kod-icon-sm" />
                    </IconButton>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};
