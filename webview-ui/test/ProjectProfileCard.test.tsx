import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vscode } from '../src/utils/vscode';
import { ProjectProfileCard } from '../src/components/views/settings/SettingsProjectProfileCard';
import type { ProjectProfile } from '@shared/types';

const originalPostMessage = vscode.postMessage;

afterEach(() => {
  cleanup();
  vscode.postMessage = originalPostMessage;
});

const profileOf = (overrides: Partial<ProjectProfile> = {}): ProjectProfile => ({
  version: 1,
  generatedAt: new Date().toISOString(),
  source: 'auto',
  kinds: ['web-frontend'],
  primaryKind: 'web-frontend',
  stacks: ['react', 'typescript'],
  monorepo: false,
  confidence: 0.8,
  evidence: ['package.json: react bağımlılığı', 'Tür: Web arayüzü'],
  ...overrides
});

/** Kartı render eder ve host'un yapacağı gibi profili besler; gönderilen mesajları toplar. */
async function renderCard(
  profile: ProjectProfile = profileOf()
): Promise<Array<{ type: string; payload?: unknown }>> {
  const sent: Array<{ type: string; payload?: unknown }> = [];
  vscode.postMessage = (message: unknown) => {
    const typed = message as { type: string; payload?: { rescan?: boolean } };
    sent.push(typed);
    if (typed.type === 'GET_PROJECT_PROFILE' && !typed.payload?.rescan) {
      setTimeout(() => window.postMessage({ type: 'PROJECT_PROFILE_LOADED', payload: { profile } }, '*'), 0);
    }
  };
  render(<ProjectProfileCard />);
  await waitFor(() => assert.ok(screen.getByTestId('project-profile-meta')), { timeout: 15000 });
  return sent;
}

describe('ProjectProfileCard: proje profili ve uzman ekip', () => {
  it('yüklenene kadar tarama durumu gösterir ve profili hosttan ister', async () => {
    const sent = await renderCard();
    assert.ok(sent.some((m) => m.type === 'GET_PROJECT_PROFILE'));
  });

  it('otomatik profili kaynak, güven ve yığın bilgisiyle gösterir', async () => {
    await renderCard();
    const meta = screen.getByTestId('project-profile-meta').textContent ?? '';
    assert.match(meta, /Otomatik tespit · Güven: %80/);
    assert.match(meta, /react, typescript/);
    assert.ok(screen.getByText('package.json: react bağımlılığı'));
  });

  it('elle seçilmiş profil "Elle seçildi" olarak etiketlenir', async () => {
    await renderCard(profileOf({ source: 'manual', confidence: 1, evidence: [] }));
    assert.match(screen.getByTestId('project-profile-meta').textContent ?? '', /Elle seçildi/);
  });

  it('tür değişmeden Elle Kaydet pasif kalır; değişince payload ile kaydeder', async () => {
    const sent = await renderCard();
    const save = screen.getByRole('button', { name: 'Elle Kaydet' });
    assert.ok((save as HTMLButtonElement).disabled, 'temiz form kaydedilemez');

    fireEvent.change(screen.getByLabelText('Proje türü'), { target: { value: 'mobile' } });
    assert.ok(!(save as HTMLButtonElement).disabled);
    fireEvent.click(save);

    const saved = sent.find((m) => m.type === 'SAVE_PROJECT_PROFILE');
    assert.ok(saved, 'SAVE_PROJECT_PROFILE gönderilmeli');
    const payload = saved.payload as { primaryKind: string; stacks: string[]; monorepo: boolean };
    assert.equal(payload.primaryKind, 'mobile');
    assert.deepEqual(payload.stacks, ['react', 'typescript']);
    assert.equal(payload.monorepo, false);
    // Kayıt gönderildikten sonra kirlilik sıfırlanmaz (host onayı ayrı turda gelir);
    // düğme yalnızca yeni PROFILE_LOADED geldiklerinde tekrar pasifleşir.
    assert.ok(!(save as HTMLButtonElement).disabled);
  });

  it('yığın çipi seçilip kaldırılabilir ve monorepo anahtarı payloada girer', async () => {
    const sent = await renderCard();
    const flutter = screen.getByRole('button', { name: 'flutter' });
    fireEvent.click(flutter);
    assert.equal(flutter.getAttribute('aria-pressed'), 'true');

    const monorepoToggle = screen.getByRole('switch', { name: /Monorepo/ });
    fireEvent.click(monorepoToggle);

    fireEvent.click(screen.getByRole('button', { name: 'Elle Kaydet' }));
    const saved = sent.find((m) => m.type === 'SAVE_PROJECT_PROFILE');
    const payload = saved?.payload as { stacks: string[]; monorepo: boolean };
    assert.ok(payload.stacks.includes('flutter'));
    assert.equal(payload.monorepo, true);
  });

  it('Yeniden Tara zorlu tarama ister', async () => {
    const sent = await renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Yeniden Tara/ }));
    const rescan = sent.find(
      (m) => m.type === 'GET_PROJECT_PROFILE' && (m.payload as { rescan?: boolean } | undefined)?.rescan
    );
    assert.ok(rescan, 'rescan:true gönderilmeli');
  });
});
