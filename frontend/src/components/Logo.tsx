import React from 'react';

export const Logo: React.FC<{ className?: string; variant?: 'light' | 'dark'; size?: 'sm' | 'md' | 'lg' }> = ({ 
  className = "h-8 w-auto",
  variant = 'light',
  size = 'md'
}) => {
  // Silence unused variant warning if present
  void variant;
  const iconSizes = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16'
  };

  return (
    <div className={`${iconSizes[size]} ${className} relative flex-shrink-0 transition-transform duration-300 group-hover:scale-105 filter drop-shadow-md`}>
      <svg viewBox="0 0 500 500" className="w-full h-full">
        <defs>
          <linearGradient id="logoTopBlue" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1d4ed8"/>
            <stop offset="50%" stopColor="#2563eb"/>
            <stop offset="100%" stopColor="#1e40af"/>
          </linearGradient>
          <linearGradient id="logoBotRed" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#dc2626"/>
            <stop offset="50%" stopColor="#b91c1c"/>
            <stop offset="100%" stopColor="#801010"/>
          </linearGradient>
          <linearGradient id="logoBadgeGloss" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4"/>
            <stop offset="35%" stopColor="#ffffff" stopOpacity="0.08"/>
            <stop offset="100%" stopColor="#000000" stopOpacity="0.3"/>
          </linearGradient>
          <clipPath id="logoBadgeClip">
            <rect x="50" y="50" width="400" height="400" rx="90" ry="90" />
          </clipPath>
        </defs>

        {/* Badge Frame */}
        <rect x="50" y="50" width="400" height="400" rx="90" ry="90" fill="#1e293b" />
        <g clipPath="url(#logoBadgeClip)">
          <polygon points="20,20 480,20 20,480" fill="url(#logoTopBlue)" />
          <polygon points="480,20 480,480 20,480" fill="url(#logoBotRed)" />
          <line x1="480" y1="20" x2="20" y2="480" stroke="#000000" strokeWidth="8" opacity="0.35"/>
          <line x1="480" y1="20" x2="20" y2="480" stroke="#ffffff" strokeWidth="2.5" opacity="0.4"/>
          <rect x="50" y="50" width="400" height="400" fill="url(#logoBadgeGloss)" />
        </g>
        <rect x="50" y="50" width="400" height="400" rx="90" ry="90" fill="none" stroke="#ffffff" strokeWidth="5" strokeOpacity="0.35" />

        {/* Checkmark */}
        <path d="M105 240 L195 325 L345 145" fill="none" stroke="#ffffff" strokeWidth="44" strokeLinecap="round" strokeLinejoin="round" />

        {/* User Silhouette */}
        <g transform="translate(290, 270)">
          <circle cx="60" cy="45" r="34" fill="#ffffff" />
          <path d="M 12 125 C 12 85, 30 75, 60 75 C 90 75, 108 85, 108 125 Z" fill="#ffffff" />
        </g>
      </svg>
    </div>
  );
};
