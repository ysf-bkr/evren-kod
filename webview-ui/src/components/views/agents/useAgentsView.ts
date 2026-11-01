import { useEffect, useState } from 'react';
import { WorkspaceCustomizations } from '@shared/types';
import { vscode } from '../../../utils/vscode';
import { CONFIRM_RESET_MS } from '../../../utils/uiTiming';

/**
 * Ajanlar ve yetenekler ekranı için özelleştirmeleri yükleme ve alt ajan başlatma kancası.
 */
export function useAgentsView() {
  const [customizations, setCustomizations] = useState<WorkspaceCustomizations>({
    hasAgentsMd: false,
    skills: [],
    agents: []
  });
  const [loading, setLoading] = useState(true);
  const [confirmMemoryClear, setConfirmMemoryClear] = useState(false);
  const [launchRole, setLaunchRole] = useState<string | null>(null);
  const [launchTask, setLaunchTask] = useState('');
  const [launchIsolate, setLaunchIsolate] = useState(false);
  const [launching, setLaunching] = useState(false);

  const fetchCustomizations = (reload = false) => {
    setLoading(true);
    vscode.postMessage({ type: 'GET_CUSTOMIZATIONS', payload: { reload } });
  };

  useEffect(() => {
    fetchCustomizations(false);
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'CUSTOMIZATIONS_LOADED') {
        setCustomizations(event.data.payload);
        setLoading(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleLaunchSubagent = (role: string) => {
    if (!launchTask.trim() || launching) return;
    setLaunching(true);
    vscode.postMessage({
      type: 'START_SUBAGENT',
      payload: {
        role,
        task: launchTask.trim(),
        isolate: launchIsolate
      }
    });
    setLaunchRole(null);
    setLaunchTask('');
    setLaunchIsolate(false);
    setLaunching(false);
  };

  const handleResetMemory = () => {
    if (!confirmMemoryClear) {
      setConfirmMemoryClear(true);
      setTimeout(() => setConfirmMemoryClear(false), CONFIRM_RESET_MS);
      return;
    }
    setConfirmMemoryClear(false);
    vscode.postMessage({ type: 'CLEAR_PROJECT_MEMORY' });
  };

  const scaffold = () => {
    setLoading(true);
    vscode.postMessage({ type: 'INIT_AGENTS_TEMPLATE' });
  };

  return {
    customizations,
    loading,
    confirmMemoryClear,
    launchRole,
    setLaunchRole,
    launchTask,
    setLaunchTask,
    launchIsolate,
    setLaunchIsolate,
    launching,
    handleLaunchSubagent,
    handleResetMemory,
    refresh: () => fetchCustomizations(true),
    scaffold
  };
}
