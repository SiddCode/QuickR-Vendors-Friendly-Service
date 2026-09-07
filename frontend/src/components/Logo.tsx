import React from 'react';

export const Logo: React.FC<{ className?: string; variant?: 'light' | 'dark'; size?: 'sm' | 'md' | 'lg' }> = ({ 
  className = "h-8 w-auto",
  variant = 'light',
  size = 'md'
}) => {
  void size;
  const isDark = variant === 'dark';
  const textColor = isDark ? '#ffffff' : '#0a0f1d';

  return (
    <svg 
      viewBox="0 0 320 90" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={className}
    >
      <defs>
        <linearGradient id="rBlueGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00c6ff" />
          <stop offset="50%" stopColor="#0072ff" />
          <stop offset="100%" stopColor="#0052d4" />
        </linearGradient>
        <linearGradient id="speedBlueGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#00c6ff" stopOpacity="0.1" />
          <stop offset="50%" stopColor="#0072ff" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#0052d4" />
        </linearGradient>
      </defs>

      {/* Speed lines behind / left of Q */}
      <path d="M 12 36 L 68 36 L 56 42 L 8 42 Z" fill="url(#speedBlueGrad)" />
      <path d="M 2 48 L 74 48 L 62 54 L 0 54 Z" fill="url(#speedBlueGrad)" />
      <path d="M 20 60 L 62 60 L 52 65 L 15 65 Z" fill="url(#speedBlueGrad)" />

      {/* Quick Text */}
      <text 
        x="66" 
        y="66" 
        fill={textColor} 
        fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        fontWeight="900" 
        fontStyle="italic" 
        fontSize="64"
        letterSpacing="-3px"
      >
        Quick
      </text>

      {/* Stylized R with Speed Slash Notch */}
      <g transform="translate(240, 12)">
        <path 
          d="M 10 54 L 10 12 L 40 12 C 55 12, 65 19, 65 31 C 65 41, 56 48, 44 50 L 64 74 L 46 74 L 28 52 L 24 52 L 24 74 L 10 74 Z M 24 23 L 24 41 L 38 41 C 46 41, 51 37, 51 31 C 51 25, 46 23, 38 23 Z" 
          fill="url(#rBlueGrad)" 
          transform="skewX(-14)"
        />
      </g>
    </svg>
  );
};
