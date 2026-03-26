import { useEffect, useState } from 'react';

interface FreshnessIndicatorProps {
  lastUpdated: number; // timestamp
  staleThresholdMs?: number;
}

export function FreshnessIndicator({ lastUpdated, staleThresholdMs = 3000 }: FreshnessIndicatorProps) {
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    const checkFreshness = () => {
      setIsStale(Date.now() - lastUpdated > staleThresholdMs);
    };
    checkFreshness();
    const interval = setInterval(checkFreshness, 500);
    return () => clearInterval(interval);
  }, [lastUpdated, staleThresholdMs]);

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex h-2 w-2 items-center justify-center">
        {!isStale && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 duration-[200ms]"></span>
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full transition-colors duration-200 ${
            isStale ? 'bg-rose-500' : 'bg-emerald-500'
          }`}
        ></span>
      </div>
      <span className="text-[10px] uppercase tracking-wider text-slate-500">
        {isStale ? 'Stale' : 'Live'}
      </span>
    </div>
  );
}
