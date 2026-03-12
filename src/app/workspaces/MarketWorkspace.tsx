import React from 'react';
import { OptionChain } from '../../components/OptionChain';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { useMarketStore } from '../../domains/market/marketStore';
import { useSessionStore } from '../../domains/session/sessionStore';

export function MarketWorkspace({ onOpenStrategy }: { onOpenStrategy: () => void }) {
  const {
    symbol,
    expiry,
    availableExpiries,
    chain,
    spotPrice,
    lastUpdate,
    isLoading,
    chainError,
    refreshMarket,
    setExpiry,
  } = useMarketStore();
  const { addLeg, legs } = useExecutionStore();
  const { isLive, statusMessage } = useSessionStore();

  const nearestStrikeDiff = chain.length > 0
    ? Math.min(...chain.map((row) => Math.abs(row.strike - spotPrice)))
    : Number.POSITIVE_INFINITY;

  const chainWithAtm = chain.map((row) => ({
    ...row,
    isATM: Math.abs(row.strike - spotPrice) === nearestStrikeDiff,
  }));

  return (
    <div className="relative flex h-full flex-col">
      <OptionChain
        symbol={symbol}
        data={chainWithAtm}
        spotPrice={spotPrice}
        selectedExpiry={expiry}
        onExpiryChange={setExpiry}
        onAddLeg={(leg) => {
          addLeg(leg);
          onOpenStrategy();
        }}
        highlightedStrikes={new Set(legs.map((leg) => leg.strike))}
        lastUpdate={lastUpdate}
        isLoading={isLoading}
        onRefresh={refreshMarket}
        isLive={isLive}
        loadingMsg={statusMessage}
        error={chainError}
        availableExpiries={availableExpiries}
      />

      {legs.length > 0 && (
        <div className="pointer-events-none absolute bottom-6 right-6">
          <button
            onClick={onOpenStrategy}
            className="pointer-events-auto rounded-2xl bg-orange-500 px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(249,115,22,0.35)] transition hover:bg-orange-400"
          >
            Review {legs.length} strategy legs
          </button>
        </div>
      )}
    </div>
  );
}
