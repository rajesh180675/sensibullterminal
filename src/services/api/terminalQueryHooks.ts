import { useMutation, useQuery, useQueryClient, type QueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { generateChain, getMockPositions } from '../../data/mock';
import { mapBreezePositions, mergeQuotesToChain } from '../../domains/market/marketTransforms';
import { brokerGatewayClient } from '../broker/brokerGatewayClient';
import { SYMBOL_CONFIG } from '../../config/market';
import type {
  AutomationCallbackEvent,
  AutomationRule,
  ExpiryDate,
  BreezeSession,
  ExecutionPreview,
  OptionLeg,
  OptionRow,
  SymbolCode,
  Position,
} from '../../types/index';
import type {
  BackendExecutionValidationSummary,
  FundsData,
  OrderBookRow,
  TradeBookRow,
} from '../../utils/kaggleClient';

const STALE_THRESHOLDS = {
  quote: 30_000,
  position: 60_000,
  order: 10_000,
  greeks: 60_000,
} as const;

function backendSessionKey(session: BreezeSession | null) {
  if (!session?.isConnected) return 'disconnected';
  return `${session.proxyBase}:${session.backendAuthToken ?? 'anon'}`;
}

function isBackendSession(session: BreezeSession | null): session is BreezeSession {
  return !!session?.isConnected && brokerGatewayClient.session.isBackend(session.proxyBase);
}

function buildPreviewPayload(legs: OptionLeg[]) {
  const cfg = SYMBOL_CONFIG[legs[0].symbol];
  return legs.map((leg) => ({
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
  }));
}

function mergeValidation(
  previewValidation?: BackendExecutionValidationSummary,
  marginValidation?: BackendExecutionValidationSummary,
): ExecutionPreview['validation'] {
  if (!previewValidation && !marginValidation) return undefined;
  const marginLegValidation = previewValidation?.margin ?? (
    marginValidation
      ? {
          kind: 'margin',
          captured_at: marginValidation.captured_at,
          leg_count: marginValidation.leg_count,
          rawTopLevelFields: marginValidation.rawTopLevelFields ?? [],
          successFields: marginValidation.successFields ?? [],
          captureFile: marginValidation.captureFile,
        }
      : undefined
  );
  return {
    kind: 'preview',
    captured_at: previewValidation?.captured_at ?? marginValidation?.captured_at ?? Date.now(),
    leg_count: previewValidation?.leg_count ?? marginValidation?.leg_count ?? 0,
    captureFile: previewValidation?.captureFile ?? marginValidation?.captureFile,
    previewLegs: previewValidation?.previewLegs ?? [],
    margin: marginLegValidation,
  };
}

export const terminalQueryKeys = {
  chain: (session: BreezeSession | null, symbol: SymbolCode, expiry: ExpiryDate) => [
    'market',
    'chain',
    backendSessionKey(session),
    symbol,
    expiry.breezeValue,
  ] as const,
  positions: (session: BreezeSession | null) => ['portfolio', 'positions', backendSessionKey(session)] as const,
  orders: (session: BreezeSession | null) => ['portfolio', 'orders', backendSessionKey(session)] as const,
  trades: (session: BreezeSession | null) => ['portfolio', 'trades', backendSessionKey(session)] as const,
  funds: (session: BreezeSession | null) => ['portfolio', 'funds', backendSessionKey(session)] as const,
  automationRules: (session: BreezeSession | null, symbol: SymbolCode) => ['automation', 'rules', backendSessionKey(session), symbol] as const,
  automationCallbacks: (session: BreezeSession | null) => ['automation', 'callbacks', backendSessionKey(session)] as const,
};

function seedAutomationRules(symbol: SymbolCode): AutomationRule[] {
  const today = new Date();
  return [
    {
      id: 'rule-gtt-condor',
      name: 'Condor stop cluster',
      kind: 'gtt',
      status: 'active',
      scope: `${symbol} weekly spreads`,
      trigger: 'Net loss breaches staged spot guardrail',
      action: 'Place hedge buyback for staged legs',
      lastRun: 'Never',
      nextRun: 'Live',
      notes: 'Frontend fallback seed rule. Connect a backend session for persistence.',
      symbol,
      triggerConfig: { type: 'manual' },
      actionConfig: { type: 'notify', message: 'Manual review required.' },
      runCount: 0,
      updatedAt: today.getTime(),
    },
  ];
}

function setAutomationFallbackRuleCache(
  queryClient: QueryClient,
  session: BreezeSession | null,
  symbol: SymbolCode,
  updater: (current: AutomationRule[]) => AutomationRule[],
) {
  queryClient.setQueryData<AutomationRule[]>(
    terminalQueryKeys.automationRules(session, symbol),
    updater(queryClient.getQueryData<AutomationRule[]>(terminalQueryKeys.automationRules(session, symbol)) ?? seedAutomationRules(symbol)),
  );
}

export function useChainQuery(params: {
  session: BreezeSession | null;
  symbol: SymbolCode;
  expiry: ExpiryDate;
  spotPrice: number;
}): UseQueryResult<OptionRow[], Error> {
  const { session, symbol, expiry, spotPrice } = params;
  return useQuery<OptionRow[], Error>({
    queryKey: terminalQueryKeys.chain(session, symbol, expiry),
    staleTime: STALE_THRESHOLDS.quote,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      if (!isBackendSession(session)) {
        return generateChain(symbol, spotPrice);
      }

      const [calls, puts] = await Promise.all([
        brokerGatewayClient.market.fetchOptionSide(symbol, expiry.breezeValue, 'Call', session),
        brokerGatewayClient.market.fetchOptionSide(symbol, expiry.breezeValue, 'Put', session),
      ]);

      if (!calls.ok && !puts.ok) {
        throw new Error(calls.error || puts.error || 'Failed to load option chain snapshot.');
      }

      const merged = mergeQuotesToChain(
        calls.data ?? [],
        puts.data ?? [],
        spotPrice,
        SYMBOL_CONFIG[symbol].strikeStep,
        expiry.daysToExpiry,
      );

      if (merged.length === 0) {
        throw new Error('Backend returned an empty option chain snapshot.');
      }

      return merged;
    },
  });
}

