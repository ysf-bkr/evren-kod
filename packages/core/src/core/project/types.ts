/**
 * Proje profili sözleşmeleri.
 *
 * Profil, kullanıcının hangi tür uygulamayı geliştirdiğini anlatır: uzman
 * agent kataloğundan aktif ekibin seçilmesi ve yönlendirme bu veriye
 * dayanır. Tipler tek doğruluk kaynağı olan shared/types'ta yaşar; buradan
 * yeniden dışa aktarılır ki motor içi import yolları değişmesin.
 */
import type { ProjectKind, ProjectProfile, StackId } from '../../shared/types';

export type { ProjectKind, ProjectProfile, StackId };
