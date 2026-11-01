import type { UserSettings } from '@shared/types';

/**
 * SettingsView testlerinin ortak ayar kurucusu. Dosyalar arası kopyayı
 * önler; özel testler farklılaştıkları alanları `overrides` ile basar.
 */
export const settingsFixture = (overrides: Partial<UserSettings> = {}): UserSettings => ({
  selectedProvider: 'ollama',
  selectedModel: 'llama3.1',
  apiKeys: {},
  autoApprove: { readFiles: true, writeFiles: false, executeCommands: false },
  autoVerify: true,
  autonomy: 'manual',
  ...overrides
});
