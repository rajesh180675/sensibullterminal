// components/OptionChain/components/StalenessWarning.tsx

import React, { memo } from 'react';
import { AlertCircle } from 'lucide-react';

interface StalenessWarningProps {
  staleSec: number;
  canRefresh: boolean;
  onRefresh: () => void;
}

export const StalenessWarning = memo<StalenessWarningProps>(
  function StalenessWarning({ staleSec, canRefresh, onRefresh }) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 bg-amber-900/15 border-b border-amber-800/20
                      text-amber-400 text-[10px]"
           role="alert" aria-live="polite">
        <AlertCircle size={10} className="shrink-0" />
        <span>Data is {Math.floor(staleSec / 60)}m {staleSec % 60}s old.</span>
        <button onClick={onRefresh} disabled={!canRefresh}
          className="text-amber-300 underline hover:text-amber-200 disabled:opacity-40
            disabled:no-underline disabled:cursor-not-allowed text-[10px]">
          Refresh now
        </button>
      </div>
    );
  },
);
