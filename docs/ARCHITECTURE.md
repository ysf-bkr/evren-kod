# Evren Kod Mimari ve Geliştirici Kılavuzu

Bu belge, Evren Kod eklentisinin iç mimarisini, dizin yapısını, veri akışını, geliştirici araç zincirini ve test stratejisini detaylandırmaktadır.

---

## 1. Dizin Yapısı

```text
evren-kod/                                 npm workspaces monorepo
├── src/                                  VS Code konak katmanı (vscode API'sine değen her şey)
│   ├── extension.ts                      Aktivasyon, komut kaydı, view konteyner kurulumu
│   ├── shared/diffContentProvider.ts     Fark içerik sağlayıcısı (vscode Uri/EventEmitter)
│   ├── webview/                          Webview yönetimi
│   │   ├── SidebarProvider.ts            Webview yaşam döngüsü ve mesaj yönlendirme
│   │   ├── settingsStore.ts              Ayar kalıcılığı ve işletim sistemi SecretStorage
│   │   ├── modelCatalog.ts               Sağlayıcı model kataloğu
│   │   ├── gitChanges.ts                 Değişiklikler görünümü için Git sorguları
│   │   ├── apiKeys.ts                    Anahtar maskeleme
│   │   └── webviewHtml.ts                CSP'li HTML üretimi
│   └── core/                             Ajanın vscode'a bağlı çalışma zamanı parçaları
│       ├── agent/                        AgentCore, agentLoop, agentHost, toolPipeline
│       │                                 denetleyicisi, session/workflow/verification
│       │                                 denetleyicileri, terminalExecution, SessionRegistry,
│       │                                 projectTeamContext (profil + ekip istem bağlamı)
│       ├── lsp/LspClient.ts              Gerçek dil sunucusu istemcisi; @evren-kod/core'un
│       │                                 LspClientPort biçimini yapısal olarak karşılar
│       ├── mcp/McpHub.ts                 MCP istemcilerini webview mesajlamasına bağlayan merkez
│       ├── memory/HistoryManager.ts      Workspace kalıcılığı (vscode Memento)
│       └── workspace/workspaceRoot.ts    Aktif editör / workspace klasörü çözümlemesi
├── packages/
│   ├── core/                             @evren-kod/core — vscode'dan bağımsız motor
│   │   └── src/
│   │       ├── index.ts                  Varil (barrel) girişi
│   │       ├── shared/                   Sözleşmeler (types, constants, version), komut
│   │       │                             politikası, maskeleme, metin yardımcıları, ajan
│   │       │                             kaydı (13 şemsiye rol), catalog/ (12 kategoride
│   │       │                             89 uzman), team.ts (profilden aktif ekip seçimi)
│   │       ├── providers/                LLM adaptörleri (Ollama, EVREN, OpenRouter, OpenAI)
│   │       ├── tools/                    Araçlar (SSRF bekçisi, yol hapsi, ayrıştırıcılar,
│   │       │                             shell, git, knowledge, web)
│   │       ├── feedback/                 Opt-in GitHub hata bildiricisi
│   │       └── core/                     Motor servisleri: toolRunner, prompts, permission,
│   │                                     context, knowledge, memory, callgraph, graph
│   │                                     (birleşik bilgi grafı), multiagent,
│   │                                     plan, verification, routing, audit, snapshot,
│   │                                     checkpoint, worktree, rules, skills, workflow,
│   │                                     hooks, git, spec, mcp istemcisi
│   │       └── core/project/             ProjectProfiler: uygulama türü ve stack algılama,
│   │       │                             `.evren-kod/project-profile.json` kalıcılığı
│   │       └── core/lsp/port.ts          LspClientPort: motor vscode modülünü asla görmez
│   └── cli/                              @evren-kod/cli — terminal ajanı (`evren-kod`)
│       └── src/index.ts                  @evren-kod/core üzerinde ReAct döngüsü + readline arayüzü
├── webview-ui/                           React 18 + Tailwind CSS + Lucide webview
│   ├── src/
│   │   ├── App.tsx                       Ana görünüm yönlendirme ve mesaj dağıtıcı
│   │   ├── index.css                     Tasarım sistemi: token, bileşen, yerleşim
│   │   ├── components/                   Ekranlar, kartlar, besteci, başlıklar
│   │   ├── components/ui/                Button, IconButton, alanlar, Card, Toggle
│   │   ├── components/Markdown.tsx       Güvenli markdown işleyici
│   │   └── utils/                        vscode postMessage köprüsü, plan ilerlemesi
│   └── test/                             React bileşen testleri (JSDOM)
├── test/
│   ├── unit/                             Çekirdek birim testleri
│   ├── support/                          VS Code API sahteleri ve test kancaları
│   └── e2e/                              Gerçek VS Code tümleşik testleri
├── resources/                            Marka varlıkları (logo, ikon, favicon varyantları)
└── scripts/                              Yaşam döngüsü, doğrulama, paketleme betikleri
```

