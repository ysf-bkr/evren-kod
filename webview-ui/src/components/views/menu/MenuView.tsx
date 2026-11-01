import React from 'react';
import {
  Bot,
  ChevronRight,
  FileDiff,
  History,
  Info,
  Network,
  Server,
  Settings,
  X,
  MessageSquare
} from 'lucide-react';
import { NavigationDestination } from '@shared/types';
import { Badge, IconButton, ListButton } from '../../ui';

export type MenuDestination = NavigationDestination;

interface MenuViewProps {
  onSelect: (destination: NavigationDestination) => void;
  changedFileCount: number;
  activeDestination?: string;
  onClose?: () => void;
}

interface MenuItem {
  id: NavigationDestination;
  title: string;
  description: string;
  icon: React.ReactNode;
  category: 'workspace' | 'ai' | 'system';
}

const MENU_ITEMS: MenuItem[] = [
  {
    id: 'chat',
    title: 'Sohbet',
    description: 'Ana asistan çalışma alanı',
    icon: <MessageSquare className="evren-kod-icon-md evren-kod-text-brand" />,
    category: 'workspace'
  },
  {
    id: 'changes',
    title: 'Değişiklikler',
    description: 'Görev dosyalarını ve Git durumunu incele',
    icon: <FileDiff className="evren-kod-icon-md evren-kod-text-warning" />,
    category: 'workspace'
  },
  {
    id: 'history',
    title: 'Görev geçmişi',
    description: 'Önceki sohbetleri görüntüle ve devam et',
    icon: <History className="evren-kod-icon-md evren-kod-text-brand" />,
    category: 'workspace'
  },
  {
    id: 'agents',
    title: 'Ajanlar ve beceriler',
    description: '13 uzman alt ajan ve proje yönergeleri',
    icon: <Bot className="evren-kod-icon-md evren-kod-text-success" />,
    category: 'ai'
  },
  {
    id: 'callgraph',
    title: 'Çağrı grafiği',
    description: 'Sembollerin kimlerce çağrıldığını incele',
    icon: <Network className="evren-kod-icon-md evren-kod-text-brand" />,
    category: 'ai'
  },
  {
    id: 'mcp',
    title: 'MCP sunucuları',
    description: 'Bağlantıları ve araçları yönet',
    icon: <Server className="evren-kod-icon-md evren-kod-text-info" />,
    category: 'ai'
  },
  {
    id: 'settings',
    title: 'Ayarlar',
    description: 'Model, onaylar ve çalışma tercihleri',
    icon: <Settings className="evren-kod-icon-md evren-kod-text-brand" />,
    category: 'system'
  },
  {
    id: 'about',
    title: 'Hakkında',
    description: 'Sürüm, tanılama ve proje bilgileri',
    icon: <Info className="evren-kod-icon-md evren-kod-text-muted" />,
    category: 'system'
  }
];

const CATEGORIES: Array<{ key: 'workspace' | 'ai' | 'system'; label: string }> = [
  { key: 'workspace', label: 'Çalışma Alanı' },
  { key: 'ai', label: 'Yapay Zekâ ve Beceriler' },
  { key: 'system', label: 'Yapılandırma' }
];

export const MenuView: React.FC<MenuViewProps> = ({
  onSelect,
  changedFileCount,
  activeDestination = 'chat',
  onClose
}) => (
  <div
    role="menu"
    aria-label="Sohbet menüsü"
    className="flex h-full w-full flex-col overflow-hidden evren-kod-text-fg"
  >
    {/* Panel Başlığı */}
    <div className="flex shrink-0 items-center justify-between border-b evren-kod-border-base evren-kod-bg-section px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="evren-kod-overline">Gezinti ve Ayarlar</span>
      </div>
      {onClose && (
        <IconButton label="Kapat" onClick={onClose}>
          <X className="evren-kod-icon-sm" />
        </IconButton>
      )}
    </div>

    {/* Menü Listesi */}
    <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
      {CATEGORIES.map((cat) => {
        const items = MENU_ITEMS.filter((item) => item.category === cat.key);
        if (items.length === 0) return null;

        return (
          <div key={cat.key} className="space-y-1">
            <div className="px-2 evren-kod-overline evren-kod-text-muted opacity-80">{cat.label}</div>
            <div className="flex flex-col gap-0.5">
              {items.map((item) => {
                const isActive = activeDestination === item.id;
                return (
                  <ListButton
                    key={item.id}
                    role="menuitem"
                    onClick={() => onSelect(item.id)}
                    active={isActive}
                    icon={item.icon}
                    title={
                      <span className="flex items-center gap-1.5 font-medium evren-kod-text-fg">
                        {item.title}
                        {item.id === 'changes' && changedFileCount > 0 && (
                          <Badge tone="brand" mono>
                            {changedFileCount}
                          </Badge>
                        )}
                      </span>
                    }
                    description={item.description}
                    trailing={
                      <ChevronRight className="evren-kod-icon-sm shrink-0 evren-kod-text-muted opacity-60" />
                    }
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>

    {/* Alt Bilgi */}
    <div className="shrink-0 border-t evren-kod-border-base evren-kod-soft-card px-3 py-2 text-2xs evren-kod-text-muted">
      <div className="flex items-center justify-between">
        <span>Evren Kod</span>
        <span className="font-mono">
          v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.1'}
        </span>
      </div>
    </div>
  </div>
);
