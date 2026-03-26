import { SYMBOL_CONFIG } from '../../config/market';
import type { TruthAuthority } from '../../lib/truth';
import type { BreezeSession, SymbolCode } from '../../types/index';
import { extractApiSession, placeLegOrder, validateSession } from '../../utils/breezeClient';
import {
  checkBackendHealth,
  connectToBreeze,
  createAutomationRule,
  deleteAutomationRule,
  evaluateAutomationRules,
  fetchAutomationCallbacks,
  fetchAutomationRules,
  fetchExecutionPreview,
  fetchFunds,
  fetchExpiryDates,
  fetchHistorical,
  fetchLayout,
  fetchMarginPreview,
  fetchMarketDepth,
  fetchOptionChain,
  fetchOrderBook,
  fetchPositions,
  fetchRepairPreview,
  fetchSellerReviewState,
  saveSellerReviewState,
  saveLayout,
  squareOffPosition,
  fetchSpotPrice,
  fetchTradeBook,
  isKaggleBackend,
  setTerminalAuthToken,
  updateAutomationRule,
  updateAutomationRuleStatus,
  cancelOrder,
} from '../../utils/kaggleClient';
import { setWsAuthToken, subscribeOptionChain } from '../../utils/breezeWs';
import type { OptionLeg } from '../../types/index';

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
  authority: TruthAuthority;
  source: string;
  asOf: number;
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
          authority: 'broker',
          source: 'session_disconnected',
          asOf: Date.now(),
        };
      }

      if (!isKaggleBackend(session.proxyBase)) {
        return {
          backendReachable: true,
          backendMessage: 'Browser-direct diagnostic mode',
          backendConnected: true,
          streamStatus,
          authority: 'analytical',
          source: 'browser_direct_mode',
          asOf: Date.now(),
        };
      }

      const health = await checkBackendHealth(session.proxyBase);
      return {
        backendReachable: health.ok,
        backendMessage: health.message,
        backendConnected: health.connected,
        streamStatus,
        authority: 'broker',
        source: 'backend_health_probe',
        asOf: Date.now(),
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
    async fetchHistorical(symbol: SymbolCode, session: BreezeSession, params: {
      interval: string;
      fromDate: string;
      toDate: string;
      expiryDate?: string;
      right?: 'call' | 'put';
      strikePrice?: string;
    }) {
      const cfg = SYMBOL_CONFIG[symbol];
      return fetchHistorical(session.proxyBase, {
        stockCode: cfg.breezeStockCode,
        exchangeCode: cfg.breezeExchangeCode,
        ...params,
      });
    },
    async fetchMarketDepth(symbol: SymbolCode, session: BreezeSession, params: {
      expiryDate: string;
      right: 'call' | 'put';
      strikePrice: string;
    }) {
      const cfg = SYMBOL_CONFIG[symbol];
      return fetchMarketDepth(session.proxyBase, {
        stockCode: cfg.breezeStockCode,
        exchangeCode: cfg.breezeExchangeCode,
        ...params,
      });
    },
  },
  portfolio: {
    async fetchPositions(session: BreezeSession) {
      return fetchPositions(session.proxyBase);
    },
    async fetchFunds(session: BreezeSession) {
      return fetchFunds(session.proxyBase);
    },
    async fetchOrders(session: BreezeSession) {
      return fetchOrderBook(session.proxyBase);
    },
    async fetchTrades(session: BreezeSession) {
      return fetchTradeBook(session.proxyBase);
    },
  },
  orders: {
    async placeDirectLeg(session: BreezeSession, params: Parameters<typeof placeLegOrder>[1]) {
      return placeLegOrder(session, params);
    },
    async cancel(session: BreezeSession, orderId: string, exchangeCode = 'NFO') {
      return cancelOrder(session.proxyBase, orderId, exchangeCode);
    },
    async squareOffLeg(session: BreezeSession, params: Parameters<typeof squareOffPosition>[1]) {
      return squareOffPosition(session.proxyBase, params);
    },
  },
  execution: {
    async previewStrategy(session: BreezeSession, legs: Array<Record<string, unknown>>) {
      return fetchExecutionPreview(session.proxyBase, legs);
    },
    async repairPreview(session: BreezeSession, payload: Record<string, unknown>) {
      return fetchRepairPreview(session.proxyBase, payload);
    },
    async fetchMargin(session: BreezeSession, legs: OptionLeg[]) {
      const cfg = SYMBOL_CONFIG[legs[0].symbol];
      return fetchMarginPreview(session.proxyBase, legs.map((leg) => ({
        stock_code: cfg.breezeStockCode,
        exchange_code: cfg.breezeExchangeCode,
        product: 'options',
        action: leg.action.toLowerCase(),
        quantity: String(leg.lots * cfg.lotSize),
        price: String(leg.limitPrice ?? leg.ltp ?? 0),
        order_type: leg.orderType ?? 'market',
        expiry_date: leg.expiry,
        right: leg.type === 'CE' ? 'call' : 'put',
        strike_price: String(leg.strike),
      })));
    },
  },
  automation: {
    async fetchRules(session: BreezeSession) {
      return fetchAutomationRules(session.proxyBase);
    },
    async createRule(session: BreezeSession, payload: Record<string, unknown>) {
      return createAutomationRule(session.proxyBase, payload);
    },
    async updateRule(session: BreezeSession, ruleId: string, payload: Record<string, unknown>) {
      return updateAutomationRule(session.proxyBase, ruleId, payload);
    },
    async deleteRule(session: BreezeSession, ruleId: string) {
      return deleteAutomationRule(session.proxyBase, ruleId);
    },
    async updateRuleStatus(session: BreezeSession, ruleId: string, status: 'active' | 'paused' | 'draft') {
      return updateAutomationRuleStatus(session.proxyBase, ruleId, status);
    },
    async evaluate(session: BreezeSession) {
      return evaluateAutomationRules(session.proxyBase);
    },
    async fetchCallbacks(session: BreezeSession, limit = 25) {
      return fetchAutomationCallbacks(session.proxyBase, limit);
    },
  },
  reviews: {
    async fetchState(session: BreezeSession) {
      return fetchSellerReviewState(session.proxyBase);
    },
    async saveState(session: BreezeSession, payload: Record<string, unknown>) {
      return saveSellerReviewState(session.proxyBase, payload);
    },
  },
  layout: {
    async fetch(session: BreezeSession, layoutId: string) {
      return fetchLayout(session.proxyBase, layoutId);
    },
    async save(
      session: BreezeSession,
      layoutId: string,
      payload: { workspace_id: string; name: string; panels: Record<string, unknown>; is_default?: boolean },
    ) {
      return saveLayout(session.proxyBase, layoutId, payload);
    },
  },
};
