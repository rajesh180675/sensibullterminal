// ════════════════════════════════════════════════════════════════════════════
// useBreeze — React hook wrapping the browser-native Breeze client
//
// Automatically routes to the right transport:
//   isKaggleBackend(proxyBase) === true  → KaggleClient (Python SDK)
//   otherwise                           → breezeClient (SHA-256 browser direct)
// ════════════════════════════════════════════════════════════════════════════

import { useState, useCallback } from 'react';
import { BreezeSession }         from '../types/index';
import {
  generateChecksum,
  breezeTimestamp,
  extractApiSession,
  validateSession,
  fetchOptionChain  as directFetchChain,
  placeLegOrder     as directPlaceOrder,
  pyDumps,
  type BreezeQuote,
  type OrderParams,
} from '../utils/breezeClient';
import {
  connectToBreeze,
  fetchOptionChain as kaggleFetchChain,
  placeOrder       as kagglePlaceOrder,
  isKaggleBackend,
} from '../utils/kaggleClient';

export { extractApiSession };
export type { BreezeQuote, OrderParams };

// ── Types ────────────────────────────────────────────────────────────────────

interface UseBreezeReturn {
  session:       BreezeSession | null;
  isConnected:   boolean;
  connecting:    boolean;
  error:         string | null;
  isBackend:     boolean;

  autoExtractToken: () => string | null;
  initSession:      (
    apiKey: string,
    apiSecret: string,
    sessionToken: string,
    proxyBase: string,
  ) => Promise<void>;
  disconnect:   () => void;
  fetchChain:   (stockCode: string, exchangeCode: string, expiry: string, right: 'Call' | 'Put') => Promise<BreezeQuote[]>;
  placeOrder:   (params: OrderParams) => Promise<{ order_id: string; status: string }>;
  testChecksum: (payload: Record<string, string>, secret: string) => Promise<string>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useBreeze(): UseBreezeReturn {
  const [session,    setSession]    = useState<BreezeSession | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const isConnected = session?.isConnected ?? false;
  const isBackend   = session ? isKaggleBackend(session.proxyBase) : false;

  const autoExtractToken = useCallback((): string | null => {
    return extractApiSession();
  }, []);

  const initSession = useCallback(async (
    apiKey:       string,
    apiSecret:    string,
    sessionToken: string,
    proxyBase:    string,
  ) => {
    setConnecting(true);
    setError(null);

    const newSession: BreezeSession = {
      apiKey, apiSecret, sessionToken, proxyBase, isConnected: false,
    };

    try {
      if (isKaggleBackend(proxyBase)) {
        // ── Backend (Kaggle / Cloudflare tunnel) ─────────────────────────
        console.log('[useBreeze] Backend mode →', proxyBase);
        const result = await connectToBreeze({ apiKey, apiSecret, sessionToken, backendUrl: proxyBase });

        newSession.isConnected = result.ok;
        newSession.connectedAt = new Date();
        if (result.sessionToken) newSession.sessionToken = result.sessionToken;
        setSession({ ...newSession });
        if (!result.ok) setError(result.reason);
      } else {
        // ── Browser-direct (CORS proxy) ──────────────────────────────────
        console.log('[useBreeze] CORS proxy mode →', proxyBase);
        const result = await validateSession(newSession);

        newSession.isConnected = result.ok;
        newSession.connectedAt = new Date();
        if (result.sessionToken) newSession.sessionToken = result.sessionToken;
        setSession({ ...newSession });
        if (!result.ok) setError(result.reason);
      }
    } catch (e) {
      newSession.isConnected = false;
      setSession({ ...newSession });
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setSession(null);
    setError(null);
  }, []);

  // ── Fetch option chain ───────────────────────────────────────────────────

  const fetchChain = useCallback(async (
    stockCode:    string,
    exchangeCode: string,
    expiry:       string,
    right:        'Call' | 'Put',
  ): Promise<BreezeQuote[]> => {
    if (!session) throw new Error('Not connected');

    if (isKaggleBackend(session.proxyBase)) {
      const result = await kaggleFetchChain(session.proxyBase, {
        stockCode,
        exchangeCode,
        expiryDate: expiry,
        right,
      });
      if (!result.ok || !result.data) throw new Error(result.error || 'Failed to fetch chain');
      // kaggleClient already normalises to BreezeQuote shape
      return result.data as unknown as BreezeQuote[];
    }

    return directFetchChain(session, stockCode, exchangeCode, expiry, right);
  }, [session]);

  // ── Place order ──────────────────────────────────────────────────────────

  const placeOrder = useCallback(async (params: OrderParams) => {
    if (!session) throw new Error('Not connected');

    if (isKaggleBackend(session.proxyBase)) {
      const result = await kagglePlaceOrder(session.proxyBase, {
        stockCode:    params.stockCode,
        exchangeCode: params.exchangeCode,
        action:       params.action.toUpperCase() as 'BUY' | 'SELL',
        quantity:     params.quantity,
        expiryDate:   params.expiryDate,
        right:        params.right.toLowerCase() as 'call' | 'put',
        strikePrice:  params.strikePrice,
        orderType:    params.orderType,
        price:        params.price,
      });

      if (!result.ok) throw new Error(result.error || 'Order failed');
      return { order_id: result.orderId ?? 'unknown', status: 'success' };
    }

    return directPlaceOrder(session, params);
  }, [session]);

  // ── Test SHA-256 checksum locally (no network) ───────────────────────────

  const testChecksum = useCallback(async (
    payload: Record<string, string>,
    secret:  string,
  ): Promise<string> => {
    const ts      = breezeTimestamp();
    const bodyStr = pyDumps(payload);
    return generateChecksum(ts, bodyStr, secret);
  }, []);

  return {
    session, isConnected, connecting, error, isBackend,
    autoExtractToken, initSession, disconnect,
    fetchChain, placeOrder, testChecksum,
  };
}
