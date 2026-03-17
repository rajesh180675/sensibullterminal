import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PortfolioSummary, Position } from '../../types/index';
import { useNotificationStore } from '../../stores/notificationStore';
import type { FundsData, OrderBookRow, TradeBookRow } from '../../utils/kaggleClient';
import {
  useFundsQuery,
  useOrdersQuery,
  usePositionsQuery,
  useTradesQuery,
} from '../../services/api/terminalQueryHooks';
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
  const positionsQuery = usePositionsQuery({
    session,
    canRefreshBrokerData: stream.canRefreshBrokerData,
  });
  const fundsQuery = useFundsQuery({
    session,
    canRefreshBrokerData: stream.canRefreshBrokerData,
  });
  const ordersQuery = useOrdersQuery({
    session,
    canRefreshBrokerData: stream.canRefreshBrokerData,
  });
  const tradesQuery = useTradesQuery({
    session,
    canRefreshBrokerData: stream.canRefreshBrokerData,
  });
  const livePositions = positionsQuery.data ?? [];
  const funds = fundsQuery.data ?? null;
  const orders = ordersQuery.data ?? [];
  const trades = tradesQuery.data ?? [];
  const isRefreshing = positionsQuery.isFetching || fundsQuery.isFetching || ordersQuery.isFetching || tradesQuery.isFetching;
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);

  useEffect(() => {
    setSelectedPosition((current) => livePositions.find((position) => position.id === current?.id) ?? livePositions[0] ?? null);
  }, [livePositions]);

  const refreshPortfolioSurface = useCallback(async () => {
    try {
      await Promise.all([
        positionsQuery.refetch(),
        fundsQuery.refetch(),
        ordersQuery.refetch(),
        tradesQuery.refetch(),
      ]);
    } catch (error) {
      notify({
        title: 'Portfolio refresh failed',
        message: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    }
  }, [fundsQuery, notify, ordersQuery, positionsQuery, tradesQuery]);

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
