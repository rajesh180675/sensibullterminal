import React, { useEffect } from 'react';
import { Positions } from '../../components/Positions';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { useMarketStore } from '../../domains/market/marketStore';
import { usePortfolioStore } from '../../domains/portfolio/portfolioStore';
import { useSessionStore } from '../../domains/session/sessionStore';

export function PortfolioWorkspace({ onOpenStrategy }: { onOpenStrategy: () => void }) {
  const { livePositions, refreshPositions } = usePortfolioStore();
  const { loadPosition } = useExecutionStore();
  const { setSymbol } = useMarketStore();
  const { session, isLive } = useSessionStore();

  useEffect(() => {
    if (session?.isConnected) {
      void refreshPositions();
    }
  }, [session, refreshPositions]);

  return (
    <Positions
      onLoadToBuilder={(position) => {
        loadPosition(position);
        setSymbol(position.symbol);
        onOpenStrategy();
      }}
      livePositions={livePositions}
      isLive={isLive}
      session={session}
      onRefreshPositions={() => void refreshPositions()}
    />
  );
}
