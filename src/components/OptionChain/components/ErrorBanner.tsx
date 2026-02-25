// components/OptionChain/components/ErrorBanner.tsx

import React, { memo } from 'react';
import { AlertCircle } from 'lucide-react';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

export const ErrorBanner = memo<ErrorBannerProps>(function ErrorBanner({ message, onRetry }) {
  return (
    <div className="mx-3 my-2 px-3 py-2 bg-red-900/20 border border-red-800/30 rounded-lg
                    flex items-center gap-2 text-red-400 text-xs"
         role="alert" data-testid="chain-error">
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1 truncate">{message}</span>
      {onRetry && (
        <button onClick={onRetry}
          className="px-2 py-0.5 bg-red-800/30 hover:bg-red-700/40 rounded text-[10px] font-medium
            transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400">
          Retry
        </button>
      )}
    </div>
  );
});
