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

  const bodyPath = colored
    ? 'M 116 80 L 380 80 A 36 36 0 0 1 380 152 L 176 152 A 24 24 0 0 0 152 176 L 152 196 A 24 24 0 0 0 176 220 L 330 220 A 36 36 0 0 1 330 292 L 176 292 A 24 24 0 0 0 152 316 L 152 336 A 24 24 0 0 0 176 360 L 380 360 A 36 36 0 0 1 380 432 L 116 432 A 36 36 0 0 1 80 396 L 80 116 A 36 36 0 0 1 116 80 Z M 200 222 L 234 256 L 200 290 L 166 256 Z'
    : 'M 116 80 L 380 80 A 36 36 0 0 1 380 152 L 176 152 A 24 24 0 0 0 152 176 L 152 196 A 24 24 0 0 0 176 220 L 330 220 A 36 36 0 0 1 330 292 L 176 292 A 24 24 0 0 0 152 316 L 152 336 A 24 24 0 0 0 176 360 L 380 360 A 36 36 0 0 1 380 432 L 116 432 A 36 36 0 0 1 80 396 L 80 116 A 36 36 0 0 1 116 80 Z M 200 222 L 234 256 L 200 290 L 166 256 Z M 200 232 L 224 256 L 200 280 L 176 256 Z';
  const knotPath = 'M 200 232 L 224 256 L 200 280 L 176 256 Z';

  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true" role="presentation">
      {colored && (
        <defs>
          <linearGradient id={`${uid}-blue`} x1="80" y1="80" x2="416" y2="432" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="20%" stopColor="#0092FA" />
            <stop offset="65%" stopColor="#0051F1" />
            <stop offset="100%" stopColor="#00299E" />
          </linearGradient>
          <linearGradient
            id={`${uid}-knot`}
            x1="176"
            y1="232"
            x2="224"
            y2="280"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FDE68A" />
            <stop offset="40%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#D97706" />
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
          <path d={knotPath} fill={`url(#${uid}-knot)`} />
          <polygon points="200,250 206,256 200,262 194,256" fill="#FFFFFF" opacity="0.95" />

          {/* Üst çağrı grafiği düğümü: mimari ve keşif */}
          <circle cx="380" cy="116" r="18" fill="#38BDF8" opacity="0.85" />
          <circle cx="380" cy="116" r="8" fill="#FFFFFF" />

          {/* Orta çağrı grafiği düğümü: akıl yürütme ve planlama */}
          <circle cx="330" cy="256" r="18" fill="#FBBF24" opacity="0.85" />
          <circle cx="330" cy="256" r="8" fill="#FFFFFF" />

          {/* Alt çağrı grafiği düğümü: yürütme ve doğrulama */}
          <circle cx="380" cy="396" r="18" fill="#818CF8" opacity="0.85" />
          <circle cx="380" cy="396" r="8" fill="#FFFFFF" />
        </>
      ) : (
        <>
          <circle cx="380" cy="116" r="14" fill="currentColor" />
          <circle cx="330" cy="256" r="14" fill="currentColor" />
          <circle cx="380" cy="396" r="14" fill="currentColor" />
        </>
      )}
    </svg>
  );
};
