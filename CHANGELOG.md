# Sürüm Notları

Bu dosya kullanıcıları etkileyen önemli değişiklikleri kaydeder.
Proje sürümlemesi 0.1.0 ile burada başlar.

## [0.1.1] - 2026-11-04

### Değiştirildi

- **Bilgi Grafiği (Knowledge Graph):** Çağrı haritası ile bilgi tabanı tek bir graf katmanında birleşti. Ajan bir görev için projeyi baştan okumak yerine `knowledge_graph` ile hazır bağıntıları okur: sembol kartı tanımları kesin `dosya:satır-aralığı` ve imzalarla, çağıranları, import bağımlılarını, ilgili testleri ve kayıtlı mimari kararları birlikte döner; `mode: "architecture"` proje katmanlarını, merkez (hub) dosyaları, bağımlılık yönlerini, döngüleri ve kararları özetler. Yeni araçlar: `knowledge_graph`, `graph_callers`, `graph_callees`, `graph_impact`, `graph_search`, `graph_status`; her çıktı sabit bir token bütçesiyle döner. Eski adlar (`get_callers`, `get_callees`, `call_graph_impact`, `find_related_code`, `call_graph_status`) yürütme uyumluluğu için alias olarak çalışmaya devam eder, modele şema olarak sunulmaz.
- **Sembol imzaları ve sınıf metotları:** Bilgi tabanı indeksi her sembolün bildirim satırını (imzasını) ve bitiş satırını bir kez indekleme sırasında hesaplar; sınıf metotları da indekslenir. Ajan gövdeyi okumadan arayüzü görür, `read_file`'ı yalnızca değişdireceği aralık için çağırır.
- **"Bilgi Grafiği" ekranı:** Eski "Çağrı Grafiği" paneli iki kaynağı birlikte anlatır: çağrı haritası sayılarına ek olarak bilgi tabanının dosya/sembol/karar sayaçları da gösterilir.
- **README logosu:** Başlık logosu artık tek bir mutlak `raw.githubusercontent.com` adresi. VS Code Marketplacesi `<picture>` etiketini silip göreli yolları çözümleyemediği için Marketplace'te görünmeyen logo bu değişiklikle kalıcı olarak düzeltildi.
- **Mimari özet hubs sıralaması:** Ham çağrı sayısı yerine import bağımlısı birincil ölçü; test dosyaları tüketici olduğu için merkez listesinden çıkarıldı.
- **Alt ajan token muhasebesi:** Alt ajan ve paralel görev model çağrılarının giden/gelen/önbellek token kullanımı artık ana oturumun Σ rozetine ve görev istatistiklerine eklenir. Devretme yoluyla harcanan tokenlar "görev X token yaktı" sayısının dışında kalamaz.
- **İstem önbelleği iki katmana ayrıldı:** Sistem istemi tur boyunca bayt-kararlı kalır (kimlik, mod, kurallar, hafıza, dondurulmuş bilgi tabanı); değişen görev durumu (aşama, spec, plan kutuları, modül haritası, onboarding) her model çağrısında mesaj listenin sonundaki `<system_context>` kuyruğunda tazelenir. Plan kutusu işaretlenince tüm önbellek çöp olmaz; yalnızca kuyruk tokenları yeniden faturalanır.
- **Görev durumu blokları bütçelendi:** Spec, plan ve modül haritası artık isteme sınırsız gövde yazamaz (gövde başına 4-6 KB karakter kapısı); tamamlanan plan adımları tam metin yerine kimlik listesine sıkıştırılır, tek planda en çok 60 adım / 32 modül kabul edilir. Model bir spec'i onlarca KB'a şişirse de her isteğin bağlamı zehirlenmez.
- **Bilgi tabanı tek bütçe tüketir:** Repo haritası, insan dosyaları ve modül özetleri tek `charBudget` payını sırayla kullanır; özetler eskiden bütçenin üzerine ekleniyordu. Sığmayan özetler sayıyla bildirilir.
- **Doğrulama notları tekilleştirildi:** "Zaten var olan hatalar" notu her doğrulama turunda yeniden eklenmez; sonuncusu yerinde tazelenir. Skill/AGENT.md açıklamaları bağlam satırında 200 karakterle sınırlanır.

### Düzeltildi

