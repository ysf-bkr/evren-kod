import React, { useState } from 'react';
import {
  Search,
  RefreshCw,
  Loader2,
  GitBranch,
  CornerDownLeft,
  CornerUpRight,
  FileCode,
  FolderTree,
  ChevronDown,
  ChevronRight,
  ArrowRightLeft,
  Network
} from 'lucide-react';
import {
  CallGraphPanelDepRow,
  CallGraphPanelNode,
  CallGraphPanelResult,
  NavigationDestination
} from '@shared/types';
import { ScreenHeader } from '../../common/ScreenHeader';
import { Badge, Button, Card, EmptyState, IconButton, Input, Section, SectionTitle } from '../../ui';
import { vscode } from '../../../utils/vscode';
import { useCallGraphView } from './useCallGraphView';
import { useListNav } from './useListNav';

interface CallGraphViewProps {
  onSelectMenu?: (destination: NavigationDestination) => void;
  changedFileCount?: number;
}

/** Düğüm satırı: tıklayınca kaynağı editörde açar; ikondan grafikte merkeze alınır. */
const NodeRow: React.FC<{
  node: CallGraphPanelNode;
  selected: boolean;
  onOpen: (node: CallGraphPanelNode) => void;
  onCenter: (node: CallGraphPanelNode) => void;
}> = ({ node, selected, onOpen, onCenter }) => (
  <div className="flex items-center gap-1">
    <button
      type="button"
      data-nav
      onClick={() => onOpen(node)}
      className={`flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition hover:opacity-85 ${
        selected ? 'evren-kod-bg-brand-soft evren-kod-text-brand' : 'evren-kod-text-fg'
      }`}
      title="Editörde aç"
    >
      <FileCode className="evren-kod-icon-xs shrink-0 evren-kod-text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {node.className ? `${node.className}.${node.name}` : node.name}
        </span>
        <span className="block truncate font-mono text-2xs evren-kod-text-muted">
          {node.file}:{node.startLine}
        </span>
      </span>
      <Badge tone="muted">{node.kind}</Badge>
      {node.isTest && <Badge tone="info">test</Badge>}
    </button>
    <IconButton
      label="Grafiğinde merkeze al"
      title="Bu sembolün çağıranlarını ve çağrıldıklarını göster"
      onClick={() => onCenter(node)}
    >
      <GitBranch className="evren-kod-icon-xs" />
    </IconButton>
  </div>
);

/** Düğümün kaynak satırını editörde açar (satır numaralı OPEN_FILE). */
const openNodeSource = (node: CallGraphPanelNode, line?: number) =>
  vscode.postMessage({
    type: 'OPEN_FILE',
    payload: { filePath: node.file, line: line ?? node.startLine }
  });

