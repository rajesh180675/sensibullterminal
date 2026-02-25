// components/OptionChain/hooks/useChainStats.ts

import { useMemo } from 'react';
import type { OptionRow } from '../../../types/index';
import type { SymbolCode } from '../../../types/index';
import type { ChainStats } from '../types';
import { SYMBOL_CONFIG } from '../../../config/market';
import { computeMaxPain } from '../utils/computeMaxPain';

/**
 * SPEC-B1 integrated: Uses computeMaxPain() instead of naive rounding.
 * SPEC-F3 integrated: Computes ATM straddle premium + expected move.
 *
 * Single-pass derivation of every aggregate stat, plus O(n²) max pain.
 * Total cost for 80 strikes: ~6500 operations — trivial for useMemo.
 */
export function useChainStats(
  data: ReadonlyArray<OptionRow>,
  spotPrice: number,
  symbol: SymbolCode,
): ChainStats {
  return useMemo(() => {
    const cfg = SYMBOL_CONFIG[symbol];

    const empty: ChainStats = {
      maxOI: 1,
      totalCeOI: 0,
      totalPeOI: 0,
      pcr: 'N/A',
      pcrNumeric: 0,
      maxPain: 0,
      atmRow: undefined,
      maxCeOIStrike: 0,
      maxPeOIStrike: 0,
      totalCeVolume: 0,
      totalPeVolume: 0,
      atmStraddlePremium: 0,
      expectedMovePercent: 0,
    };

    if (!cfg || data.length === 0) return empty;

    let maxOI = 1;
    let totalCeOI = 0;
    let totalPeOI = 0;
    let totalCeVol = 0;
    let totalPeVol = 0;
    let peakCeOI = 0;
    let peakPeOI = 0;
    let maxCeOIStrike = 0;
    let maxPeOIStrike = 0;
    let atmRow: OptionRow | undefined;

    for (const row of data) {
      totalCeOI += row.ce_oi;
      totalPeOI += row.pe_oi;
      totalCeVol += row.ce_volume;
      totalPeVol += row.pe_volume;

      if (row.ce_oi > peakCeOI) {
        peakCeOI = row.ce_oi;
        maxCeOIStrike = row.strike;
      }
      if (row.pe_oi > peakPeOI) {
        peakPeOI = row.pe_oi;
        maxPeOIStrike = row.strike;
      }

      const localMax = Math.max(row.ce_oi, row.pe_oi);
      if (localMax > maxOI) maxOI = localMax;

      if (row.isATM) atmRow = row;
    }

    const pcrNum = totalCeOI > 0 ? totalPeOI / totalCeOI : 0;

    // SPEC-B1: True max pain
    const maxPain = computeMaxPain(data);

    // SPEC-F3: ATM straddle premium
    const atmStraddlePremium = atmRow
      ? atmRow.ce_ltp + atmRow.pe_ltp
      : 0;
    const expectedMovePercent =
      spotPrice > 0 && atmStraddlePremium > 0
        ? (atmStraddlePremium / spotPrice) * 100
        : 0;

    return {
      maxOI,
      totalCeOI,
      totalPeOI,
      pcr: totalCeOI > 0 ? pcrNum.toFixed(2) : 'N/A',
      pcrNumeric: pcrNum,
      maxPain,
      atmRow,
      maxCeOIStrike,
      maxPeOIStrike,
      totalCeVolume: totalCeVol,
      totalPeVolume: totalPeVol,
      atmStraddlePremium,
      expectedMovePercent,
    };
  }, [data, spotPrice, symbol]);
}
