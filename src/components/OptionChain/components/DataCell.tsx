// components/OptionChain/components/DataCell.tsx

import React, { memo } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { FlashEntry, OISignal } from '../types';
import { TOOLTIPS, OI_SIGNAL_CONFIG } from '../constants';
import { formatCell } from '../utils/formatCell';
import { OIBar } from './OIBar';

interface DataCellProps {
  col: string;
  value: number;
  flash: FlashEntry | undefined;
  showOIBars: boolean;
  maxOI: number;
  side: 'ce' | 'pe';
  align: 'text-right' | 'text-left';
  /** SPEC-F2: OI signal badge (only for oiChg columns) */
  oiSignal?: OISignal;
  showOISignals: boolean;
}

export const DataCell = memo<DataCellProps>(function DataCell({
  col,
  value,
  flash,
  showOIBars,
  maxOI,
  side,
  align,
  oiSignal,
  showOISignals,
}) {
  const isLTP = col.endsWith('_ltp');
  const isChg = col.includes('oiChg');
  const isOI =
    col.endsWith('_oi') && !col.includes('Chg') && !col.includes('iv');

  // SPEC-B4: Animation restart is driven by key prop on <DataCell> in ChainRow.
  // The flash direction class is sufficient here.
  const flashCls = flash
    ? flash.direction === 'up' ? 'flash-up' : 'flash-dn'
    : '';

  const valCls = isLTP
    ? `font-bold ${side === 'ce' ? 'text-blue-300' : 'text-orange-300'} text-[11px]`
    : isChg
      ? value >= 0 ? 'text-emerald-400' : 'text-red-400'
      : 'text-gray-500';

  // SPEC-F7: IV color gradient
  const ivGradientStyle = col.includes('_iv') && Number.isFinite(value)
    ? getIVGradient(value)
    : undefined;

  // SPEC-F2: OI signal badge
  const signalCfg = isChg && showOISignals && oiSignal && oiSignal !== 'neutral'
    ? OI_SIGNAL_CONFIG[oiSignal]
    : null;

  return (
    <td
      className={`py-[3px] px-2 ${align} relative ${flashCls}`}
      role="gridcell"
      aria-label={`${TOOLTIPS[col] ?? col}: ${formatCell(col, value)}`}
      title={`${TOOLTIPS[col] ?? col}: ${value}`}
      style={ivGradientStyle}
    >
      {isOI && showOIBars && <OIBar value={value} max={maxOI} side={side} />}

      <span className={`relative z-10 mono ${valCls}`}>
        {isLTP && flash && (
          flash.direction === 'up' ? (
            <TrendingUp size={7} className="inline mr-0.5 text-emerald-400" aria-hidden="true" />
          ) : (
            <TrendingDown size={7} className="inline mr-0.5 text-red-400" aria-hidden="true" />
          )
        )}
        {formatCell(col, value)}

        {/* SPEC-F2: OI signal badge */}
        {signalCfg && (
          <span
            className={`text-[6px] ml-0.5 px-0.5 rounded ${signalCfg.bgColor} ${signalCfg.color}`}
            title={signalCfg.label}
          >
            {signalCfg.abbr}
          </span>
        )}
      </span>
    </td>
  );
});

/**
 * SPEC-F7: IV color gradient
 *
 * Maps IV values to a background opacity gradient.
 * Low IV (0-10%) → no tint
 * Medium IV (10-20%) → faint purple
 * High IV (20-40%+) → strong purple
 *
 * This adds meaning to existing cells without clutter.
 */
function getIVGradient(iv: number): React.CSSProperties | undefined {
  if (iv < 8) return undefined;

  // Normalize: 8% → 0, 40% → 1
  const t = Math.min(1, Math.max(0, (iv - 8) / 32));
  const opacity = t * 0.12;

  return {
    backgroundColor: `rgba(168, 85, 247, ${opacity})`,
  };
}
