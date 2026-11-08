import { ProviderMessage } from '../../providers/base';
import { RelevanceScorer } from './RelevanceScorer';

export interface FileInsight {
  filePath: string;
  version: number;
  contentHash: string;
  exportedSymbols: string[];
  validity: 'current' | 'stale_due_to_edit';
  lastEditedStep?: number;
}

export class ContextOptimizer {
  private relevanceScorer: RelevanceScorer = new RelevanceScorer();
  private insights: Map<string, FileInsight> = new Map();

  /**
   * Bir dosya içeriğinden önemli sembol ve dışa aktarımları çıkarıp kaydeder.
   */
  public recordFileInsight(filePath: string, content: string, contentHash: string): void {
    const normPath = filePath.replace(/\\/g, '/');
    const existing = this.insights.get(normPath);
    const version = existing ? existing.version + 1 : 1;

    // Basit sembol çıkarımı: export function/interface/class/type
    const symbols: string[] = [];
    const symbolRegex =
      /export\s+(?:default\s+)?(?:class|interface|type|function|const|enum)\s+([a-zA-Z0-9_$]+)/g;
    let match: RegExpExecArray | null;
    while ((match = symbolRegex.exec(content)) !== null) {
      if (match[1]) symbols.push(match[1]);
      if (symbols.length >= 10) break;
    }

    this.insights.set(normPath, {
      filePath: normPath,
      version,
      contentHash,
      exportedSymbols: symbols,
      validity: 'current'
    });
  }

  /**
   * Bir dosya düzenlendiğinde (edit_file / write_file), geçmişteki eski read_file
   * gövdelerini reaktif olarak düşürürken çıkarılmış sembol ve sürüm bilgisini korur.
   */
  public reactiveEvict(
    messages: ProviderMessage[],
    editedFilePath: string,
    editSummary?: string
  ): ProviderMessage[] {
    const normPath = editedFilePath.replace(/\\/g, '/');
    const insight = this.insights.get(normPath);

    if (insight) {
      insight.validity = 'stale_due_to_edit';
      insight.version += 1;
    }

    const readHeaderRegex = new RegExp(`^\\[file:${normPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    let evictedCount = 0;

    const result = messages.map((msg) => {
      if (msg.role !== 'tool' || !msg.content || msg.content.length <= 500) {
        return msg;
      }

      // Dosya okuması bu dosyaya mı ait?
      const isTargetRead = readHeaderRegex.test(msg.content) || msg.content.includes(normPath);
      if (!isTargetRead) return msg;

      evictedCount++;
      const preservedSymbols =
        insight && insight.exportedSymbols.length > 0
          ? `Korunan Semboller/Sözleşmeler: ${insight.exportedSymbols.join(', ')}`
          : 'Sözleşme bilgisi korundu.';

      const summaryNote = editSummary ? ` Değişiklik: ${editSummary}.` : '';

      return {
        ...msg,
        content:
          `[read_file: "${normPath}" sürüm ${insight?.version ?? 2} olarak düzenlendi.${summaryNote}\n` +
          `${preservedSymbols}\n` +
          `Eski ham gövde (${msg.content.length} karakter) reaktif sıkıştırma ile düşürüldü. ` +
          `Gerekirse yeni satırları hedefli offset/limit ile okuyun.]`
      };
    });

    return evictedCount > 0 ? result : messages;
  }

  /**
   * Alaka puanlaması rehberliğinde düşük değerli eski mesajları sıkıştırır.
   */
  public relevanceGuidedCompaction(
    messages: ProviderMessage[],
    maxTokens: number,
    options?: { activeFiles?: Set<string> }
  ): ProviderMessage[] {
    const scored = this.relevanceScorer.scoreAll(messages, options);
    let currentTokens = this.estimateTokens(messages);

    if (currentTokens <= maxTokens) {
      return messages;
    }

    const result = [...messages];

    // Düşük puanlı mesajları (skor < 0.6) öncelikli olarak sıkıştır
    for (let i = 0; i < scored.length; i++) {
      if (currentTokens <= maxTokens) break;
      const item = scored[i];
      if (!item) continue;

      // Sistem istemi veya son mesajlar asla sıkıştırılmaz
      if (item.score >= 0.85 || item.message.role === 'system') continue;

      const msg = result[i];
      if (msg && msg.content && msg.content.length > 400) {
        const originalLength = msg.content.length;
        const firstLine = msg.content.split('\n')[0] ?? '';
        const compacted =
          `${firstLine.slice(0, 140)}\n` +
          `[... Bağlam bütçesi için sıkıştırıldı: ${originalLength} karakter -> özet korundu (${item.reason}) ...]`;

        result[i] = { ...msg, content: compacted };
        currentTokens -= Math.ceil((originalLength - compacted.length) / 3.8);
      }
    }

    return result;
  }

  /**
   * Dosya içgörü kaydını döner.
   */
  public getInsight(filePath: string): FileInsight | undefined {
    return this.insights.get(filePath.replace(/\\/g, '/'));
  }

  /**
   * Mesajların yaklaşık token boyutunu hesaplar.
   */
  public estimateTokens(messages: ProviderMessage[]): number {
    let charCount = 0;
    for (const msg of messages) {
      charCount += (msg.content || '').length + 4;
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          charCount += tc.name.length + JSON.stringify(tc.arguments).length;
        }
      }
    }
    return Math.ceil(charCount / 3.8);
  }

  /**
   * Durumu sıfırlar.
   */
  public reset(): void {
    this.insights.clear();
  }
}
