import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { BreezeSession } from '../../types/index';
import { brokerGatewayClient, type BrokerCapabilities, type BrokerHealthSnapshot } from '../../services/broker/brokerGatewayClient';
import { useNotificationStore } from '../../stores/notificationStore';
import type { WsStatus } from '../../utils/breezeWs';

interface SessionStoreValue {
  session: BreezeSession | null;
  showConnectionCenter: boolean;
  wsStatus: WsStatus;
  statusMessage: string;
  capabilities: BrokerCapabilities;
  health: BrokerHealthSnapshot;
  isLive: boolean;
  openConnectionCenter: () => void;
  closeConnectionCenter: () => void;
  connectSession: (session: BreezeSession) => Promise<void>;
  disconnectSession: () => void;
  setWsStatus: (status: WsStatus) => void;
  setStatusMessage: (message: string) => void;
  refreshHealth: () => Promise<void>;
}

const SessionStore = createContext<SessionStoreValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { notify } = useNotificationStore();
  const [session, setSession] = useState<BreezeSession | null>(null);
  const [showConnectionCenter, setShowConnectionCenter] = useState(false);
  const [wsStatus, setWsStatusState] = useState<WsStatus>('disconnected');
  const [statusMessage, setStatusMessage] = useState('Demo mode');
  const [health, setHealth] = useState<BrokerHealthSnapshot>({
    backendReachable: false,
    backendMessage: 'Disconnected',
    backendConnected: false,
    streamStatus: 'disconnected',
  });

  const capabilities = useMemo(() => brokerGatewayClient.session.capabilities(session), [session]);
  const isLive = !!session?.isConnected;

  useEffect(() => {
    const token = brokerGatewayClient.session.extractApiSession();
    if (token) setShowConnectionCenter(true);
  }, []);

  const refreshHealth = useCallback(async () => {
    const next = await brokerGatewayClient.session.checkHealth(session, wsStatus);
    setHealth(next);
  }, [session, wsStatus]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const setWsStatus = useCallback((status: WsStatus) => {
    setWsStatusState(status);
    setHealth((current) => ({ ...current, streamStatus: status }));
  }, []);

  const connectSession = useCallback(async (nextSession: BreezeSession) => {
    brokerGatewayClient.session.setAuthToken(nextSession.backendAuthToken);
    setSession(nextSession);
    setShowConnectionCenter(false);
    setStatusMessage('Connected. Initializing broker workspace...');
    notify({
      title: 'Session connected',
      message: nextSession.proxyBase,
      tone: 'success',
    });
  }, [notify]);

  const disconnectSession = useCallback(() => {
    brokerGatewayClient.session.setAuthToken(undefined);
    setSession(null);
    setWsStatusState('disconnected');
    setStatusMessage('Disconnected');
    notify({
      title: 'Session disconnected',
      message: 'Terminal returned to demo mode.',
      tone: 'warning',
    });
  }, [notify]);

  const value = useMemo<SessionStoreValue>(() => ({
    session,
    showConnectionCenter,
    wsStatus,
    statusMessage,
    capabilities,
    health,
    isLive,
    openConnectionCenter: () => setShowConnectionCenter(true),
    closeConnectionCenter: () => setShowConnectionCenter(false),
    connectSession,
    disconnectSession,
    setWsStatus,
    setStatusMessage,
    refreshHealth,
  }), [session, showConnectionCenter, wsStatus, statusMessage, capabilities, health, isLive, connectSession, disconnectSession, setWsStatus, refreshHealth]);

  return <SessionStore.Provider value={value}>{children}</SessionStore.Provider>;
}

export function useSessionStore() {
  const context = useContext(SessionStore);
  if (!context) throw new Error('useSessionStore must be used within SessionProvider');
  return context;
}
