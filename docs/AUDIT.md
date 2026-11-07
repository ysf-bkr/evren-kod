# Denetim Kimlikleri Dizini

Kodda geçen `denetim bulgusu F07`, `m.13`, `M3` gibi kısa kimlikler, projenin
geçmiş iç denetim turlarında açılan bulgulara işaret eder. Kimlikler kodu
okuyan kişiye "bu satır neden böyle" sorusunun cevabını hızlıca vermek için
vardır; ancak tek başına anlamsızdır. Bu dosya her kimliğin hangi sözleşmeyi
koruduğunu tek yerde toplar.

> Kural: yeni bir denetim kimliği koda yazılacaksa buraya bir satırlık
> karşılığı da eklenir. Aksi hâlde kimlik, bir yıl sonra okunamayan bir
> arkeolojik kalıntıya dönüşür.

## Fonksiyonel bulgular (F serisi)

| Kimlik | Korunan sözleşme | Örnek kod |
| --- | --- | --- |
| F01 | Komut politikası çalışma alanı dışına okuma/yazmayı riskli sayar | `shared/commandPolicy.ts` |
| F02 | Terminal komutu çift tırnak yerine tek tırnakla kaçırılır; `$()`/backtick enjeksiyonu etkisiz kalır | `src/core/agent/terminalExecution.ts` |
| F03 | İzin yolu normalize edilir; `..` ve benzeri parçalar yeniden eklenerek hapis atlatılamaz | `core/permission/PermissionManager.ts` |
| F04 | Her araç, izin motorunun deny/hassas dosya kararını uygulamak zorundadır | `tools/contracts.ts` |
| F05 | Alt ajan çağrıları da onay/izin politikasına tabidir; devretme güvenlik gevşetmez | `core/multiagent/SubagentManager.ts` |
| F07 | Komut geri alma, komut bittikten sonra yapılan kullanıcı değişikliklerini silmez | `core/git/GitManager.ts`, `toolPipelineController.ts` |
| F08 | Başarısız komut başarılı görünmez; yanlış dizinde çalışma olmaz | `terminalExecution.ts` |
| F11 | Çağrı haritası artımlı güncellemesi iki yönü de doğru ele alır (ekleme/silme) | `core/callgraph/builder.ts` |

## Motor bulguları (M serisi)

| Kimlik | Korunan sözleşme | Örnek kod |
| --- | --- | --- |
| M1 | CI iş akışları depo sırlarıyla çalışır; otonom modda bile yazımı açık onay ister | `core/permission/PermissionManager.ts` |
| M3 | Yarım kalan akışın faturası buharlaşmaz; kesinti tahmini token muhasebesiyle döner | `providers/openai.ts`, `agentLoop.ts` |

## Model/bağlam bulguları (m serisi)

| Kimlik | Korunan sözleşme | Örnek kod |
| --- | --- | --- |
| m.1/2 | Tekrara giren model yanıtı erken kesilir; temiz önek korunur | `shared/repetition.ts` |
| m.2 | Kullanıcının istek zaman aşımı alt ajanlara da uygulanır | `core/multiagent/SubagentManager.ts` |
| m.7 | Araç şemaları bağlam bütçesine sayılır; budama onları da hesaba katar | `core/context/ContextManager.ts`, `agentLoop.ts` |
| m.8 | Alt ajan da kirli editör korumasına ve workspace hook'larına tabidir | `core/multiagent/SubagentManager.ts` |
| m.13 | Onaya sunulan spec, araç sonucundaki kimlikten okunur; eşzamanlı oturum karışmaz | `toolPipelineController.ts` |
| m.15 | Hiçbir şeyi değiştirmeyen düzenleme "başarılı" sayılmaz | `tools/file.ts` |

## Yeni kimlik eklerken

1. Bulgunun koruduğu sözleşmeyi tek cümleyle yazın.
2. Onu sınayan testi ekleyin (mümkünse sabotaj hedefi olarak).
3. Bu tabloya satırı ekleyin.
