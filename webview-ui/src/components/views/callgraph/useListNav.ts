import { useCallback, useRef } from 'react';
import type { KeyboardEvent } from 'react';

interface ListNavOptions {
  /** Satır oku sağa basıldığında, odaktaki satırın data-nav-path değeriyle çağrılır. */
  onExpand?: (path: string) => void;
  /** Satır oku sola basıldığında, odaktaki satırın data-nav-path değeriyle çağrılır. */
  onCollapse?: (path: string) => void;
}

export interface ListNav {
  /**
   * Gezinecek düğüm listesini saran kapsayıcıya bağlanır.
   * Yapısal tip: React 18 ve 19 tip tanımlarının ikisiyle de uyumlu kalır.
   */
  containerRef: { readonly current: HTMLDivElement | null };
  /** Kapsayıcının onKeyDown olayına bağlanır (ok tuşları yukarıdan söner). */
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Düğme listelerinde klavye ile gezinme: aşağı/yukarı odağı taşır, Home/End
 * uçlara atlar. Ağaçlı listelerde (dosya → semboller) sağ/sol tuşları,
 * `data-nav-path` taşıyan satır üzerinden çağırana iletir.
 *
 * Tuşlar yalnızca liste içindeki [data-nav] işaretli düğmeler arasında dolaşır;
 * satır yanındaki simge düğmeleri (örn. grafik merkeze alma) gezintiden
 * bilinçli olarak muaftır.
 */
export function useListNav(options: ListNavOptions = {}): ListNav {
  const containerRef = useRef<HTMLDivElement>(null);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const buttons = Array.from(
        containerRef.current?.querySelectorAll<HTMLButtonElement>('[data-nav]') ?? []
      );
      if (buttons.length === 0) return;
      const active = document.activeElement;
      const index = buttons.findIndex((button) => button === active);
      const focusAt = (next: number) => {
        const target = buttons[Math.min(Math.max(next, 0), buttons.length - 1)];
        target?.focus();
      };
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          focusAt(index < 0 ? 0 : index + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          focusAt(index < 0 ? buttons.length - 1 : index - 1);
          break;
        case 'Home':
          event.preventDefault();
          focusAt(0);
          break;
        case 'End':
          event.preventDefault();
          focusAt(buttons.length - 1);
          break;
        case 'ArrowRight': {
          const path = active instanceof HTMLElement ? active.dataset.navPath : undefined;
          if (path && options.onExpand) {
            event.preventDefault();
            options.onExpand(path);
          }
          break;
        }
        case 'ArrowLeft': {
          const path = active instanceof HTMLElement ? active.dataset.navPath : undefined;
          if (path && options.onCollapse) {
            event.preventDefault();
            options.onCollapse(path);
          }
          break;
        }
        default:
          break;
      }
    },
    [options.onExpand, options.onCollapse]
  );

  return { containerRef, onKeyDown };
}
