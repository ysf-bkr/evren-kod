import './setupDom';
import { afterEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SettingsView } from '../src/components/views/settings';
import { settingsFixture } from './settingsTestSupport';
import { MASKED_KEY } from '@shared/constants';

afterEach(() => cleanup());

const testSettings = (overrides: Parameters<typeof settingsFixture>[0] = {}) =>
  settingsFixture({ isConfigured: true, ...overrides });

describe('SettingsView: sağlayıcı ve API anahtarı yönetimi', () => {
  it('EVREN sağlayıcısı seçildiğinde API anahtarı girilebilir', () => {
    render(<SettingsView settings={testSettings({ selectedProvider: 'evren', selectedModel: 'auto' })} />);

    const keyInput = screen.getByLabelText('API anahtarı') as HTMLInputElement;
    assert.ok(keyInput, 'API anahtarı alanı görünmeli');

    fireEvent.change(keyInput, { target: { value: 'evren-kod-deneme-anahtari' } });
    assert.equal(keyInput.value, 'evren-kod-deneme-anahtari', 'yazılan anahtar alana aktarılmalı');
  });

  it('kayıtlı anahtar varken yer tutucu gösterir ve doğrudan düzenlemeye izin verir', () => {
    render(
      <SettingsView
        settings={testSettings({
          selectedProvider: 'evren',
          selectedModel: 'auto',
          apiKeys: { evren: MASKED_KEY },
          apiKeyStatus: { evren: true, openrouter: false, openaiCompatible: false }
        })}
      />
    );

    const keyInput = screen.getByLabelText('API anahtarı') as HTMLInputElement;
    assert.equal(keyInput.value, '', 'ham maske karakterleri düzenleme alanını kirletmemeli');
    assert.match(keyInput.placeholder, /Kayıtlı anahtar korunuyor/);

    // Yeni anahtar yazılabilmeli
    fireEvent.change(keyInput, { target: { value: 'yeni-anahtar-123' } });
    assert.equal(keyInput.value, 'yeni-anahtar-123');
  });

  it('şifre göster/gizle düğmesi türü değiştirir', () => {
    render(
      <SettingsView settings={testSettings({ selectedProvider: 'openrouter', selectedModel: 'claude' })} />
    );

    const keyInput = screen.getByLabelText('API anahtarı') as HTMLInputElement;
    assert.equal(keyInput.type, 'password');

    const toggleBtn = screen.getByRole('button', { name: 'Anahtarı göster' });
    fireEvent.click(toggleBtn);

    assert.equal(keyInput.type, 'text');
  });
});
