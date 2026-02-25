// components/OptionChain/hooks/useFilteredData.ts

import { useMemo } from 'react';
import type { OptionRow, SymbolCode } from '../../../types/index';
import { SYMBOL_CONFIG } from '../../../config/market';

/**
 * Filters rows to ±N strikes around ATM.
 * Returns the original array reference when range ≤ 0 (no copy).
 */
export function useFilteredData(
  data: ReadonlyArray<OptionRow>,
  range: number,
  spotPrice: number,
  symbol: SymbolCode,
): OptionRow[] {
  return useMemo(() => {
    if (range <= 0 || data.length === 0) {
      return data as OptionRow[];
    }

    const cfg = SYMBOL_CONFIG[symbol];
    if (!cfg) return data as OptionRow[];

    const step = cfg.strikeStep || 1;
    const atm = Math.round(spotPrice / step) * step;
    const half = range * step;

    return data.filter(
      (r) => r.strike >= atm - half && r.strike <= atm + half,
    );
  }, [data, range, spotPrice, symbol]);
}
