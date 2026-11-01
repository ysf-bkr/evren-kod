import { useEffect, useMemo, useState } from 'react';
import { TaskSummary } from '@shared/types';
import { vscode } from '../../../utils/vscode';

export type StatusFilter = 'all' | 'completed' | 'failed' | 'cancelled';
export type SortOrder = 'recent' | 'oldest' | 'largest';

export interface UseHistoryViewOptions {
  onBack: () => void;
  onSelectTask?: () => void;
}

/**
 * Oturum kütüphanesi için veri yükleme, arama, filtreleme ve aksiyon kancası.
 */
export function useHistoryView(options: UseHistoryViewOptions) {
  const [history, setHistory] = useState<TaskSummary[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortOrder>('recent');
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    vscode.postMessage({ type: 'GET_TASK_HISTORY' });
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'TASK_HISTORY_LOADED') {
        setHistory(event.data.payload.history || []);
        setLoading(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleSelectTask = (taskId: string) => {
    vscode.postMessage({ type: 'LOAD_TASK', payload: { taskId } });
    if (options.onSelectTask) {
      options.onSelectTask();
    } else {
      options.onBack();
    }
  };

  const handleDeleteTask = (taskId: string) => {
    if (pendingDelete !== taskId) {
      setPendingDelete(taskId);
      return;
    }
    vscode.postMessage({ type: 'DELETE_TASK', payload: { taskId } });
    setPendingDelete(null);
  };

  const stats = useMemo(() => {
    const byStatus = (value: TaskSummary['status']) => history.filter((t) => t.status === value).length;
    return {
      total: history.length,
      completed: byStatus('completed'),
      failed: byStatus('failed'),
      messages: history.reduce((sum, task) => sum + task.messageCount, 0)
    };
  }, [history]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = history.filter((task) => {
      if (status !== 'all' && task.status !== status) return false;
      if (!needle) return true;
      return task.prompt.toLowerCase().includes(needle);
    });

    return [...list].sort((a, b) => {
      if (sort === 'oldest') return a.timestamp - b.timestamp;
      if (sort === 'largest') return b.messageCount - a.messageCount;
      return b.timestamp - a.timestamp;
    });
  }, [history, search, status, sort]);

  const filtersActive = search.trim().length > 0 || status !== 'all';

  return {
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
  };
}