- **Oturum geri yüklemede token dökümü:** Geri yüklenen ve arşivden içe aktarılan oturumlar giden/gelen/önbellek token kırılımını korur; önbellek isabet oranı gibi göstergeler yeniden yüklemeden sonra bozulmaz. Markdown dışa aktarımı da dökümü satır olarak taşır.
- **Kırpma notları geri kazanım ipucu verir:** `web_fetch`, `read_notebook` ve komut çıktılarındaki kırpma işaretleri artık modelin kalan içeriğe nasıl ulaşacağını söyler (`maxChars` yükseltme, not defterini `read_file` ile okuma, çıktıyı dosyaya yönlendirip aralık okuma).
- **Kesilen isteğin tokenı artık kaybolmuyor:** Kullanıcı iptali, akış takılması veya tekrar çökmesi nedeniyle yarım kalan isteklerde sunucu üretimi FATURALAMIŞTIR; yakılan token artık tahmini olarak muhasebeye eklenir ve Σ rozeti ipucunda "≈N tahmini (kesilen istekler)" diye ayrı işaretlenir. Rozet gerçek harcamayı sistematik olarak düşük göstermez.
- **Takılma mesajı doğru eşiği söylüyor:** "Model stream stalled for X sec" uyarısı sabit 120 saniyeyi değil, fiilen silahlanan yapılandırılmış zaman aşımını bildirir.
- **Budama gerçek kullanıcı sözünü korur:** Bağlam budaması en son kullanıcı mesajını ararken `<system_context>` enjeksiyon bloklarını atlar; kuyruğun kendisi korunup gerçek istek budanamaz.
- **CLI tüketim özeti:** Terminal ajanı çıkışta oturumun token dökümünü (giden/gelen/önbellek/istek sayısı) basar; iptal ve kesintilerde de yazılır. CLI araç çıktıları geçmişe artık kapıdan geçmiş hâliyle yazılır.
- **Kalıcı oturum boyut kapısı:** Depolama kopyasında en yeni 30 araç sonucunun gövdesi tam kalır, daha eski ve büyük gövdeler başı korunarak kısaltılır; canlı oturum bundan etkilenmez, workspaceState şişmez.
- **Pazar yeri kurulum belgeleri:** Uzantı VS Code Marketplace'te yayına girdi (`ysf-bkr.evren-kod`); README ve geliştirici belgeleri Marketplace kurulumunu birincil yol olarak gösterir, "henüz yayımlanmadı" notları kaldırıldı.

### Kaldırıldı

- **Token bütçesi ayarı (`maxTokensPerTask`):** Ayar arayüzden çoktan kaldırılmıştı; artık dayanak kodu da temizlendi. Harcama kontrolü bilinçli olarak yalnızca kırpma, sıkıştırma ve önbellekle yapılır — görev asla sayısal bir token limitinde durdurulmaz.

## [0.1.0] - 2026-11-01

İlk yayın: **Evren Kod** — zanaat disipliniyle kodlayan, kanıtla doğrulayan otonom VS Code ajanı.

### Eklendi