---

## 2. ReAct Döngüsü ve Veri Akışı

Evren Kod, kullanıcı isteğini alır almaz denetimli bir ReAct (Reasoning + Acting) döngüsü başlatır. Döngü, onay kapıları ve hash zincirli denetim günlüğüyle sıkı şekilde çevrelenmiştir:

```text
Webview UI (React)
   │  postMessage (SEND_MESSAGE / APPROVE_TOOL / CANCEL / ...)
   ▼
SidebarProvider (VS Code WebviewView)
   ▼
AgentCore
   │
   ├── ModelProvider (OpenRouter / Ollama / OpenAI Uyumlu)
   │     └── Streaming SSE + Tool Calls
   │
   ├── ToolPipelineController (Araç Kapı Zinciri)
   │     ├── PermissionManager (Allow / Deny / Approval)
   │     ├── CommandPolicy (Safe / Risky / Blocked denetimi)
   │     └── SnapshotManager (Dosya yazma öncesi otomatik yedek)
   │
   ├── VerificationController (Otomatik Onarım & Doğrulama)
   │     ├── Quick Verification (Tip kontrolü / Lint)
   │     └── End-of-Task Verification (Test süiti koşturma)
   │
   ├── AuditLog (Kriptografik SHA-256 Hash Zinciri)
   │     └── .evren-kod/audit.log içine değişmez kayıt
   │
   └── TaskState Güncellemeleri → Webview UI
```

---

## 3. Oturumlar ve Arka Plan Çalışması

Bir sohbet görünüm durumu değil, yaşayan bir `AgentCore` örneğidir.

- `SessionRegistry` her sohbet için bir çekirdek tutar. Sohbet değiştirmek
  (ya da yeni sohbet açmak) yalnızca hangi çekirdeğin **etkin** olduğunu
  değiştirir; önceki çekirdek turunu ve alt ajanlarını arka planda sürdürür.
- Tek örnek olması gereken ağır servisler `SharedServices` üzerinden
  paylaşılır (`McpHub`, `LspClient`, `CallGraphManager`, `KnowledgeStore`,
  spec deposu, worktree ve git yöneticileri). Böylece ikinci sohbet yeni bir
  MCP yığını açmaz, indeksi yeniden kurmaz.
- Oturuma özel durum çekirdekte kalır: plan, modül haritası, snapshot'lar,
  checkpoint'ler, doğrulama baseline'ı ve abort denetleyicisi.
- Durum güncellemeleri `sessionKey` ile etiketlenir; arayüz yalnızca etkin
  oturumu çizer, diğer çalışan sohbetleri sohbet alanının üstündeki şeritte
  gösterir.
- Arka plan sohbetleri yalnızca uyarı ve hataları öne çıkarır; alt ajan
  ilerlemesi etkin sohbeti meşgul etmez.
- Bir sohbet silinirken önce çekirdeği kapatılır; silinen oturum kendi kaydını
  geçmişe geri yazamaz.