const NeighborList: React.FC<{
  title: string;
  icon: React.ReactNode;
  neighbors: CallGraphPanelResult['callers'];
  onSelect: (node: CallGraphPanelNode) => void;
}> = ({ title, icon, neighbors, onSelect }) => {
  const nav = useListNav();
  return (
    <div className="space-y-1">
      <SectionTitle icon={icon} title={title} count={neighbors?.length ?? 0} />
      {neighbors && neighbors.length > 0 ? (
        <div ref={nav.containerRef} onKeyDown={nav.onKeyDown} className="space-y-0.5">
          {neighbors.map((neighbor) => (
            <div key={`${neighbor.id}-${neighbor.depth}`} className="flex items-center gap-1">
              <button
                type="button"
                data-nav
                onClick={() => openNodeSource(neighbor, neighbor.lines[0])}
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left text-xs evren-kod-text-fg hover:opacity-85"
                title={
                  neighbor.lines.length > 0
                    ? `Çağrı satırı: ${neighbor.lines.join(', ')} · ${neighbor.depth}. kademe`
                    : `${neighbor.depth}. kademe`
                }
              >
                <span className="min-w-0 flex-1 truncate">{neighbor.name}</span>
                {neighbor.isTest && <Badge tone="info">test</Badge>}
                <span className="shrink-0 font-mono text-2xs evren-kod-text-muted">
                  {neighbor.file}:{neighbor.lines[0] ?? neighbor.startLine}
                </span>
                <Badge tone={neighbor.depth === 1 ? 'brand' : 'muted'}>{neighbor.depth}. kademe</Badge>
              </button>
              <IconButton
                label="Grafiğinde merkeze al"
                title="Bu sembolü grafiğin merkezine al"
                onClick={() => onSelect(neighbor)}
              >
                <GitBranch className="evren-kod-icon-xs" />
              </IconButton>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-2 text-2xs evren-kod-text-muted">Bu yönde bağlantı yok.</p>
      )}
    </div>
  );
};

/** Dosyanın tarama durumunu Türkçe rozete çevirir. */
const fileStatusLabel: Record<string, string> = {
  partial: 'kısmi tarandı',
  failed: 'taranamadı',
  skipped: 'atlandı'
};

/** Tek dosya bağlantısı satırı: kaynak → hedef ve kenar adedi. */
const DepRow: React.FC<{ row: CallGraphPanelDepRow; onOpen: (path: string) => void }> = ({ row, onOpen }) => (
  <button
    type="button"
    data-nav
    onClick={() => onOpen(row.from)}
    className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-2xs transition hover:opacity-85"
    title="Kaynak dosyayı aç"
  >
    <span className="min-w-0 flex-1 truncate font-mono evren-kod-text-fg">{row.from}</span>
    <ArrowRightLeft className="evren-kod-icon-xs shrink-0 evren-kod-text-muted" />
    <span className="min-w-0 flex-1 truncate font-mono evren-kod-text-fg">{row.to}</span>
    <Badge tone="brand">{row.count}</Badge>
  </button>
);

/** Açık dosyanın iki yönlü bağlantıları: hangi dosyaları çağırıyor, kimler çağırıyor. */
const FileDeps: React.FC<{ path: string; deps: CallGraphPanelDepRow[]; onOpen: (path: string) => void }> = ({
  path,
  deps,
  onOpen
}) => {
  const outgoing = deps.filter((row) => row.from === path);
  const incoming = deps.filter((row) => row.to === path);
  if (outgoing.length === 0 && incoming.length === 0) {
    return (
      <p className="ml-8 py-1 text-2xs evren-kod-text-muted">
        Bu dosyanın başka dosyalarla çağrı bağlantısı yok.
      </p>
    );
  }
  const rowOf = (other: string, count: number) => (
    <button
      key={other}
      type="button"
      data-nav
      onClick={() => onOpen(other)}
      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-2xs transition hover:opacity-85"
      title="Bu dosyayı aç"
    >
      <span className="min-w-0 flex-1 truncate font-mono evren-kod-text-fg">{other}</span>
      <Badge tone="muted">{count}</Badge>
    </button>
  );
  return (
    <div className="ml-3 space-y-1 border-l evren-kod-border-surface pl-2">
      {outgoing.length > 0 && (
        <div>
          <p className="px-2 pt-1 text-2xs font-medium evren-kod-text-muted">
            → Şu dosyaları çağırıyor ({outgoing.length})
          </p>
          {outgoing.map((row) => rowOf(row.to, row.count))}
        </div>
      )}
      {incoming.length > 0 && (
        <div>
          <p className="px-2 pt-1 text-2xs font-medium evren-kod-text-muted">
            ← Şu dosyalardan çağrılıyor ({incoming.length})
          </p>
          {incoming.map((row) => rowOf(row.from, row.count))}
        </div>
      )}
    </div>
  );
};

/**
 * Çağrı grafiği ekranı: motorun LSP'den ürettiği harita burada görülür —
 * durum/ilerleme, sembol arama, dosya→sembol gezgini ve seçili sembolün
 * çağıran/çağrılan ağacı.
 */
export const CallGraphView: React.FC<CallGraphViewProps> = ({ onSelectMenu, changedFileCount }) => {
  const {
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
  } = useCallGraphView();
  const [fileFilter, setFileFilter] = useState<'all' | 'project' | 'test'>('all');

  // Klavye gezintisi: ok tuşları satırlar arasında dolaşır; dosya listesinde
  // sağ/sol odaktaki dosyayı genişletir/daraltır.
  const searchNav = useListNav();
  const depsNav = useListNav();
  const filesNav = useListNav({
    onExpand: (path) => {
      if (expandedFile !== path) toggleFile(path);
    },
    onCollapse: (path) => {
      if (expandedFile === path) toggleFile(path);
    }
  });

  /** Satıra tıklama: sembolü grafiğin merkezine alır VE editörde kaynağını açar. */
  const openAndSelect = (node: CallGraphPanelNode) => {
    selectNode(node);
    openNodeSource(node);
  };

  const visibleFiles =
    files?.filter((row) => fileFilter === 'all' || (fileFilter === 'test') === row.isTest) ?? null;

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title="Bilgi Grafiği"
        onSelectMenu={onSelectMenu}
        activeDestination="callgraph"
        changedFileCount={changedFileCount}
        actions={
          <IconButton label="Yeniden kur" title="Haritayı baştan tara" onClick={rebuild} disabled={busy}>
            <RefreshCw className="evren-kod-icon-sm" />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        <Card className="space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Network className="evren-kod-icon-sm evren-kod-text-brand" />
            <span className="font-medium evren-kod-text-fg">
              {status?.building ? 'Harita çıkarılıyor' : status?.ready ? 'Harita hazır' : 'Harita yok'}
            </span>
            {status?.building && (
              <Badge tone="info">
                <Loader2 className="evren-kod-icon-xs animate-spin" /> %{status.progress ?? 0}
              </Badge>
            )}
            {status?.stats && (
              <span className="evren-kod-text-muted">
                {status.stats.nodes} sembol · {status.stats.edges} kenar · {status.stats.files} dosya
              </span>
            )}
            {status?.stats?.knowledge && (
              <Badge tone="info">
                bilgi tabanı: {status.stats.knowledge.files} dosya · {status.stats.knowledge.symbols} sembol
                {status.stats.knowledge.decisions > 0 ? ` · ${status.stats.knowledge.decisions} karar` : ''}
              </Badge>
            )}
            {status?.stats && status.stats.incompleteFiles > 0 && (
              <Badge tone="warning">{status.stats.incompleteFiles} dosya eksik tarandı</Badge>
            )}
          </div>
          {status?.message && (
            <p className="text-2xs leading-relaxed evren-kod-text-muted">{status.message}</p>
          )}
          {!status?.ready && !status?.building && (
            <p className="text-2xs evren-kod-text-muted">
              Bilgi grafiği iki kaynaktan beslenir: dil sunucusundan çıkarılan çağrı haritası (bir dosyayı
              kaydettiğinde o dosya kendiliğinden yeniden taranır) ve `.evren-kod/knowledge` altındaki bilgi
              tabanı. Ajan araçlarında `knowledge_graph` aynı iki kaynağı birlikte kullanır.
            </p>
          )}
        </Card>

        <Section>
          <SectionTitle icon={<Search className="evren-kod-icon-xs" />} title="Sembol ara" />
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') runSearch();
              }}
              placeholder="fonksiyon ya da sınıf adı…"
              aria-label="Çağrı grafiğinde sembol ara"
            />
            <Button onClick={runSearch} disabled={busy || !query.trim()}>
              <Search className="evren-kod-icon-xs" /> Ara
            </Button>
          </div>
          {matches.length > 0 && (
            <div ref={searchNav.containerRef} onKeyDown={searchNav.onKeyDown} className="mt-2 space-y-0.5">
              {matches.map((node) => (
                <NodeRow
                  key={node.id}
                  node={node}
                  selected={selected?.id === node.id}
                  onOpen={openAndSelect}
                  onCenter={selectNode}
                />
              ))}
            </div>
          )}
          {query.trim() && !busy && matches.length === 0 && (
            <p className="mt-2 text-2xs evren-kod-text-muted">
              Eşleşme yok; harita bayatsa yeniden kurmayı deneyin.
            </p>
          )}
        </Section>

        {status?.ready && (
          <Section>
            <SectionTitle
              icon={<FolderTree className="evren-kod-icon-xs" />}
              title="Dosyalar ve sembolleri"
              count={visibleFiles?.length ?? 0}
            />
            <div className="mt-1 flex items-center gap-1">
              {(
                [
                  { id: 'all', label: 'Tümü' },
                  { id: 'project', label: 'Proje' },
                  { id: 'test', label: 'Testler' }
                ] as const
              ).map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setFileFilter(chip.id)}
                  className={`rounded-full px-2 py-0.5 text-2xs transition ${
                    fileFilter === chip.id
                      ? 'evren-kod-bg-brand-soft evren-kod-text-brand font-medium'
                      : 'evren-kod-text-muted hover:opacity-85'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <p className="mt-1 px-2 text-2xs evren-kod-text-muted">
              ↑ ↓ ile gezin · Enter ile aç/kapat · → genişlet · ← daralt
            </p>
            {visibleFiles === null ? (
              <p className="mt-2 flex items-center gap-2 text-2xs evren-kod-text-muted">
                <Loader2 className="evren-kod-icon-xs animate-spin" /> Dosya listesi yükleniyor…
              </p>
            ) : visibleFiles.length === 0 ? (
              <p className="mt-2 text-2xs evren-kod-text-muted">Bu filtreyle eşleşen dosya yok.</p>
            ) : (
              <div ref={filesNav.containerRef} onKeyDown={filesNav.onKeyDown} className="mt-2 space-y-0.5">
                {visibleFiles.map((row) => {
                  const expanded = expandedFile === row.path;
                  const symbols = fileSymbols[row.path];
                  return (
                    <div key={row.path}>
                      <button
                        type="button"
                        data-nav
                        data-nav-path={row.path}
                        onClick={() => toggleFile(row.path)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition hover:opacity-85 evren-kod-text-fg"
                        title="Sembolleri görmek için aç"
                      >
                        {expanded ? (
                          <ChevronDown className="evren-kod-icon-xs shrink-0 evren-kod-text-muted" />
                        ) : (
                          <ChevronRight className="evren-kod-icon-xs shrink-0 evren-kod-text-muted" />
                        )}
                        <span className="min-w-0 flex-1 truncate font-mono text-2xs">{row.path}</span>
                        {row.isTest && <Badge tone="info">test</Badge>}
                        <span className="shrink-0 text-2xs evren-kod-text-muted">
                          {row.nodeCount} sembol · {row.edgeCount} kenar
                        </span>
                        {row.externalCalls > 0 && <Badge tone="muted">{row.externalCalls} dış çağrı</Badge>}
                        {row.status !== 'complete' && (
                          <Badge tone="warning">{fileStatusLabel[row.status] ?? row.status}</Badge>
                        )}
                      </button>
                      {expanded && fileDeps[row.path] && (
                        <FileDeps path={row.path} deps={fileDeps[row.path]} onOpen={toggleFile} />
                      )}
                      {expanded &&
                        (symbols ? (
                          symbols.length > 0 ? (
                            <div className="ml-3 space-y-0.5 border-l evren-kod-border-surface pl-1">
                              {symbols.map((node) => (
                                <NodeRow
                                  key={node.id}
                                  node={node}
                                  selected={selected?.id === node.id}
                                  onOpen={openAndSelect}
                                  onCenter={selectNode}
                                />
                              ))}
                            </div>
                          ) : (
                            <p className="ml-8 py-1 text-2xs evren-kod-text-muted">
                              Bu dosyada haritalanmış sembol yok.
                            </p>
                          )
                        ) : (
                          <p className="ml-8 flex items-center gap-2 py-1 text-2xs evren-kod-text-muted">
                            <Loader2 className="evren-kod-icon-xs animate-spin" /> Semboller yükleniyor…
                          </p>
                        ))}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        )}

        {status?.ready && topDeps.length > 0 && (
          <Section>
            <SectionTitle
              icon={<ArrowRightLeft className="evren-kod-icon-xs" />}
              title="En sık dosya bağlantıları"
              count={topDeps.length}
            />
            <div ref={depsNav.containerRef} onKeyDown={depsNav.onKeyDown} className="mt-1 space-y-0.5">
              {topDeps.map((row) => (
                <DepRow key={`${row.from}→${row.to}`} row={row} onOpen={toggleFile} />
              ))}
            </div>
            <p className="px-2 pt-1 text-2xs evren-kod-text-muted">
              Sayı, iki dosya arasındaki çağrı kenarı adedidir; satır içi çağrılar tek kenarda toplanır.
            </p>
          </Section>
        )}

        {selected ? (
          <div className="space-y-4">
            <Card className="space-y-2 p-3">
              <div className="flex items-center gap-2">
                <GitBranch className="evren-kod-icon-sm shrink-0 evren-kod-text-brand" />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold evren-kod-text-fg">
                  {selected.className ? `${selected.className}.${selected.name}` : selected.name}
                </span>
                <Badge tone="muted">{selected.kind}</Badge>
                {selected.exported && <Badge tone="brand">exported</Badge>}
                {selected.isTest && <Badge tone="info">test</Badge>}
                <IconButton
                  label="Kaynağı aç"
                  title="Sembolün tanımını editörde aç"
                  onClick={() => openNodeSource(selected)}
                >
                  <FileCode className="evren-kod-icon-xs" />
                </IconButton>
              </div>
              <button
                type="button"
                onClick={() => openNodeSource(selected)}
                className="block max-w-full truncate font-mono text-2xs evren-kod-text-muted hover:underline"
                title="Satırda konumlandırarak aç"
              >
                {selected.file}:{selected.startLine}
              </button>
            </Card>
            {neighbors ? (
              <>
                <NeighborList
                  title="Çağıranlar"
                  icon={<CornerUpRight className="evren-kod-icon-xs" />}
                  neighbors={neighbors.callers}
                  onSelect={selectNode}
                />
                <NeighborList
                  title="Çağırdıkları"
                  icon={<CornerDownLeft className="evren-kod-icon-xs" />}
                  neighbors={neighbors.callees}
                  onSelect={selectNode}
                />
              </>
            ) : (
              <p className="flex items-center gap-2 text-2xs evren-kod-text-muted">
                <Loader2 className="evren-kod-icon-xs animate-spin" /> Komşular yükleniyor…
              </p>
            )}
          </div>
        ) : (
          <EmptyState
            icon={<Network className="evren-kod-icon-md" />}
            title="Bir sembol seçin"
            description="Arama sonuçlarından bir sembole tıklayınca onu kimlerin çağırdığını ve kendisinin ne çağırdığını burada görürsünüz."
          />
        )}

        {rebuilding && (
          <p className="flex items-center gap-2 px-1 text-2xs evren-kod-text-muted">
            <Loader2 className="evren-kod-icon-xs animate-spin" /> Tam yeniden kurulum başladı; ilerleme
            durumu göstergesinde izlenir.
          </p>
        )}
      </div>
    </div>
  );
};
