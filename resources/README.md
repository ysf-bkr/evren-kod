# Evren Kod Görsel ve Marka Varlıkları

Bu dizin, Evren Kod eklentisi, web arayüzü ve tanıtım mecralarında kullanılan resmi
görsel varlıkları barındırır.

## 1. Temel Eklenti Varlıkları (VS Code)

| Dosya | Boyut / Format | Kullanım Alanı |
| ----- | -------------- | -------------- |

Amblem: stilize **E** harfi; orta kolonda örgü **�örgü düğümü** (elmas) ve üç çubuğun ucunda **çağrı grafiği düğümleri**. Renkler marka gradyanıyla birebir: mavi (#0092FA→#003CCD), altın düğüm (#f59e0b).

| Dosya            | Boyut / Format                        | Kullanım Alanı                                            |
| ---------------- | ------------------------------------- | --------------------------------------------------------- |
| `icon.png`       | 128×128 PNG                           | VS Code Marketplace eklenti simgesi                       |
| `icon.svg`       | Vektör SVG (monokrom, `currentColor`) | VS Code ikincil kenar çubuğu görünüm ikonu (tema duyarlı) |
| `icon-color.svg` | Vektör SVG (renkli)                   | Renkli Evren Kod amblem vektör kaynağı                    |
| `logo.png`       | 900×531 PNG (koyu yazı)               | Açık temalar için kenar boşluksuz saydam arka planlı logo |
| `logo-dark.png`  | 900×531 PNG (açık yazı)               | Koyu temalar için kenar boşluksuz saydam arka planlı logo |
| `logo.svg`       | SVG                                   | Amblem ve yazı vektör sarmalayıcısı                       |

## 2. Yüksek Çözünürlüklü Tanıtım Varlıkları

Sosyal medya, bülten, dokümantasyon ve sunumlar için:

- `logo-light-1800.png` / `logo-light-2700.png`: Açık renk zeminler için koyu yazılı yüksek çözünürlüklü logolar (1800px ve 2700px yükseklik 1063/1594).
- `logo-dark-1800.png` / `logo-dark-2700.png`: Koyu renk zeminler için açık yazılı yüksek çözünürlüklü logolar (1800px ve 2700px yükseklik 1063/1594).
- `logo-safe.png` / `logo-safe-1800.png`: Tema-nötr varyant — yazı marka mavisiyle (#0073f9) çizilir ve hem açık hem koyu zeminde okunur. Medya sorgusunu desteklemeyen görüntüleyiciler (Marketplace README, bazı Markdown önizlemeleri) için README'deki `<picture>` yedek resmi budur.
- `icon-256.png` / `icon-512.png` / `icon-1024.png`: Yüksek çözünürlüklü uygulama ve mağaza simgeleri.

## 3. Web ve Favicon Varlıkları

Webview ve web arayüzü için:

- `favicon.ico`: Çoklu çözünürlük içeren standart web favicon'u (`webview-ui/public/favicon.ico` konumuna da kopyalanmıştır).
- `favicon-16.png`, `favicon-32.png`, `favicon-48.png`, `favicon-64.png`, `favicon-180.png`: Farklı cihaz ve ekran yoğunlukları için standart PNG favicon'lar.

Webview yalnızca kullandığı varyantları taşır: `webview-ui/public/` altında
`favicon.ico`, `favicon_16x16.png`, `favicon_32x32.png` ve `favicon_180x180.png`
bulunur (bkz. `webview-ui/index.html`).
