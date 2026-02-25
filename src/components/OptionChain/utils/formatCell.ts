// components/OptionChain/utils/formatCell.ts

import { FORMATTERS } from '../constants';

/**
 * SPEC-A2: Registry-based cell formatter.
 *
 * O(1) hash lookup instead of sequential string matching.
 * Returns '—' for non-finite values (NaN, Infinity, undefined).
 *
 * To add a new column format:
 *   1. Add to FORMATTERS in constants.ts
 *   2. Done — no regex or .includes() changes needed
 */
export function formatCell(key: string, value: number): string {
  if (!Number.isFinite(value)) return '—';

  const fmt = FORMATTERS[key];
  if (fmt) return fmt(value);

  // Fallback for unknown columns
  return String(value);
}