export function usePositionsQuery(params: {
  session: BreezeSession | null;
  canRefreshBrokerData: boolean;
}): UseQueryResult<Position[], Error> {
  const { session, canRefreshBrokerData } = params;
  return useQuery<Position[], Error>({
    queryKey: terminalQueryKeys.positions(session),
    staleTime: STALE_THRESHOLDS.position,
    queryFn: async () => {
      if (!canRefreshBrokerData || !isBackendSession(session)) {
        return getMockPositions();
      }

      const result = await brokerGatewayClient.portfolio.fetchPositions(session);
      if (!result.ok) {
        throw new Error(result.error || 'Failed to load positions.');
      }
      return mapBreezePositions(result.data);
    },
  });
}

export function useOrdersQuery(params: {
  session: BreezeSession | null;
  canRefreshBrokerData: boolean;
}): UseQueryResult<OrderBookRow[], Error> {
  const { session, canRefreshBrokerData } = params;
  return useQuery<OrderBookRow[], Error>({
    queryKey: terminalQueryKeys.orders(session),
    staleTime: STALE_THRESHOLDS.order,
    queryFn: async () => {
      if (!canRefreshBrokerData || !isBackendSession(session)) {
        return [];
      }

      const result = await brokerGatewayClient.portfolio.fetchOrders(session);
      if (!result.ok) {
        throw new Error(result.error || 'Failed to load order book.');
      }
      return result.data;
    },
  });
}

export function useTradesQuery(params: {
  session: BreezeSession | null;
  canRefreshBrokerData: boolean;
}): UseQueryResult<TradeBookRow[], Error> {
  const { session, canRefreshBrokerData } = params;
  return useQuery<TradeBookRow[], Error>({
    queryKey: terminalQueryKeys.trades(session),
    staleTime: STALE_THRESHOLDS.position,
    queryFn: async () => {
      if (!canRefreshBrokerData || !isBackendSession(session)) {
        return [];
      }

      const result = await brokerGatewayClient.portfolio.fetchTrades(session);
      if (!result.ok) {
        throw new Error(result.error || 'Failed to load trade book.');
      }
      return result.data;
    },
  });
}

