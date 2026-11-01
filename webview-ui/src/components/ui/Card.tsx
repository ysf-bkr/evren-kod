import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  muted?: boolean;
  interactive?: boolean;
  active?: boolean;
}

/**
 * Yüzey kapsayıcısı. Yalnızca yerleşim yardımcıları `className` ile eklenebilir;
 * renkler, kenarlıklar ve dolgu index.css'te kalır.
 */
export const Card: React.FC<CardProps> = ({
  muted = false,
  interactive = false,
  active = false,
  className = '',
  children,
  ...rest
}) => (
  <div
    className={[
      'evren-kod-card',
      muted ? 'evren-kod-card--muted' : '',
      interactive ? 'evren-kod-card--interactive' : '',
      active ? 'evren-kod-card--active' : '',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...rest}
  >
    {children}
  </div>
);

export interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
}

export const Section: React.FC<SectionProps> = ({ className = '', children, ...rest }) => (
  <section className={['evren-kod-section', className].filter(Boolean).join(' ')} {...rest}>
    {children}
  </section>
);

export interface SectionTitleProps {
  icon?: React.ReactNode;
  title: string;
  count?: string | number;
  action?: React.ReactNode;
}

export const SectionTitle: React.FC<SectionTitleProps> = ({ icon, title, count, action }) => (
  <div className="flex items-center justify-between gap-2 px-0.5">
    <div className="evren-kod-overline">
      {icon}
      {title}
    </div>
    {action}
    {count !== undefined && <span className="text-2xs font-mono evren-kod-text-muted">{count}</span>}
  </div>
);

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => (
  <div className="evren-kod-empty">
    {icon}
    {title && <div className="evren-kod-title">{title}</div>}
    {description && <p className="evren-kod-caption max-w-[42ch]">{description}</p>}
    {action}
  </div>
);
