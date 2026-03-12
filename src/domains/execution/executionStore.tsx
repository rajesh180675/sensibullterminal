import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { SYMBOL_CONFIG } from '../../config/market';
import type { ExecutionBlotterItem, ExecutionPreview, OptionLeg, Position } from '../../types/index';
import { brokerGatewayClient } from '../../services/broker/brokerGatewayClient';
import { useNotificationStore } from '../../stores/notificationStore';
import { buildPayoff, findBreakevens, maxProfitLoss } from '../../utils/math';
import { useSessionStore } from '../session/sessionStore';

let executionLegId = 0;
const nextExecutionLegId = () => `leg-${++executionLegId}-${Date.now()}`;
const nextBlotterId = () => `blotter-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

function buildExecutionPreview(legs: OptionLeg[]): ExecutionPreview {
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
  };
}

interface ExecutionStoreValue {
  legs: OptionLeg[];
  preview: ExecutionPreview;
  blotter: ExecutionBlotterItem[];
  isExecuting: boolean;
  addLeg: (leg: Omit<OptionLeg, 'id'>) => void;
  appendLegs: (legs: Array<Omit<OptionLeg, 'id'>>) => void;
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
  const [legs, setLegs] = useState<OptionLeg[]>([]);
  const [blotter, setBlotter] = useState<ExecutionBlotterItem[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);

  const addLeg = useCallback((leg: Omit<OptionLeg, 'id'>) => {
    setLegs((current) => [...current, { ...leg, id: nextExecutionLegId() }]);
  }, []);

  const appendLegs = useCallback((nextLegs: Array<Omit<OptionLeg, 'id'>>) => {
    setLegs((current) => [
      ...current,
      ...nextLegs.map((leg) => ({ ...leg, id: nextExecutionLegId() })),
    ]);
  }, []);

  const updateLeg = useCallback((id: string, update: Partial<OptionLeg>) => {
    setLegs((current) => current.map((leg) => leg.id === id ? { ...leg, ...update } : leg));
  }, []);

  const removeLeg = useCallback((id: string) => {
    setLegs((current) => current.filter((leg) => leg.id !== id));
  }, []);

  const clearLegs = useCallback(() => setLegs([]), []);
  const clearBlotter = useCallback(() => setBlotter([]), []);

  const loadPosition = useCallback((position: Position) => {
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

  const preview = useMemo(() => buildExecutionPreview(legs), [legs]);

  const executeStrategy = useCallback(async (selectedLegs: OptionLeg[]) => {
    if (selectedLegs.length === 0) return;

    const blotterId = nextBlotterId();
    const blotterBase: ExecutionBlotterItem = {
      id: blotterId,
      submittedAt: Date.now(),
      symbol: selectedLegs[0].symbol,
      legCount: selectedLegs.length,
      summary: selectedLegs.map((leg) => `${leg.action} ${leg.type} ${leg.strike}`).join(' | '),
      premium: buildExecutionPreview(selectedLegs).estimatedPremium,
      status: 'queued',
      response: 'Queued for broker dispatch.',
    };

    setBlotter((current) => [blotterBase, ...current].slice(0, 20));

    if (!session?.isConnected) {
      setBlotter((current) => current.map((item) => item.id === blotterId ? {
        ...item,
        status: 'failed',
        response: 'No broker session connected.',
      } : item));
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
    let successCount = 0;

    try {
      if (brokerGatewayClient.session.isBackend(session.proxyBase)) {
        const base = session.proxyBase.replace(/\/api\/?$/, '').replace(/\/$/, '');
        const response = await fetch(`${base}/api/strategy/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            legs: selectedLegs.map((leg) => ({
              stock_code: cfg.breezeStockCode,
              exchange_code: cfg.breezeExchangeCode,
              action: leg.action.toLowerCase(),
              quantity: String(leg.lots * cfg.lotSize),
              expiry_date: leg.expiry,
              right: leg.type === 'CE' ? 'call' : 'put',
              strike_price: String(leg.strike),
              order_type: leg.orderType ?? 'market',
              price: leg.orderType === 'limit' ? String(leg.limitPrice ?? leg.ltp) : '0',
            })),
          }),
        });

        const data = await response.json() as {
          results?: Array<{ success: boolean; order_id?: string; error?: string }>;
        };

        data.results?.forEach((result, index) => {
          const leg = selectedLegs[index];
          if (result.success) successCount += 1;
          results.push(result.success
            ? `${leg.type} ${leg.strike} ${leg.action} -> ${result.order_id}`
            : `${leg.type} ${leg.strike} failed -> ${result.error}`);
        });
      } else {
        for (const leg of selectedLegs) {
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
            successCount += 1;
            results.push(`${leg.type} ${leg.strike} ${leg.action} -> ${result.order_id}`);
          } catch (error) {
            results.push(error instanceof Error ? error.message : String(error));
          }
        }
      }
    } catch (error) {
      results.push(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExecuting(false);
    }

    const status = successCount === 0
      ? 'failed'
      : successCount === selectedLegs.length
        ? 'sent'
        : 'partial';

    setBlotter((current) => current.map((item) => item.id === blotterId ? {
      ...item,
      status,
      response: results.join(' | ') || 'No orders sent.',
    } : item));

    notify({
      title: 'Execution result',
      message: results.join(' | ') || 'No orders sent.',
      tone: status === 'failed' ? 'error' : status === 'partial' ? 'warning' : 'success',
    });
  }, [notify, session]);

  const value = useMemo(() => ({
    legs,
    preview,
    blotter,
    isExecuting,
    addLeg,
    appendLegs,
    updateLeg,
    removeLeg,
    clearLegs,
    loadPosition,
    clearBlotter,
    executeStrategy,
  }), [legs, preview, blotter, isExecuting, addLeg, appendLegs, updateLeg, removeLeg, clearLegs, loadPosition, clearBlotter, executeStrategy]);

  return <ExecutionStore.Provider value={value}>{children}</ExecutionStore.Provider>;
}

export function useExecutionStore() {
  const context = useContext(ExecutionStore);
  if (!context) throw new Error('useExecutionStore must be used within ExecutionProvider');
  return context;
}