export function useFundsQuery(params: {
  session: BreezeSession | null;
  canRefreshBrokerData: boolean;
}): UseQueryResult<FundsData | null, Error> {
  const { session, canRefreshBrokerData } = params;
  return useQuery<FundsData | null, Error>({
    queryKey: terminalQueryKeys.funds(session),
    staleTime: STALE_THRESHOLDS.position,
    queryFn: async () => {
      if (!canRefreshBrokerData || !isBackendSession(session)) {
        return {
          cash_balance: 325000,
          utilized_margin: 84500,
          available_margin: 240500,
        };
      }

      const result = await brokerGatewayClient.portfolio.fetchFunds(session);
      if (!result.ok) {
        throw new Error(result.error || 'Failed to load funds.');
      }
      return result.data ?? null;
    },
  });
}

export function useAutomationRulesQuery(params: {
  session: BreezeSession | null;
  symbol: SymbolCode;
}): UseQueryResult<AutomationRule[], Error> {
  const { session, symbol } = params;
  return useQuery<AutomationRule[], Error>({
    queryKey: terminalQueryKeys.automationRules(session, symbol),
    staleTime: STALE_THRESHOLDS.position,
    queryFn: async () => {
      if (!isBackendSession(session)) {
        return seedAutomationRules(symbol);
      }
      const result = await brokerGatewayClient.automation.fetchRules(session);
      if (!result.ok) {
        throw new Error(result.error || 'Failed to load automation rules.');
      }
      return (result.rules as AutomationRule[] | undefined) ?? [];
    },
  });
}

export function useAutomationCallbacksQuery(params: {
  session: BreezeSession | null;
}): UseQueryResult<AutomationCallbackEvent[], Error> {
  const { session } = params;
  return useQuery<AutomationCallbackEvent[], Error>({
    queryKey: terminalQueryKeys.automationCallbacks(session),
    staleTime: STALE_THRESHOLDS.position,
    queryFn: async () => {
      if (!isBackendSession(session)) {
        return [];
      }
      const result = await brokerGatewayClient.automation.fetchCallbacks(session, 25);
      if (!result.ok) {
        throw new Error(result.error || 'Failed to load automation callbacks.');
      }
      return (result.events as AutomationCallbackEvent[] | undefined) ?? [];
    },
  });
}

export function usePreviewMutation(
  session: BreezeSession | null,
): UseMutationResult<Partial<ExecutionPreview>, Error, OptionLeg[]> {
  return useMutation<Partial<ExecutionPreview>, Error, OptionLeg[]>({
    mutationFn: async (legs) => {
      if (!isBackendSession(session) || legs.length === 0) {
        throw new Error('Backend preview is unavailable for the current session.');
      }

      const [previewResult, marginResult] = await Promise.all([
        brokerGatewayClient.execution.previewStrategy(session, buildPreviewPayload(legs)),
        brokerGatewayClient.execution.fetchMargin(session, legs),
      ]);

      if (!previewResult.ok && !marginResult.ok) {
        throw new Error(previewResult.error || marginResult.error || 'Backend preview unavailable.');
      }

      return {
        ...previewResult.data,
        ...marginResult.data,
        source: 'backend',
        updatedAt: previewResult.data?.updated_at ?? marginResult.data?.updated_at ?? Date.now(),
        validation: mergeValidation(previewResult.data?.validation, marginResult.data?.validation),
      };
    },
  });
}

