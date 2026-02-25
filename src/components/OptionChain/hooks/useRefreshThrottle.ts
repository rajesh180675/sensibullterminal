// components/OptionChain/hooks/useRefreshThrottle.ts

import { useState, useRef, useEffect, useCallback } from 'react';
import { REFRESH_COOLDOWN_MS } from '../constants';

/**
 * Returns [canRefresh, startCooldown].
 * After startCooldown(), canRefresh is false for REFRESH_COOLDOWN_MS.
 */
export function useRefreshThrottle(
  isLoading: boolean,
): [boolean, () => void] {
  const [cooling, setCooling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(() => {
    setCooling(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCooling(false);
      timer.current = null;
    }, REFRESH_COOLDOWN_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return [!isLoading && !cooling, start];
}
