/**
 * Proje profilinin Türkçe arayüz etiketleri.
 *
 * Motor (ProjectProfiler) gerekçe metinlerinde, arayüz (Ayarlar > Proje
 * Profili) seçim listelerinde aynı etiketleri kullanır; tek doğruluk
 * kaynağı burada durur.
 */
import type { ProjectKind } from './types';

export const PROJECT_KIND_LABELS: Record<ProjectKind, string> = {
  'web-frontend': 'Web arayüzü',
  'web-backend': 'Arka uç servisi',
  fullstack: 'Fullstack web uygulaması',
  mobile: 'Mobil uygulama',
  desktop: 'Masaüstü uygulaması',
  library: 'Kütüphane / paket',
  cli: 'Komut satırı aracı',
  unknown: 'Bilinmeyen proje türü'
};
