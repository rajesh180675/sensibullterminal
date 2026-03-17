import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SYMBOL_CONFIG } from '../../config/market';
import type { ExecutionBlotterItem, ExecutionPreview, OptionLeg, Position } from '../../types/index';
import { brokerGatewayClient } from '../../services/broker/brokerGatewayClient';
import {
  useCancelOrderMutation,
  usePlaceOrderMutation,
  usePreviewMutation,
} from '../../services/api/terminalQueryHooks';
import { useNotificationStore } from '../../stores/notificationStore';
import { buildPayoff, findBreakevens, maxProfitLoss } from '../../utils/math';
import { useMarketStore } from '../market/marketStore';
import { useSessionStore } from '../session/sessionStore';
import {
  createDraftBasket,
  finalizeBasket,
  findMatchingOrderRow,
  nextDraftBasketId,
  normalizeBrokerOrderStatus,
  updateBasketState,
  updateLegState,
} from './executionStateMachine';

let executionLegId = 0;
const nextExecutionLegId = () => `leg-${++executionLegId}-${Date.now()}`;

export function buildExecutionPreview(legs: OptionLeg[]): ExecutionPreview {
  if (legs.length === 0) {
    return {
      estimatedPremium: 0,
      estimatedFees: 0,
      slippage: 0,
      capitalAtRisk: 0,
      marginRequired: 0,
      maxProfit: 0,
      maxLoss: 0,
      breakevens: [],
      source: 'estimated',
      updatedAt: Date.now(),
    };
  }

  const lotSize = SYMBOL_CONFIG[legs[0].symbol].lotSize;
  const estimatedPremium = legs.reduce((total, leg) => (
    total + leg.ltp * (leg.action === 'BUY' ? -1 : 1) * leg.lots * lotSize
  ), 0);
  const turnover = legs.reduce((total, leg) => total + leg.ltp * leg.lots * lotSize, 0);
  const estimatedFees = Math.max(40, turnover * 0.00085);
  const slippage = turnover * 0.0006;
  const referenceSpot = legs.reduce((total, leg) => total + leg.strike, 0) / legs.length;
  const payoff = buildPayoff(legs, referenceSpot);
  const { maxProfit, maxLoss } = maxProfitLoss(payoff);
  const shortPremium = legs
    .filter((leg) => leg.action === 'SELL')
    .reduce((total, leg) => total + leg.ltp * leg.lots * lotSize, 0);
  const longPremium = legs
    .filter((leg) => leg.action === 'BUY')
    .reduce((total, leg) => total + leg.ltp * leg.lots * lotSize, 0);
  const capitalAtRisk = Math.max(longPremium + estimatedFees, Math.abs(maxLoss) + estimatedFees);
  const marginRequired = Math.max(capitalAtRisk, shortPremium * 1.25 + estimatedFees + slippage);

  return {
    estimatedPremium,
    estimatedFees,
    slippage,
    capitalAtRisk,
    marginRequired,
    maxProfit,
    maxLoss,
    breakevens: findBreakevens(payoff),
    source: 'estimated',
    updatedAt: Date.now(),
  };
}

