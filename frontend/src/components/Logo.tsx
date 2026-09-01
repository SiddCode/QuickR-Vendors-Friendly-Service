import React from 'react';

export const Logo: React.FC<{ className?: string; variant?: 'light' | 'dark' }> = ({ 
  className = "h-8 w-auto",
  variant = 'light'
}) => {
  const textColor = variant === 'dark' ? '#ffffff' : '#0f172a';

  return (
    <svg 
      viewBox="0 0 220 48" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg" 
      className={className}
    >
      {/* Speed lines on left of Q */}
      <path d="M 4 18 H 36 L 30 21 H 4 Z" fill="#2563eb" opacity="0.9" />
      <path d="M 1 24 H 40 L 34 27 H 1 Z" fill="#3b82f6" />
      <path d="M 6 30 H 34 L 28 33 H 6 Z" fill="#60a5fa" opacity="0.8" />

      {/* Italic stylized text for QuickR */}
      <text 
        x="32" 
        y="36" 
        fill={textColor} 
        fontFamily="system-ui, -apple-system, sans-serif"
        fontWeight="900" 
        fontStyle="italic" 
        fontSize="32"
        letterSpacing="-1.5px"
      >
        Quick<tspan fill="#2563eb">R</tspan>
      </text>
    </svg>
  );
};