- **Üç çalışma modu:** Kodlama (dosya ve komut yetkili), Planlama (salt okunur mimari analiz ve yol haritası) ve Eğitim (yeni başlayanlara sohbette rehberlik: sistem isteminin dayattığı ders biçimi sözleşmesi — sade analoji, sözde kod, adım adım örnek çizelgesi, tipik hata açıklaması, alıştırma ve "Ne öğrendik?" özeti). Planlama ve Eğitimde dosya yazma ile komut çalıştırma teknik olarak kilitlidir.
- **Yönlendirilmiş geliştirme akışı:** Anlama → İstek → Spec Onayı → Modül Haritası ve Plan Onayı → Uygulama → İnceleme → Doğrulama aşamaları; her geçişin kapısı vardır, son söz her zaman kullanıcıdadır.
- **Otonom ReAct döngüsü:** Hedefe ulaşana kadar dosyaları inceler, komutları çalıştırır, testleri koşturur ve hataları düzeltir; görev sonunda tüm değişiklikler tek tıkla diff ekranında toplanır.
- **Endüstriyel modül akışı:** İş katmanlı modüllere ayrılır (shared → domain → infrastructure → application → interface), her modüle sahip uzman atanır; katman ihlalleri ve döngüler reddedilir.
- **Kalkan güvenlik katmanı:** Otonomi düzeyine göre çalışan onay kapıları, dizin hapsi (symlink denetimli), allowlist tabanlı komut politikası, salt okunur mod araç kilidi, API anahtarlarında işletim sistemi anahtarlığı (`SecretStorage`) ve hash zincirli doğrulanabilir denetim günlüğü. Güvenlik ayarları yalnızca kullanıcı kapsamından okunur; depo kökenli dosyalarla yükselemez.
- **Akıl sağlığı korumaları:** Tekrar çökmesi bekçisi (aynı birimin sonsuz tekrarı akışı durdurur), çıkmaz sokakta üçüncü denemede duraklatma, kanıtsız başarı bildirimini reddetme, checkpoint'li tek tıkla geri alma.
- **Çağrı grafiği:** Dil sunucusundan çıkarılan sembol haritası arayüzde gezilebilir — kim kimi çağırıyor, etki alanı ne; dosya bağlantı haritası, test/proje ayrımı, klavye ile gezinme ve kaynak dosyaya tek tıkla sıçrama.
- **Alt ajanlar (çoklu ajan):** Roller kayıt defterinden türetilir, görevler uzmanlara devredilir; paralel görevler izole worktree'de çalışır. Alt ajanlar aynı güvenlik çıpalarını (zaman aşımı, bağlam bütçesi, workspace hook'ları, kaydedilmemiş değişiklik koruması) paylaşır.
- **Bağlam ve maliyet disiplini:** Araç şemaları bağlam bütçesine sayılır, `contextWindowTokens` ayarıyla gerçek pencere bildirilebilir, sohbet başlığındaki rozet tur başına giden/gelen/önbellek token dökümünü gösterir, sağlayıcı önbelleği için sistem istemi bayt-dengeli tutulur.
- **Proje hafızası ve bilgi tabanı:** `.evren-kod/memory.md` ve `.evren-kod/knowledge/` içinde mimari kararlar, kurallar ve sembol haritaları yaşar; okunan dosyalar yapısal iskelet olarak hafızaya işlenir, sıkıştırma çöp stub yerine bu iskelete döner.
- **Geniş model desteği:** EVREN LLM, yerel Ollama, LM Studio, OpenRouter ve OpenAI uyumlu uç noktalar; göreve göre otomatik model yönlendirme (hızlı / derin akıl yürütme / inceleme) ve sohbetten ayrılmadan model değişimi.
- **Terminal arayüzü (`evren-kod`):** Aynı çekirdek terminalde — tek istemlik çalıştırma veya etkileşimli sohbet; onaylar, plan ve korumalar VS Code ile aynı.
- **Monorepo mimarisi:** `@evren-kod/core` sağlayıcı, araç, izin, bağlam, bilgi ve çoklu ajan motorunu taşır ve `vscode` modülünü hiç import etmez; `@evren-kod/cli` yalnızca çekirdek üzerine kuruludur; `src/` tek başına VS Code konağıdır. Bu sözleşme birim testleriyle kilitlidir.
- **Erişilebilir ve yerel arayüz:** Tamamen Türkçe arayüz ve hata mesajları, tema duyarlı monokrom kenar çubuğu ikonu, koyu/açık/High Contrast uyumu `--vscode-*` jetonlarında, VS Code standart ölçülerinde (35px başlık, 48px gezinme rayı, akışkan 8–20px kenar boşlukları) tek ölçekli yerleşim, klavye gezinmesi ve `prefers-reduced-motion` desteği.
- **Marka seti:** Örgü düğümü ve çağrı grafiği düğümlerini taşıyan stilize "E" amblemi; tema duyarlı monokrom ikon, renkli amblem, kelime logosu (açık / koyu / tema-nötr), favicon ve ICO seti.

### Bilinen sınırlar

- Varsayılan sağlayıcı Ollama'dır; bulut sağlayıcıları isteğe bağlıdır ve anahtarlar yalnızca cihazınızda saklanır.
- Yol hapsi symlink kaçışını engeller; doğrulama sonrası yol değişikliği (TOCTOU) ve alan içi hardlink senaryoları kabul edilmiş sınır olarak belgelenmiştir.
- Eğitim modunda kilitler ve ders biçimi sözleşmesi güvence altındadır; anlatımın kalitesi seçilen modele bağlıdır. Ayrı bir müfredat motoru veya öğrenci ilerleme takibi yoktur; rehberlik sohbet içinde yaşar.