---

## 4. Proje Profili ve Uzman Ekip Kataloğu

Ajanın ilk sorusu "burada ne tür bir uygulama geliştiriliyor?" sorusudur. Cevap üç katmanda üretilir:

**ProjectProfiler** (`packages/core/src/core/project/`): Depo taranır (`node_modules`, `dist`,
`.git` gibi paket/çıktı klasörlerine girilmez) ve manifest kanıtlarından uygulama türü
(`web-frontend`, `web-backend`, `fullstack`, `mobile`, `desktop`, `library`, `cli`) ile
teknoloji yığını çıkarılır. Sonuç `.evren-kod/project-profile.json` dosyasına yazılır;
`"source": "manual"` içeren profil kullanıcı elle düzenlediği anlamına gelir ve otomatik
tarama onu asla ezmez. `detectProfile` saf fonksiyondur: aynı dosya listesi her zaman
aynı profili üretir.

**Uzman kataloğu** (`shared/agents/`): Kayıt defteri 13 şemsiye rol + 12 kategoride
89 katalog uzmanından oluşur (Yönetim, Mimari, Frontend, Backend, Veritabanı, Mobil,
Masaüstü, Kalite, Güvenlik, DevOps, Yapay Zekâ, Operasyon). Uzmanlar `defineSpecialist`
fabrikasıyla şemsiye rolün araç yetkilerini devralır; `invoke_subagent` ve
`run_parallel_tasks` yetkisi fabrika seviyesinde her uzmandan geri alınır — orkestrasyon
tekeli @manager'dır. Plan adımı yönlendirmesi (`routing.ts`) şemsiye rollerde kalır;
uzmanlar `invoke_subagent` ile doğrudan çağrılabilir ve lead takma adları
(`backend-lead → backend` gibi) tek merkezdeki `ROLE_ALIASES`'te çözülür.

**Aktif ekip seçimi** (`shared/agents/team.ts`): 100+ tanımın tamamı hiçbir turda modele
gösterilmez. Proje profili her görev için deterministik bir ekip seçer:

```text
Kural sırası: çekirdek gözetmenler (manager, analyst, architect, explorer,
              quality, security, git)
            → türün şemsiye rolleri (ör. fullstack → frontend + backend + database)
            → stack eşleşen uzmanlar (eşleşme sayısı sıralı, eşitlikte ad sırası)
            → kategori uzmanları (bütçe artanı)
Bütçe: 14. Çekirdek ve şemsiye roller bütçe dolunca da düşmez; yalnızca
uzmanlar budanır. Aynı profil → aynı ekip (önbellek ve prompt kararlılığı).
```

Seçilen ekip, sistem isteminin bayt-kararlı önbellek önekine `ACTIVE SPECIALIST TEAM`
bloğu olarak girer (`generateSystemPrompt` → `teamContext`). VS Code konağında
`src/core/agent/projectTeamContext.ts` kök başına bir kez çözüp önbellekler; CLI aynı
bloğu `resolveProfile + selectActiveTeam + formatTeamContext` ile kendisi kurar.

**Yayın kapısı (`core/gate/ReleaseGate.ts`):** `done` kapısı kriter ve doğrulamanın
yanında taze bir PASS kararı ister. Karar `record_release_gate` aracıyla kaydedilir;
kayıt anının dünyası (değişen dosyalar, işaretli kriterler, doğrulama durumu)
sha256 digest'ine damgalanır ve karardan sonra tek dosya değişse kapı yeniden koşar.
"pass" beyanı makine denetiminden geçer (`machineCheckPass`): kriterler eksik ya da
doğrulama taze geçmemişse kayıt BLOCK'a döner. Doğrulama geçtiği hâlde kapı kararı
yoksa iş akışı `build`'e geri dönmez; `verify`'de kalır ve modele `@release-gate`
denetimini isteyen sistem talimatı yazılır. Planlama modu kapıdan muaftır.

