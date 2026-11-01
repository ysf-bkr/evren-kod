import React from 'react';
import { ChevronRight } from 'lucide-react';
import { cx } from './cx';

export type BadgeTone = 'neutral' | 'muted' | 'brand' | 'info' | 'success' | 'warning' | 'error';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  mono?: boolean;
  truncate?: boolean;
}

/** Küçük durum/etiket hapı. Renk tonları index.css'teki durum jetonlarından gelir. */
export const Badge: React.FC<BadgeProps> = ({
  tone = 'neutral',
  mono = false,
  truncate = false,
  className,
  children,
  ...rest
}) => (
  <span
    className={cx(
      'evren-kod-badge',
      `evren-kod-badge--${tone}`,
      mono && 'evren-kod-badge--mono',
      truncate && 'evren-kod-badge--truncate',
      className
    )}
    {...rest}
  >
    {children}
  </span>
);

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: React.ReactNode;
  count?: React.ReactNode;
}

/** Seçilebilir hap düğme: filtre ve sıralama kontrolleri. */
export const Chip: React.FC<ChipProps> = ({
  active = false,
  icon,
  count,
  className,
  children,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    aria-pressed={active}
    className={cx('evren-kod-chip', active && 'evren-kod-chip--active', className)}
    {...rest}
  >
    {icon}
    <span>{children}</span>
    {count !== undefined && <span className="evren-kod-chip__count">{count}</span>}
  </button>
);

export interface LinkButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Renk devralınır; yalnızca üzerine gelince alt çizgi çıkar. */
  plain?: boolean;
}

/** Metin gibi görünen düğme: e-posta, dosya yolu gibi bağlantılar. */
export const LinkButton: React.FC<LinkButtonProps> = ({
  plain = false,
  className,
  children,
  type = 'button',
  ...rest
}) => (
  <button type={type} className={cx('evren-kod-link', plain && 'evren-kod-link--plain', className)} {...rest}>
    {children}
  </button>
);

export interface ListButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  active?: boolean;
  /** `flat`: çerçevesiz satır (akordeon başlığı, açılır liste girdisi). */
  flat?: boolean;
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
}

/** Tıklanabilir liste satırı/kartı. */
export const ListButton: React.FC<ListButtonProps> = ({
  active = false,
  flat = false,
  icon,
  title,
  description,
  trailing,
  className,
  children,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    title={typeof title === 'string' ? title : undefined}
    className={cx(
      'evren-kod-list-item',
      flat && 'evren-kod-list-item--flat',
      active && 'evren-kod-list-item--active',
      className
    )}
    {...rest}
  >
    {children ?? (
      <>
        {icon && <span className="evren-kod-toggle-row__icon shrink-0">{icon}</span>}
        {(title || description) && (
          <span className="min-w-0 flex-1 text-left">
            {title && <span className="evren-kod-title block truncate">{title}</span>}
            {description && <span className="evren-kod-caption block truncate">{description}</span>}
          </span>
        )}
        {trailing && <span className="shrink-0">{trailing}</span>}
      </>
    )}
  </button>
);

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  title?: string;
}

export interface SegmentedProps<T extends string> {
  label?: string;
  'aria-label'?: string;
  value: T;
  options?: Array<SegmentedOption<T>>;
  items?: Array<SegmentedOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  disabledTitle?: string;
}

/** Bölümlü denetim: birbirini dışlayan az sayıda seçenek (ör. görev modu). */
export function Segmented<T extends string>({
  label,
  'aria-label': ariaLabel,
  value,
  options,
  items,
  onChange,
  disabled = false,
  disabledTitle
}: SegmentedProps<T>): React.ReactElement {
  const list = options ?? items ?? [];
  return (
    <div role="group" aria-label={label ?? ariaLabel ?? 'Seçenekler'} className="evren-kod-segmented">
      {list.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          disabled={disabled}
          aria-pressed={value === option.id}
          title={disabled && disabledTitle ? disabledTitle : (option.title ?? option.label)}
          className={cx(
            'evren-kod-segmented__item',
            value === option.id && 'evren-kod-segmented__item--active'
          )}
        >
          {option.icon}
          <span className="evren-kod-segmented__label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export interface IconPickerProps<T extends string> {
  'aria-label': string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  disabledTitle?: string;
}

/**
 * Satır içi ikon seçici: tüm seçenekler tek satırda durur; seçili olan ikon +
 * etiket, seçili olmayanlar yalnızca ikon olarak çizilir (etiketler çubuğu
 * şişirmez, erişilebilir ad her düğmede taşınır). Menü katmanı yoktur:
 * bestecinin `overflow: hidden` kutusunda yukarı açılır menüler kesiliyor ve
 * seçenekler hiç görünmüyordu. Tıklamak seçimi doğrudan uygular.
 */
export function IconPicker<T extends string>({
  'aria-label': ariaLabel,
  value,
  options,
  onChange,
  disabled = false,
  disabledTitle
}: IconPickerProps<T>): React.ReactElement {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex items-center gap-0.5 rounded-md border evren-kod-border-surface p-0.5"
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected}
            aria-label={`${ariaLabel}: ${option.label}`}
            disabled={disabled}
            title={disabled && disabledTitle ? disabledTitle : (option.title ?? option.label)}
            onClick={() => onChange(option.id)}
            className={cx(
              'flex items-center gap-1 rounded px-1.5 py-1 text-xs hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50',
              selected
                ? 'evren-kod-bg-brand-soft evren-kod-text-brand font-medium'
                : 'evren-kod-text-fg opacity-75'
            )}
          >
            {option.icon}
            {selected && <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export interface NavButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string;
  expanded: boolean;
  active?: boolean;
  badge?: number;
}

/** Yan menü öğesi: daralmışken yalnızca simge, genişken simge + başlık. */
export const NavButton: React.FC<NavButtonProps> = ({
  icon,
  label,
  expanded,
  active = false,
  badge,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    aria-current={active ? 'page' : undefined}
    className={cx('evren-kod-nav__item', active && 'evren-kod-nav__item--active')}
    {...rest}
  >
    <span className="evren-kod-nav__icon">
      {icon}
      {badge ? <span className="evren-kod-nav__badge">{badge}</span> : null}
    </span>
    {expanded && <span className="evren-kod-nav__label">{label}</span>}
  </button>
);

export interface DisclosureProps {
  title?: React.ReactNode;
  summary?: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  /** `plain`: çerçevesiz, `card`: dolgulu yüzey, `dashed`: kesikli çerçeve. */
  variant?: 'plain' | 'card' | 'dashed';
  className?: string;
  children: React.ReactNode;
}

/** Açılır bölüm. Ham `<details>/<summary>` yalnızca bu dosyada kullanılır. */
export const Disclosure: React.FC<DisclosureProps> = ({
  title,
  summary,
  icon,
  defaultOpen = false,
  variant = 'plain',
  className,
  children
}) => (
  <details
    open={defaultOpen || undefined}
    className={cx(
      'evren-kod-disclosure',
      variant === 'card' && 'evren-kod-disclosure--card',
      variant === 'dashed' && 'evren-kod-disclosure--dashed',
      className
    )}
  >
    <summary className="evren-kod-disclosure__summary">
      <ChevronRight className="evren-kod-icon-xs evren-kod-disclosure__chevron" aria-hidden="true" />
      {icon}
      {title ?? summary}
    </summary>
    <div className="evren-kod-disclosure__body">{children}</div>
  </details>
);
