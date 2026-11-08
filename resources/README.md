# Evren Kod Görsel ve Marka Varlıkları

Bu dizin, Evren Kod eklentisi, web arayüzü ve tanıtım mecralarında kullanılan resmi
görsel varlıkları barındırır. Bütün raster varlıklar tek kaynak olan `logo-evren.png`
üzerinden `npm run build:assets` komutuyla türetilir.

## 1. Temel Eklenti Varlıkları (VS Code)

Amblem: **Kalkan** (kurumsal güvenlik ve gizlilik), **Kod Sembolü `</>`** (kodlama asistanlığı), **Sonsuzluk / Evren Şeridi** (sürekli ve güvenli geliştirme döngüsü) ve **Yeşil Doğrulama Mührü `✓`** (kanıtsız kodu teslim etmeyen kalite güvencesi). Renkler: derin uzay ve elektrik mavisi (#38BDF8→#3B82F6→#1E3A8A), eflatun/mor sonsuzluk geçişi (#8B5CF6→#D946EF) ve neşeli zümrüt yeşili doğrulama mührü (#10B981→#34D399).

| Dosya            | Boyut / Format                        | Kullanım Alanı                                            |
| ---------------- | ------------------------------------- | --------------------------------------------------------- |
| `icon.png`       | 128×128 PNG                           | VS Code Marketplace eklenti simgesi                       |
| `icon.svg`       | Vektör SVG (monokrom, `currentColor`) | VS Code ikincil kenar çubuğu görünüm ikonu (tema duyarlı) |
| `icon-color.svg` | Vektör SVG (renkli)                   | Renkli Evren Kod amblem vektör kaynağı                    |
| `logo.png`       | 900×900 PNG                           | Açık temalar için kenar boşluksuz saydam arka planlı logo |
| `logo-dark.png`  | 900×900 PNG                           | Koyu temalar için kenar boşluksuz saydam arka planlı logo |
| `logo-safe.png`  | 900×900 PNG                           | Tema-nötr yedek logo (Marketplace ve README başlığı)      |
| `logo.svg`       | SVG                                   | Amblem ve yazı vektör sarmalayıcısı                       |
| `logo-evren.png` | 1254×1254 PNG                         | Kaynak yüksek çözünürlüklü marka amblemi (ana varlık)     |

## 2. Dağıtım ve Mağaza Varlıkları

Yüksek çözünürlüklü ekranlar ve mağaza listelemeleri için:

- `logo-evren.png`: 1254×1254 kaynak yüksek çözünürlüklü amblem varlığı.
- `logo-safe.png`: Tema-nötr varyant — hem açık hem koyu zeminde okunur. README başlığı bu logoyu `raw.githubusercontent.com` üzerinden MUTLAK bir adresle gösterir: VS Code Marketplacesi `<picture>` etiketini siler ve göreli yolları çözümleyemediği için tek güvenilir çözüm budur.
- `icon-256.png` / `icon-512.png` / `icon-1024.png`: Yüksek çözünürlüklü uygulama ve mağaza simgeleri.

## 3. Web ve Favicon Varlıkları

Webview ve web arayüzü için:

- `favicon.ico`: Çoklu çözünürlük (16, 32, 48) içeren standart web favicon'u (`webview-ui/public/favicon.ico` konumuna da senkronize edilir).
- `favicon-16.png`, `favicon-32.png`, `favicon-48.png`, `favicon-64.png`, `favicon-180.png`: Farklı cihaz ve ekran yoğunlukları için standart PNG favicon'lar.

Webview yalnızca kullandığı varyantları taşır: `webview-ui/public/` altında
`favicon.ico`, `favicon_16x16.png`, `favicon_32x32.png` ve `favicon_180x180.png`
bulunur (bkz. `webview-ui/index.html`).