**Commit güven sınırı (`tools/git.ts`):** Aktif görevi olan bir iş akışında
`git_commit` atomik bir doğrulama sınırından geçer: kapı muhafızı → stage →
snapshot'ın yeniden doğrulanması (port eksikse commit yapılmaz, fail closed) →
indeks ağacının kimliğinin buzlanması (`write-tree`) → commit → HEAD ağacının
buzlanmış anlık görüntüyle karşılaştırılması. Karar ile commit arasında dünya
değişirse commit reddedilir; commit'lenen ağaç buzlanmış görüntüyle birebir
eşleşmek zorundadır — eşleşme "teslim edilen, doğrulanan içeriğin ta kendisi"
makine kanıtıdır. Kullanıcının eşzamanlı değişiklikleri asla ezilmez; görev
dışı commit'ler serbest ama "kapı dışı" etiketiyle işaretlidir. `prepare_pr`
PR gövdesinin başına kapı durumunu dürüstçe yazar.

**Denetim defteri (`core/gate/ReviewLedger.ts`):** Her dosya yazımı (ana ajanın
`write_file`/`edit_file`'ı ve alt ajanların ana ağaca dokunan yazmaları — konağa
`SubagentPorts.onSubagentWrite` ile bildirilir) `WorkflowState.reviewLedger`
defterine yazar-rol kimliğiyle işlenir. Yalnızca kalite/güvenlik/mimari
kategorisindeki roller incelemeye yetkilidir (`REVIEWER_CATEGORIES`); bir reviewer
turundaki başarılı tamamlama kendinden önceki ve kendinden farklı rollerin
yazmalarını "incelendi" işaretler — yazar kendi yazdığını inceleyemez. Defter
durumu kapı digest'ine girer ve `machineCheckPass` inceleme borcu olan dünyada
"pass"ı reddeder. Aynı dosyanın yeniden yazılması eski inceleme kararını düşürür.
Kapanış beyan değil PARMAK İZİDİR: her okuma olayında dosyanın sha256 içerik
hash'i, boyu ve dünya snapshot kimliği (`ReviewedFileEvidence`) kanıt olarak
bağlanır; mtime hiçbir yerde kanıt sayılmaz ve önbelleklenmez. Her kapı
değerlendirmesi öncesi `reconcileLedger` defteri diskle yüzleştirir
(`verifyLedgerFreshness`, fail closed): içeriği değişmiş inceleme bayatlayıp
borca döner, kanıtsız "incelendi" kaydı güvenilmez sayılır, silinen dosyanın
hayalet borcu düşer, deftersiz değişmiş yol `unattributed` borcu açar. Ölçülemeyen
komut yan etkileri `command:*` gölge borcu olur ve yalnız bir şey okumuş bağımsız
denetim turunun ölçülemezlik kanıtıyla kapanır.

## 5. Güvenilirlik ve Güvenlik Sözleşmeleri

| Konu                     | Tasarım Tercihi ve Davranış                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **İptal ve Zaman Aşımı** | Streaming yanıtın tamamı anında iptal edilebilir; 2 dakika veri akışı durursa bağlantı zaman aşımına uğrar.                                 |
| **Token Sayacı**         | Streaming isteklerinde `include_usage` bayrağı ile sağlayıcıdan kesin token sayısı alınır.                                                  |
| **Audit Log**            | Komutlar kaydedilirken `Bearer`, `sk-`, `api_key=` gibi hassas anahtar kalıpları maskelenir.                                                |
| **Docker Sandbox**       | Sandbox modu seçiliyse boş imajla ana makineye sessizce düşülmez; hata fırlatılır.                                                          |
| **Editör Bağlamı**       | Yalnızca çalışma alanı **içindeki** aktif dosya ve seçimler prompt bağlamına eklenir.                                                       |
| **Araç Kilidi**          | Plan modunda yazma/komut araçları şemadan çıkarılır; model çağırırsa işlem reddedilir.                                                      |
| **Oturum İzolasyonu**    | Yeni oturum başladığında snapshot/checkpoint dizinleri sıfırlanır, oturumlar karışmaz.                                                      |
| **Plan İlerlemesi**      | Başlatılan adım `in_progress` işaretlenir; dosya değişikliği, araç etkinliği ya da görev tamamlanması üreten turun sonunda adım tamamlanır. |

