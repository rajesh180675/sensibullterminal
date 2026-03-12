import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Position } from '../../types/index';
import { brokerGatewayClient } from '../../services/broker/brokerGatewayClient';
import { mapBreezePositions } from '../market/marketTransforms';
import { useNotificationStore } from '../../stores/notificationStore';
import { useSessionStore } from '../session/sessionStore';

interface PortfolioStoreValue {
  livePositions: Position[] | null;
  refreshPositions: () => Promise<void>;
}

const PortfolioStore = createContext<PortfolioStoreValue | null>(null);

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { notify } = useNotificationStore();
  const { session } = useSessionStore();
  const [livePositions, setLivePositions] = useState<Position[] | null>(null);

  const refreshPositions = useCallback(async () => {
    if (!session?.isConnected || !brokerGatewayClient.session.isBackend(session.proxyBase)) return;
    try {
      const result = await brokerGatewayClient.portfolio.fetchPositions(session);
      if (result.ok && result.data) {
        setLivePositions(mapBreezePositions(result.data));
      }
    } catch (error) {
      notify({
        title: 'Portfolio refresh failed',
        message: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    }
  }, [session, notify]);

  const value = useMemo(() => ({ livePositions, refreshPositions }), [livePositions, refreshPositions]);
  return <PortfolioStore.Provider value={value}>{children}</PortfolioStore.Provider>;
}

export function usePortfolioStore() {
  const context = useContext(PortfolioStore);
  if (!context) throw new Error('usePortfolioStore must be used within PortfolioProvider');
  return context;
}
