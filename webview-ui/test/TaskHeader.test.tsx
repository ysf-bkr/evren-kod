import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, render, screen } from '@testing-library/react';
import { TaskHeader } from '../src/components/workflow/TaskHeader';
import type { TaskState } from '@shared/types';

afterEach(() => cleanup());

const baseState = (overrides: Partial<TaskState> = {}): TaskState => ({
  id: 's1',
  prompt: 'görev',
  mode: 'code',
  status: 'running',
  messages: [],
  stats: { totalTokens: 0, stepsCount: 0, filesModified: [] },
  ...overrides
});

const renderHeader = (state: TaskState) =>
  render(<TaskHeader state={state} changedFileCount={0} onSelectMenu={() => undefined} />);

describe('TaskHeader: görev token rozeti', () => {
  it('token harcandıysa toplamı gösterir, ipucunda kırılım ve önbellek isabeti var', () => {
    renderHeader(
      baseState({
        status: 'completed',
        stats: {
          totalTokens: 12_400,
          stepsCount: 3,
          filesModified: [],
          promptTokens: 11_000,
          completionTokens: 1_400,
          cachedTokens: 8_800
        }
      })
    );

    const badge = screen.getByLabelText('Görev token tüketimi');
    assert.equal(badge.textContent, 'Σ 12.4B');
    const title = badge.getAttribute('title') || '';
    assert.ok(title.includes('giden 11B'), `giden kırılımı olmalı: ${title}`);
    assert.ok(title.includes('gelen 1.4B'), `gelen kırılımı olmalı: ${title}`);
    assert.ok(title.includes('önbelleğinden okunan 8.8B (%80)'), `önbellek isabeti olmalı: ${title}`);
  });

  it('henüz token harcanmadıysa rozet çizilmez', () => {
    renderHeader(baseState());
    assert.equal(screen.queryByLabelText('Görev token tüketimi'), null);
  });

  it('sağlayıcı kırılım döndürmediyse yalnızca toplam görünür, çarpan yok', () => {
    renderHeader(baseState({ stats: { totalTokens: 900, stepsCount: 1, filesModified: [] } }));
    const badge = screen.getByLabelText('Görev token tüketimi');
    assert.equal(badge.textContent, 'Σ 900');
    const title = badge.getAttribute('title') || '';
    assert.ok(!title.includes('%'), 'önbellek yüzdesi uydurulmamalı');
  });
});