---

## 6. Geliştirici Scriptleri ve Araç Zinciri

| Komut                          | Açıklama                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `npm run dev`                  | Derler ve yeni bir Extension Host penceresi açar.                                                            |
| `npm run check`                | Tam kalite kapısı: format + tip + lint + dil + test + kapsam.                                                |
| `npm run typecheck`            | Extension TypeScript tip kontrolü (`tsc --noEmit`).                                                          |
| `npm run typecheck:test`       | Test dosyalarının tip kontrolü (`tsconfig.test.json`).                                                       |
| `npm run lint`                 | ESLint kod kalitesi kontrolü (src, test, scripts).                                                           |
| `npm run format`               | Prettier ile kod tabanını biçimlendirir.                                                                     |
| `npm run format:check`         | Biçimlendirmenin bozulmadığını doğrular (CI kapısı).                                                         |
| `npm test`                     | Çekirdek ve arayüz birim testlerini birlikte çalıştırır.                                                     |
| `npm run test:ui`              | Yalnızca webview (React) testlerini çalıştırır.                                                              |
| `npm run test:coverage`        | Node.js yerleşik test kapsam raporunu yazdırır.                                                              |
| `npm run check:coverage`       | Satır kapsamı eşiğini (%75) doğrular.                                                                        |
| `npm run check:version`        | `package.json`, lockfile ve `version.ts` tutarlılığını doğrular.                                             |
| `npm run check:test-isolation` | Testlerin geçici dosyaları `os.tmpdir()` altında tuttuğunu doğrular.                                         |
| `npm run check:language`       | Ajan dosyalarının (`AGENTS.md`, `.agents/**`) İngilizce ve kaynak kod yorumlarının Türkçe olduğunu doğrular. |
| `npm run build`                | Tüm kapılar + webview derleme + minified extension ve CLI bundle'ı üretir.                                   |
| `npm run compile`              | Yalnızca extension bundle'ını esbuild ile derler.                                                            |
| `npm run build:ui`             | Yalnızca webview uygulamasını Vite ile derler.                                                               |
| `npm run build:cli`            | Yalnızca CLI bundle'ını derler.                                                                              |
| `npm run package`              | `out/evren-kod-0.1.1.vsix` paketini üretir.                                                                  |
| `npm run audit:verify`         | `.evren-kod/audit.log` hash zincirini doğrular (`-- --workspace <path>`).                                    |
| `npm run cli`                  | Başsız (headless) terminal CLI'ını kaynaktan çalıştırır.                                                     |
| `npm run test:e2e`             | Derler ve gerçek bir VS Code penceresinde uçtan uca testleri çalıştırır.                                     |

---

## 7. Endüstriyel Modül Akışı

Kod, plandan doğrudan yazılmaz. Ajan önce katmanlı bir modül haritası kurar;
böylece "ne nereye gidecek" ve "hangi sırayla yazılacak" sorusu tek bir dosyaya
dokunulmadan önce netleşir:

1. **Spec** (`write_spec`) — hedef, kapsam, kapsam dışı, varsayımlar ve kabul
   kriterleri. Onay için kriterler üç boyutu kapsamalıdır: mutlu yol, hata yolu
   ve uç durum.
2. **Modül haritası** (`update_module_plan`) — her modül bir katman
   (`shared`, `domain`, `infrastructure`, `application`, `interface`, `test`,
   `docs`), sahip olduğu yollar, tek cümlelik sorumluluk, bağımlılıklar ve onu
   yazacak uzmanı bildirir. Bağımlılık yönü alana doğrudur; katman ihlalleri ve
   döngüler kod yazılmadan reddedilir.
