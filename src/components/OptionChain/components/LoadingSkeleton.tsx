// components/OptionChain/components/LoadingSkeleton.tsx

import React, { memo } from 'react';

export const LoadingSkeleton = memo(function LoadingSkeleton() {
  return (
    <div className="flex-1 overflow-hidden px-2 py-3" role="status" aria-label="Loading option chain">
      <div className="space-y-1.5">
        {Array.from({ length: 15 }, (_, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className="h-5 bg-gray-800/40 rounded animate-pulse flex-1" />
            <div className="h-5 w-20 bg-gray-700/30 rounded animate-pulse" />
            <div className="h-5 bg-gray-800/40 rounded animate-pulse flex-1" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading option chain data…</span>
    </div>
  );
});
