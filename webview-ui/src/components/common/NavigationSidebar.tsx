import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Bot, FileDiff, History, Info, MessageSquare, Network, Server, Settings } from 'lucide-react';
import { NavigationDestination } from '@shared/types';
import { NavButton } from '../ui';

export interface NavigationSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  activeDestination: NavigationDestination;
  onSelect: (destination: NavigationDestination) => void;
  changedFileCount: number;
}

interface NavItem {
  id: NavigationDestination;
  title: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'chat', title: 'Sohbet', icon: <MessageSquare className="evren-kod-icon-md" /> },
  { id: 'changes', title: 'Değişiklikler', icon: <FileDiff className="evren-kod-icon-md" /> },
  { id: 'history', title: 'Görev Geçmişi', icon: <History className="evren-kod-icon-md" /> },
  { id: 'agents', title: 'Ajanlar & Beceriler', icon: <Bot className="evren-kod-icon-md" /> },
  { id: 'callgraph', title: 'Çağrı Grafiği', icon: <Network className="evren-kod-icon-md" /> },
  { id: 'mcp', title: 'MCP Sunucuları', icon: <Server className="evren-kod-icon-md" /> },
  { id: 'settings', title: 'Ayarlar', icon: <Settings className="evren-kod-icon-md" /> },
  { id: 'about', title: 'Hakkında', icon: <Info className="evren-kod-icon-md" /> }
];

/**
 * Sabit gezinme çubuğu. Daralmışken yalnızca simge gösterir; genişken başlıkları
 * da gösterir. Dar ekranda (<480px) genişleyen panel içeriği ezmek yerine üstüne biner.
 */
export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
  isOpen,
  onToggle,
  activeDestination,
  onSelect,
  changedFileCount
}) => (
  <aside aria-label="Sabit yan menü" className={`evren-kod-nav ${isOpen ? 'evren-kod-nav--open' : ''}`}>
    <div className="evren-kod-nav__panel">
      <nav className="evren-kod-nav__list">
        {NAV_ITEMS.map((item) => {
          const showBadge = item.id === 'changes' && changedFileCount > 0;
          return (
            <NavButton
              key={item.id}
              icon={item.icon}
              label={item.title}
              expanded={isOpen}
              active={activeDestination === item.id}
              badge={showBadge ? changedFileCount : undefined}
              title={`${item.title}${showBadge ? ` (${changedFileCount} dosya)` : ''}`}
              onClick={() => onSelect(item.id)}
            />
          );
        })}
      </nav>

      <div className="evren-kod-nav__footer">
        <NavButton
          icon={
            isOpen ? (
              <ChevronRight className="evren-kod-icon-sm" />
            ) : (
              <ChevronLeft className="evren-kod-icon-sm" />
            )
          }
          label="Menüyü daralt"
          expanded={isOpen}
          title={isOpen ? 'Menüyü daralt (sabit ikon moduna geç)' : 'Menüyü genişlet'}
          aria-label={isOpen ? 'Menüyü daralt' : 'Menüyü genişlet'}
          onClick={onToggle}
        />
      </div>
    </div>
  </aside>
);
