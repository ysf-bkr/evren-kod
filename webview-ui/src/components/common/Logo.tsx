import React, { useId } from 'react';

export interface LogoProps {
  className?: string;
  /** Marka mavisi gradyanı; kapalıyken temanın ön plan rengini kullanır. */
  colored?: boolean;
}

/**
 * Evren markası: stilize "E", örgü düğümü ve çağrı grafiği düğümleri.
 * Gövde tek bileşik yoldur (evenodd elmas boşluk küçük boyutta da okunur).
 * Rengi `currentColor` ya da marka gradyanıdır; kapsayıcı tema rengini verir.
 */
export const Logo: React.FC<LogoProps> = ({ className = 'evren-kod-icon-md', colored = false }) => {
  const uid = `evren-kod-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // E gövdesi + �örgü düğümünün elmas boşluğu.
  const bodyPath =
    'M 88 88 L 408 88 L 408 168 L 168 168 L 168 216 L 352 216 L 352 296 L 168 296 L 168 344 L 408 344 L 408 424 L 88 424 Z M 212 192 L 276 256 L 212 320 L 148 256 Z';
  // Düğüm bağlantıları ve daireler tek yolda birleşir (currentColor mirası).
  const nodesPath =
    'M 408 121 h 24 v 14 h -24 Z M 456 104 a 24 24 0 1 0 0.1 0 Z M 352 249 h 24 v 14 h -24 Z M 400 232 a 24 24 0 1 0 0.1 0 Z M 408 377 h 24 v 14 h -24 Z M 456 360 a 24 24 0 1 0 0.1 0 Z';
  const knotPath = 'M 212 212 L 256 256 L 212 300 L 168 256 Z';

  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true" role="presentation">
      {colored && (
        <defs>
          <linearGradient id={`${uid}-blue`} x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#0092FA" />
            <stop offset="50%" stopColor="#0073F9" />
            <stop offset="100%" stopColor="#0051F1" />
          </linearGradient>
        </defs>
      )}
      <path
        d={bodyPath}
        fill={colored ? `url(#${uid}-blue)` : 'currentColor'}
        fillRule="evenodd"
        clipRule="evenodd"
      />
      {colored ? (
        <>
          <path d={knotPath} fill="#f59e0b" />
          <path d="M 408 121 h 24 v 14 h -24 Z M 456 104 a 24 24 0 1 0 0.1 0 Z" fill="#0092FA" />
          <path d="M 352 249 h 24 v 14 h -24 Z M 400 232 a 24 24 0 1 0 0.1 0 Z" fill="#f59e0b" />
          <path d="M 408 377 h 24 v 14 h -24 Z M 456 360 a 24 24 0 1 0 0.1 0 Z" fill="#0051F1" />
        </>
      ) : (
        <path d={nodesPath} fill="currentColor" />
      )}
    </svg>
  );
};
