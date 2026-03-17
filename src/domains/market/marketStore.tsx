import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SPOT_PRICES, MARKET_INDICES, SYMBOL_CONFIG, getExpiries } from '../../config/market';
import { generateChain, simulateTick } from '../../data/mock';
import { truthDescriptor, type TruthDescriptor } from '../../lib/truth';
import type {
  ExpiryDate,
  MarketDepthSnapshot,
  MarketIndex,
  OptionRow,
  SymbolCode,
  WatchlistItem,
} from '../../types/index';
import { brokerGatewayClient } from '../../services/broker/brokerGatewayClient';
import { terminalEventBus } from '../../services/streaming/eventBus';
import { UnifiedStreamingManager } from '../../services/streaming/unifiedStreamingManager';
import { useNotificationStore } from '../../stores/notificationStore';
import { useSpotPriceStore } from '../../state/market/spotPriceStore';
import type { BackendMarketDepth, HistoricalCandle } from '../../utils/kaggleClient';
import type { TickUpdate } from '../../utils/breezeWs';
import { useSessionStore } from '../session/sessionStore';
import {
  applyTicksToChain,
  deriveSpotFromMedian,
  mergeQuotesToChain,
  updateIndicesWithSpot,
} from './marketTransforms';
import { buildWatchlist } from './marketDerived';

interface MarketStoreValue {
  symbol: SymbolCode;
  expiry: ExpiryDate;
  availableExpiries: ExpiryDate[];
  chain: OptionRow[];
  spotPrice: number;
  lastUpdate: Date;
  spotTruth: TruthDescriptor;
  chainTruth: TruthDescriptor;
  isLoading: boolean;
  chainError: string | null;
  liveIndices: MarketIndex[];
  watchlist: WatchlistItem[];
  marketDepth: MarketDepthSnapshot;
  historical: HistoricalCandle[];
  chartInterval: string;
  isHistoricalLoading: boolean;
  setSymbol: (symbol: SymbolCode) => void;
  setExpiry: (expiry: ExpiryDate) => void;
  setChartInterval: (interval: string) => void;
  refreshMarket: () => Promise<void>;
  refreshHistorical: () => Promise<void>;
}

const DEFAULT_SYMBOL: SymbolCode = 'NIFTY';
const DEFAULT_INTERVAL = '5minute';
const streamingManager = new UnifiedStreamingManager();
const MarketStore = createContext<MarketStoreValue | null>(null);

function emptyDepth(source: MarketDepthSnapshot['source'] = 'unavailable'): MarketDepthSnapshot {
  return {
    bids: [],
    asks: [],
    spread: 0,
    imbalance: 0,
    updatedAt: Date.now(),
    source,
  };
}

function chartRange(interval: string) {
  const now = new Date();
  const from = new Date(now);
  if (interval === '1minute') from.setHours(now.getHours() - 1);
  else if (interval === '5minute') from.setHours(now.getHours() - 6);
  else if (interval === '30minute') from.setDate(now.getDate() - 4);
  else from.setDate(now.getDate() - 10);

  return {
    fromDate: from.toISOString().slice(0, 19).replace('T', ' '),
    toDate: now.toISOString().slice(0, 19).replace('T', ' '),
  };
}

function mergeHistorical(existing: HistoricalCandle[], incoming: HistoricalCandle[]) {
  const merged = new Map<string, HistoricalCandle>();
  for (const candle of existing) merged.set(candle.datetime, candle);
  for (const candle of incoming) merged.set(candle.datetime, candle);
  return Array.from(merged.values())
    .sort((left, right) => new Date(left.datetime).getTime() - new Date(right.datetime).getTime())
    .slice(-240);
}

function resolveFocalDepthContract(chain: OptionRow[], spotPrice: number) {
  if (chain.length === 0) return null;
  const nearest = chain.reduce((best, row) => (
    Math.abs(row.strike - spotPrice) < Math.abs(best.strike - spotPrice) ? row : best
  ));
  const useCall = nearest.ce_volume >= nearest.pe_volume;
  return {
    strikePrice: String(nearest.strike),
    right: useCall ? 'call' as const : 'put' as const,
    label: `${nearest.strike} ${useCall ? 'CE' : 'PE'}`,
  };
}

