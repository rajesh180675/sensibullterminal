// components/OptionChain/hooks/useScrollToATM.ts

import { useRef, useEffect, useCallback } from 'react';
import type { SymbolCode } from '../../../types/index';
import { SCROLL_DELAY_MS } from '../constants';

/**
 * SPEC-B3: Data-aware scroll-to-ATM
 *
 * Scrolls to the ATM row when:
 *   1. Symbol changes AND data is available
 *   2. Data transitions from empty → populated (initial load)
 *
 * Does NOT scroll on every data refresh — only on initial load
 * or symbol change. Returns a manual `scrollNow()` for the
 * toolbar button.
 */
export function useScrollToATM(
  symbol: SymbolCode,
  dataLength: number,
  containerRef: React.RefObject<HTMLDivElement | null>,
): () => void {
  const prevSymbolRef = useRef(symbol);
  const prevDataLenRef = useRef(dataLength);
  const hasScrolledRef = useRef(false);

  const scrollNow = useCallback(() => {
    const el = containerRef.current?.querySelector<HTMLElement>(
      'tr[data-atm="true"]',
    );
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [containerRef]);

  useEffect(() => {
    const symbolChanged = prevSymbolRef.current !== symbol;
    const dataJustLoaded =
      prevDataLenRef.current === 0 && dataLength > 0;

    if (symbolChanged) {
      hasScrolledRef.current = false;
      prevSymbolRef.current = symbol;
    }

    prevDataLenRef.current = dataLength;

    if (
      dataLength > 0 &&
      !hasScrolledRef.current &&
      (symbolChanged || dataJustLoaded)
    ) {
      // Small delay for DOM to settle after data render
      const timer = setTimeout(() => {
        scrollNow();
        hasScrolledRef.current = true;
      }, SCROLL_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [symbol, dataLength, scrollNow]);

  return scrollNow;
}
