import { SYMBOL_CONFIG } from '../../config/market';
import type { BreezeSession, SymbolCode } from '../../types/index';
import { extractApiSession, placeLegOrder, validateSession } from '../../utils/breezeClient';
import {
  checkBackendHealth,
  connectToBreeze,
  fetchExpiryDates,
  fetchOptionChain,
  fetchPositions,
  fetchSpotPrice,
  isKaggleBackend,
  setTerminalAuthToken,
} from '../../utils/kaggleClient';
import { setWsAuthToken, subscribeOptionChain } from '../../utils/breezeWs';

export interface BrokerCapabilities {
  backendPrimary: boolean;
  streaming: boolean;
  positions: boolean;
  strategyExecution: boolean;
  diagnostics: boolean;
}

export interface BrokerHealthSnapshot {
  backendReachable: boolean;
  backendMessage: string;
  backendConnected: boolean;
  streamStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
}

export const brokerGatewayClient = {
  session: {
    extractApiSession,
    isBackend: isKaggleBackend,
    setAuthToken(token?: string) {
      setTerminalAuthToken(token);
      setWsAuthToken(token);
    },
    async connectSession(session: BreezeSession): Promise<BreezeSession> {
      if (isKaggleBackend(session.proxyBase)) {
        const result = await connectToBreeze({
          apiKey: session.apiKey,
          apiSecret: session.apiSecret,
          sessionToken: session.sessionToken,
          backendUrl: session.proxyBase,
        });

        if (!result.ok) {
          throw new Error(result.reason || 'Failed to connect to backend session');
        }

        return {
          ...session,
          isConnected: true,
          connectedAt: new Date(),
          sessionToken: result.sessionToken || session.sessionToken,
        };
      }

      const result = await validateSession(session);
      if (!result.ok) {
        throw new Error(result.reason || 'Failed to validate Breeze session');
      }

      return {
        ...session,
        isConnected: true,
        connectedAt: new Date(),
        sessionToken: result.sessionToken || session.sessionToken,
      };
    },
    async checkHealth(session: BreezeSession | null, streamStatus: BrokerHealthSnapshot['streamStatus']): Promise<BrokerHealthSnapshot> {
      if (!session?.isConnected) {
        return {
          backendReachable: false,
          backendMessage: 'Disconnected',
          backendConnected: false,
          streamStatus,
        };
      }

      if (!isKaggleBackend(session.proxyBase)) {
        return {
          backendReachable: true,
          backendMessage: 'Browser-direct diagnostic mode',
          backendConnected: true,
          streamStatus,
        };
      }

      const health = await checkBackendHealth(session.proxyBase);
      return {
        backendReachable: health.ok,
        backendMessage: health.message,
        backendConnected: health.connected,
        streamStatus,
      };
    },
    capabilities(session: BreezeSession | null): BrokerCapabilities {
      const backendPrimary = !!(session && isKaggleBackend(session.proxyBase));
      return {
        backendPrimary,
        streaming: backendPrimary,
        positions: backendPrimary,
        strategyExecution: true,
        diagnostics: !backendPrimary,
      };
    },
  },
  market: {
    async fetchSpot(symbol: SymbolCode, session: BreezeSession) {
      return fetchSpotPrice(session.proxyBase, symbol);
    },
    async fetchExpiries(symbol: SymbolCode, session: BreezeSession) {
      const cfg = SYMBOL_CONFIG[symbol];
      return fetchExpiryDates(session.proxyBase, cfg.breezeStockCode, cfg.breezeExchangeCode);
    },
    async fetchOptionSide(symbol: SymbolCode, expiryDate: string, right: 'Call' | 'Put', session: BreezeSession) {
      const cfg = SYMBOL_CONFIG[symbol];
      return fetchOptionChain(session.proxyBase, {
        stockCode: cfg.breezeStockCode,
        exchangeCode: cfg.breezeExchangeCode,
        expiryDate,
        right,
      });
    },
    async subscribeOptionChain(symbol: SymbolCode, expiryDate: string, strikes: number[], session: BreezeSession) {
      const cfg = SYMBOL_CONFIG[symbol];
      return subscribeOptionChain(
        session.proxyBase,
        cfg.breezeStockCode,
        cfg.breezeExchangeCode,
        expiryDate,
        strikes,
      );
    },
  },
  portfolio: {
    async fetchPositions(session: BreezeSession) {
      return fetchPositions(session.proxyBase);
    },
  },
  orders: {
    async placeDirectLeg(session: BreezeSession, params: Parameters<typeof placeLegOrder>[1]) {
      return placeLegOrder(session, params);
    },
  },
};
