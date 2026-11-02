import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, render, screen } from '@testing-library/react';
import { SettingsView } from '../src/components/views/settings';
import { settingsFixture as settings } from './settingsTestSupport';

afterEach(() => cleanup());

describe('SettingsView: sadeleştirilmiş davranış ayarları', () => {
  it('kaldırılan bütçe/sınır alanlarını artık göstermez', () => {
    render(<SettingsView settings={settings({ maxContinuations: 7 })} />);

    assert.equal(screen.queryByLabelText('Token bütçesi'), null);
    assert.equal(screen.queryByLabelText('Otomatik devam sınırı'), null);
    assert.equal(screen.queryByLabelText('Onarım denemesi'), null);
    assert.equal(screen.queryByLabelText('Adım sınırı'), null);
  });

  it('model yönlendirme ve EVREN ajan hazır ayarı açıklamasını gösterir', () => {
    render(<SettingsView settings={settings()} />);

    assert.ok(screen.getByText('Model yönlendirme'));
    assert.match(screen.getByText(/GLM-5.3/).textContent ?? '', /MiMo-V2.6-Pro/);
  });

  it('otomatik doğrulama ve istem önbellekleme anahtarlarını gösterir', () => {
    render(<SettingsView settings={settings()} />);

    assert.ok(screen.getByText('Otomatik doğrulama'));
    assert.match(screen.getByText(/İstem önbellekleme/).textContent ?? '', /Prompt caching/);
  });
});
