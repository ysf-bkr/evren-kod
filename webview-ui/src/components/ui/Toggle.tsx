import React from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
  icon?: React.ReactNode;
}

/**
 * Erişilebilir anahtar satırı. Tüm görseller index.css'teki `.evren-kod-toggle-row`
 * ve `.evren-kod-switch` sınıflarından gelir; böylece işaretleme stil dizilerinden arınmış kalır.
 */
export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, title, description, icon }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={title}
    onClick={() => onChange(!checked)}
    className="evren-kod-toggle-row"
  >
    {icon && <span className="evren-kod-toggle-row__icon">{icon}</span>}
    <span className="min-w-0 flex-1">
      <span className="evren-kod-title block">{title}</span>
      <span className="evren-kod-caption mt-0.5 block">{description}</span>
    </span>
    <span className={`evren-kod-switch ${checked ? 'evren-kod-switch--on' : ''}`} aria-hidden="true">
      <span className="evren-kod-switch__thumb" />
    </span>
  </button>
);