3. **Plan** (`update_plan`) — adımlar bir `moduleId` ve karşıladıkları kabul
   kriterlerini referanslar. Modül haritası olmayan plan reddedilir.
4. **Uygulama** — modüller katman sırasına göre yazılır (shared → domain →
   infrastructure → application → interface); bir modül yalnızca bağımlı
   olduğu modülleri kullanabilir. Her yazma öncesi snapshot alınır ve diff
   önizlemesi açılır.
5. **Doğrulama** — test, lint ve tip denetimi çalışır. Atlanan doğrulama, bitti
   kapısını yalnızca çalışma alanı hiç yokken tatmin eder; böylece test komutu
   bulunamadığında görev sessizce kapanmaz.

İnceleme aşaması bulguları ve ajanın öz değerlendirmesi **tavsiye niteliğindedir**:
neyin denendiğini, neyin denenemediğini özetler. Son söz her zaman kullanıcıya
aittir; hiçbir şey, altta yatan test ya da komut gerçekten çalışıp geçmeden
"doğrulandı" olarak sunulmaz.

Modül haritası besteci altındaki şeritte görünür; görev çalışırken yazma sırası
ve hangi modülün işlendiği tek bakışta izlenir.

---

## 8. Arayüz Geliştirme ve Tasarım Sistemi İlkeleri

- **Merkezi Stil Tanımı (`webview-ui/src/index.css`):**
  Tipografi ölçeği (`--evren-kod-text-*`), kenar yuvarlaklıkları, kontrol yükseklikleri, yüzey renkleri ve kart stilleri tek dosyada toplanmıştır.
- **Yeniden Kullanılabilir UI Bileşenleri (`webview-ui/src/components/ui/`):**
  `Button`, `IconButton`, `Input`, `Textarea`, `Select`, `Checkbox`, `TextField`, `SelectField`, `TextareaField`, `SearchField`, `Toggle`, `Card`, `Section`, `SectionTitle`, `EmptyState`, `Badge`, `Chip`, `Segmented`, `ListButton`, `NavButton`, `Disclosure`, `Drawer` ve `Popover`.
- **Sert Stil Yasağı:**
  Bileşenler içinde sabit piksel renkleri (`#123456`) veya `text-[9px]` gibi keyfi boyutlar kullanılmaz. Yeni bir ihtiyaçta önce `index.css` semantik değişkeni güncellenir.
- **Tema Uyumu:**
  Gezinti, bağlantı, odak halkaları ve birincil düğmeler VS Code tema değişkenlerini okur; özel temalar marka mavisine zorlanmaz. Ayrıntılar için [DEVELOPMENT.md](./DEVELOPMENT.md).
- **Doğal Ölçeklenebilirlik:**
  Font boyutları `rem` birimiyle bağlanmıştır; kullanıcının VS Code genel font büyüklüğü değiştikçe arayüz editörle mükemmel oranda ölçeklenir.

---

## 9. Test Mimarisi ve Kapsam

Test süiti hâlihazırda 646 testten (542 çekirdek + 104 webview) oluşur ve üç katmanda icra edilir:

1. **Birim Testleri (`test/unit/`):** Node.js yerleşik test runner'ı (`node:test`) ve sahte VS Code köprüsü (`test/support/vscode-stub.ts`) ile harici bağımlılık olmadan milisaniyeler içinde çalışır.
2. **Webview UI Testleri (`webview-ui/test/`):** JSDOM ortamında React Testing Library benzeri yapıyla tüm ekran ve bileşen etkileşimlerini simüle eder.
3. **Uçtan Uca Entegrasyon Testleri (`test/e2e/`):** `@vscode/test-electron` ile gerçek bir VS Code örneği başlatarak uzantının manifest uyumunu, komut kaydını ve ayar senkronizasyonunu denetler.
