import React from 'react';
import { Menu as MenuIcon } from 'lucide-react';
import { NavigationDestination } from '@shared/types';
import { MenuView } from '../views/menu';
import { Drawer, IconButton } from '../ui';

interface HeaderMenuProps {
  showMenu: boolean;
  onToggle: () => void;
  onClose: () => void;
  /** Drawer'ın dışarıdan-tıklama kapanışı için düğüm referansı. */
  menuRef: { readonly current: HTMLDivElement | null };
  changedFileCount: number;
  activeDestination?: NavigationDestination;
  onSelectMenu: (destination: NavigationDestination) => void;
}

/**
 * Ekran başlıklarındaki menü düğmesi + popove menü. Ekran başlığı ve görev
 * başlığı aynı menüyü taşır; menü öğeleri iki yerde ayrı ayrı sürüklenmesin
 * diye burada yaşar.
 */
export const HeaderMenu: React.FC<HeaderMenuProps> = ({
  showMenu,
  onToggle,
  onClose,
  menuRef,
  changedFileCount,
  activeDestination,
  onSelectMenu
}) => (
  <div className="relative">
    <IconButton
      label="Menüyü aç"
      active={showMenu}
      onClick={onToggle}
      aria-haspopup="menu"
      aria-expanded={showMenu}
    >
      <MenuIcon className="evren-kod-icon-sm" />
    </IconButton>
    {showMenu && (
      <Drawer onClose={onClose} drawerRef={menuRef}>
        <MenuView
          changedFileCount={changedFileCount}
          activeDestination={activeDestination}
          onSelect={(destination) => {
            onClose();
            onSelectMenu(destination);
          }}
          onClose={onClose}
        />
      </Drawer>
    )}
  </div>
);
