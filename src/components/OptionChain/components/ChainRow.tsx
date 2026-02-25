// components/OptionChain/components/ChainRow.tsx

import React, { memo, useCallback, useMemo } from 'react';
import type { OptionRow } from '../../../types/index';
import type { FlashEntry, OISignal } from '../types';
import { FLASH_FIELD_KEYS } from '../constants';
import { getRowValue } from '../utils/getRowValue';
import { deriveOISignal, hasOISignalData } from '../utils/deriveOISignal';
import { ActionButtons } from './ActionButtons';
import { DataCell } from './DataCell';
import { StrikeCell } from './StrikeCell';

interface ChainRowProps {
  row: OptionRow;
  ceCols: readonly string[];
  peCols: readonly string[];
  isATM: boolean;
  isHighlighted: boolean;
  isMaxCeOI: boolean;
  isMaxPeOI: boolean;
  showOIBars: boolean;
  showOISignals: boolean;
  maxOI: number;
  flashed: ReadonlyMap<string, FlashEntry>;
  onAddLeg: (strike: number, type: 'CE' | 'PE', action: 'BUY' | 'SELL') => void;
  rowIndex: number;
  focusedStrike: number | null;
  onFocusStrike: (s: number | null) => void;
}

export const ChainRow = memo<ChainRowProps>(
  function ChainRow({
    row, ceCols, peCols, isATM, isHighlighted, isMaxCeOI, isMaxPeOI,
    showOIBars, showOISignals, maxOI, flashed, onAddLeg, rowIndex,
    focusedStrike, onFocusStrike,
  }) {
    const isHovered = focusedStrike === row.strike;

    // Keyboard: B/S for CE, Shift+B/S for PE
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTableRowElement>) => {
        const key = e.key.toLowerCase();
        if (key !== 'b' && key !== 's') return;
        e.preventDefault();
        e.stopPropagation();
        const type: 'CE' | 'PE' = e.shiftKey ? 'PE' : 'CE';
        const action: 'BUY' | 'SELL' = key === 'b' ? 'BUY' : 'SELL';
        onAddLeg(row.strike, type, action);
      },
      [onAddLeg, row.strike],
    );

    // SPEC-F10: Double-click to add CE leg
    const handleDoubleClick = useCallback(() => {
      onAddLeg(row.strike, 'CE', 'BUY');
    }, [onAddLeg, row.strike]);

    // SPEC-F2: Derive OI signals
    const ceSignal: OISignal = useMemo(() => {
      if (!showOISignals) return 'neutral';
      const ltpChg = getRowValue(row, 'ce_ltpChg');
      if (ltpChg === 0 && !hasOISignalData(row)) return 'neutral';
      return deriveOISignal(row.ce_oiChg, ltpChg);
    }, [row, showOISignals]);

    const peSignal: OISignal = useMemo(() => {
      if (!showOISignals) return 'neutral';
      const ltpChg = getRowValue(row, 'pe_ltpChg');
      if (ltpChg === 0 && !hasOISignalData(row)) return 'neutral';
      return deriveOISignal(row.pe_oiChg, ltpChg);
    }, [row, showOISignals]);

    // Stable callbacks for ActionButtons (SPEC perf fix for #8)
    const buyCE = useCallback(() => onAddLeg(row.strike, 'CE', 'BUY'), [onAddLeg, row.strike]);
    const sellCE = useCallback(() => onAddLeg(row.strike, 'CE', 'SELL'), [onAddLeg, row.strike]);
    const buyPE = useCallback(() => onAddLeg(row.strike, 'PE', 'BUY'), [onAddLeg, row.strike]);
    const sellPE = useCallback(() => onAddLeg(row.strike, 'PE', 'SELL'), [onAddLeg, row.strike]);

    const bgClass = isATM
      ? 'bg-yellow-400/[0.035] border-yellow-700/20'
      : isHighlighted
        ? 'bg-blue-500/[0.055] border-blue-700/20'
        : isHovered
          ? 'bg-gray-700/[0.12] border-gray-700/20'
          : 'border-gray-800/20';

    return (
      <tr
        className={`border-b transition-colors duration-75 ${bgClass}
          focus-visible:outline focus-visible:outline-1
          focus-visible:outline-blue-500/50 focus-visible:-outline-offset-1`}
        onMouseEnter={() => onFocusStrike(row.strike)}
        onMouseLeave={() => onFocusStrike(null)}
        onFocus={() => onFocusStrike(row.strike)}
        onKeyDown={handleKeyDown}
        onDoubleClick={handleDoubleClick}
        tabIndex={0}
        role="row"
        aria-rowindex={rowIndex + 1}
        aria-selected={isHighlighted}
        data-strike={row.strike}
        data-atm={isATM || undefined}
        data-testid={`chain-row-${row.strike}`}
      >
        <ActionButtons visible={isHovered} onBuy={buyCE} onSell={sellCE} side="CE" strike={row.strike} />

        {ceCols.map((col) => (
          <DataCell
            key={col}
            col={col}
            value={getRowValue(row, col)}
            flash={flashed.get(`${col}_${row.strike}`)}
            showOIBars={showOIBars}
            maxOI={maxOI}
            side="ce"
            align="text-right"
            oiSignal={col === 'ce_oiChg' ? ceSignal : undefined}
            showOISignals={showOISignals}
          />
        ))}

        <StrikeCell
          strike={row.strike}
          isATM={isATM}
          isHighlighted={isHighlighted}
          isMaxCeOI={isMaxCeOI}
          isMaxPeOI={isMaxPeOI}
        />

        {peCols.map((col) => (
          <DataCell
            key={col}
            col={col}
            value={getRowValue(row, col)}
            flash={flashed.get(`${col}_${row.strike}`)}
            showOIBars={showOIBars}
            maxOI={maxOI}
            side="pe"
            align="text-left"
            oiSignal={col === 'pe_oiChg' ? peSignal : undefined}
            showOISignals={showOISignals}
          />
        ))}

        <ActionButtons visible={isHovered} onBuy={buyPE} onSell={sellPE} side="PE" strike={row.strike} />
      </tr>
    );
  },

  // Custom areEqual
  (prev, next) => {
    if (prev.row !== next.row) return false;
    if (prev.isATM !== next.isATM) return false;
    if (prev.isHighlighted !== next.isHighlighted) return false;
    if (prev.isMaxCeOI !== next.isMaxCeOI) return false;
    if (prev.isMaxPeOI !== next.isMaxPeOI) return false;
    if (prev.showOIBars !== next.showOIBars) return false;
    if (prev.showOISignals !== next.showOISignals) return false;
    if (prev.maxOI !== next.maxOI) return false;
    if (prev.ceCols !== next.ceCols) return false;
    if (prev.peCols !== next.peCols) return false;

    const wasHov = prev.focusedStrike === prev.row.strike;
    const nowHov = next.focusedStrike === next.row.strike;
    if (wasHov !== nowHov) return false;

    const s = prev.row.strike;
    const hadFlash = FLASH_FIELD_KEYS.some((k) => prev.flashed.has(`${k}_${s}`));
    const hasFlash = FLASH_FIELD_KEYS.some((k) => next.flashed.has(`${k}_${s}`));
    if (hadFlash !== hasFlash) return false;

    return true;
  },
);
