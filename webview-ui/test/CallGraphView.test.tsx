import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CallGraphPanelNode, CallGraphPanelNeighbor } from '@shared/types';
import { vscode } from '../src/utils/vscode';
import { CallGraphView } from '../src/components/views/callgraph';

const originalPostMessage = vscode.postMessage;

afterEach(() => {
  cleanup();
  vscode.postMessage = originalPostMessage;
});

const NODE: CallGraphPanelNode = {
  id: 'fn:src/a.ts:Beta.alpha',
  name: 'alpha',
  kind: 'function',
  file: 'src/a.ts',
  startLine: 12,
  exported: true,
  isTest: false,
  className: 'Beta'
};

const CALLER: CallGraphPanelNeighbor = {
  ...NODE,
  id: 'fn:src/b.ts:beta',
  className: undefined,
  name: 'beta',
  file: 'src/b.ts',
  startLine: 5,
  depth: 1,
  lines: [41, 87]
};

/** Ekranı render eder ve extension host gibi CALLGRAPH_RESULT'ları besler. */
async function renderWithGraph(): Promise<Array<{ type: string; payload?: unknown }>> {
  const sent: Array<{ type: string; payload?: unknown }> = [];
  vscode.postMessage = (message: unknown) => {
    const typed = message as { type: string; payload?: { action?: string; path?: string } };
    sent.push(typed);
    const action = typed.payload?.action;
    setTimeout(() => {
      if (action === 'status') {
        window.postMessage(
          {
            type: 'CALLGRAPH_RESULT',
            payload: {
              action: 'status',
              ready: true,
              building: false,
              message: '',
              stats: { files: 2, nodes: 2, edges: 1, incompleteFiles: 0 }
            }
          },
          '*'
        );
      } else if (action === 'search') {
        window.postMessage(
          {
            type: 'CALLGRAPH_RESULT',
            payload: { action: 'search', ready: true, building: false, message: '', matches: [NODE] }
          },
          '*'
        );
      } else if (action === 'neighbors') {
        window.postMessage(
          {
            type: 'CALLGRAPH_RESULT',
            payload: {
              action: 'neighbors',
              ready: true,
              building: false,
              message: '',
              callers: [CALLER],
              callees: []
            }
          },
          '*'
        );
      } else if (action === 'files') {
        window.postMessage(
          {
            type: 'CALLGRAPH_RESULT',
            payload: {
              action: 'files',
              ready: true,
              building: false,
              message: '',
              files: [
                {
                  path: 'src/a.ts',
                  status: 'complete',
                  nodeCount: 2,
                  edgeCount: 1,
                  externalCalls: 0,
                  isTest: false
                },
                {
                  path: 'src/b.ts',
                  status: 'complete',
                  nodeCount: 1,
                  edgeCount: 2,
                  externalCalls: 0,
                  isTest: false
                },
                {
                  path: 'src/a.test.ts',
                  status: 'complete',
                  nodeCount: 1,
                  edgeCount: 1,
                  externalCalls: 0,
                  isTest: true
                }
              ]
            }
          },
          '*'
        );
      } else if (action === 'fileSymbols') {
        window.postMessage(
          {
            type: 'CALLGRAPH_RESULT',
            payload: {
              action: 'fileSymbols',
              ready: true,
              building: false,
              message: '',
              path: typed.payload?.path,
              fileSymbols: [NODE]
            }
          },
          '*'
        );
      } else if (action === 'deps') {
        window.postMessage(
          {
            type: 'CALLGRAPH_RESULT',
            payload: {
              action: 'deps',
              ready: true,
              building: false,
              message: '',
              path: typed.payload?.path,
              deps: [{ from: 'src/b.ts', to: 'src/a.ts', count: 4 }]
            }
          },
          '*'
        );
      }
    }, 0);
  };

  render(<CallGraphView />);
  await waitFor(() => assert.ok(screen.getByText('Harita hazır')));
  fireEvent.change(screen.getByLabelText('Çağrı grafiğinde sembol ara'), { target: { value: 'alpha' } });
  fireEvent.click(screen.getByRole('button', { name: /Ara/ }));
  await waitFor(() => assert.ok(screen.getByText('Beta.alpha')));
  fireEvent.click(screen.getByText('Beta.alpha'));
  await waitFor(() => assert.ok(screen.getByText('Çağıranlar')));
  return sent;
}

