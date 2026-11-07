/**
 * Araç hatalarının kullanıcıya bakan Türkçe karşılığı.
 *
 * Model, araç sonuçlarını İngilizce teknik metinle görür (istem diliyle
 * tutarlı kalsın diye). Arayüzde ise aynı metni ham göstermek "her şey
 * Türkçe" sözünü bozuyordu. Burada yalnızca uygulamanın kendi ürettiği
 * bilinen mesajlar çevrilir; işletim sistemi ya da üçüncü taraf araçlardan
 * gelen serbest metinler çevrilemez ve "teknik ayrıntı" etiketiyle açıkça
 * ham bırakılır — uydurma bir çeviri yapmaktansa dürüst olmak yeğdir.
 */

interface Rule {
  match: RegExp;
  render: (groups: string[]) => string;
}

const RULES: Rule[] = [
  {
    match: /^Tool is not allowed at this stage: (.+)\.$/,
    render: ([name]) => `Bu araç bu aşamada kullanılamaz: ${name}.`
  },
  {
    match: /^"(.+)" contains unsaved editor changes\. Save or revert them first\.$/,
    render: ([file]) =>
      `"${file}" dosyasında kaydedilmemiş editör değişiklikleri var. Önce kaydedin ya da değişiklikleri geri alın.`
  },
  {
    match: /^Approval timed out \(10 minutes\)\.$/,
    render: () => 'Onay süresi doldu (10 dakika).'
  },
  {
    match: /^Rejected by the user\.$/,
    render: () => 'İşlem kullanıcı tarafından reddedildi.'
  },
  {
    match: /^The user cancelled (?:the operation|the task)\.$/,
    render: () => 'İşlem kullanıcı tarafından iptal edildi.'
  },
  {
    match: /^Unknown tool: (.+)$/,
    render: ([name]) => `Bilinmeyen araç: ${name}.`
  },
  {
    match: /^Blocked by the PreToolUse hook\.$/,
    render: () => 'PreToolUse kancası işlemi engelledi.'
  },
  {
    match: /^An error occurred while running the tool\.$/,
    render: () => 'Araç çalıştırılırken bir hata oluştu.'
  },
  {
    match: /^An error occurred while running the subagent\.$/,
    render: () => 'Alt ajan çalışırken bir hata oluştu.'
  },
  {
    match: /^Could not run parallel tasks\.$/,
    render: () => 'Paralel görevler çalıştırılamadı.'
  },
  {
    match: /^Could not merge worktree\.$/,
    render: () => 'Worktree ana çalışma alanına birleştirilemedi.'
  },
  {
    match: /^Could not update the module plan\.$/,
    render: () => 'Modül haritası güncellenemedi.'
  },
  {
    match: /^Could not update the task plan\.$/,
    render: () => 'Görev planı güncellenemedi.'
  },
  {
    match: /^Workspace not found\.$/,
    render: () => 'Çalışma alanı bulunamadı.'
  },
  {
    match: /^No module map yet\. Call update_module_plan first[\s\S]*$/,
    render: () =>
      'Henüz modül haritası yok. Önce `update_module_plan` ile katmanlı modül haritasını oluşturun.'
  },
  // Sağlayıcı katmanının kullanıcıya ulaşan bilinen hataları.
  {
    match: /^No API key provided for (.+)\. Add your API key in the Settings panel\.$/,
    render: ([name]) => `${name} için API anahtarı tanımlı değil. Ayarlar ekranından ekleyin.`
  },
  {
    match: /^(.+) requires a concrete model id\.[\s\S]*$/,
    render: ([name]) =>
      `${name} somut bir model kimliği ister. Ayarlar ekranından model listesini yükleyip bir model seçin ("auto" yalnızca OpenRouter için geçerlidir).`
  },
  {
    match: /^API error \[(\d+)\]: ([\s\S]*)$/,
    render: ([status, detail]) => `Model sunucusu HTTP ${status} hatası döndürdü: ${detail}`
  },
  {
    match: /^Could not reach the model server\.$/,
    render: () => 'Model sunucusuna ulaşılamadı. Sağlayıcının çalıştığını ve adresi kontrol edin.'
  },
  {
    match: /^No valid response received from the model\.$/,
    render: () => 'Modelden geçerli bir yanıt alınamadı.'
  },
  {
    match: /^Model request timed out \((\d+) sec\)[\s\S]*$/,
    render: ([seconds]) =>
      `Model isteği zaman aşımına uğradı (${seconds} sn). Yavaş modeller için Ayarlar'dan bağlantı zaman aşımını artırın.`
  },
  {
    match: /^Model stream stalled for (\d+) sec; the request was stopped\.$/,
    render: ([seconds]) => `Model akışı ${seconds} sn boyunca durdu; istek kesildi.`
  },
  {
    match: /^Model stream ended before completion \(no \[DONE\] received\)[\s\S]*$/,
    render: () => 'Model akışı tamamlanmadan kapandı; yanıt yarım kalmış olabilir. Görevi yeniden deneyin.'
  },
  {
    match: /^Request cancelled by the user\.$/,
    render: () => 'İstek kullanıcı tarafından iptal edildi.'
  },
  {
    match: /^Model request failed\.$/,
    render: () => 'Model isteği başarısız oldu.'
  }
];

/** Metin zaten Türkçe mi? (Türkçe'ye özgü karakter ya da bilinen sözcükler) */
function looksTurkish(text: string): boolean {
  return /[çğıöşüÇĞİÖŞÜ]/.test(text);
}

export interface HumanizedErrorMessage {
  /** Kullanıcıya gösterilecek Türkçe metin. */
  text: string;
  /** Metin birebir çevrilemediyse ham teknik ayrıntı olarak işaretlenir. */
  technical: boolean;
}

export function humanizeErrorMessage(raw: string | undefined): HumanizedErrorMessage | undefined {
  const message = (raw ?? '').trim();
  if (!message) return undefined;

  for (const rule of RULES) {
    const match = rule.match.exec(message);
    if (match) {
      return { text: rule.render(match.slice(1)), technical: false };
    }
  }

  if (looksTurkish(message)) {
    return { text: message, technical: false };
  }

  return { text: message, technical: true };
}
