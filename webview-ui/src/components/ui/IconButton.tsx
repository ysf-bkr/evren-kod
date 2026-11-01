import React from 'react';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Erişilebilir etiket; araç ipucu olarak da kullanılır. */
  label: string;
  active?: boolean;
  small?: boolean;
  children: React.ReactNode;
}

/**
 * Üstbilgilerde ve araç çubuklarında kullanılan kare, yalnızca simge içeren düğme.
 */
export const IconButton: React.FC<IconButtonProps> = ({
  label,
  active = false,
  small = false,
  className = '',
  children,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    title={label}
    aria-label={label}
    aria-pressed={active || undefined}
    className={[
      'evren-kod-icon-btn',
      small ? 'evren-kod-icon-btn--sm' : '',
      active ? 'evren-kod-icon-btn--active' : '',
      className
    ]
      .filter(Boolean)
      .join(' ')}
    {...rest}
  >
    {children}
  </button>
);
