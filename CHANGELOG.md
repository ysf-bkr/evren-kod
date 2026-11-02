# Sürüm Notları

Bu dosya kullanıcıları etkileyen önemli değişiklikleri kaydeder.
Proje sürümlemesi 0.1.0 ile burada başlar.

## [Yayınlanmamış]

### Değiştirildi

- **Bilgi Grafiği (Knowledge Graph):** Çağrı haritası ile bilgi tabanı tek bir graf katmanında birleşti. Ajan bir görev için projeyi baştan okumak yerine `knowledge_graph` ile hazır bağıntıları okur: sembol kartı tanımları kesin `dosya:satır-aralığı` ve imzalarla, çağıranları, import bağımlılarını, ilgili testleri ve kayıtlı mimari kararları birlikte döner; `mode: "architecture"` proje katmanlarını, merkez (hub) dosyaları, bağımlılık yönlerini, döngüleri ve kararları özetler. Yeni araçlar: `knowledge_graph`, `graph_callers`, `graph_callees`, `graph_impact`, `graph_search`, `graph_status`; her çıktı sabit bir token bütçesiyle döner. Eski adlar (`get_callers`, `get_callees`, `call_graph_impact`, `find_related_code`, `call_graph_status`) yürütme uyumluluğu için alias olarak çalışmaya devam eder, modele şema olarak sunulmaz.
- **Sembol imzaları ve sınıf metotları:** Bilgi tabanı indeksi her sembolün bildirim satırını (imzasını) ve bitiş satırını bir kez indekleme sırasında hesaplar; sınıf metotları da indekslenir. Ajan gövdeyi okumadan arayüzü görür, `read_file`'ı yalnızca değişdireceği aralık için çağırır.
- **"Bilgi Grafiği" ekranı:** Eski "Çağrı Grafiği" paneli iki kaynağı birlikte anlatır: çağrı haritası sayılarına ek olarak bilgi tabanının dosya/sembol/karar sayaçları da gösterilir.
- **README logosu:** Başlık logosu artık tek bir mutlak `raw.githubusercontent.com` adresi. VS Code Marketplacesi `<picture>` etiketini silip göreli yolları çözümleyemediği için Marketplace'te görünmeyen logo bu değişiklikle kalıcı olarak düzeltildi.
- **Mimari özet hubs sıralaması:** Ham çağrı sayısı yerine import bağımlısı birincil ölçü; test dosyaları tüketici olduğu için merkez listesinden çıkarıldı.

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