export function buildBackendLegPayload(legs: OptionLeg[]) {
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

function enrichPreview(base: ExecutionPreview, patch?: Partial<ExecutionPreview>): ExecutionPreview {
  if (!patch) return base;
  return {
    ...base,
    ...patch,
    maxProfit: patch.maxProfit ?? base.maxProfit,
    maxLoss: patch.maxLoss ?? base.maxLoss,
    breakevens: patch.breakevens ?? base.breakevens,
  };
}

interface ExecutionStoreValue {
  legs: OptionLeg[];
  activeBasket: ExecutionBlotterItem | null;
  preview: ExecutionPreview;
  previewStatus: 'idle' | 'loading' | 'ready' | 'fallback';
  blotter: ExecutionBlotterItem[];
  isExecuting: boolean;
  recoveringBasketId: string | null;
  addLeg: (leg: Omit<OptionLeg, 'id'>) => void;
  appendLegs: (legs: Array<Omit<OptionLeg, 'id'>>) => void;
  stageStrategy: (legs: Array<Omit<OptionLeg, 'id'>>) => void;
  updateLeg: (id: string, update: Partial<OptionLeg>) => void;
  removeLeg: (id: string) => void;
  clearLegs: () => void;
  loadPosition: (position: Position) => void;
  clearBlotter: () => void;
  executeStrategy: (legs: OptionLeg[]) => Promise<void>;
  retryFailedBasket: (basketId: string) => Promise<void>;
  cancelRemainingBasket: (basketId: string) => Promise<void>;
  squareOffFilledBasket: (basketId: string) => Promise<void>;
  reconcileInterruptedBasket: (basketId: string) => Promise<void>;
}

const ExecutionStore = createContext<ExecutionStoreValue | null>(null);

export function ExecutionProvider({ children }: { children: React.ReactNode }) {
  const { notify } = useNotificationStore();
  const { session } = useSessionStore();
  const { stream } = useMarketStore();
  const previewMutation = usePreviewMutation(session);
  const placeOrderMutation = usePlaceOrderMutation(session);
  const cancelOrderMutation = useCancelOrderMutation(session);
  const [draftMeta, setDraftMeta] = useState<{ id: string; createdAt: number } | null>(null);
  const [legs, setLegs] = useState<OptionLeg[]>([]);
  const [blotter, setBlotter] = useState<ExecutionBlotterItem[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [recoveringBasketId, setRecoveringBasketId] = useState<string | null>(null);
  const localPreview = useMemo(() => buildExecutionPreview(legs), [legs]);
  const [preview, setPreview] = useState<ExecutionPreview>(localPreview);
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'ready' | 'fallback'>('idle');

  const addLeg = useCallback((leg: Omit<OptionLeg, 'id'>) => {
    setLegs((current) => {
      if (current.length === 0) setDraftMeta({ id: nextDraftBasketId(), createdAt: Date.now() });
      return [...current, { ...leg, id: nextExecutionLegId() }];
    });
  }, []);

  const appendLegs = useCallback((nextLegs: Array<Omit<OptionLeg, 'id'>>) => {
    setLegs((current) => {
      if (current.length === 0 && nextLegs.length > 0) setDraftMeta({ id: nextDraftBasketId(), createdAt: Date.now() });
      return [
        ...current,
        ...nextLegs.map((leg) => ({ ...leg, id: nextExecutionLegId() })),
      ];
    });
  }, []);

  const stageStrategy = useCallback((nextLegs: Array<Omit<OptionLeg, 'id'>>) => {
    setDraftMeta(nextLegs.length > 0 ? { id: nextDraftBasketId(), createdAt: Date.now() } : null);
    setLegs(nextLegs.map((leg) => ({ ...leg, id: nextExecutionLegId() })));
  }, []);

  const updateLeg = useCallback((id: string, update: Partial<OptionLeg>) => {
    setLegs((current) => current.map((leg) => leg.id === id ? { ...leg, ...update } : leg));
  }, []);

  const removeLeg = useCallback((id: string) => {
    setLegs((current) => current.filter((leg) => leg.id !== id));
  }, []);

  const clearLegs = useCallback(() => {
    setDraftMeta(null);
    setLegs([]);
  }, []);
  const clearBlotter = useCallback(() => setBlotter([]), []);

  const loadPosition = useCallback((position: Position) => {
    setDraftMeta({ id: nextDraftBasketId(), createdAt: Date.now() });
    setLegs(position.legs.map((leg) => ({
      id: nextExecutionLegId(),
      symbol: position.symbol,
      type: leg.type,
      strike: leg.strike,
      action: leg.action,
      lots: leg.lots,
      ltp: leg.currentPrice,
      iv: 14,
      delta: leg.type === 'CE' ? 0.45 : -0.45,
      theta: -2.5,
      gamma: 0.0002,
      vega: 0.15,
      expiry: position.expiry,
    })));
  }, []);

  useEffect(() => {
    setPreview(localPreview);
    if (legs.length === 0) {
      setPreviewStatus('idle');
      return;
    }

    if (!session?.isConnected || !brokerGatewayClient.session.isBackend(session.proxyBase)) {
      setPreviewStatus('fallback');
      return;
    }

    let cancelled = false;
    setPreviewStatus('loading');

    const loadPreview = async () => {
      const merged = enrichPreview(localPreview, await previewMutation.mutateAsync(legs));
      if (cancelled) return;
      setPreview(merged);
      setPreviewStatus('ready');
    };

    void loadPreview().catch((error) => {
      if (cancelled) return;
      setPreview(localPreview);
      setPreviewStatus('fallback');
      notify({
        title: 'Backend preview failed',
        message: error instanceof Error ? error.message : String(error),
        tone: 'warning',
      });
    });

    return () => {
      cancelled = true;
    };
  }, [legs, localPreview, notify, previewMutation, session]);

  const activeBasket = useMemo<ExecutionBlotterItem | null>(() => {
    if (legs.length === 0 || !draftMeta) return null;
    return createDraftBasket({
      basketId: draftMeta.id,
      createdAt: draftMeta.createdAt,
      symbol: legs[0].symbol,
      legs,
      preview,
      previewStatus,
    });
  }, [draftMeta, legs, preview, previewStatus]);

  const patchBlotterItem = useCallback((basketId: string, updater: (item: ExecutionBlotterItem) => ExecutionBlotterItem) => {
    setBlotter((current) => current.map((item) => item.id === basketId ? updater(item) : item));
  }, []);

  const legSnapshotMap = useCallback((item: ExecutionBlotterItem) => {
    return new Map((item.legsSnapshot ?? []).map((leg) => [leg.id, leg] as const));
  }, []);

  const executeStrategy = useCallback(async (selectedLegs: OptionLeg[]) => {
    if (selectedLegs.length === 0) return;

    const usesActiveDraft = !!(activeBasket && activeBasket.legStates?.every((leg) => selectedLegs.some((candidate) => candidate.id === leg.legId)));
    const submittedAt = Date.now();
    const blotterId = usesActiveDraft
      ? activeBasket.id
      : nextDraftBasketId();
    const blotterBase: ExecutionBlotterItem = {
      ...(activeBasket ?? createDraftBasket({
        basketId: blotterId,
        createdAt: submittedAt,
        symbol: selectedLegs[0].symbol,
        legs: selectedLegs,
        preview,
        previewStatus,
      })),
      id: blotterId,
      submittedAt,
      status: 'sending',
      response: 'Sending basket sequentially to the broker.',
    };

    setBlotter((current) => [blotterBase, ...current].slice(0, 20));
    if (usesActiveDraft) {
      setDraftMeta({ id: nextDraftBasketId(), createdAt: Date.now() });
    }

    if (!stream.canTrade) {
      patchBlotterItem(blotterId, (item) => updateBasketState(item, {
            status: 'all_failed',
            response: `Execution blocked. ${stream.detail}`,
            completedAt: Date.now(),
            recoveryAction: 'none',
          }));
      notify({
        title: 'Execution blocked',
        message: stream.detail,
        tone: 'warning',
      });
      return;
    }

    if (!session?.isConnected) {
      patchBlotterItem(blotterId, (item) => updateBasketState(item, {
            status: 'all_failed',
            response: 'No broker session connected.',
            completedAt: Date.now(),
            recoveryAction: 'none',
          }));
      notify({
        title: 'Broker not connected',
        message: 'Open Connections and validate a live session before executing orders.',
        tone: 'warning',
      });
      return;
    }

    setIsExecuting(true);
    const results: string[] = [];
    let basketInterrupted = false;

    try {
      for (let index = 0; index < selectedLegs.length; index += 1) {
        const leg = selectedLegs[index];
        patchBlotterItem(blotterId, (item) => updateLegState(item, leg.id, { status: 'sending', sentAt: Date.now(), updatedAt: Date.now() }));
        try {
          const result = await placeOrderMutation.mutateAsync(leg);
          results.push(`${leg.type} ${leg.strike} ${leg.action} -> ${result.orderId}`);
          patchBlotterItem(blotterId, (item) => updateLegState(item, leg.id, {
            status: 'pending',
            orderId: result.orderId,
            updatedAt: Date.now(),
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push(`${leg.type} ${leg.strike} failed -> ${message}`);
          patchBlotterItem(blotterId, (item) => updateBasketState(
            updateLegState(item, leg.id, {
              status: message.toLowerCase().includes('reject') ? 'rejected' : 'failed',
              error: message,
              updatedAt: Date.now(),
            }),
            {
              status: index === 0 ? 'all_failed' : 'partial_failure',
              recoveryAction: index === 0 ? 'none' : 'manual_intervention',
            },
          ));
          basketInterrupted = true;
          break;
        }
      }
    } catch (error) {
      results.push(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExecuting(false);
    }

    patchBlotterItem(blotterId, (item) => finalizeBasket(
          updateBasketState(item, {
            status: basketInterrupted ? item.status : 'partial_fill',
          }),
          results.join(' | ') || 'No orders sent.',
        ));

    notify({
      title: 'Execution result',
      message: results.join(' | ') || 'No orders sent.',
      tone: basketInterrupted && results.length <= 1 ? 'error' : basketInterrupted ? 'warning' : 'success',
    });
  }, [activeBasket, notify, patchBlotterItem, placeOrderMutation, preview, previewStatus, session, stream]);

  const retryFailedBasket = useCallback(async (basketId: string) => {
    if (!session?.isConnected) return;
    const basket = blotter.find((item) => item.id === basketId);
    if (!basket) return;
    const snapshotById = legSnapshotMap(basket);
    const retryLegs = (basket.legStates ?? [])
      .filter((leg) => leg.status === 'failed' || leg.status === 'rejected')
      .map((leg) => snapshotById.get(leg.legId))
      .filter((leg): leg is OptionLeg => Boolean(leg));
    if (retryLegs.length === 0) return;

    setRecoveringBasketId(basketId);
    const messages: string[] = [];
    try {
      patchBlotterItem(basketId, (item) => updateBasketState(item, {
        status: 'sending',
        response: 'Retrying failed legs.',
        recoveryAction: 'retry_failed',
      }));

      for (const leg of retryLegs) {
        patchBlotterItem(basketId, (item) => updateLegState(item, leg.id, {
          status: 'sending',
          updatedAt: Date.now(),
        }));
        try {
          const result = await placeOrderMutation.mutateAsync(leg);
          messages.push(`${leg.type} ${leg.strike} retried -> ${result.orderId}`);
          patchBlotterItem(basketId, (item) => updateLegState(item, leg.id, {
            status: 'pending',
            orderId: result.orderId,
            error: undefined,
            updatedAt: Date.now(),
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          messages.push(`${leg.type} ${leg.strike} retry failed -> ${message}`);
          patchBlotterItem(basketId, (item) => updateLegState(item, leg.id, {
            status: 'failed',
            error: message,
            updatedAt: Date.now(),
          }));
        }
      }

      patchBlotterItem(basketId, (item) => finalizeBasket(item, messages.join(' | ') || 'Retry attempted.'));
    } finally {
      setRecoveringBasketId(null);
    }
  }, [blotter, legSnapshotMap, patchBlotterItem, placeOrderMutation, session]);

  const cancelRemainingBasket = useCallback(async (basketId: string) => {
    if (!session?.isConnected) return;
    const basket = blotter.find((item) => item.id === basketId);
    if (!basket) return;
    const pendingLegs = (basket.legStates ?? []).filter((leg) => leg.status === 'pending' && leg.orderId);
    if (pendingLegs.length === 0) return;

    setRecoveringBasketId(basketId);
    const messages: string[] = [];
    try {
      for (const leg of pendingLegs) {
        try {
          await cancelOrderMutation.mutateAsync({
            orderId: leg.orderId!,
            exchangeCode: SYMBOL_CONFIG[basket.symbol].breezeExchangeCode,
          });
          messages.push(`${leg.summary} cancelled`);
          patchBlotterItem(basketId, (item) => updateLegState(item, leg.legId, {
            status: 'cancelled',
            updatedAt: Date.now(),
          }));
        } catch (error) {
          messages.push(`${leg.summary} cancel failed -> ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      patchBlotterItem(basketId, (item) => {
        const next = finalizeBasket(updateBasketState(item, {
          recoveryAction: 'cancel_remaining',
        }), messages.join(' | ') || 'Cancel attempted.');
        return next.status === 'all_failed'
          ? updateBasketState(next, { status: 'cancelled' })
          : next;
      });
    } finally {
      setRecoveringBasketId(null);
    }
  }, [blotter, cancelOrderMutation, patchBlotterItem, session]);

  const squareOffFilledBasket = useCallback(async (basketId: string) => {
    if (!session?.isConnected) return;
    const basket = blotter.find((item) => item.id === basketId);
    if (!basket) return;
    const snapshotById = legSnapshotMap(basket);
    const liveLegs = (basket.legStates ?? [])
      .filter((leg) => leg.status === 'pending' || leg.status === 'filled')
      .map((leg) => snapshotById.get(leg.legId))
      .filter((leg): leg is OptionLeg => Boolean(leg));
    if (liveLegs.length === 0) return;

    setRecoveringBasketId(basketId);
    const messages: string[] = [];
    try {
      for (const leg of liveLegs) {
        const cfg = SYMBOL_CONFIG[leg.symbol];
        const result = await brokerGatewayClient.orders.squareOffLeg(session, {
          stockCode: cfg.breezeStockCode,
          exchangeCode: cfg.breezeExchangeCode,
          action: leg.action === 'BUY' ? 'SELL' : 'BUY',
          quantity: String(leg.lots * cfg.lotSize),
          expiryDate: leg.expiry,
          right: leg.type === 'CE' ? 'call' : 'put',
          strikePrice: String(leg.strike),
          orderType: leg.orderType ?? 'market',
          price: leg.orderType === 'limit' ? String(leg.limitPrice ?? leg.ltp) : '0',
        });
        if (result.ok) {
          messages.push(`${leg.type} ${leg.strike} square-off -> ${result.orderId}`);
          patchBlotterItem(basketId, (item) => updateLegState(item, leg.id, {
            error: `Squared off via ${result.orderId}`,
            updatedAt: Date.now(),
          }));
        } else {
          messages.push(`${leg.type} ${leg.strike} square-off failed -> ${result.error || 'Unknown error'}`);
        }
      }

      patchBlotterItem(basketId, (item) => updateBasketState(item, {
        response: messages.join(' | ') || 'Square-off attempted.',
        recoveryAction: 'square_off_filled',
      }));
    } finally {
      setRecoveringBasketId(null);
    }
  }, [blotter, legSnapshotMap, patchBlotterItem, session]);

  const reconcileInterruptedBasket = useCallback(async (basketId: string) => {
    if (!session?.isConnected) return;
    const basket = blotter.find((item) => item.id === basketId);
    if (!basket) return;

    const ambiguousLegs = (basket.legStates ?? []).filter((leg) => leg.status === 'failed' || leg.status === 'sending');
    if (ambiguousLegs.length === 0) return;

    setRecoveringBasketId(basketId);
    try {
      patchBlotterItem(basketId, (item) => updateBasketState(item, {
        response: 'Reconciling basket against broker order book...',
        recoveryAction: item.recoveryAction === 'none' ? 'manual_intervention' : item.recoveryAction,
      }));

      const ordersResult = await brokerGatewayClient.portfolio.fetchOrders(session);
      if (!ordersResult.ok) {
        patchBlotterItem(basketId, (item) => updateBasketState(item, {
          response: `Order-book reconciliation failed: ${ordersResult.error || 'Unknown error'}`,
        }));
        return;
      }

      const snapshotById = legSnapshotMap(basket);
      const messages: string[] = [];

      for (const legState of ambiguousLegs) {
        const leg = snapshotById.get(legState.legId);
        if (!leg) continue;
        const cfg = SYMBOL_CONFIG[leg.symbol];
        const quantity = String(leg.lots * cfg.lotSize);
        const row = findMatchingOrderRow(leg, cfg.breezeStockCode, quantity, ordersResult.data);

        if (!row) {
          messages.push(`${legState.summary} not found in order book`);
          patchBlotterItem(basketId, (item) => updateLegState(item, leg.id, {
            error: 'Not found during reconciliation.',
            brokerStatus: 'not_found',
            reconciledAt: Date.now(),
            updatedAt: Date.now(),
          }));
          continue;
        }

        const brokerState = normalizeBrokerOrderStatus(row.status);
        if (brokerState === 'filled') {
          messages.push(`${legState.summary} reconciled as filled`);
          patchBlotterItem(basketId, (item) => updateLegState(item, leg.id, {
            status: 'filled',
            orderId: row.order_id,
            brokerStatus: row.status,
            error: undefined,
            reconciledAt: Date.now(),
            updatedAt: Date.now(),
          }));
        } else if (brokerState === 'pending') {
          messages.push(`${legState.summary} reconciled as pending`);
          patchBlotterItem(basketId, (item) => updateLegState(item, leg.id, {
            status: 'pending',
            orderId: row.order_id,
            brokerStatus: row.status,
            error: undefined,
            reconciledAt: Date.now(),
            updatedAt: Date.now(),
          }));
        } else if (brokerState === 'cancelled') {
          messages.push(`${legState.summary} reconciled as cancelled`);
          patchBlotterItem(basketId, (item) => updateLegState(item, leg.id, {
            status: 'cancelled',
            orderId: row.order_id,
            brokerStatus: row.status,
            reconciledAt: Date.now(),
            updatedAt: Date.now(),
          }));
        } else if (brokerState === 'rejected') {
          messages.push(`${legState.summary} reconciled as rejected`);
          patchBlotterItem(basketId, (item) => updateLegState(item, leg.id, {
            status: 'rejected',
            orderId: row.order_id,
            brokerStatus: row.status,
            error: 'Broker rejected the order.',
            reconciledAt: Date.now(),
            updatedAt: Date.now(),
          }));
        } else {
          messages.push(`${legState.summary} found with unknown broker status ${row.status}`);
          patchBlotterItem(basketId, (item) => updateLegState(item, leg.id, {
            orderId: row.order_id,
            brokerStatus: row.status,
            reconciledAt: Date.now(),
            updatedAt: Date.now(),
          }));
        }
      }

      patchBlotterItem(basketId, (item) => finalizeBasket(item, messages.join(' | ') || 'Reconciliation complete.'));
    } finally {
      setRecoveringBasketId(null);
    }
  }, [blotter, legSnapshotMap, patchBlotterItem, session]);

  const value = useMemo(() => ({
    legs,
    activeBasket,
    preview,
    previewStatus,
    blotter,
    isExecuting,
    recoveringBasketId,
    addLeg,
    appendLegs,
    stageStrategy,
    updateLeg,
    removeLeg,
    clearLegs,
    loadPosition,
    clearBlotter,
    executeStrategy,
    retryFailedBasket,
    cancelRemainingBasket,
    squareOffFilledBasket,
    reconcileInterruptedBasket,
  }), [legs, activeBasket, preview, previewStatus, blotter, isExecuting, recoveringBasketId, addLeg, appendLegs, stageStrategy, updateLeg, removeLeg, clearLegs, loadPosition, clearBlotter, executeStrategy, retryFailedBasket, cancelRemainingBasket, squareOffFilledBasket, reconcileInterruptedBasket]);

  return <ExecutionStore.Provider value={value}>{children}</ExecutionStore.Provider>;
}

export function useExecutionStore() {
  const context = useContext(ExecutionStore);
  if (!context) throw new Error('useExecutionStore must be used within ExecutionProvider');
  return context;
}
