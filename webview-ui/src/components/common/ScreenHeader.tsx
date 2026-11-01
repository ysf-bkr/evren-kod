import React, { useEffect, useRef, useState } from 'react';
import { NavigationDestination } from '@shared/types';
import { HeaderMenu } from './HeaderMenu';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  onSelectMenu?: (destination: NavigationDestination) => void;
  changedFileCount?: number;
  /** Menüde aktif gösterilecek ekran; açılmayan menü yanlış "Sohbet"i işaret etmesin. */
  activeDestination?: NavigationDestination;
}

/**
 * Ekran başlığı.
 *
 * Her alt görünümün en üstünde yer alır: solda ekran adı (ve varsa simge/eylem),
 * sağda ekran eylemleri ile gezinti menüsü. Sohbete dönüş gezinme rayından ve
 * ekran altındaki "Sohbete Git" şeridinden yapılır; başlıkta geri düğmesi yoktur.
 */
export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  title,
  subtitle,
  icon,
  actions,
  onSelectMenu,
  changedFileCount = 0,
  activeDestination
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuRef.current && !menuRef.current.contains(event.target)) setShowMenu(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowMenu(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showMenu]);

  return (
    <header className="evren-kod-screen-header">
      <div className="evren-kod-row evren-kod-fill">
        {icon}
        <div className="evren-kod-screen-header__text">
          <h1 className="evren-kod-heading evren-kod-truncate">{title}</h1>
          {subtitle && <p className="evren-kod-caption evren-kod-truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="evren-kod-screen-header__actions">
        {actions}
        {onSelectMenu && (
          <HeaderMenu
            showMenu={showMenu}
            onToggle={() => setShowMenu((v) => !v)}
            onClose={() => setShowMenu(false)}
            menuRef={menuRef}
            changedFileCount={changedFileCount}
            activeDestination={activeDestination}
            onSelectMenu={onSelectMenu}
          />
        )}
      </div>
    </header>
  );
};
