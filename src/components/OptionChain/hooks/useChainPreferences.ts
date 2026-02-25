// components/OptionChain/hooks/useChainPreferences.ts

import { useState, useCallback } from 'react';
import type { ChainPreferences } from '../types';
import { PREFS_STORAGE_KEY, DEFAULT_PREFS } from '../constants';

/**
 * SPEC-F4: User Preference Persistence
 *
 * Reads/writes showGreeks, showOIBars, strikeRange, showOISignals
 * to localStorage. Gracefully handles:
 *   - Corrupted JSON
 *   - Missing localStorage (SSR, privacy mode)
 *   - Full localStorage quota
 *   - Partial stored data (merges with defaults)
 */
export function useChainPreferences(): [
  ChainPreferences,
  (patch: Partial<ChainPreferences>) => void,
] {
  const [prefs, setPrefs] = useState<ChainPreferences>(() => {
    try {
      const stored = localStorage.getItem(PREFS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Validate shape: only accept known keys with correct types
        return {
          showGreeks:
            typeof parsed.showGreeks === 'boolean'
              ? parsed.showGreeks
              : DEFAULT_PREFS.showGreeks,
          showOIBars:
            typeof parsed.showOIBars === 'boolean'
              ? parsed.showOIBars
              : DEFAULT_PREFS.showOIBars,
          strikeRange:
            typeof parsed.strikeRange === 'number' &&
            Number.isFinite(parsed.strikeRange)
              ? parsed.strikeRange
              : DEFAULT_PREFS.strikeRange,
          showOISignals:
            typeof parsed.showOISignals === 'boolean'
              ? parsed.showOISignals
              : DEFAULT_PREFS.showOISignals,
        };
      }
    } catch {
      // Corrupted or unavailable — use defaults
    }
    return { ...DEFAULT_PREFS };
  });

  const updatePrefs = useCallback(
    (patch: Partial<ChainPreferences>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        try {
          localStorage.setItem(
            PREFS_STORAGE_KEY,
            JSON.stringify(next),
          );
        } catch {
          // localStorage full or unavailable — silent fail
        }
        return next;
      });
    },
    [],
  );

  return [prefs, updatePrefs];
}
