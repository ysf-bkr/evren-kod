# Evren Kod Geliştirici Kılavuzu

Bu belge, Evren Kod eklentisine katkı sağlayan, iç mekanizmalarını inceleyen ve yerel ortamda eklentiyi derleyip genişleten geliştiriciler için hazırlanmıştır.

---

## 1. Geliştirme Ortamı Kurulumu

### Gereksinimler

- **Node.js**: v22 veya üzeri
- **npm**: v10 veya üzeri
- **VS Code**: v1.106 veya üzeri (veya VSCodium / Cursor)
- **Git**: 2.30 veya üzeri

### Depoyu Klonlama ve Bağımlılıkları Yükleme

```bash
git clone https://github.com/ysf-bkr/evren-kod.git
cd evren-kod
npm ci
npm --prefix webview-ui ci
```

### Monorepo Yapısı (npm workspaces)

Evren Kod, üç paket ve eklenti konağından oluşan tek depolu bir npm
workspace'idir. Kökte çalıştırılan `npm ci` tüm workspace'leri tek seferde
bağlar.

| Yol              | Paket             | Görev                                                                                                                                            |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/` | `@evren-kod/core` | vscode'dan bağımsız motor: sağlayıcılar, araçlar, izinler, bağlam, bilgi tabanı, çağrı grafiği, çoklu ajan. `vscode` modülünü asla import etmez. |
| `packages/cli/`  | `@evren-kod/cli`  | `evren-kod` terminal ajanı. Yalnızca `@evren-kod/core` üzerine kurulu (VS Code yok).                                                             |
| `src/`           | eklenti konağı    | `vscode` API'sine değen her dosya (aktivasyon, webview, AgentCore çalışma zamanı, gerçek LSP istemcisi).                                         |
| `webview-ui/`    | React uygulaması  | Sohbet webview'ı.                                                                                                                                |

İçe aktarma sözleşmesi `test/unit/architecture.test.ts` ile kilitlenir:
`@evren-kod/core`, `vscode`'u veya eklentinin `src/` katmanını import edemez;
`@evren-kod/cli`, eklentinin `src/` katmanını import edemez. Motor, dil
sunucusuna `LspClientPort` arayüzüyle ulaşır; konağın `LspClient` sınıfı bu
biçimi yapısal olarak karşılar. Terminal ajanını kaynaktan
`npm run cli -- --prompt "..."` ile çalıştırın.

### Derleme ve Doğrulama Komutları

Evren Kod, yüksek kod kalitesi ve test izolasyonu için kapsamlı kontrol scriptlerine sahiptir:

| Komut                          | Açıklama                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                  | Extension'ı derler ve test amaçlı yeni bir VS Code Extension Development Host açar.                                                                                        |
| `npm test`                     | Çekirdek ve arayüz birim testlerini (`test/unit/**` ve `webview-ui/test/**`) çalıştırır.                                                                                   |
| `npm run test:ui`              | Yalnızca webview (React) testlerini JSDOM ortamında çalıştırır.                                                                                                            |
| `npm run typecheck`            | Extension TypeScript tip kontrolü (`tsc --noEmit`).                                                                                                                        |
| `npm run typecheck:test`       | Test dosyalarının tip kontrolü (`tsconfig.test.json`).                                                                                                                     |
| `npm run lint`                 | ESLint ile statik kod analizini çalıştırır.                                                                                                                                |
| `npm run format`               | Prettier ile tüm dosyaları biçimlendirir.                                                                                                                                  |
| `npm run format:check`         | Prettier kurallarına uyumu doğrular.                                                                                                                                       |
| `npm run check:version`        | `package.json`, lockfile'lar ve `version.ts` sürümlerinin tutarlılığını denetler.                                                                                          |
| `npm run version:bump 0.1.2`   | Sürümü manifest, iki lockfile, workspace paketleri, `version.ts` ve dokümanlarda tek komutta yükseltir; eski VSIX'leri siler. `--release` CHANGELOG başlığını da sabitler. |
| `npm run check:test-isolation` | Testlerin geçici dosyaları `os.tmpdir()` altında yalıttığını doğrular.                                                                                                     |
| `npm run check:language`       | Ajan belgelerinin (`AGENTS.md`, `.agents/**`) İngilizce, kaynak kod yorumlarının Türkçe olduğunu doğrular.                                                                 |
| `npm run check:mutation`       | Hedefli sabotaj koşucusu: kritik koruyucuları kaynakta bilerek bozar, ilgili testlerin BAŞARISIZ olmasını bekler, kaynağı geri yükler. Yalnız kalan sabotaj kör noktadır.  |
| `npm run audit:verify`         | Denetim zincirini (hash zinciri + harici çapalar) doğrular; bozuklukta 1 koduyla çıkar. Haftalık CI'da da koşar.                                                           |
| `npm run test:coverage`        | Node.js yerleşik test kapsam raporunu yazdırır.                                                                                                                            |
| `npm run check:coverage`       | Satır kapsamı eşiğini (%75) doğrular; ölçüm Node birim test kümesi (`test/unit/**`) üzerinden yapılır, webview UI testleri ayrı koşar ve eşiğe dâhil değildir.             |
| `npm run check`                | Tam kalite kapısı: format + tip + lint + dil + test + kapsam.                                                                                                              |
| `npm run package`              | `out/evren-kod-0.1.2.vsix` paketini üretir.                                                                                                                                |
| `npm run install:ext`          | VSIX paketini üretip yerel VS Code ortamına kurar/günceller.                                                                                                               |

---

## 2. İç Mimari ve Katmanlar

Evren Kod modüler ve tek yönlü veri akışına dayalı bir katman mimarisine sahiptir:

`vscode` API'sine değmeyen her şey motor paketindedir; `src/` yalnızca konak
katmanıdır. Aşağıdaki ağaç gerçek yerleşimi gösterir:

```text
packages/core/src/                # @evren-kod/core — vscode import etmez
├── shared/                       # Tipler, sabitler, sürüm, komut politikası, maskeleme
│   ├── types.ts                  # İki yönlü postMessage protokolü ve veri modelleri
│   ├── constants.ts              # Dizin yolları, zaman aşımları, varsayılan URL'ler
│   ├── version.ts                # Sürüm tek kaynağı (Single source of truth)
│   ├── commandPolicy.ts          # Terminal komut risk analizi (blocked/risky/safe)
│   ├── languageMap.ts            # Söz dizimi renklendirme ve dil haritası
│   └── redaction.ts              # Hassas anahtar/parola maskeleme
├── providers/                    # LLM adaptörleri (Ollama, EVREN, OpenRouter, OpenAI)
├── tools/                        # Ajan araçları: file, shell, git, lsp, web, gate, graph
├── feedback/                     # Opt-in GitHub hata bildiricisi
└── core/                         # Motor servisleri
    ├── agent/                    # Autonomy, mod araçları, oturum kalıcılığı, turn derleme
    ├── permission/               # İzin yöneticisi, onay politikası, desen eşleme
    ├── audit/                    # SHA-256 hash zinciri + harici çapalar
    ├── gate/                     # Yayın kapısı ve denetim defteri
    ├── snapshot/                 # Dosya anlık görüntüleri ve diff geri alma
    ├── checkpoint/               # Tur bazlı durum geri sarma
    ├── callgraph/                # Çağrı haritası ve kod ilişkileri
    ├── graph/                    # Birleşik bilgi grafı: çağrı + import + kararlar
    ├── knowledge/                # Proje bilgi tabanı ve embedding indeksi
    ├── memory/                   # Proje belleği, oturum arşivi, vektör bellek
    ├── multiagent/               # Alt ajan yöneticisi ve paralel zamanlayıcı
    ├── plan/                     # Görev ve modül planlayıcıları
    ├── project/                  # Uygulama türü ve teknoloji yığını algılama
    ├── spec/                     # Şartname deposu
    ├── verification/             # Test/lint/tip doğrulaması ve onarım politikası
    ├── workflow/                 # Aşama kapıları ve iş akışı durumu
    └── mcp/                      # Model Context Protocol istemcisi

src/                              # VS Code konak katmanı
├── extension.ts                  # Aktivasyon noktası ve komut kayıtları
├── shared/diffContentProvider.ts # Fark içerik sağlayıcısı
├── webview/                      # SidebarProvider, settingsStore, apiKeys, paneller
└── core/
    ├── agent/                    # AgentCore, döngü, araç hattı, oturum kaydı
    ├── lsp/                      # Gerçek dil sunucusu istemcisi
    ├── mcp/                      # MCP hub (mesajlaşma köprüsü)
    ├── memory/                   # Workspace kalıcılığı
    └── workspace/                # Aktif editör/çalışma alanı çözümlemesi

packages/cli/src/index.ts         # `evren-kod` terminal ajanı (yalnızca @evren-kod/core)
```

---

## 3. Tasarım Sistemi ve Stil Kuralları

Tüm arayüz değişkenleri, renkler, ölçüler ve bileşen biçimleri `webview-ui/src/index.css` dosyasında merkezi olarak tanımlanmıştır. Bileşenler (`webview-ui/src/components/ui/*`) bu sınıfları birleştirir; JSX içinde ham renk, piksel değeri veya tekrar eden uzun yardımcı sınıf dizisi bulunmaz.

### Tema Uyumu

- Arayüz renkleri kullanıcının VS Code temasından gelir: `--vscode-*` değişkenleri `--evren-kod-*` jetonlarına eşlenir.
- Gezinti, bağlantı, odak ve birincil düğme renkleri `textLink`, `button`, `focusBorder` gibi tema değişkenlerini kullanır; böylece kırmızı, yeşil ya da yüksek karşıtlıklı bir temada arayüz maviye zorlanmaz.
- Marka paleti (`--primary`, `--secondary`, `--accent`, `--brand-gradient`) yalnızca logo ve tanıtım yüzeylerinde kullanılır.
- Durum renkleri (`--status-*`) tema değişkenlerinden türetilir; açık, koyu ve yüksek karşıtlık temalarında ayrı ayrı doğrulanır.

### Tipografi ve Boyut Ölçeği

- `rem` tabanlı ölçek kullanılarak VS Code genel font boyutuyla uyum sağlanır.
- Metin jetonları: `--evren-kod-text-2xs` (0.82rem), `--evren-kod-text-xs` (0.88rem), `--evren-kod-text-sm` (0.96rem), `--evren-kod-text-md` (1rem), `--evren-kod-text-lg` (1.18rem), `--evren-kod-text-xl` (1.35rem).
- Sohbet gövdesi ve markdown içeriği `--evren-kod-text-md` üzerinden `evren-kod-prose` sınıfıyla biçimlenir; markdown başlıkları `evren-kod-md-h1`…`evren-kod-md-h6` sınıflarını kullanır.
- Bileşenler tipografiyi `evren-kod-heading`, `evren-kod-title`, `evren-kod-label`, `evren-kod-caption`, `evren-kod-overline` sınıflarından alır.

### Simge Ölçeği

- Tüm lucide simgeleri tek ölçekten boyutlanır: `evren-kod-icon-xs` (12px), `evren-kod-icon-sm` (14px), `evren-kod-icon-md` (16px), `evren-kod-icon-lg` (20px), `evren-kod-icon-xl` (24px), `evren-kod-icon-2xl` (32px).
- Simgeler `var(--evren-kod-icon-*)` değişkenleriyle tanımlandığı için JSX içinde `h-3 w-3` gibi ham boyut sınıfı kullanılmaz.

### Renk Yardımcıları

- Metin: `evren-kod-text-fg`, `evren-kod-text-muted`, `evren-kod-text-brand`, `evren-kod-text-info`, `evren-kod-text-success`, `evren-kod-text-warning`, `evren-kod-text-error`, `evren-kod-text-on-accent`.
- Yüzey ve çerçeve: `evren-kod-bg-base`, `evren-kod-bg-raised`, `evren-kod-bg-surface`, `evren-kod-bg-input`, `evren-kod-bg-brand-soft`, `evren-kod-border-base`, `evren-kod-border-surface`, `evren-kod-border-brand` ve `evren-kod-border-{info,success,warning,error}`.
- Durum yüzeyleri: `evren-kod-bg-{info,success,warning,error}`.
- Ham renk kodu (`#123456`) yerine her zaman `var(--vscode-*)` veya `var(--evren-kod-*)` kullanılır.

### Yazı Tipleri

- Arayüz metni `var(--vscode-font-family)` devralır.
- Kod, terminal ve tek aralıklı öğeler `var(--vscode-editor-font-family)` ve kullanıcının editör yazı boyutu ayarını kullanır.

### Arayüzde modül haritası

Besteci altındaki `ModuleStrip`, planın üstünde modül haritasını çizer:
modüller katmana göre gruplanır ve alttan üste sıralanır; her satır sahip rolü,
sahip olduğu yolları ve o modüle bağlı plan adımının durumunu gösterir. Plan
onaylanana kadar şeritte `kod öncesi` işareti görünür.

---

## 4. MCP (Model Context Protocol) Desteği

Evren Kod, harici geliştirici araçlarını ve veri kaynaklarını dinamik olarak
bağlamak için Model Context Protocol standardını destekler. İstemci
`packages/core/src/core/mcp/` altında (vscode'dan bağımsız motor tarafı) yer
alır ve JSON-RPC'yi stdio ya da HTTP/SSE taşıyıcıları üzerinden konuşur.

### Yapılandırma

Sunucular sırasıyla şu dosyalardan okunur:

1. `.evren-kod/mcp_config.json` (önerilen)
2. Çalışma alanı kökündeki `mcp_config.json`
3. Çalışma alanı kökündeki `.mcp.json`

Dosya şeması `{ "mcpServers": { "<ad>": { ... } } }` biçimindedir. Bir sunucu
kaydı ya yerel bir süreç ya da uzak bir uç nokta tanımlar:

```json
{
  "mcpServers": {
    "local-tool": {
      "command": "node",
      "args": ["./tools/server.js"],
      "env": { "TOKEN": "<değer>" }
    },
    "remote-tool": {
      "type": "sse",
      "url": "https://example.com/mcp"
    }
  }
}
```

### Güvenlik kuralları

- Sunucuya miras kalan ortam değişkenleri ayıklanır; sır görünümlü değerler
  geçirilmez. Anahtar gerektiren bir sunucuya değer, `env` alanıyla açıkça
  verilmelidir.
- Sunucu komutları makinenizde çalışır; bu yüzden proje MCP sunucuları açık ve
  parmak izi kapsamlı onay gerektirir ve güvenilmeyen çalışma alanında asla
  yüklenmez.
- MCP sunucusuna gönderilen araç argümanları ve çağrının gerektirdiği proje
  verileri makinenizden çıkabilir. Yalnızca güvendiğiniz sunucuları ekleyin.
