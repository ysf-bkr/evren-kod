import React, { useMemo, useState } from 'react';
import {
  CircleSlash,
  Clock3,
  FileCode2,
  FileDiff,
  FilePlus2,
  GitBranch,
  GitCommit,
  History,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X
} from 'lucide-react';
import { GitFileChange, NavigationDestination, TaskState } from '@shared/types';
import { ScreenHeader } from '../../common/ScreenHeader';
import { Button, EmptyState, IconButton, LinkButton, ListButton, Section, SectionTitle } from '../../ui';
import { vscode } from '../../../utils/vscode';
import { formatBytes, formatDateTime } from '../../../utils/timeFormat';
import { useChangesView } from './useChangesView';

interface ChangesViewProps {
  state: TaskState;
  onSelectMenu?: (destination: NavigationDestination) => void;
  changedFileCount?: number;
}

/** Dosya durumunu tek bir rozet + renkle özetler. */
type FileChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';

const KIND_META: Record<FileChangeKind, { label: string; badge: string; icon: React.ReactNode }> = {
  modified: {
    label: 'değiştirildi',
    badge: 'evren-kod-bg-warning-soft evren-kod-text-warning',
    icon: <FileCode2 className="evren-kod-icon-xs" />
  },
  added: {
    label: 'eklendi',
    badge: 'evren-kod-bg-success-soft evren-kod-text-success',
    icon: <FilePlus2 className="evren-kod-icon-xs" />
  },
  deleted: {
    label: 'silindi',
    badge: 'evren-kod-bg-error-soft evren-kod-text-error',
    icon: <Trash2 className="evren-kod-icon-xs" />
  },
  renamed: {
    label: 'yeniden adlandırıldı',
    badge: 'evren-kod-bg-brand-soft evren-kod-text-brand',
    icon: <FileCode2 className="evren-kod-icon-xs" />
  },
  untracked: {
    label: 'izlenmiyor',
    badge: 'evren-kod-bg-surface evren-kod-text-muted',
    icon: <CircleSlash className="evren-kod-icon-xs" />
  }
};

function kindOf(change: GitFileChange | undefined, existsInGit: boolean): FileChangeKind {
  if (!change) return existsInGit ? 'modified' : 'modified';
  const letter = change.indexStatus !== ' ' ? change.indexStatus : change.workTreeStatus;
  if (change.deleted || letter === 'D') return 'deleted';
  if (letter === 'A' || letter === '?') return change.indexStatus === '?' ? 'untracked' : 'added';
  if (letter === 'R') return 'renamed';
  return 'modified';
}

/** Meta satırı: son değişim zamanı + boyut; bilinmeyen alanlar sessizce düşer. */
const FileMeta: React.FC<{ modifiedAt?: number; sizeBytes?: number; deleted?: boolean }> = ({
  modifiedAt,
  sizeBytes,
  deleted
}) => {
  const time = formatDateTime(modifiedAt);
  const size = formatBytes(sizeBytes);
  const parts = [
    time ? `Son değişim: ${time}` : deleted ? 'Diskte yok (silinmiş)' : 'Zaman bilgisi yok',
    size
  ].filter(Boolean);
  return (
    <span className="flex min-w-0 items-center gap-1.5 truncate text-2xs evren-kod-text-muted">
      <Clock3 className="evren-kod-icon-xs shrink-0" />
      <span className="truncate">{parts.join(' · ')}</span>
    </span>
  );
};

