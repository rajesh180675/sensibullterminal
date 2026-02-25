// components/OptionChain/hooks/useStalenessTimer.ts

import { useState, useEffect } from 'react';
import { STALE_THRESHOLD_SEC, STALE_CHECK_INTERVAL_MS } from '../constants';

/**
 * SPEC-B2: Autonomous Staleness Timer
 *
 * Returns the number of seconds since lastUpdate,
 * re-rendering the consumer every intervalMs.
 *
 * Fixes the bug where staleness warning never appeared
 * because nothing triggered a re-render when time passed.
 */
export function useStalenessTimer(
  lastUpdate: Date,
  thresholdSec: number = STALE_THRESHOLD_SEC,
  intervalMs: number = STALE_CHECK_INTERVAL_MS,
): number {
  const [staleSec, setStaleSec] = useState(() =>
    Math.floor((Date.now() - lastUpdate.getTime()) / 1000),
  );

  useEffect(() => {
    const compute = () =>
      Math.floor((Date.now() - lastUpdate.getTime()) / 1000);

    // Immediately update on lastUpdate change
    setStaleSec(compute());

    // Tick periodically
    const id = setInterval(() => {
      setStaleSec(compute());
    }, intervalMs);

    return () => clearInterval(id);
  }, [lastUpdate, intervalMs]);

  return staleSec;
}
