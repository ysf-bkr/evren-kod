import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExtensionToWebviewMessage, GitChangesPayload, TaskState } from '@shared/types';
import { vscode } from '../../../utils/vscode';

/**
 * Değişiklikler ekranı için git durumunu izleme ve diff aksiyonları kancası.
 */
export function useChangesView(state: TaskState) {
  const [changes, setChanges] = useState<GitChangesPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    vscode.postMessage({ type: 'GET_GIT_CHANGES' });
  }, []);

  useEffect(() => {
    refresh();

    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;
      if (message.type === 'GIT_CHANGES_LOADED') {
        setChanges(message.payload);
        setLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refresh]);

  const modifiedSet = useMemo(() => new Set(state.stats?.filesModified ?? []), [state.stats?.filesModified]);

  return {
    changes,
    loading,
    refresh,
    modifiedSet
  };
}
