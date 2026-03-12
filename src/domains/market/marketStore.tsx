import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { MARKET_INDICES, SPOT_PRICES, SYMBOL_CONFIG, getExpiries } from '../../config/market';
import { generateChain, simulateTick } from '../../data/mock';
import type { ExpiryDate, MarketIndex, OptionRow, SymbolCode } from '../../types/index';
import type { TickUpdate } from '../../utils/breezeWs';
import { brokerGatewayClient } from '../../services/broker/brokerGatewayClient';
import { UnifiedStreamingManager } from '../../services/streaming/unifiedStreamingManager';
import { useNotificationStore } from '../../stores/notificationStore';
import { useSessionStore } from '../session/sessionStore';
import {
  applyTicksToChain,
  deriveSpotFromMedian,
  mergeQuotesToChain,
  updateIndicesWithSpot,
} from './marketTransforms';

interface MarketStoreValue {
  symbol: SymbolCode;
  expiry: ExpiryDate;
  availableExpiries: ExpiryDate[];
  chain: OptionRow[];
  spotPrice: number;
  lastUpdate: Date;
  isLoading: boolean;
  chainError: string | null;
  liveIndices: MarketIndex[];
  setSymbol: (symbol: SymbolCode) => void;
  setExpiry: (expiry: ExpiryDate) => void;
  refreshMarket: () => Promise<void>;
}

const DEFAULT_SYMBOL: SymbolCode = 'NIFTY';
const streamingManager = new UnifiedStreamingManager();
const MarketStore = createContext<MarketStoreValue | null>(null);

