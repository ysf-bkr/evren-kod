import React from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'xs';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** İçeriği sola yaslar (menü benzeri tam genişlik düğmeler için). */
  start?: boolean;
  icon?: React.ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'evren-kod-btn--primary',
  secondary: 'evren-kod-btn--secondary',
  ghost: 'evren-kod-btn--ghost',
  danger: 'evren-kod-btn--danger'
};

/**
 * Webview'daki tek düğme ilkeli. Görsel biçim index.css'te yaşar;
 * çağıran yalnızca anlamsal bir varyant seçer.
 */
export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'sm',
  block = false,
  start = false,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    className={cx(
      'evren-kod-btn',
      variantClass[variant],
      size === 'xs' && 'evren-kod-btn--xs',
      block && 'evren-kod-btn--block',
      start && 'evren-kod-btn--start',
      className
    )}
    {...rest}
  >
    {icon}
    {children}
  </button>
);
