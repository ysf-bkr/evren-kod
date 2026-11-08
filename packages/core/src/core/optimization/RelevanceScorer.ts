import { ProviderMessage } from '../../providers/base';

export interface ScoredContextItem {
  message: ProviderMessage;
  score: number;
  reason: string;
}

export class RelevanceScorer {
  /**
   * Bir mesajın bağlamda kalma değerini (0.0 - 1.0) hesaplar.
   *
   * Yüksek Puan (0.8 - 1.0):
   * - Sistem istemi
   * - Son kullanıcı mesajı ve talimatları
   * - Aktif kabul kriterleri, mimari kararlar, API sözleşmeleri
   * - En son yapılan dosya düzenlemeleri ve aktif derleme hataları
   *
   * Orta Puan (0.5 - 0.7):
   * - Düzenlenen dosyaların güncel yapısal özetleri
   * - Aktif aşamaya ait alt ajan raporları
   *
   * Düşük Puan (0.1 - 0.4):
   * - Başarılı geçmiş test/terminal çıktıları
   * - Eski aşamalara ait arama ve dizin listeleme sonuçları
   * - Düzenlenmiş ve ham gövdesi bayatlamış eski okumalar
   */
  public scoreMessage(
    message: ProviderMessage,
    index: number,
    totalMessages: number,
    options?: { activeFiles?: Set<string> }
  ): ScoredContextItem {
    // Sistem istemi ve ilk mesaj mutlak korunur
    if (message.role === 'system') {
      return { message, score: 1.0, reason: 'Sistem yönergesi' };
    }

    const distanceFromEnd = totalMessages - index - 1;

    // En son mesajlar ve son kullanıcı istemi
    if (distanceFromEnd <= 2) {
      return { message, score: 0.95, reason: 'En son tur mesajı' };
    }

    if (message.role === 'user') {
      return { message, score: 0.9, reason: 'Kullanıcı girdisi / yönlendirmesi' };
    }

    // Araç çıktıları için içerik analizi
    if (message.role === 'tool') {
      const content = message.content || '';

      // Hata veya başarısızlık içeren mesajlar yüksek önceliklidir
      if (/(?:error|fail|exception|fatal|TS\d{4}|AssertionError)/i.test(content)) {
        return { message, score: 0.85, reason: 'Hata veya istisna sinyali' };
      }

      // Dosya okuması aktif dosyalardan biri mi?
      if (options?.activeFiles) {
        for (const activeFile of options.activeFiles) {
          if (content.includes(activeFile)) {
            return { message, score: 0.75, reason: 'Aktif üzerinde çalışılan dosya referansı' };
          }
        }
      }

      // Başarılı test veya temiz komut çıktıları zamanla değer kaybeder
      if (/(?:testler başarıyla geçti|pass(?:ed)?|all tests passed)/i.test(content)) {
        return {
          message,
          score: Math.max(0.2, 0.5 - distanceFromEnd * 0.03),
          reason: 'Geçmiş başarılı test çıktısı'
        };
      }

      // Genel araç çıktıları eskidikçe puan kaybeder
      return {
        message,
        score: Math.max(0.15, 0.6 - distanceFromEnd * 0.04),
        reason: 'Eski araç çıktısı'
      };
    }

    // Asistan mesajları
    if (message.role === 'assistant') {
      if (message.toolCalls && message.toolCalls.length > 0) {
        return { message, score: 0.7, reason: 'Araç çağıran asistan adımı' };
      }
      return { message, score: 0.6, reason: 'Asistan akıl yürütmesi' };
    }

    return { message, score: 0.5, reason: 'Standart bağlam' };
  }

  /**
   * Tüm mesajları puanlayarak sıralar.
   */
  public scoreAll(messages: ProviderMessage[], options?: { activeFiles?: Set<string> }): ScoredContextItem[] {
    return messages.map((msg, idx) => this.scoreMessage(msg, idx, messages.length, options));
  }
}
