// components/OptionChain/components/StrikeCell.tsx

import React, { memo } from 'react';
import { Zap } from 'lucide-react';

interface StrikeCellProps {
  strike: number;
  isATM: boolean;
  isHighlighted: boolean;
  isMaxCeOI: boolean;
  isMaxPeOI: boolean;
}

export const StrikeCell = memo<StrikeCellProps>(function StrikeCell({
  strike,
  isATM,
  isHighlighted,
  isMaxCeOI,
  isMaxPeOI,
}) {
  return (
    <td
      className={`
        py-[3px] px-2 text-center font-bold text-[11px]
        bg-[#080b12]/30 border-x border-gray-800/20
        ${isATM ? 'text-yellow-400' : 'text-gray-300'}
      `}
      role="rowheader"
      aria-label={[
        `Strike ${strike}`,
        isATM && 'at the money',
        isHighlighted && 'in strategy',
        isMaxCeOI && 'max CE open interest (resistance)',
        isMaxPeOI && 'max PE open interest (support)',
      ]
        .filter(Boolean)
        .join(', ')}
    >
      <div className="flex flex-col items-center leading-tight">
        {isATM && (
          <span className="text-[7px] bg-yellow-500/12 text-yellow-500 px-1 rounded border border-yellow-500/20 mb-0.5 select-none">
            ATM
          </span>
        )}
        <span className="mono">{strike.toLocaleString('en-IN')}</span>
        <div className="flex items-center gap-0.5 mt-0.5 empty:hidden">
          {isHighlighted && <Zap size={7} className="text-blue-400" aria-label="In strategy" />}
          {isMaxCeOI && (
            <span className="text-[6px] text-blue-400 bg-blue-400/10 px-0.5 rounded" title="Highest CE OI — resistance">R</span>
          )}
          {isMaxPeOI && (
            <span className="text-[6px] text-orange-400 bg-orange-400/10 px-0.5 rounded" title="Highest PE OI — support">S</span>
          )}
        </div>
      </div>
    </td>
  );
});