function normalizeDepth(depth: BackendMarketDepth | undefined, fallbackLabel: string): MarketDepthSnapshot {
  if (!depth) return emptyDepth();
  return {
    bids: (depth.bids ?? []).map((level) => ({
      price: level.price,
      quantity: level.quantity,
      orders: level.orders ?? 1,
    })),
    asks: (depth.asks ?? []).map((level) => ({
      price: level.price,
      quantity: level.quantity,
      orders: level.orders ?? 1,
    })),
    spread: depth.spread ?? 0,
    imbalance: depth.imbalance ?? 0,
    updatedAt: depth.updated_at ?? Date.now(),
    instrumentLabel: depth.instrument_label ?? fallbackLabel,
    contractKey: depth.contract_key,
    source: 'backend',
  };
}

export function MarketProvider({ children }: { children: React.ReactNode }) {
  const { notify } = useNotificationStore();
  const { session, setStatusMessage } = useSessionStore();
  const [symbol, setSymbolState] = useState<SymbolCode>(DEFAULT_SYMBOL);
  const [expiry, setExpiryState] = useState<ExpiryDate>(getExpiries(DEFAULT_SYMBOL)[0]);
  const [availableExpiries, setAvailableExpiries] = useState<ExpiryDate[]>(getExpiries(DEFAULT_SYMBOL));
  const [chain, setChain] = useState<OptionRow[]>(() => generateChain(DEFAULT_SYMBOL));
  const [spotPrice, setSpotPrice] = useState<number>(useSpotPriceStore.getState().getSpot(DEFAULT_SYMBOL));
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [spotTruth, setSpotTruth] = useState<TruthDescriptor>(() => truthDescriptor('analytical', 'mock_spot_seed'));
  const [chainTruth, setChainTruth] = useState<TruthDescriptor>(() => truthDescriptor('analytical', 'mock_chain_seed'));
  const [isLoading, setIsLoading] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [liveIndices, setLiveIndices] = useState<MarketIndex[]>(MARKET_INDICES);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [marketDepth, setMarketDepth] = useState<MarketDepthSnapshot>(() => emptyDepth());
  const [historical, setHistorical] = useState<HistoricalCandle[]>([]);
  const [chartInterval, setChartInterval] = useState(DEFAULT_INTERVAL);
  const [isHistoricalLoading, setIsHistoricalLoading] = useState(false);

  const currentChain = useRef<OptionRow[]>(chain);
  const currentSymbol = useRef<SymbolCode>(symbol);
  const currentInterval = useRef<string>(chartInterval);
  const demoTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const skipNextExpiryReload = useRef<string | null>(null);
  const lastDepthRefresh = useRef<number>(0);

  useEffect(() => { currentChain.current = chain; }, [chain]);
  useEffect(() => { currentSymbol.current = symbol; }, [symbol]);
  useEffect(() => { currentInterval.current = chartInterval; }, [chartInterval]);

  const updateSpot = useCallback((nextSpot: number, nextSymbol = currentSymbol.current, nextTruth?: TruthDescriptor) => {
    const accepted = useSpotPriceStore.getState().setSpot(nextSymbol, nextSpot);
    if (!accepted) return;
    setSpotPrice(nextSpot);
    if (nextTruth) {
      setSpotTruth(nextTruth);
    }
    const dayOpen = useSpotPriceStore.getState().dayOpens[nextSymbol];
    setLiveIndices((current) => updateIndicesWithSpot(current, nextSymbol, nextSpot, dayOpen));
  }, []);

  const refreshHistorical = useCallback(async () => {
    setIsHistoricalLoading(true);
    try {
      if (!session?.isConnected || !brokerGatewayClient.session.isBackend(session.proxyBase)) {
        setHistorical([]);
        return;
      }

      const { fromDate, toDate } = chartRange(currentInterval.current);
      const result = await brokerGatewayClient.market.fetchHistorical(currentSymbol.current, session, {
        interval: currentInterval.current,
        fromDate,
        toDate,
      });

      if (result.ok) {
        setHistorical(result.data);
        return;
      }

      setHistorical([]);
      notify({
        title: 'Historical unavailable',
        message: result.error || 'No backend historical candles were returned.',
        tone: 'warning',
      });
    } catch (error) {
      setHistorical([]);
      notify({
        title: 'Historical reload failed',
        message: error instanceof Error ? error.message : String(error),
        tone: 'warning',
      });
    } finally {
      setIsHistoricalLoading(false);
    }
  }, [notify, session]);

  const refreshMarketDepth = useCallback(async (
    force = false,
    options?: { sessionOverride?: NonNullable<typeof session>; symbolOverride?: SymbolCode; expiryOverride?: ExpiryDate; chainOverride?: OptionRow[]; spotOverride?: number },
  ) => {
    const activeSession = options?.sessionOverride ?? session;
    const activeSymbol = options?.symbolOverride ?? currentSymbol.current;
    const activeExpiry = options?.expiryOverride ?? expiry;
    const activeChain = options?.chainOverride ?? currentChain.current;
    const activeSpot = options?.spotOverride ?? useSpotPriceStore.getState().getSpot(activeSymbol);

    if (!activeSession?.isConnected || !brokerGatewayClient.session.isBackend(activeSession.proxyBase)) {
      setMarketDepth(emptyDepth());
      return;
    }

    const now = Date.now();
    if (!force && now - lastDepthRefresh.current < 12000) return;
    const focal = resolveFocalDepthContract(activeChain, activeSpot);
    if (!focal) {
      setMarketDepth(emptyDepth());
      return;
    }

    lastDepthRefresh.current = now;
    const result = await brokerGatewayClient.market.fetchMarketDepth(activeSymbol, activeSession, {
      expiryDate: activeExpiry.breezeValue,
      right: focal.right,
      strikePrice: focal.strikePrice,
    });

    if (result.ok && result.data) {
      setMarketDepth(normalizeDepth(result.data, `${activeSymbol} ${activeExpiry.label} ${focal.label}`));
      return;
    }

    setMarketDepth({
      ...emptyDepth(),
      instrumentLabel: `${activeSymbol} ${activeExpiry.label} ${focal.label}`,
    });
  }, [expiry.breezeValue, expiry.label, session]);

  const fetchAndSetSpot = useCallback(async (nextSymbol: SymbolCode, nextSession: NonNullable<typeof session>) => {
    const fallback = useSpotPriceStore.getState().getSpot(nextSymbol);
    try {
      const result = await brokerGatewayClient.market.fetchSpot(nextSymbol, nextSession);
      if (result.ok && result.spot && result.spot > 1000) {
        const spotStore = useSpotPriceStore.getState();
        if (!spotStore.dayOpens[nextSymbol]) {
          spotStore.setDayOpen(nextSymbol, result.spot);
        }
        updateSpot(result.spot, nextSymbol, truthDescriptor('broker', 'breeze_rest_spot'));
        return result.spot;
      }
    } catch {
      // fallback below
    }
    updateSpot(fallback, nextSymbol, truthDescriptor('analytical', 'static_spot_seed'));
    return fallback;
  }, [updateSpot]);

  const fetchLiveExpiries = useCallback(async (nextSymbol: SymbolCode, nextSession: NonNullable<typeof session>) => {
    if (!brokerGatewayClient.session.isBackend(nextSession.proxyBase)) {
      const staticExpiries = getExpiries(nextSymbol);
      setAvailableExpiries(staticExpiries);
      return staticExpiries;
    }

    try {
      const result = await brokerGatewayClient.market.fetchExpiries(nextSymbol, nextSession);
      if (result.ok && result.expiries.length > 0) {
        const liveExpiries = result.expiries.map((item) => ({
          label: item.label || item.date,
          breezeValue: item.date,
          daysToExpiry: item.days_away,
        }));
        setAvailableExpiries(liveExpiries);
        return liveExpiries;
      }
    } catch {
      // fallback below
    }

    const fallback = getExpiries(nextSymbol);
    setAvailableExpiries(fallback);
    return fallback;
  }, []);

  const handleTickUpdate = useCallback((update: TickUpdate) => {
    const activeSpot = useSpotPriceStore.getState().getSpot(currentSymbol.current);
    const updatedChain = applyTicksToChain(
      currentChain.current,
      update.ticks,
      activeSpot,
      expiry.daysToExpiry,
    );
    setChain(updatedChain);
    currentChain.current = updatedChain;
    setLastUpdate(new Date());
    setChainTruth(truthDescriptor('normalized', 'breeze_ws_accumulated', update.ts));

    const nextSymbol = currentSymbol.current;
    const broadcastSpot = update.spot_prices?.[nextSymbol] ?? update.spot_prices?.NIFTY;
    if (broadcastSpot && broadcastSpot > 1000) {
      const currentSpot = useSpotPriceStore.getState().getSpot(nextSymbol);
      const diff = Math.abs(broadcastSpot - currentSpot);
      if (diff < currentSpot * 0.15) {
        if (diff > 0.5) updateSpot(broadcastSpot, nextSymbol, truthDescriptor('broker', 'breeze_ws_spot', update.ts));
      }
    } else {
      const derivedSpot = deriveSpotFromMedian(updatedChain);
      if (derivedSpot && derivedSpot > 1000) {
        const currentSpot = useSpotPriceStore.getState().getSpot(nextSymbol);
        const diff = Math.abs(derivedSpot - currentSpot);
        if (diff > 1 && diff < currentSpot * 0.15) {
          updateSpot(derivedSpot, nextSymbol, truthDescriptor('normalized', 'put_call_parity', update.ts));
        }
      }
    }

    const streamedCandles = update.candle_streams?.[nextSymbol]?.[currentInterval.current];
    if (streamedCandles && streamedCandles.length > 0) {
      setHistorical((current) => mergeHistorical(current, streamedCandles));
    }
  }, [expiry.daysToExpiry, updateSpot]);

  const fetchLiveChain = useCallback(async (
    nextSymbol: SymbolCode,
    nextExpiry: ExpiryDate,
    nextSession: NonNullable<typeof session>,
    nextSpot: number,
  ) => {
    if (!brokerGatewayClient.session.isBackend(nextSession.proxyBase)) return;
    setIsLoading(true);
    setChainError(null);
    setStatusMessage('Fetching option chain snapshot...');

    try {
      const [calls, puts] = await Promise.all([
        brokerGatewayClient.market.fetchOptionSide(nextSymbol, nextExpiry.breezeValue, 'Call', nextSession),
        brokerGatewayClient.market.fetchOptionSide(nextSymbol, nextExpiry.breezeValue, 'Put', nextSession),
      ]);

      const merged = mergeQuotesToChain(
        calls.data ?? [],
        puts.data ?? [],
        nextSpot,
        SYMBOL_CONFIG[nextSymbol].strikeStep,
        nextExpiry.daysToExpiry,
      );

      if (merged.length > 0) {
        setChain(merged);
        currentChain.current = merged;
        setLastUpdate(new Date());
        setChainTruth(truthDescriptor('normalized', 'breeze_rest_snapshot'));
        setStatusMessage(`Loaded ${merged.length} strikes. Subscribing live stream...`);

        const subscription = await brokerGatewayClient.market.subscribeOptionChain(
          nextSymbol,
          nextExpiry.breezeValue,
          merged.map((row) => row.strike),
          nextSession,
        );

        setStatusMessage(subscription.ok
          ? `Live subscription active for ${subscription.subscribed ?? 0} feeds`
          : `Snapshot loaded. Stream subscribe failed: ${subscription.error}`);

        await refreshMarketDepth(true, {
          sessionOverride: nextSession,
          symbolOverride: nextSymbol,
          expiryOverride: nextExpiry,
          chainOverride: merged,
          spotOverride: nextSpot,
        });
      } else {
        setStatusMessage('No option chain data returned.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setChainError(message);
      setStatusMessage(message);
      notify({
        title: 'Option chain load failed',
        message,
        tone: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  }, [notify, refreshMarketDepth, setStatusMessage]);

  const initializeLiveSession = useCallback(async (nextSymbol: SymbolCode, nextSession: NonNullable<typeof session>) => {
    if (!brokerGatewayClient.session.isBackend(nextSession.proxyBase)) {
      if (demoTickRef.current) {
        clearInterval(demoTickRef.current);
        demoTickRef.current = null;
      }
      streamingManager.disconnect();
      const staticExpiries = getExpiries(nextSymbol);
      setAvailableExpiries(staticExpiries);
      setExpiryState(staticExpiries[0]);
      updateSpot(DEFAULT_SPOT_PRICES[nextSymbol], nextSymbol, truthDescriptor('analytical', 'static_spot_seed'));
      setChain(generateChain(nextSymbol));
      setChainTruth(truthDescriptor('analytical', 'mock_chain_seed'));
      setHistorical([]);
      setMarketDepth(emptyDepth());
      setChainError(null);
      setLastUpdate(new Date());
      setStatusMessage('Browser-direct session connected. Backend-native depth and candles are unavailable.');
      return;
    }

    const liveSpot = await fetchAndSetSpot(nextSymbol, nextSession);
    const expiries = await fetchLiveExpiries(nextSymbol, nextSession);
    const firstExpiry = expiries[0];
    if (firstExpiry) {
      skipNextExpiryReload.current = firstExpiry.breezeValue;
      setExpiryState(firstExpiry);
      await fetchLiveChain(nextSymbol, firstExpiry, nextSession, liveSpot);
    }

    await refreshHistorical();

    streamingManager.connect(nextSession.proxyBase);
    setStatusMessage('Connecting live market stream...');
  }, [fetchAndSetSpot, fetchLiveExpiries, fetchLiveChain, refreshHistorical, setStatusMessage, updateSpot]);

  useEffect(() => terminalEventBus.on('stream:tick', handleTickUpdate), [handleTickUpdate]);

  useEffect(() => terminalEventBus.on('stream:status', ({ status, transport }) => {
      if (transport === 'system' && status === 'disconnected') return;
      setStatusMessage(
        status === 'connected'
          ? transport === 'polling'
            ? 'REST polling fallback active for market data'
            : 'Streaming live market data and candles'
          : status === 'reconnecting'
            ? 'Reconnecting market stream'
            : status === 'error'
              ? 'WebSocket unavailable. REST polling fallback active.'
              : 'Market stream disconnected'
      );
  }), [setStatusMessage]);

  const resetToDemo = useCallback((nextSymbol: SymbolCode) => {
    streamingManager.disconnect();
    if (demoTickRef.current) clearInterval(demoTickRef.current);
    const expiries = getExpiries(nextSymbol);
    setAvailableExpiries(expiries);
    setExpiryState(expiries[0]);
    updateSpot(DEFAULT_SPOT_PRICES[nextSymbol], nextSymbol, truthDescriptor('analytical', 'mock_spot_seed'));
    setChain(generateChain(nextSymbol));
    setChainTruth(truthDescriptor('analytical', 'mock_chain_seed'));
    setHistorical([]);
    setMarketDepth(emptyDepth());
    setChainError(null);
    setLastUpdate(new Date());
    demoTickRef.current = setInterval(() => {
      setChain((current) => simulateTick(current));
      setChainTruth(truthDescriptor('analytical', 'mock_tick_simulation'));
      setLastUpdate(new Date());
    }, 2500);
  }, [updateSpot]);

  useEffect(() => {
    currentSymbol.current = symbol;
    if (!session?.isConnected) {
      resetToDemo(symbol);
      return;
    }

    void initializeLiveSession(symbol, session);

    return () => {
      if (demoTickRef.current) {
        clearInterval(demoTickRef.current);
        demoTickRef.current = null;
      }
    };
  }, [symbol, session, initializeLiveSession, resetToDemo]);

  useEffect(() => () => {
    streamingManager.disconnect();
    if (demoTickRef.current) clearInterval(demoTickRef.current);
  }, []);

  useEffect(() => {
    setWatchlist((current) => buildWatchlist(symbol, spotPrice, current));
  }, [spotPrice, symbol]);

  useEffect(() => {
    void refreshHistorical();
  }, [refreshHistorical, chartInterval, symbol]);

  useEffect(() => {
    if (!session?.isConnected || !brokerGatewayClient.session.isBackend(session.proxyBase)) return;
    void refreshMarketDepth(true);
  }, [expiry.breezeValue, refreshMarketDepth, session, symbol]);

  useEffect(() => {
    if (!session?.isConnected || !brokerGatewayClient.session.isBackend(session.proxyBase)) return;
    const timer = setInterval(() => {
      void refreshMarketDepth();
    }, 15000);
    return () => clearInterval(timer);
  }, [refreshMarketDepth, session]);

  const refreshMarket = useCallback(async () => {
    if (!session?.isConnected) {
      setChain(generateChain(symbol, spotPrice));
      setChainTruth(truthDescriptor('analytical', 'mock_chain_seed'));
      setHistorical([]);
      setMarketDepth(emptyDepth());
      setLastUpdate(new Date());
      return;
    }

    if (!brokerGatewayClient.session.isBackend(session.proxyBase)) {
      setChain(generateChain(symbol, spotPrice));
      setChainTruth(truthDescriptor('analytical', 'mock_chain_seed'));
      setHistorical([]);
      setMarketDepth(emptyDepth());
      setLastUpdate(new Date());
      setStatusMessage('Browser-direct mode refreshed from static market seed.');
      return;
    }

    const liveSpot = await fetchAndSetSpot(symbol, session);
    await fetchLiveChain(symbol, expiry, session, liveSpot);
    await Promise.all([refreshHistorical(), refreshMarketDepth(true)]);
  }, [session, symbol, spotPrice, expiry, fetchAndSetSpot, fetchLiveChain, refreshHistorical, refreshMarketDepth, setStatusMessage]);

  useEffect(() => {
    if (!session?.isConnected || !brokerGatewayClient.session.isBackend(session.proxyBase)) return;
    if (skipNextExpiryReload.current === expiry.breezeValue) {
      skipNextExpiryReload.current = null;
      return;
    }
    void fetchLiveChain(symbol, expiry, session, useSpotPriceStore.getState().getSpot(symbol));
  }, [expiry.breezeValue, fetchLiveChain, session, symbol, expiry]);

  const value = useMemo(() => ({
    symbol,
    expiry,
    availableExpiries,
    chain,
    spotPrice,
    lastUpdate,
    spotTruth,
    chainTruth,
    isLoading,
    chainError,
    liveIndices,
    watchlist,
    marketDepth,
    historical,
    chartInterval,
    isHistoricalLoading,
    setSymbol: setSymbolState,
    setExpiry: setExpiryState,
    setChartInterval,
    refreshMarket,
    refreshHistorical,
  }), [
    symbol,
    expiry,
    availableExpiries,
    chain,
    spotPrice,
    lastUpdate,
    spotTruth,
    chainTruth,
    isLoading,
    chainError,
    liveIndices,
    watchlist,
    marketDepth,
    historical,
    chartInterval,
    isHistoricalLoading,
    refreshMarket,
    refreshHistorical,
  ]);

  return <MarketStore.Provider value={value}>{children}</MarketStore.Provider>;
}

export function useMarketStore() {
  const context = useContext(MarketStore);
  if (!context) throw new Error('useMarketStore must be used within MarketProvider');
  return context;
}
