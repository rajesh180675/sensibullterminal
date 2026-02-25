// components/OptionChain/hooks/useColumnSort.ts

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { OptionRow, ExpiryDate, SymbolCode } from '../../../types/index';
import type { SortState, SortableColumn } from '../types';
import { getRowValue } from '../utils/getRowValue';

/**
 * SPEC-F1: Column Sorting
 *
 * Toggle behavior:
 *   1st click: desc (highest first — natural for OI/volume)
 *   2nd click: asc
 *   3rd click: reset to natural strike order
 *
 * Auto-resets when symbol or expiry changes.
 */
export function useColumnSort(
  data: OptionRow[],
  symbol: SymbolCode,
  expiryValue: string,
): {
  sortedData: OptionRow[];
  sortState: SortState;
  toggleSort: (col: SortableColumn) => void;
  resetSort: () => void;
} {
  const [sortState, setSortState] = useState<SortState>({
    column: null,
    direction: 'desc',
  });

  // Auto-reset on symbol/expiry change
  const prevSymbol = useRef(symbol);
  const prevExpiry = useRef(expiryValue);

  useEffect(() => {
    if (prevSymbol.current !== symbol || prevExpiry.current !== expiryValue) {
      setSortState({ column: null, direction: 'desc' });
      prevSymbol.current = symbol;
      prevExpiry.current = expiryValue;
    }
  }, [symbol, expiryValue]);

  const toggleSort = useCallback((col: SortableColumn) => {
    setSortState((prev) => {
      if (prev.column !== col) {
        return { column: col, direction: 'desc' };
      }
      if (prev.direction === 'desc') {
        return { column: col, direction: 'asc' };
      }
      // Third click: reset to natural order
      return { column: null, direction: 'desc' };
    });
  }, []);

  const resetSort = useCallback(() => {
    setSortState({ column: null, direction: 'desc' });
  }, []);

  const sortedData = useMemo(() => {
    if (!sortState.column) return data;

    const col = sortState.column;
    const dir = sortState.direction === 'asc' ? 1 : -1;

    return [...data].sort((a, b) => {
      const av = getRowValue(a, col);
      const bv = getRowValue(b, col);
      return (av - bv) * dir;
    });
  }, [data, sortState]);

  return { sortedData, sortState, toggleSort, resetSort };
}