export function usePlaceOrderMutation(
  session: BreezeSession | null,
): UseMutationResult<{ orderId?: string }, Error, OptionLeg> {
  const queryClient = useQueryClient();
  return useMutation<{ orderId?: string }, Error, OptionLeg>({
    mutationFn: async (leg) => {
      if (!session?.isConnected) {
        throw new Error('No broker session connected.');
      }

      const cfg = SYMBOL_CONFIG[leg.symbol];
      if (isBackendSession(session)) {
        const base = session.proxyBase.replace(/\/api\/?$/, '').replace(/\/$/, '');
        const response = await fetch(`${base}/api/strategy/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            legs: [{
              stock_code: cfg.breezeStockCode,
              exchange_code: cfg.breezeExchangeCode,
              action: leg.action.toLowerCase(),
              quantity: String(leg.lots * cfg.lotSize),
              expiry_date: leg.expiry,
              right: leg.type === 'CE' ? 'call' : 'put',
              strike_price: String(leg.strike),
              order_type: leg.orderType ?? 'market',
              price: leg.orderType === 'limit' ? String(leg.limitPrice ?? leg.ltp) : '0',
            }],
          }),
        });

        const data = await response.json() as {
          results?: Array<{ success: boolean; order_id?: string; error?: string }>;
        };
        const result = data.results?.[0];
        if (!result?.success) {
          throw new Error(result?.error || 'Rejected by broker.');
        }
        return { orderId: result.order_id };
      }

      const result = await brokerGatewayClient.orders.placeDirectLeg(session, {
        stockCode: cfg.breezeStockCode,
        exchangeCode: cfg.breezeExchangeCode,
        right: leg.type === 'CE' ? 'call' : 'put',
        strikePrice: String(leg.strike),
        expiryDate: leg.expiry,
        action: leg.action.toLowerCase() as 'buy' | 'sell',
        quantity: String(leg.lots * cfg.lotSize),
        orderType: (leg.orderType ?? 'market') as 'market' | 'limit',
        price: leg.orderType === 'limit' ? String(leg.limitPrice ?? leg.ltp) : '0',
      });
      return { orderId: result.order_id };
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: terminalQueryKeys.positions(session) }),
        queryClient.invalidateQueries({ queryKey: terminalQueryKeys.orders(session) }),
        queryClient.invalidateQueries({ queryKey: terminalQueryKeys.trades(session) }),
        queryClient.invalidateQueries({ queryKey: terminalQueryKeys.funds(session) }),
      ]);
    },
  });
}

export function useCancelOrderMutation(
  session: BreezeSession | null,
): UseMutationResult<{ orderId: string }, Error, { orderId: string; exchangeCode?: string }> {
  const queryClient = useQueryClient();
  return useMutation<{ orderId: string }, Error, { orderId: string; exchangeCode?: string }>({
    mutationFn: async ({ orderId, exchangeCode }) => {
      if (!session?.isConnected) {
        throw new Error('No broker session connected.');
      }

      const result = await brokerGatewayClient.orders.cancel(session, orderId, exchangeCode);
      if (!result.ok) {
        throw new Error(result.error || 'Order cancel failed.');
      }

      return { orderId };
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: terminalQueryKeys.orders(session) }),
        queryClient.invalidateQueries({ queryKey: terminalQueryKeys.positions(session) }),
      ]);
    },
  });
}

export function useSaveAutomationRuleMutation(params: {
  session: BreezeSession | null;
  symbol: SymbolCode;
}): UseMutationResult<AutomationRule, Error, AutomationRule> {
  const { session, symbol } = params;
  const queryClient = useQueryClient();
  return useMutation<AutomationRule, Error, AutomationRule>({
    mutationFn: async (rule) => {
      if (!isBackendSession(session)) {
        setAutomationFallbackRuleCache(queryClient, session, symbol, (current) => {
          const found = current.some((item) => item.id === rule.id);
          return found ? current.map((item) => (item.id === rule.id ? rule : item)) : [rule, ...current];
        });
        return rule;
      }
      const result = await brokerGatewayClient.automation.updateRule(session, rule.id, rule as unknown as Record<string, unknown>);
      if (!result.ok || !result.rule) {
        throw new Error(result.error || 'Could not save automation rule.');
      }
      return result.rule as AutomationRule;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: terminalQueryKeys.automationRules(session, symbol) }),
        queryClient.invalidateQueries({ queryKey: terminalQueryKeys.automationCallbacks(session) }),
      ]);
    },
  });
}

export function useCreateAutomationRuleMutation(params: {
  session: BreezeSession | null;
  symbol: SymbolCode;
}): UseMutationResult<AutomationRule, Error, AutomationRule> {
  const { session, symbol } = params;
  const queryClient = useQueryClient();
  return useMutation<AutomationRule, Error, AutomationRule>({
    mutationFn: async (rule) => {
      if (!isBackendSession(session)) {
        setAutomationFallbackRuleCache(queryClient, session, symbol, (current) => [rule, ...current]);
        return rule;
      }
      const result = await brokerGatewayClient.automation.createRule(session, rule as unknown as Record<string, unknown>);
      if (!result.ok || !result.rule) {
        throw new Error(result.error || 'Could not persist automation rule.');
      }
      return result.rule as AutomationRule;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: terminalQueryKeys.automationRules(session, symbol) }),
        queryClient.invalidateQueries({ queryKey: terminalQueryKeys.automationCallbacks(session) }),
      ]);
    },
  });
}

export function useDeleteAutomationRuleMutation(params: {
  session: BreezeSession | null;
  symbol: SymbolCode;
}): UseMutationResult<void, Error, { id: string }> {
  const { session, symbol } = params;
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      if (!isBackendSession(session)) {
        setAutomationFallbackRuleCache(queryClient, session, symbol, (current) => current.filter((rule) => rule.id !== id));
        return;
      }
      const result = await brokerGatewayClient.automation.deleteRule(session, id);
      if (!result.ok) {
        throw new Error(result.error || 'Could not delete automation rule.');
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: terminalQueryKeys.automationRules(session, symbol) }),
        queryClient.invalidateQueries({ queryKey: terminalQueryKeys.automationCallbacks(session) }),
      ]);
    },
  });
}

export function useToggleAutomationRuleStatusMutation(params: {
  session: BreezeSession | null;
  symbol: SymbolCode;
}): UseMutationResult<AutomationRule, Error, { rule: AutomationRule }> {
  const { session, symbol } = params;
  const queryClient = useQueryClient();
  return useMutation<AutomationRule, Error, { rule: AutomationRule }>({
    mutationFn: async ({ rule }) => {
      const nextStatus: AutomationRule['status'] = rule.status === 'active' ? 'paused' : 'active';
      if (!isBackendSession(session)) {
        const nextRule: AutomationRule = {
          ...rule,
          status: nextStatus,
          nextRun: nextStatus === 'active' ? 'Live' : 'Paused',
        };
        setAutomationFallbackRuleCache(queryClient, session, symbol, (current) => current.map((item) => item.id === rule.id ? nextRule : item));
        return nextRule;
      }
      const result = await brokerGatewayClient.automation.updateRuleStatus(session, rule.id, nextStatus);
      if (!result.ok || !result.rule) {
        throw new Error(result.error || 'Could not update automation rule status.');
      }
      return result.rule as AutomationRule;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: terminalQueryKeys.automationRules(session, symbol) }),
        queryClient.invalidateQueries({ queryKey: terminalQueryKeys.automationCallbacks(session) }),
      ]);
    },
  });
}

export function useEvaluateAutomationRulesMutation(params: {
  session: BreezeSession | null;
  symbol: SymbolCode;
}): UseMutationResult<{ count: number }, Error, void> {
  const { session, symbol } = params;
  const queryClient = useQueryClient();
  return useMutation<{ count: number }, Error, void>({
    mutationFn: async () => {
      if (!isBackendSession(session)) {
        throw new Error('Connect a backend session to evaluate automation rules.');
      }
      const result = await brokerGatewayClient.automation.evaluate(session);
      if (!result.ok) {
        throw new Error(result.error || 'Could not evaluate backend automation rules.');
      }
      return { count: result.count ?? 0 };
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: terminalQueryKeys.automationRules(session, symbol) }),
        queryClient.invalidateQueries({ queryKey: terminalQueryKeys.automationCallbacks(session) }),
      ]);
    },
  });
}
