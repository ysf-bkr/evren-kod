import React, { useMemo } from 'react';
import {
  CircleSlash,
  FileCode2,
  FileDiff,
  FilePlus2,
  GitBranch,
  History,
  Loader2,
  RefreshCw,
  Trash2,
  Clock3
} from 'lucide-react';
import { GitFileChange, NavigationDestination, TaskState } from '@shared/types';
import { ScreenHeader } from '../../common/ScreenHeader';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  LinkButton,
  ListButton,
  Section,
  SectionTitle
} from '../../ui';
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
}> = ({ filePath, change, diffTitle }) => {
  const kind = kindOf(change, true);
  const meta = KIND_META[kind];
  return (
    <Card className="flex flex-col gap-1 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className={`evren-kod-badge shrink-0 ${meta.badge}`} title={meta.label}>
          {meta.label}
        </span>
        <LinkButton
          plain
          onClick={() => vscode.postMessage({ type: 'OPEN_FILE', payload: { filePath } })}
          className="min-w-0 flex-1 truncate text-left font-mono text-sm"
          title={`${filePath} — düzenleyicide aç`}
        >
          {filePath}
        </LinkButton>
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
      <FileMeta modifiedAt={change?.modifiedAt} sizeBytes={change?.sizeBytes} deleted={change?.deleted} />
    </Card>
  );
};

export const ChangesView: React.FC<ChangesViewProps> = ({ state, onSelectMenu, changedFileCount }) => {
  const { changes, loading, refresh } = useChangesView(state);

  const gitByPath = useMemo(() => {
    const map = new Map<string, GitFileChange>();
    for (const file of changes?.files ?? []) map.set(file.path, file);
    return map;
  }, [changes]);

  const taskFiles = state.stats.filesModified;

  const counts = useMemo(() => {
    const tally = { modified: 0, added: 0, deleted: 0, untracked: 0, renamed: 0 };
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
            <RefreshCw className="evren-kod-icon-xs" />
          </IconButton>
        }
      />
      <div className="evren-kod-screen-body">
        <Section>
          <SectionTitle
            icon={<FileCode2 className="evren-kod-icon-xs" />}
            title="Bu görevde değişen dosyalar"
            count={taskFiles.length}
          />
          {taskFiles.length === 0 ? (
            <EmptyState
              icon={<FileCode2 className="evren-kod-icon-lg evren-kod-text-muted" />}
              title="Henüz değişiklik yok"
              description="Bu görevde henüz dosya değişikliği yapılmadı."
            />
          ) : (
            <div className="mt-1 flex flex-col gap-1.5">
              <p className="evren-kod-caption">
                Dosya adına tıklayarak düzenleyicide açabilir, "Fark" ile değişikliği inceleyebilirsiniz.
              </p>
              {taskFiles.map((filePath) => (
                <FileRow
                  key={filePath}
                  filePath={filePath}
                  change={gitByPath.get(filePath)}
                  diffTitle="Dosya farkını VS Code diff görünümünde aç"
                />
              ))}
            </div>
          )}
        </Section>

        <Section>
          <SectionTitle
            icon={<GitBranch className="evren-kod-icon-xs" />}
            title={`Git çalışma ağacı (${changes?.branch || 'dal yok'})`}
            count={sortedGitFiles.length}
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
            <div className="mt-1 flex flex-col gap-1.5">
              <div className="flex flex-wrap gap-1.5 text-2xs">
                {counts.modified > 0 && (
                  <span className="evren-kod-badge evren-kod-bg-warning-soft evren-kod-text-warning">
                    {counts.modified} değiştirildi
                  </span>
                )}
                {counts.added > 0 && (
                  <span className="evren-kod-badge evren-kod-bg-success-soft evren-kod-text-success">
                    {counts.added} eklendi
                  </span>
                )}
                {counts.untracked > 0 && (
                  <span className="evren-kod-badge evren-kod-bg-surface evren-kod-text-muted">
                    {counts.untracked} izlenmiyor
                  </span>
                )}
                {counts.deleted > 0 && (
                  <span className="evren-kod-badge evren-kod-bg-error-soft evren-kod-text-error">
                    {counts.deleted} silindi
                  </span>
                )}
                {counts.renamed > 0 && (
                  <span className="evren-kod-badge evren-kod-bg-brand-soft evren-kod-text-brand">
                    {counts.renamed} yeniden adlandırıldı
                  </span>
                )}
              </div>
              {sortedGitFiles.map((change) => (
                <FileRow
                  key={`${change.path}-${change.indexStatus}${change.workTreeStatus}`}
                  filePath={change.path}
                  change={change}
                  diffTitle="Git farkını VS Code diff görünümünde aç"
                />
              ))}
            </div>
          )}
        </Section>

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
                      <span className="evren-kod-badge shrink-0 evren-kod-bg-base font-mono evren-kod-text-brand">
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