const FileRow: React.FC<{
  filePath: string;
  change?: GitFileChange;
  diffTitle: string;
  isTaskFile?: boolean;
}> = ({ filePath, change, diffTitle, isTaskFile }) => {
  const kind = kindOf(change, true);
  const meta = KIND_META[kind];
  return (
    <div className="group rounded-md border evren-kod-border-surface evren-kod-bg-base p-2 transition hover:border-[var(--evren-kod-focus)] hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <span
              className={`evren-kod-badge shrink-0 flex items-center gap-1 ${meta.badge}`}
              title={meta.label}
            >
              {meta.icon}
              <span className="font-medium">{meta.label}</span>
            </span>
            {isTaskFile && (
              <span
                className="evren-kod-badge shrink-0 evren-kod-bg-brand-soft evren-kod-text-brand"
                title="Bu oturumda ajan tarafından değiştirildi"
              >
                görev
              </span>
            )}
          </div>
          <LinkButton
            plain
            onClick={() => vscode.postMessage({ type: 'OPEN_FILE', payload: { filePath } })}
            className="min-w-0 truncate text-left font-mono text-xs font-semibold evren-kod-text-fg hover:text-[var(--evren-kod-focus)]"
            title={`${filePath} — düzenleyicide aç`}
          >
            {filePath}
          </LinkButton>
        </div>
        <div className="shrink-0 pt-0.5">
          <Button
            variant="secondary"
            size="xs"
            onClick={() => vscode.postMessage({ type: 'SHOW_FILE_DIFF', payload: { filePath } })}
            title={diffTitle}
            icon={<FileDiff className="evren-kod-icon-xs" />}
          >
            Fark
          </Button>
        </div>
      </div>
      <div className="mt-1.5 pt-1.5 border-t evren-kod-border-surface/40">
        <FileMeta modifiedAt={change?.modifiedAt} sizeBytes={change?.sizeBytes} deleted={change?.deleted} />
      </div>
    </div>
  );
};

