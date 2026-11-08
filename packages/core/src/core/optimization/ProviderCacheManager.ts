import { ProviderMessage } from '../../providers/base';
import { ModelProviderType } from '../../shared/types';
import { ToolDefinition } from '../../tools/base';

export interface CacheOptimizationResult {
  messages: ProviderMessage[];
  staticPrefixTokens: number;
  dynamicTokens: number;
  isCacheOptimized: boolean;
  providerStrategy: 'ephemeral-breakpoint' | 'byte-stable-prefix' | 'none';
}

export class ProviderCacheManager {
  /**
   * Sağlayıcı türüne göre önbellekleme stratejisini belirler.
   */
  public getProviderStrategy(
    providerType: ModelProviderType | string
  ): 'ephemeral-breakpoint' | 'byte-stable-prefix' | 'none' {
    if (providerType === 'openrouter' || providerType === 'anthropic') {
      return 'ephemeral-breakpoint';
    }
    if (providerType === 'evren' || providerType === 'openai-compatible') {
      return 'byte-stable-prefix';
    }
    return 'none';
  }

  /**
   * Mesaj geçmişini bayt-kararlı statik önek ve dinamik kuyruk olarak yapılandırır.
   *
   * 1. Statik Önek: Sistem Yönergeleri + Aşama Araç Şemaları + Değişmeyen Kurallar
   * 2. Yarı-Statik: Proje Hafızası ve Repo Haritası
   * 3. Dinamik Kuyruk: Çalışma Hafızası + Sohbet Turları + Canlı Görev Durumu (<system_context>)
   */
  public buildOptimizedConversation(
    systemPrompt: string,
    historyMessages: ProviderMessage[],
    tailContext?: string,
    providerType: ModelProviderType | string = 'evren'
  ): CacheOptimizationResult {
    const strategy = this.getProviderStrategy(providerType);

    // Statik sistem istemi (hiçbir değişken zaman damgası veya rastgele kimlik içermez)
    const messages: ProviderMessage[] = [{ role: 'system', content: systemPrompt }];

    // Konuşma geçmişi adımları eklenir
    for (const msg of historyMessages) {
      if (msg.role !== 'system') {
        messages.push(msg);
      }
    }

    // Dinamik kuyruk en sona <system_context> olarak eklenir
    if (tailContext && tailContext.trim()) {
      messages.push({
        role: 'user',
        content: `<system_context>\n${tailContext.trim()}\n</system_context>`
      });
    }

    const staticPrefixTokens = Math.ceil(systemPrompt.length / 3.8);
    const dynamicTokens = Math.ceil(
      (messages.reduce((acc, m) => acc + (m.content?.length || 0), 0) - systemPrompt.length) / 3.8
    );

    return {
      messages,
      staticPrefixTokens,
      dynamicTokens,
      isCacheOptimized: strategy !== 'none',
      providerStrategy: strategy
    };
  }

  /**
   * Araç şemalarını bayt-kararlı deterministik sırayla biçimlendirir.
   */
  public getStableToolSchemas(tools: ToolDefinition[]): ToolDefinition[] {
    return [...tools].sort((a, b) => a.name.localeCompare(b.name));
  }
}
