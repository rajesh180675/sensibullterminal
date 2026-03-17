import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SYMBOL_CONFIG } from '../../config/market';
import type { ExecutionBlotterItem, ExecutionPreview, ExecutionValidationSummary, OptionLeg, Position } from '../../types/index';
import { brokerGatewayClient } from '../../services/broker/brokerGatewayClient';
import { useNotificationStore } from '../../stores/notificationStore';
import { buildPayoff, findBreakevens, maxProfitLoss } from '../../utils/math';
import { useMarketStore } from '../market/marketStore';
import { useSessionStore } from '../session/sessionStore';
import {
  createDraftBasket,
  finalizeBasket,
  nextDraftBasketId,
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

function mergeValidation(
  previewValidation?: ExecutionValidationSummary,
  marginValidation?: ExecutionValidationSummary,
): ExecutionValidationSummary | undefined {
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

interface ExecutionStoreValue {
  legs: OptionLeg[];
  activeBasket: ExecutionBlotterItem | null;
  preview: ExecutionPreview;
  previewStatus: 'idle' | 'loading' | 'ready' | 'fallback';
  blotter: ExecutionBlotterItem[];
  isExecuting: boolean;
  addLeg: (leg: Omit<OptionLeg, 'id'>) => void;
  appendLegs: (legs: Array<Omit<OptionLeg, 'id'>>) => void;
  stageStrategy: (legs: Array<Omit<OptionLeg, 'id'>>) => void;
  updateLeg: (id: string, update: Partial<OptionLeg>) => void;
  removeLeg: (id: string) => void;
  clearLegs: () => void;
  loadPosition: (position: Position) => void;
  clearBlotter: () => void;
  executeStrategy: (legs: OptionLeg[]) => Promise<void>;
}

const ExecutionStore = createContext<ExecutionStoreValue | null>(null);

export function ExecutionProvider({ children }: { children: React.ReactNode }) {
  const { notify } = useNotificationStore();
  const { session } = useSessionStore();
  const { stream } = useMarketStore();
  const [draftMeta, setDraftMeta] = useState<{ id: string; createdAt: number } | null>(null);
  const [legs, setLegs] = useState<OptionLeg[]>([]);
  const [blotter, setBlotter] = useState<ExecutionBlotterItem[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
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
      const requestLegs = buildBackendLegPayload(legs);
      const [previewResult, marginResult] = await Promise.all([
        brokerGatewayClient.execution.previewStrategy(session, requestLegs),
        brokerGatewayClient.execution.fetchMargin(session, legs),
      ]);

      if (cancelled) return;

      if (!previewResult.ok && !marginResult.ok) {
        setPreview(localPreview);
        setPreviewStatus('fallback');
        notify({
          title: 'Backend preview unavailable',
          message: previewResult.error || marginResult.error || 'Falling back to local execution estimates.',
          tone: 'warning',
        });
        return;
      }

      const merged = enrichPreview(localPreview, {
        ...previewResult.data,
        ...marginResult.data,
        source: 'backend',
        updatedAt: previewResult.data?.updated_at ?? marginResult.data?.updated_at ?? Date.now(),
        validation: mergeValidation(previewResult.data?.validation, marginResult.data?.validation),
      });
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
  }, [legs, localPreview, notify, session]);

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
      setBlotter((current) => current.map((item) => item.id === blotterId
        ? updateBasketState(item, {
            status: 'all_failed',
            response: `Execution blocked. ${stream.detail}`,
            completedAt: Date.now(),
            recoveryAction: 'none',
          })
        : item));
      notify({
        title: 'Execution blocked',
        message: stream.detail,
        tone: 'warning',
      });
      return;
    }

    if (!session?.isConnected) {
      setBlotter((current) => current.map((item) => item.id === blotterId
        ? updateBasketState(item, {
            status: 'all_failed',
            response: 'No broker session connected.',
            completedAt: Date.now(),
            recoveryAction: 'none',
          })
        : item));
      notify({
        title: 'Broker not connected',
        message: 'Open Connections and validate a live session before executing orders.',
        tone: 'warning',
      });
      return;
    }

    setIsExecuting(true);
    const cfg = SYMBOL_CONFIG[selectedLegs[0].symbol];
    const results: string[] = [];
    let basketInterrupted = false;

    try {
      if (brokerGatewayClient.session.isBackend(session.proxyBase)) {
        const base = session.proxyBase.replace(/\/api\/?$/, '').replace(/\/$/, '');
        for (let index = 0; index < selectedLegs.length; index += 1) {
          const leg = selectedLegs[index];
          setBlotter((current) => current.map((item) => item.id === blotterId
            ? updateLegState(item, leg.id, { status: 'sending', sentAt: Date.now(), updatedAt: Date.now() })
            : item));

          try {
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

            if (result?.success) {
              results.push(`${leg.type} ${leg.strike} ${leg.action} -> ${result.order_id}`);
              setBlotter((current) => current.map((item) => item.id === blotterId
                ? updateLegState(item, leg.id, {
                    status: 'pending',
                    orderId: result.order_id,
                    updatedAt: Date.now(),
                  })
                : item));
            } else {
              const error = result?.error || 'Rejected by broker.';
              results.push(`${leg.type} ${leg.strike} failed -> ${error}`);
              setBlotter((current) => current.map((item) => item.id === blotterId ? updateBasketState(
                updateLegState(item, leg.id, {
                  status: 'rejected',
                  error,
                  updatedAt: Date.now(),
                }),
                {
                  status: index === 0 ? 'all_failed' : 'partial_failure',
                  recoveryAction: index === 0 ? 'none' : 'manual_intervention',
                },
              ) : item));
              basketInterrupted = true;
              break;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            results.push(`${leg.type} ${leg.strike} failed -> ${message}`);
            setBlotter((current) => current.map((item) => item.id === blotterId ? updateBasketState(
              updateLegState(item, leg.id, {
                status: 'failed',
                error: message,
                updatedAt: Date.now(),
              }),
              {
                status: index === 0 ? 'all_failed' : 'partial_failure',
                recoveryAction: index === 0 ? 'none' : 'manual_intervention',
              },
            ) : item));
            basketInterrupted = true;
            break;
          }
        }
      } else {
        for (const leg of selectedLegs) {
          setBlotter((current) => current.map((item) => item.id === blotterId
            ? updateLegState(item, leg.id, { status: 'sending', sentAt: Date.now(), updatedAt: Date.now() })
            : item));
          try {
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
            results.push(`${leg.type} ${leg.strike} ${leg.action} -> ${result.order_id}`);
            setBlotter((current) => current.map((item) => item.id === blotterId
              ? updateLegState(item, leg.id, {
                  status: 'pending',
                  orderId: result.order_id,
                  updatedAt: Date.now(),
                })
              : item));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            results.push(`${leg.type} ${leg.strike} failed -> ${message}`);
            setBlotter((current) => current.map((item) => item.id === blotterId ? updateBasketState(
              updateLegState(item, leg.id, {
                status: 'failed',
                error: message,
                updatedAt: Date.now(),
              }),
              {
                status: results.length === 1 ? 'all_failed' : 'partial_failure',
                recoveryAction: results.length === 1 ? 'none' : 'manual_intervention',
              },
            ) : item));
            basketInterrupted = true;
            break;
          }
        }
      }
    } catch (error) {
      results.push(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExecuting(false);
    }

    setBlotter((current) => current.map((item) => item.id === blotterId
      ? finalizeBasket(
          updateBasketState(item, {
            status: basketInterrupted ? item.status : 'partial_fill',
          }),
          results.join(' | ') || 'No orders sent.',
        )
      : item));

    notify({
      title: 'Execution result',
      message: results.join(' | ') || 'No orders sent.',
      tone: basketInterrupted && results.length <= 1 ? 'error' : basketInterrupted ? 'warning' : 'success',
    });
  }, [activeBasket, notify, preview, previewStatus, session, stream]);

  const value = useMemo(() => ({
    legs,
    activeBasket,
    preview,
    previewStatus,
    blotter,
    isExecuting,
    addLeg,
    appendLegs,
    stageStrategy,
    updateLeg,
    removeLeg,
    clearLegs,
    loadPosition,
    clearBlotter,
    executeStrategy,
  }), [legs, activeBasket, preview, previewStatus, blotter, isExecuting, addLeg, appendLegs, stageStrategy, updateLeg, removeLeg, clearLegs, loadPosition, clearBlotter, executeStrategy]);

  return <ExecutionStore.Provider value={value}>{children}</ExecutionStore.Provider>;
}

export function useExecutionStore() {
  const context = useContext(ExecutionStore);
  if (!context) throw new Error('useExecutionStore must be used within ExecutionProvider');
  return context;
}