describe('CallGraphView: detaylı inceleme', () => {
  it('seçili sembolün kartındaki Aç düğmesi satır numaralı OPEN_FILE gönderir', async () => {
    const sent = await renderWithGraph();

    fireEvent.click(screen.getByTitle('Sembolün tanımını editörde aç'));
    const open = [...sent].reverse().find((message) => message.type === 'OPEN_FILE');
    assert.deepEqual(open?.payload, { filePath: 'src/a.ts', line: 12 });
  });

  it('çağıran satırına tıklamak çağrı satırını editöre taşır', async () => {
    const sent = await renderWithGraph();

    // Yeni davranış: komşu satırının kendisi kaynağa götürür (çalışma satırı).
    // Kurulumdaki arama-tık da OPEN_FILE gönderdiği için son mesaj incelenir.
    fireEvent.click(screen.getByTitle(/Çağrı satırı: 41/));
    const open = [...sent].reverse().find((message) => message.type === 'OPEN_FILE');
    assert.deepEqual(open?.payload, { filePath: 'src/b.ts', line: 41 });
  });

  it('seçili sembolün tür/ihrac rozetleri detay kartında görünür', async () => {
    await renderWithGraph();

    assert.ok(screen.getAllByText('function').length > 0);
    assert.ok(screen.getByText('exported'));
    assert.ok(screen.getAllByText('src/a.ts:12').length > 0);
  });
});

describe('CallGraphView: dosya gezgini ve bağlantılar', () => {
  it('dosya satırını açmak sembolleri ve iki yönlü bağlantıları yükler', async () => {
    const sent = await renderWithGraph();
    await waitFor(() => assert.ok(document.querySelector('[data-nav-path="src/b.ts"]')));

    fireEvent.click(document.querySelector<HTMLButtonElement>('[data-nav-path="src/b.ts"]')!);
    await waitFor(() => assert.ok(screen.getByText('→ Şu dosyaları çağırıyor (1)')));
    const hasSymbols = sent.some(
      (message) => (message.payload as { action?: string; path?: string })?.action === 'fileSymbols'
    );
    assert.ok(hasSymbols, 'fileSymbols istemi gönderilmeli');
    // Küresel özet de açılışta kendiliğinden gelir.
    assert.ok(screen.getByText('En sık dosya bağlantıları'));
  });

  it('Testler filtresi yalnızca test dosyalarını gösterir', async () => {
    await renderWithGraph();
    await waitFor(() => assert.ok(document.querySelector('[data-nav-path="src/a.ts"]')));

    fireEvent.click(screen.getByRole('button', { name: 'Testler' }));
    await waitFor(() => assert.ok(document.querySelector('[data-nav-path="src/a.test.ts"]')));
    assert.strictEqual(document.querySelector('[data-nav-path="src/a.ts"]'), null);
  });
});

describe('CallGraphView: klavye ile gezinme', () => {
  it('ok tuğları satırlar arasında odağı taşır, sağ ok dosyayı genişletir', async () => {
    const sent = await renderWithGraph();
    await waitFor(() => assert.ok(document.querySelector('[data-nav-path="src/b.ts"]')));

    const first = document.querySelector<HTMLButtonElement>('[data-nav-path="src/a.ts"]');
    const second = document.querySelector<HTMLButtonElement>('[data-nav-path="src/b.ts"]');
    assert.ok(first && second);

    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    assert.strictEqual(document.activeElement, second, 'aşağı ok ikinci satıra taşımalı');

    fireEvent.keyDown(second, { key: 'ArrowUp' });
    assert.strictEqual(document.activeElement, first, 'yukarı ok geri dönmeli');

    // Sağ ok odaktaki satıra uygulanır: gerçek kullanım gibi b.ts'ye dönülür.
    second.focus();
    fireEvent.keyDown(second, { key: 'ArrowRight' });
    await waitFor(() =>
      assert.ok(
        sent.some(
          (message) =>
            (message.payload as { action?: string; path?: string })?.action === 'fileSymbols' &&
            (message.payload as { path?: string })?.path === 'src/b.ts'
        ),
        'sağ ok odaktaki dosyayı genişletmeli'
      )
    );
  });
});
