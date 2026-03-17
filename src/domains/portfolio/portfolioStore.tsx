import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { getMockPositions } from '../../data/mock';
import type { PortfolioSummary, Position } from '../../types/index';
import { brokerGatewayClient } from '../../services/broker/brokerGatewayClient';
import { useNotificationStore } from '../../stores/notificationStore';
import type { FundsData, OrderBookRow, TradeBookRow } from '../../utils/kaggleClient';
import { mapBreezePositions } from '../market/marketTransforms';
import { useMarketStore } from '../market/marketStore';
import { useSessionStore } from '../session/sessionStore';

function derivePortfolioSummary(positions: Position[], funds: FundsData | null): PortfolioSummary {
  const totalMtm = positions.reduce((sum, position) => sum + position.mtmPnl, 0);
  const totalMaxProfit = positions.reduce((sum, position) => sum + position.maxProfit, 0);
  const totalMaxLoss = positions.reduce((sum, position) => sum + Math.abs(position.maxLoss), 0);
  const grossExposure = positions.reduce((sum, position) => (
    sum + position.legs.reduce((legsTotal, leg) => legsTotal + Math.abs(leg.currentPrice * leg.lots), 0)
  ), 0);
  const hedgedExposure = positions.reduce((sum, position) => (
    sum + Math.min(
      position.legs.filter((leg) => leg.action === 'BUY').reduce((legsTotal, leg) => legsTotal + leg.currentPrice * leg.lots, 0),
      position.legs.filter((leg) => leg.action === 'SELL').reduce((legsTotal, leg) => legsTotal + leg.currentPrice * leg.lots, 0),
    )
  ), 0);
  const availableFunds = Number(funds?.available_margin ?? funds?.cash_balance ?? 0);
  const marginUsed = Number(funds?.utilized_margin ?? 0);
  const marginUtilization = availableFunds + marginUsed === 0 ? 0 : marginUsed / (availableFunds + marginUsed);

  return {
    totalMtm,
    totalMaxProfit,
    totalMaxLoss,
    activePositions: positions.filter((position) => position.status === 'ACTIVE').length,
    winners: positions.filter((position) => position.mtmPnl >= 0).length,
    losers: positions.filter((position) => position.mtmPnl < 0).length,
    grossExposure,
    hedgedExposure,
    availableFunds,
    marginUsed,
    marginUtilization,
  };
}

interface PortfolioStoreValue {
  livePositions: Position[];
  selectedPosition: Position | null;
  funds: FundsData | null;
  orders: OrderBookRow[];
  trades: TradeBookRow[];
  summary: PortfolioSummary;
  isRefreshing: boolean;
  selectPosition: (position: Position | null) => void;
  refreshPositions: () => Promise<void>;
  refreshPortfolioSurface: () => Promise<void>;
}

const PortfolioStore = createContext<PortfolioStoreValue | null>(null);

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { notify } = useNotificationStore();
  const { session } = useSessionStore();
  const { stream } = useMarketStore();
  const [livePositions, setLivePositions] = useState<Position[]>(() => getMockPositions());
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(() => getMockPositions()[0] ?? null);
  const [funds, setFunds] = useState<FundsData | null>(null);
  const [orders, setOrders] = useState<OrderBookRow[]>([]);
  const [trades, setTrades] = useState<TradeBookRow[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshPortfolioSurface = useCallback(async () => {
    if (!stream.canRefreshBrokerData) {
      const mockPositions = getMockPositions();
      setLivePositions(mockPositions);
      setSelectedPosition((current) => current ?? mockPositions[0] ?? null);
      setFunds({
        cash_balance: 325000,
        utilized_margin: 84500,
        available_margin: 240500,
      });
      setOrders([]);
      setTrades([]);
      return;
    }

    if (!session?.isConnected || !brokerGatewayClient.session.isBackend(session.proxyBase)) {
      const mockPositions = getMockPositions();
      setLivePositions(mockPositions);
      setSelectedPosition((current) => current ?? mockPositions[0] ?? null);
      setFunds({
        cash_balance: 325000,
        utilized_margin: 84500,
        available_margin: 240500,
      });
      setOrders([]);
      setTrades([]);
      return;
    }

    setIsRefreshing(true);
    try {
      const [positionsResult, fundsResult, ordersResult, tradesResult] = await Promise.all([
        brokerGatewayClient.portfolio.fetchPositions(session),
        brokerGatewayClient.portfolio.fetchFunds(session),
        brokerGatewayClient.portfolio.fetchOrders(session),
        brokerGatewayClient.portfolio.fetchTrades(session),
      ]);

      if (positionsResult.ok && positionsResult.data) {
        const mapped = mapBreezePositions(positionsResult.data);
        setLivePositions(mapped);
        setSelectedPosition((current) => mapped.find((position) => position.id === current?.id) ?? mapped[0] ?? null);
      }
      if (fundsResult.ok && fundsResult.data) setFunds(fundsResult.data);
      if (ordersResult.ok) setOrders(ordersResult.data);
      if (tradesResult.ok) setTrades(tradesResult.data);
    } catch (error) {
      notify({
        title: 'Portfolio refresh failed',
        message: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [notify, session, stream.canRefreshBrokerData]);

  const refreshPositions = useCallback(async () => {
    await refreshPortfolioSurface();
  }, [refreshPortfolioSurface]);

  const summary = useMemo(() => derivePortfolioSummary(livePositions, funds), [livePositions, funds]);

  const value = useMemo(() => ({
    livePositions,
    selectedPosition,
    funds,
    orders,
    trades,
    summary,
    isRefreshing,
    selectPosition: setSelectedPosition,
    refreshPositions,
    refreshPortfolioSurface,
  }), [livePositions, selectedPosition, funds, orders, trades, summary, isRefreshing, refreshPositions, refreshPortfolioSurface]);

  return <PortfolioStore.Provider value={value}>{children}</PortfolioStore.Provider>;
}

export function usePortfolioStore() {
  const context = useContext(PortfolioStore);
  if (!context) throw new Error('usePortfolioStore must be used within PortfolioProvider');
  return context;
}
