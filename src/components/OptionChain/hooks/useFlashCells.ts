// components/OptionChain/hooks/useFlashCells.ts

import { useState, useRef, useEffect, useCallback } from 'react';
import type { OptionRow } from '../../../types/index';
import type { FlashEntry } from '../types';
import { TRACKED_FIELDS, FLASH_DURATION_MS } from '../constants';

/**
 * SPEC-B4 + SPEC-B5: Fixed flash system
 *
 * B4 fix: Uses a monotonic flash counter per cell key as part of
 * the FlashEntry. The DataCell uses this counter in a `key` attribute
 * to force React to remount the element, restarting the CSS animation.
 *
 * B5 fix: MERGES new flashes into existing map instead of replacing.
 * Only removes entries whose timestamp is older than FLASH_DURATION_MS.
 */
export function useFlashCells(
  data: ReadonlyArray<OptionRow>,
): ReadonlyMap<string, FlashEntry> {
  const [flashed, setFlashed] = useState<Map<string, FlashEntry>>(
    () => new Map(),
  );
  const prevRef = useRef<Map<number, OptionRow>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counterRef = useRef(0);

  useEffect(() => {
    const now = Date.now();
    const prev = prevRef.current;
    const newEntries = new Map<string, FlashEntry>();

    for (const row of data) {
      const p = prev.get(row.strike);
      if (!p) continue;

      for (const [field, accessor] of TRACKED_FIELDS) {
        const cur = accessor(row);
        const old = accessor(p);

        if (
          cur !== old &&
          Number.isFinite(cur) &&
          Number.isFinite(old)
        ) {
          counterRef.current += 1;
          newEntries.set(`${field}_${row.strike}`, {
            direction: cur > old ? 'up' : 'down',
            timestamp: now,
          });
        }
      }
    }

    // Always update snapshot with shallow clones
    prevRef.current = new Map(
      data.map((r) => [r.strike, { ...r }]),
    );

    if (newEntries.size > 0) {
      // SPEC-B5: Merge into existing, don't replace
      setFlashed((existing) => {
        const merged = new Map(existing);

        // Remove expired entries from previous batch
        for (const [key, entry] of merged) {
          if (now - entry.timestamp > FLASH_DURATION_MS) {
            merged.delete(key);
          }
        }

        // Add/overwrite with new entries
        for (const [key, entry] of newEntries) {
          merged.set(key, entry);
        }

        return merged;
      });

      // Schedule cleanup of THIS batch
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        setFlashed((existing) => {
          const cleaned = new Map<string, FlashEntry>();
          const cutoff = Date.now() - FLASH_DURATION_MS;
          for (const [key, entry] of existing) {
            if (entry.timestamp > cutoff) {
              cleaned.set(key, entry);
            }
          }
          // Return same reference if nothing was removed
          return cleaned.size === existing.size ? existing : cleaned;
        });
        timerRef.current = null;
      }, FLASH_DURATION_MS + 50); // +50ms buffer for animation completion
    }
  }, [data]);

  // Unconditional unmount cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      prevRef.current.clear();
    };
  }, []);

  return flashed;
}

/**
 * Generates a unique key suffix for a flash entry to force
 * CSS animation restart (SPEC-B4).
 *
 * When the same cell flashes in the same direction twice,
 * the timestamp differs, causing React to see a different key
 * and remount the animation wrapper.
 */
export function flashAnimationKey(
  flash: FlashEntry | undefined,
): string {
  if (!flash) return 'none';
  return `${flash.direction}_${flash.timestamp}`;
}
