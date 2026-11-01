import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SettingsView } from '../src/components/views/settings';
import { settingsFixture as settings } from './settingsTestSupport';

afterEach(() => cleanup());

describe('SettingsView: otonomi seçimi', () => {
  it('üç seviyeyi de gösterir ve mevcut olanı işaretler', () => {
    render(<SettingsView settings={settings({ autonomy: 'guided' })} />);

    assert.ok(screen.getByText('Elle'));
    assert.ok(screen.getByText('Yönlendirilmiş'));
    assert.ok(screen.getByText('Otonom'));

    const guided = screen.getByRole('button', { name: /Yönlendirilmiş/ });
    assert.equal(guided.getAttribute('aria-pressed'), 'true');

    const manual = screen.getByRole('button', { name: /Elle/ });
    assert.equal(manual.getAttribute('aria-pressed'), 'false');
  });

  it('seçim değiştiğinde otonomi güncellenir', () => {
    render(<SettingsView settings={settings()} />);

    const auto = screen.getByRole('button', { name: /Otonom/ });
    fireEvent.click(auto);

    const updated = screen.getByRole('button', { name: /Otonom/ });
    assert.equal(updated.getAttribute('aria-pressed'), 'true');
  });

  it('seviye sözleşmesini ve güvenlik sınırlarını dürüstçe yazar', () => {
    render(<SettingsView settings={settings({ autonomy: 'auto' })} />);

    const caption = screen.getByText(/Otonom: akış kartları/).textContent ?? '';
    assert.match(caption, /dosya yazma ve güvenli komutlar otomatik onaylanır/);
    assert.match(caption, /Riskli ya da tanımadığımız komutlar.*her seviyede onay ister/);
  });
});
