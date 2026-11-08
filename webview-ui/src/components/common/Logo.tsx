import React, { useId } from 'react';

export interface LogoProps {
  className?: string;
  /** Marka gradyanı; kapalıyken temanın ön plan rengini (currentColor) kullanır. */
  colored?: boolean;
}

/**
 * Evren Kod Marka Logosu:
 * - Kalkan: Güvenlik, kurumsal gizlilik ve koruma
 * - Kod Sembolü (</>): Kodlama asistanlığı
 * - Sonsuzluk / Evren Döngüsü: Kesintisiz ve güvenli geliştirme döngüsü
 * - Doğrulama Mührü (✓): Kanıtsız kod teslim etmeyen kalite güvencesi
 */
export const Logo: React.FC<LogoProps> = ({ className = 'evren-kod-icon-md', colored = false }) => {
  const uid = `evren-kod-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true" role="presentation" fill="none">
      {colored ? (
        <defs>
          <linearGradient
            id={`${uid}-shield-rim`}
            x1="106"
            y1="56"
            x2="406"
            y2="440"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#93C5FD" />
            <stop offset="35%" stopColor="#3B82F6" />
            <stop offset="100%" stopColor="#1E3A8A" />
          </linearGradient>
          <linearGradient
            id={`${uid}-shield-body`}
            x1="256"
            y1="60"
            x2="256"
            y2="440"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#0C1938" />
            <stop offset="50%" stopColor="#070F24" />
            <stop offset="100%" stopColor="#020617" />
          </linearGradient>
          <linearGradient
            id={`${uid}-code`}
            x1="182"
            y1="136"
            x2="330"
            y2="212"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#E0F2FE" />
          </linearGradient>
          <linearGradient id={`${uid}-inf`} x1="36" y1="276" x2="476" y2="276" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="25%" stopColor="#0284C7" />
            <stop offset="50%" stopColor="#3B82F6" />
            <stop offset="75%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#D946EF" />
          </linearGradient>
          <linearGradient
            id={`${uid}-seal`}
            x1="228"
            y1="347"
            x2="284"
            y2="403"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#064E3B" />
            <stop offset="100%" stopColor="#022C22" />
          </linearGradient>
        </defs>
      ) : null}

      {/* Kalkan Dış Gövdesi */}
      <path
        d="M 256 56 C 295 72 355 96 406 118 C 406 185 396 310 256 440 C 116 310 106 185 106 118 C 157 96 217 72 256 56 Z"
        fill={colored ? `url(#${uid}-shield-body)` : 'none'}
        stroke={colored ? `url(#${uid}-shield-rim)` : 'currentColor'}
        strokeWidth={colored ? 16 : 24}
        strokeLinejoin="round"
        fillRule="evenodd"
        clipRule="evenodd"
      />

      {/* Kalkan İç Işıltı Çizgisi */}
      {colored && (
        <path
          d="M 256 74 C 288 88 344 110 384 128 C 384 185 375 292 256 414 C 137 292 128 185 128 128 C 168 110 224 88 256 74 Z"
          fill="none"
          stroke="#60A5FA"
          strokeWidth={2}
          opacity={0.25}
        />
      )}

      {/* Kod Sembolü </> */}
      <g
        stroke={colored ? `url(#${uid}-code)` : 'currentColor'}
        strokeWidth={20}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M 222 142 L 182 174 L 222 206" />
        <path d="M 272 136 L 240 212" />
        <path d="M 290 142 L 330 174 L 290 206" />
      </g>

      {/* Sonsuzluk / Evren Şeridi (Infinity Ribbon) */}
      <path
        d="M 256 276 C 290 232 345 210 405 218 C 455 225 476 256 476 276 C 476 302 450 332 400 336 C 340 340 285 315 256 276 C 227 237 172 212 112 216 C 62 220 36 250 36 276 C 36 296 57 327 107 334 C 167 342 222 320 256 276 Z"
        stroke={colored ? `url(#${uid}-inf)` : 'currentColor'}
        strokeWidth={colored ? 36 : 30}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Kalite & Kanıt Mührü (Yeşil Doğrulama Rozeti) */}
      <g transform="translate(256, 375)">
        <circle
          cx={0}
          cy={0}
          r={28}
          fill={colored ? `url(#${uid}-seal)` : 'none'}
          stroke={colored ? '#10B981' : 'currentColor'}
          strokeWidth={colored ? 6 : 10}
        />
        {colored && (
          <circle cx={0} cy={0} r={33} fill="none" stroke="#34D399" strokeWidth={2} opacity={0.4} />
        )}
        <path
          d="M -11 1 L -3 9 L 13 -7"
          fill="none"
          stroke={colored ? '#34D399' : 'currentColor'}
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
};
