// components/OptionChain/components/EmptyState.tsx

import React, { memo } from 'react';
import { Target } from 'lucide-react';

interface EmptyStateProps {
  symbol: string;
  expiry: string;
}

export const EmptyState = memo<EmptyStateProps>(function EmptyState({ symbol, expiry }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16 text-gray-600"
         role="status" data-testid="chain-empty">
      <Target size={32} className="text-gray-700" />
      <p className="text-sm font-medium">No option chain data</p>
      <p className="text-xs text-gray-700">{symbol} · {expiry} — data may be unavailable or still loading.</p>
    </div>
  );
});
