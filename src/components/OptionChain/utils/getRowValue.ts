// components/OptionChain/utils/getRowValue.ts

import type { OptionRow } from '../../../types/index';

/**
 * Safely read a numeric property from an OptionRow by string key.
 * Returns 0 for missing, undefined, NaN, or Infinity values.
 *
 * This replaces unsafe `as keyof OptionRow` / `as number` casts
 * throughout the codebase with a single guarded accessor.
 */
export function getRowValue(row: OptionRow, col: string): number {
  const v = (row as unknown as Record<string, unknown>)[col];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
