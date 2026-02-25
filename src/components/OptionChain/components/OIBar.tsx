// components/OptionChain/components/OIBar.tsx

import React, { memo } from 'react';

interface OIBarProps {
  value: number;
  max: number;
  side: 'ce' | 'pe';
}

export const OIBar = memo<OIBarProps>(function OIBar({ value, max, side }) {
  const pct = Math.min(100, (Math.abs(value) / Math.max(max, 1)) * 100);
  if (pct < 0.5) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none overflow-hidden"
      aria-hidden="true"
    >
      <div
        className={`
          absolute inset-y-0 opacity-[0.12]
          transition-[width] duration-300 ease-out
          ${side === 'ce' ? 'right-0 bg-blue-400' : 'left-0 bg-orange-400'}
        `}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
});