export const ChangesView: React.FC<ChangesViewProps> = ({ state, onSelectMenu, changedFileCount }) => {
  const { changes, loading, refresh } = useChangesView(state);
  const [filterQuery, setFilterQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'task' | 'git'>('all');
  const [kindFilter, setKindFilter] = useState<FileChangeKind | null>(null);

  const gitByPath = useMemo(() => {
    const map = new Map<string, GitFileChange>();
    for (const file of changes?.files ?? []) map.set(file.path, file);
    return map;
  }, [changes]);

  const taskFiles = state.stats.filesModified;

  const counts = useMemo(() => {
    const tally: Record<FileChangeKind, number> = {
      modified: 0,
      added: 0,
      deleted: 0,
      untracked: 0,
      renamed: 0
    };
    for (const file of changes?.files ?? []) {
      tally[kindOf(file, true)]++;
    }
    return tally;
  }, [changes]);

  // En yeni değişen dosya en üstte: kullanıcının bakacağı ilk şey en sondur.
  const sortedGitFiles = useMemo(
    () =>
      [...(changes?.files ?? [])].sort(
        (a, b) => (b.modifiedAt ?? Number.NEGATIVE_INFINITY) - (a.modifiedAt ?? Number.NEGATIVE_INFINITY)
      ),
    [changes]
  );

  const query = filterQuery.trim().toLowerCase();

  const filteredTaskFiles = useMemo(() => {
    if (!query) return taskFiles;
    return taskFiles.filter((path) => path.toLowerCase().includes(query));
  }, [taskFiles, query]);

  const filteredGitFiles = useMemo(() => {
    return sortedGitFiles.filter((file) => {
      if (kindFilter && kindOf(file, true) !== kindFilter) return false;
      if (query && !file.path.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [sortedGitFiles, kindFilter, query]);

  const totalCount = useMemo(() => {
    const set = new Set([...taskFiles, ...(changes?.files?.map((f) => f.path) ?? [])]);
    return set.size;
  }, [taskFiles, changes]);

  return (
    <div className="evren-kod-screen">
      <ScreenHeader
        title="Değişiklikler"
        subtitle="Görev dosyaları ve Git durumu"
        onSelectMenu={onSelectMenu}
        activeDestination="changes"
        changedFileCount={changedFileCount ?? state.stats.filesModified.length}
        actions={
          <IconButton label="Git durumunu yenile" onClick={refresh}>
            <RefreshCw className={`evren-kod-icon-xs ${loading ? 'animate-spin' : ''}`} />
          </IconButton>
        }
      />
      <div className="evren-kod-screen-body space-y-3">
        {/* Sekme ve Hızlı Arama Barı */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1 rounded-md evren-kod-bg-raised p-0.5 text-2xs font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`flex-1 rounded py-1 px-1.5 text-center transition ${
                activeTab === 'all'
                  ? 'evren-kod-bg-base evren-kod-text-fg shadow-xs font-semibold'
                  : 'evren-kod-text-muted hover:evren-kod-text-fg'
              }`}
            >
              Tümü ({totalCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('task')}
              className={`flex-1 rounded py-1 px-1.5 text-center transition ${
                activeTab === 'task'
                  ? 'evren-kod-bg-base evren-kod-text-fg shadow-xs font-semibold'
                  : 'evren-kod-text-muted hover:evren-kod-text-fg'
              }`}
            >
              Bu Görev ({taskFiles.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('git')}
              className={`flex-1 rounded py-1 px-1.5 text-center transition ${
                activeTab === 'git'
                  ? 'evren-kod-bg-base evren-kod-text-fg shadow-xs font-semibold'
                  : 'evren-kod-text-muted hover:evren-kod-text-fg'
              }`}
            >
              Git ({sortedGitFiles.length})
            </button>
          </div>

          {totalCount > 2 && (
            <div className="relative">
              <Search className="evren-kod-icon-xs pointer-events-none absolute left-2.5 top-2.5 evren-kod-text-muted" />
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Dosya adına göre süz…"
                className="w-full rounded border evren-kod-border-surface evren-kod-bg-base py-1.5 pl-8 pr-7 text-xs font-mono evren-kod-text-fg placeholder:evren-kod-text-muted focus:border-[var(--evren-kod-focus)] focus:outline-none"
              />
              {filterQuery && (
                <button
                  type="button"
                  onClick={() => setFilterQuery('')}
                  className="absolute right-2 top-2 evren-kod-text-muted hover:evren-kod-text-fg"
                  title="Filtreyi temizle"
                >
                  <X className="evren-kod-icon-xs" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Görev Dosyaları Bölümü */}
        {(activeTab === 'all' || activeTab === 'task') && (
          <Section>
            <SectionTitle
              icon={<FileCode2 className="evren-kod-icon-xs" />}
              title="Bu görevde değişen dosyalar"
              count={filteredTaskFiles.length}
            />
            {filteredTaskFiles.length === 0 ? (
              <EmptyState
                icon={<FileCode2 className="evren-kod-icon-lg evren-kod-text-muted" />}
                title={query ? 'Eşleşen dosya bulunamadı' : 'Henüz değişiklik yok'}
                description={
                  query
                    ? `"${query}" filtresine uyan görev dosyası yok.`
                    : 'Bu görevde henüz dosya değişikliği yapılmadı.'
                }
              />
            ) : (
              <div className="mt-1 flex flex-col gap-2">
                <p className="evren-kod-caption">
                  Dosya adına tıklayarak düzenleyicide açabilir, "Fark" ile değişikliği inceleyebilirsiniz.
                </p>
                {filteredTaskFiles.map((filePath) => (
                  <FileRow
                    key={filePath}
                    filePath={filePath}
                    change={gitByPath.get(filePath)}
                    diffTitle="Dosya farkını VS Code diff görünümünde aç"
                    isTaskFile
                  />
                ))}
              </div>
            )}
          </Section>
        )}

        {/* Git Çalışma Ağacı Bölümü */}
        {(activeTab === 'all' || activeTab === 'git') && (
          <Section>
            <SectionTitle
              icon={<GitBranch className="evren-kod-icon-xs" />}
              title={`Git çalışma ağacı (${changes?.branch || 'dal yok'})`}
              count={filteredGitFiles.length}
            />
            {loading && !changes ? (
              <div className="flex items-center justify-center gap-1.5 py-4 text-xs evren-kod-text-muted">
                <Loader2 className="evren-kod-icon-sm animate-spin" /> Git durumu alınıyor…
              </div>
            ) : !changes || !changes.isRepository ? (
              <EmptyState
                icon={<GitBranch className="evren-kod-icon-lg evren-kod-text-muted" />}
                title="Git deposu bulunamadı"
                description={
                  changes?.error || 'Bu çalışma alanı bir Git deposu değil; Git durumu gösterilemiyor.'
                }
              />
            ) : sortedGitFiles.length === 0 ? (
              <EmptyState description="Çalışma ağacı temiz; bekleyen değişiklik yok." />
            ) : (
              <div className="mt-1 flex flex-col gap-2">
                {/* Durum filtre rozetleri */}
                <div className="flex flex-wrap gap-1.5 text-2xs">
                  {counts.modified > 0 && (
                    <button
                      type="button"
                      onClick={() => setKindFilter(kindFilter === 'modified' ? null : 'modified')}
                      className={`evren-kod-badge transition cursor-pointer ${
                        kindFilter === 'modified'
                          ? 'ring-1 ring-[var(--evren-kod-warning)] font-semibold'
                          : ''
                      } evren-kod-bg-warning-soft evren-kod-text-warning`}
                      title="Değiştirilen dosyaları filtrele"
                    >
                      {counts.modified} değiştirildi
                    </button>
                  )}
                  {counts.added > 0 && (
                    <button
                      type="button"
                      onClick={() => setKindFilter(kindFilter === 'added' ? null : 'added')}
                      className={`evren-kod-badge transition cursor-pointer ${
                        kindFilter === 'added' ? 'ring-1 ring-[var(--evren-kod-success)] font-semibold' : ''
                      } evren-kod-bg-success-soft evren-kod-text-success`}
                      title="Eklenen dosyaları filtrele"
                    >
                      {counts.added} eklendi
                    </button>
                  )}
                  {counts.untracked > 0 && (
                    <button
                      type="button"
                      onClick={() => setKindFilter(kindFilter === 'untracked' ? null : 'untracked')}
                      className={`evren-kod-badge transition cursor-pointer ${
                        kindFilter === 'untracked' ? 'ring-1 ring-[var(--evren-kod-fg)] font-semibold' : ''
                      } evren-kod-bg-surface evren-kod-text-muted`}
                      title="İzlenmeyen dosyaları filtrele"
                    >
                      {counts.untracked} izlenmiyor
                    </button>
                  )}
                  {counts.deleted > 0 && (
                    <button
                      type="button"
                      onClick={() => setKindFilter(kindFilter === 'deleted' ? null : 'deleted')}
                      className={`evren-kod-badge transition cursor-pointer ${
                        kindFilter === 'deleted' ? 'ring-1 ring-[var(--evren-kod-error)] font-semibold' : ''
                      } evren-kod-bg-error-soft evren-kod-text-error`}
                      title="Silinen dosyaları filtrele"
                    >
                      {counts.deleted} silindi
                    </button>
                  )}
                  {counts.renamed > 0 && (
                    <button
                      type="button"
                      onClick={() => setKindFilter(kindFilter === 'renamed' ? null : 'renamed')}
                      className={`evren-kod-badge transition cursor-pointer ${
                        kindFilter === 'renamed' ? 'ring-1 ring-[var(--evren-kod-brand)] font-semibold' : ''
                      } evren-kod-bg-brand-soft evren-kod-text-brand`}
                      title="Yeniden adlandırılan dosyaları filtrele"
                    >
                      {counts.renamed} yeniden adlandırıldı
                    </button>
                  )}
                </div>

                {filteredGitFiles.length === 0 ? (
                  <EmptyState
                    title="Filtreye uyan dosya yok"
                    description="Seçilen duruma veya arama kelimesine uyan Git değişikliği bulunamadı."
                  />
                ) : (
                  filteredGitFiles.map((change) => (
                    <FileRow
                      key={`${change.path}-${change.indexStatus}${change.workTreeStatus}`}
                      filePath={change.path}
                      change={change}
                      diffTitle="Git farkını VS Code diff görünümünde aç"
                      isTaskFile={taskFiles.includes(change.path)}
                    />
                  ))
                )}
              </div>
            )}
          </Section>
        )}

        {/* Son Commitler Bölümü */}
        {changes?.isRepository && (
          <Section>
            <SectionTitle
              icon={<History className="evren-kod-icon-xs" />}
              title="Son commitler"
              count={changes.commits.length}
            />
            {changes.commits.length === 0 ? (
              <EmptyState description="Henüz commit yok." />
            ) : (
              <div className="mt-1 flex flex-col gap-1.5">
                {changes.commits.map((commit) => (
                  <ListButton
                    key={commit.hash}
                    onClick={() =>
                      vscode.postMessage({ type: 'SHOW_COMMIT', payload: { commitHash: commit.hash } })
                    }
                    icon={
                      <span className="evren-kod-badge shrink-0 evren-kod-bg-base font-mono evren-kod-text-brand flex items-center gap-1">
                        <GitCommit className="evren-kod-icon-xs" />
                        {commit.hash}
                      </span>
                    }
                    title={commit.subject}
                    description={formatDateTime(commit.date ? new Date(commit.date).getTime() : undefined)}
                  />
                ))}
              </div>
            )}
          </Section>
        )}
      </div>
    </div>
  );
};