export function MarketProvider({ children }: { children: React.ReactNode }) {
  const { notify } = useNotificationStore();
  const { session, setStatusMessage, setWsStatus } = useSessionStore();
  const [symbol, setSymbolState] = useState<SymbolCode>(DEFAULT_SYMBOL);
  const [expiry, setExpiryState] = useState<ExpiryDate>(getExpiries(DEFAULT_SYMBOL)[0]);
  const [availableExpiries, setAvailableExpiries] = useState<ExpiryDate[]>(getExpiries(DEFAULT_SYMBOL));
  const [chain, setChain] = useState<OptionRow[]>(() => generateChain(DEFAULT_SYMBOL));
  const [spotPrice, setSpotPrice] = useState<number>(SPOT_PRICES[DEFAULT_SYMBOL]);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [liveIndices, setLiveIndices] = useState<MarketIndex[]>(MARKET_INDICES);

  const currentChain = useRef<OptionRow[]>(chain);
  const currentSymbol = useRef<SymbolCode>(symbol);
  const currentSpot = useRef<number>(spotPrice);
  const dayOpenBySymbol = useRef<Partial<Record<SymbolCode, number>>>({});
  const demoTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const skipNextExpiryReload = useRef<string | null>(null);

  useEffect(() => { currentChain.current = chain; }, [chain]);
  useEffect(() => { currentSymbol.current = symbol; }, [symbol]);
  useEffect(() => { currentSpot.current = spotPrice; }, [spotPrice]);

  const updateSpot = useCallback((nextSpot: number, nextSymbol = currentSymbol.current) => {
    SPOT_PRICES[nextSymbol] = nextSpot;
    currentSpot.current = nextSpot;
    setSpotPrice(nextSpot);
    setLiveIndices((current) => updateIndicesWithSpot(current, nextSymbol, nextSpot, dayOpenBySymbol.current[nextSymbol]));
  }, []);

  const fetchAndSetSpot = useCallback(async (nextSymbol: SymbolCode, nextSession: NonNullable<typeof session>) => {
    const fallback = SPOT_PRICES[nextSymbol];
    try {
      const result = await brokerGatewayClient.market.fetchSpot(nextSymbol, nextSession);
      if (result.ok && result.spot && result.spot > 1000) {
        if (!dayOpenBySymbol.current[nextSymbol]) {
          dayOpenBySymbol.current[nextSymbol] = result.spot;
        }
        updateSpot(result.spot, nextSymbol);
        return result.spot;
      }
    } catch {
      // handled via fallback below
    }
    updateSpot(fallback, nextSymbol);
    return fallback;
  }, [session, updateSpot]);

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
      // fall through
    }

    const fallback = getExpiries(nextSymbol);
    setAvailableExpiries(fallback);
    return fallback;
  }, []);

  const handleTickUpdate = useCallback((update: TickUpdate) => {
    const updatedChain = applyTicksToChain(currentChain.current, update.ticks);
    setChain(updatedChain);
    currentChain.current = updatedChain;
    setLastUpdate(new Date());

    const nextSymbol = currentSymbol.current;
    const broadcastSpot = update.spot_prices?.[nextSymbol] ?? update.spot_prices?.NIFTY;
    if (broadcastSpot && broadcastSpot > 1000) {
      const diff = Math.abs(broadcastSpot - currentSpot.current);
      if (diff < currentSpot.current * 0.15) {
        if (diff > 0.5) updateSpot(broadcastSpot, nextSymbol);
        return;
      }
    }

    const derivedSpot = deriveSpotFromMedian(updatedChain);
    if (derivedSpot && derivedSpot > 1000) {
      const diff = Math.abs(derivedSpot - currentSpot.current);
      if (diff > 1 && diff < currentSpot.current * 0.15) {
        updateSpot(derivedSpot, nextSymbol);
      }
    }
  }, [updateSpot]);

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
  }, [notify, setStatusMessage, session]);

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
      updateSpot(SPOT_PRICES[nextSymbol], nextSymbol);
      setChain(generateChain(nextSymbol));
      setChainError(null);
      setLastUpdate(new Date());
      setWsStatus('disconnected');
      setStatusMessage('Browser-direct session connected. Backend-only streaming is disabled.');
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

    if (brokerGatewayClient.session.isBackend(nextSession.proxyBase)) {
      setWsStatus('connecting');
      streamingManager.connect(nextSession.proxyBase, handleTickUpdate, (status) => {
        setWsStatus(status);
        setStatusMessage(
          status === 'connected'
            ? 'Streaming live market data'
            : status === 'reconnecting'
              ? 'Reconnecting market stream'
              : status === 'error'
                ? 'WebSocket unavailable. REST polling fallback active.'
                : 'Market stream disconnected'
        );
      });
    }
  }, [fetchAndSetSpot, fetchLiveExpiries, fetchLiveChain, handleTickUpdate, setStatusMessage, setWsStatus, session]);

  const resetToDemo = useCallback((nextSymbol: SymbolCode) => {
    streamingManager.disconnect();
    if (demoTickRef.current) clearInterval(demoTickRef.current);
    const expiries = getExpiries(nextSymbol);
    setAvailableExpiries(expiries);
    setExpiryState(expiries[0]);
    updateSpot(SPOT_PRICES[nextSymbol], nextSymbol);
    setChain(generateChain(nextSymbol));
    setChainError(null);
    setLastUpdate(new Date());
    demoTickRef.current = setInterval(() => {
      setChain((current) => simulateTick(current));
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

  useEffect(() => {
    return () => {
      streamingManager.disconnect();
      if (demoTickRef.current) clearInterval(demoTickRef.current);
    };
  }, []);

  const refreshMarket = useCallback(async () => {
    if (!session?.isConnected) {
      setChain(generateChain(symbol, spotPrice));
      setLastUpdate(new Date());
      return;
    }

    if (!brokerGatewayClient.session.isBackend(session.proxyBase)) {
      setChain(generateChain(symbol, spotPrice));
      setLastUpdate(new Date());
      setStatusMessage('Browser-direct mode refreshed from static market seed.');
      return;
    }

    const liveSpot = await fetchAndSetSpot(symbol, session);
    await fetchLiveChain(symbol, expiry, session, liveSpot);
  }, [session, symbol, spotPrice, expiry, fetchAndSetSpot, fetchLiveChain]);

  useEffect(() => {
    if (!session?.isConnected || !brokerGatewayClient.session.isBackend(session.proxyBase)) return;
    if (skipNextExpiryReload.current === expiry.breezeValue) {
      skipNextExpiryReload.current = null;
      return;
    }
    void fetchLiveChain(symbol, expiry, session, currentSpot.current);
  }, [expiry.breezeValue]);

  const value = useMemo(() => ({
    symbol,
    expiry,
    availableExpiries,
    chain,
    spotPrice,
    lastUpdate,
    isLoading,
    chainError,
    liveIndices,
    setSymbol: setSymbolState,
    setExpiry: setExpiryState,
    refreshMarket,
  }), [symbol, expiry, availableExpiries, chain, spotPrice, lastUpdate, isLoading, chainError, liveIndices, refreshMarket]);

  return <MarketStore.Provider value={value}>{children}</MarketStore.Provider>;
}

export function useMarketStore() {
  const context = useContext(MarketStore);
  if (!context) throw new Error('useMarketStore must be used within MarketProvider');
  return context;
}
