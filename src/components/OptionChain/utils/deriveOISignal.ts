// components/OptionChain/utils/deriveOISignal.ts

import type { OISignal } from '../types';
import { OI_SIGNAL_THRESHOLD } from '../constants';

/**
 * SPEC-F2: OI Interpretation Signal
 *
 * Derives a trading signal from the 2x2 matrix of:
 *   OI direction (up/down) × Price direction (up/down)
 *
 * ┌──────────────┬──────────────────┬──────────────────┐
 * │              │ Price ↑          │ Price ↓          │
 * ├──────────────┼──────────────────┼──────────────────┤
 * │ OI ↑         │ Long Buildup     │ Short Buildup    │
 * │              │ (Bullish)        │ (Bearish)        │
 * ├──────────────┼──────────────────┼──────────────────┤
 * │ OI ↓         │ Short Covering   │ Long Unwinding   │
 * │              │ (Bullish-weak)   │ (Bearish-weak)   │
 * └──────────────┴──────────────────┴──────────────────┘
 *
 * @param oiChange - Change in OI from previous close
 * @param priceChange - Change in LTP from previous close
 * @param threshold - Minimum absolute OI change to be "significant"
 * @returns The OI signal classification
 */
export function deriveOISignal(
  oiChange: number,
  priceChange: number,
  threshold: number = OI_SIGNAL_THRESHOLD,
): OISignal {
  // Guard: non-finite inputs → neutral
  if (!Number.isFinite(oiChange) || !Number.isFinite(priceChange)) {
    return 'neutral';
  }

  // Below threshold → not significant
  if (Math.abs(oiChange) < threshold) {
    return 'neutral';
  }

  const oiUp = oiChange > 0;
  const priceUp = priceChange > 0;

  if (oiUp && priceUp) return 'long_buildup';
  if (oiUp && !priceUp) return 'short_buildup';
  if (!oiUp && priceUp) return 'short_covering';
  return 'long_unwinding';
}

/**
 * Check whether an OptionRow has the required fields for OI signal derivation.
 * The component gracefully degrades when these fields are absent.
 */
export function hasOISignalData(row: unknown): boolean {
  const r = row as Record<string, unknown>;
  return (
    typeof r.ce_oiChg === 'number' &&
    typeof r.pe_oiChg === 'number' &&
    // Price change fields — may not exist in all data sources
    (typeof r.ce_ltpChg === 'number' || typeof r.pe_ltpChg === 'number')
  );
}
