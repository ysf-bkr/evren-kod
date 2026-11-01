import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CallGraphPanelDepRow,
  CallGraphPanelFileRow,
  CallGraphPanelNode,
  CallGraphPanelResult
} from '@shared/types';
import { vscode } from '../../../utils/vscode';
import { STATUS_POLL_MS } from '../../../utils/uiTiming';

const request = (payload: {
  action: 'status' | 'search' | 'neighbors' | 'rebuild' | 'files' | 'fileSymbols' | 'deps';
  query?: string;
  nodeId?: string;
  path?: string;
}) => vscode.postMessage({ type: 'CALLGRAPH_QUERY', payload });

/**
 * Çağrı grafiği paneli için durum, sembol arama, dosya gezgini ve komşuluk
 * ağacı kancası.
 */
export function useCallGraphView() {
  const [status, setStatus] = useState<CallGraphPanelResult | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<CallGraphPanelNode[]>([]);
  const [selected, setSelected] = useState<CallGraphPanelNode | null>(null);
  const [neighbors, setNeighbors] = useState<CallGraphPanelResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<CallGraphPanelFileRow[] | null>(null);
  const [fileSymbols, setFileSymbols] = useState<Record<string, CallGraphPanelNode[]>>({});
  const [fileDeps, setFileDeps] = useState<Record<string, CallGraphPanelDepRow[]>>({});
  const [topDeps, setTopDeps] = useState<CallGraphPanelDepRow[]>([]);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const expandedRef = useRef<string | null>(null);
  expandedRef.current = expandedFile;
  const resultHandler = useRef<((event: MessageEvent) => void) | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data as { type: string; payload: CallGraphPanelResult };
      if (message?.type !== 'CALLGRAPH_RESULT') return;
      const payload = message.payload;
      setBusy(false);
      if (payload.action === 'status' || payload.action === 'rebuild') {
        setStatus(payload);
      } else if (payload.action === 'search') {
        setMatches(payload.matches ?? []);
      } else if (payload.action === 'neighbors') {
        setNeighbors(payload);
      } else if (payload.action === 'files') {
        setFiles(payload.files ?? []);
      } else if (payload.action === 'fileSymbols' && payload.path) {
        const path = payload.path;
        setFileSymbols((current) => ({ ...current, [path]: payload.fileSymbols ?? [] }));
      } else if (payload.action === 'deps') {
        if (payload.path) {
          const path = payload.path;
          setFileDeps((current) => ({ ...current, [path]: payload.deps ?? [] }));
        } else {
          setTopDeps(payload.deps ?? []);
        }
      }
    };
    resultHandler.current = handler;
    window.addEventListener('message', handler);
    request({ action: 'status' });
    return () => window.removeEventListener('message', handler);
  }, []);

  // Harita hazır olduğunda (ve her yeniden kurulumda) dosya ve bağlantı
  // listelerini tazele.
  useEffect(() => {
    if (status?.ready) {
      request({ action: 'files' });
      request({ action: 'deps' });
    }
  }, [status?.ready, status?.stats?.updatedAt]);

  // Kurulum sürüyorsa ilerlemeyi periyodik çek; bitince dur.
  useEffect(() => {
    if (!status?.building) return;
    const timer = setInterval(() => request({ action: 'status' }), STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [status?.building]);

  const runSearch = useCallback(() => {
    if (!query.trim()) return;
    setBusy(true);
    request({ action: 'search', query: query.trim() });
  }, [query]);

  const selectNode = useCallback((node: CallGraphPanelNode) => {
    setSelected(node);
    setBusy(true);
    request({ action: 'neighbors', nodeId: node.id });
  }, []);

  /** Dosyayı aç/kapa; açılan dosyanın sembolleri ve bağlantıları ilk temasında yüklenir. */
  const toggleFile = useCallback((path: string) => {
    if (expandedRef.current === path) {
      setExpandedFile(null);
      return;
    }
    setExpandedFile(path);
    setBusy(true);
    request({ action: 'fileSymbols', path });
    request({ action: 'deps', path });
  }, []);

  const rebuild = useCallback(() => {
    setBusy(true);
    request({ action: 'rebuild' });
  }, []);

  const rebuilding = status?.action === 'rebuild' && status.building;

  return {
    status,
    query,
    setQuery,
    matches,
    selected,
    neighbors,
    busy,
    rebuilding,
    files,
    fileSymbols,
    fileDeps,
    topDeps,
    expandedFile,
    runSearch,
    selectNode,
    toggleFile,
    rebuild
  };
}
