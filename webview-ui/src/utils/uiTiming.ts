/**
 * Arayüz geri-bildirim zamanlamalarının tek adresi.
 * "Kopyalandı" rozeti, iki aşamalı onay sıfırlaması gibi süreler dosyadan
 * dosyaya 1500/1600/3000 diye sapmasın diye burada toplanır.
 */

/** Kopyalama eyleminde "kopyalandı" geri-bildiriminin görünürlük süresi. */
export const COPY_FEEDBACK_MS = 1500;

/** İki aşamalı onayların (sil/geri al) kendini ilk haline bırakma süresi. */
export const CONFIRM_RESET_MS = 3000;

/** Ayarlar ekranında "kaydedildi" işaretinin görünürlük süresi. */
export const SAVED_HINT_MS = 2000;

/** Çağrı grafiği gibi canlı ekranların durum yoklama aralığı. */
export const STATUS_POLL_MS = 2500;
