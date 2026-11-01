import { useEffect, useRef, useState } from 'react';
import { ModelProviderType, UserSettings } from '@shared/types';
import { vscode } from '../../../utils/vscode';
import { SAVED_HINT_MS } from '../../../utils/uiTiming';

/**
 * Ayarlar ekranı için form durumu, otomatik kaydetme ve model kataloğu kancası.
 */
export function useSettingsView(settings: UserSettings) {
  const [formData, setFormData] = useState<UserSettings>(settings);
  const [saved, setSaved] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoadedMsg, setModelsLoadedMsg] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Güncel formu referansta tutarak zamanlayıcıların doğru veriyi kaydetmesini sağlar.
  const formRef = useRef(formData);
  formRef.current = formData;

  const saveSettings = (data: UserSettings) => {
    vscode.postMessage({ type: 'SAVE_SETTINGS', payload: data });
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), SAVED_HINT_MS);
  };

  /**
   * Formu günceller ve ayarları otomatik olarak kaydeder.
   * Seçimler ve anahtarlar anında (`immediate=true`), metin girişleri ise
   * tuş basımı bittikten sonra gecikmeli kaydedilir.
   */
  const updateForm = (next: UserSettings | ((prev: UserSettings) => UserSettings), immediate = true) => {
    setFormData((prev) => {
      const nextValue = typeof next === 'function' ? next(prev) : next;
      formRef.current = nextValue;
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
      }
      if (immediate) {
        saveSettings(nextValue);
      } else {
        saveDebounceRef.current = setTimeout(() => {
          saveSettings(formRef.current);
          saveDebounceRef.current = null;
        }, 350);
      }
      return nextValue;
    });
  };

  // Dışarıdan yeni ayar gelirse (kullanıcı yerel olarak yazmadığı sürece) formu güncelle
  useEffect(() => {
    if (!saveDebounceRef.current) {
      setFormData(settings);
    }
  }, [settings]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
        saveSettings(formRef.current);
      }
    };
  }, []);

  const triggerFetchModels = (provider: ModelProviderType, apiKey?: string, baseUrl?: string) => {
    if (provider === 'evren' && !apiKey) return;
    if (provider === 'openrouter' && !apiKey) return;

    setLoadingModels(true);
    setModelsError(null);
    setModelsLoadedMsg(null);
    vscode.postMessage({ type: 'FETCH_MODELS', payload: { provider, apiKey, baseUrl } });
  };

  useEffect(() => {
    const current = formRef.current;
    const activeKey = current.apiKeys[current.selectedProvider as keyof typeof current.apiKeys];
    if (
      current.selectedProvider === 'ollama' ||
      current.selectedProvider === 'openai-compatible' ||
      activeKey
    ) {
      triggerFetchModels(
        current.selectedProvider,
        activeKey,
        current.selectedProvider === 'ollama'
          ? current.ollamaBaseUrl
          : current.selectedProvider === 'openai-compatible'
            ? current.openAiCompatibleBaseUrl
            : current.customBaseUrl
      );
    }
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type !== 'MODELS_LOADED') return;
      setLoadingModels(false);
      if (msg.payload?.provider && msg.payload.provider !== formData.selectedProvider) return;

      if (msg.payload.models?.length > 0) {
        setAvailableModels(msg.payload.models);
        const currentIsListed = msg.payload.models.includes(formData.selectedModel);
        setModelsLoadedMsg(
          currentIsListed
            ? `${msg.payload.models.length} model yüklendi`
            : `${msg.payload.models.length} model yüklendi; özel model seçiminiz korundu`
        );
        setModelsError(null);
      }
      if (msg.payload.error) {
        setModelsError(msg.payload.error);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [formData.selectedModel, formData.selectedProvider]);

  const handleApiKeyChange = (provider: 'evren' | 'openrouter' | 'openaiCompatible', key: string) => {
    updateForm(
      (prev) => ({
        ...prev,
        apiKeys: { ...prev.apiKeys, [provider]: key }
      }),
      false
    );

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (key.trim()) {
      debounceTimerRef.current = setTimeout(() => {
        const modelProvider = provider === 'openaiCompatible' ? 'openai-compatible' : provider;
        const latest = formRef.current;
        const baseUrl =
          provider === 'openaiCompatible' ? latest.openAiCompatibleBaseUrl : latest.customBaseUrl;
        triggerFetchModels(modelProvider, key.trim(), baseUrl);
      }, 500);
    }
  };

  const handleClearApiKey = (provider: 'evren' | 'openrouter' | 'openaiCompatible') => {
    updateForm(
      (prev) => ({
        ...prev,
        apiKeys: { ...prev.apiKeys, [provider]: '' },
        apiKeyStatus: prev.apiKeyStatus ? { ...prev.apiKeyStatus, [provider]: false } : undefined
      }),
      true
    );
  };

  /** Model listesini ve durum mesajlarını sıfırlar (sağlayıcı değişiminde). */
  const resetModels = () => {
    setAvailableModels([]);
    setModelsLoadedMsg(null);
    setModelsError(null);
  };

  /** Bekleyen gecikmeli bir kayıt varsa ayrılmadan önce hemen gönderir. */
  const flushPendingSave = () => {
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = null;
      saveSettings(formRef.current);
    }
  };

  return {
    formData,
    saved,
    loadingModels,
    availableModels,
    modelsLoadedMsg,
    modelsError,
    updateForm,
    saveSettings,
    triggerFetchModels,
    handleApiKeyChange,
    handleClearApiKey,
    resetModels,
    flushPendingSave
  };
}
