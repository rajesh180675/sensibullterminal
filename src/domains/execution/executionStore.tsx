import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { SYMBOL_CONFIG } from '../../config/market';
import type { OptionLeg, Position } from '../../types/index';
import { brokerGatewayClient } from '../../services/broker/brokerGatewayClient';
import { useNotificationStore } from '../../stores/notificationStore';
import { useSessionStore } from '../session/sessionStore';

let executionLegId = 0;
const nextExecutionLegId = () => `leg-${++executionLegId}-${Date.now()}`;

interface ExecutionStoreValue {
  legs: OptionLeg[];
  addLeg: (leg: Omit<OptionLeg, 'id'>) => void;
  appendLegs: (legs: Array<Omit<OptionLeg, 'id'>>) => void;
  updateLeg: (id: string, update: Partial<OptionLeg>) => void;
  removeLeg: (id: string) => void;
  clearLegs: () => void;
  loadPosition: (position: Position) => void;
  executeStrategy: (legs: OptionLeg[]) => Promise<void>;
}

const ExecutionStore = createContext<ExecutionStoreValue | null>(null);

export function ExecutionProvider({ children }: { children: React.ReactNode }) {
  const { notify } = useNotificationStore();
  const { session } = useSessionStore();
  const [legs, setLegs] = useState<OptionLeg[]>([]);

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

  const executeStrategy = useCallback(async (selectedLegs: OptionLeg[]) => {
    if (!session?.isConnected) {
      notify({
        title: 'Broker not connected',
        message: 'Open Connections and validate a live session before executing orders.',
        tone: 'warning',
      });
      return;
    }

    const cfg = SYMBOL_CONFIG[selectedLegs[0]?.symbol ?? 'NIFTY'];
    const results: string[] = [];

    if (brokerGatewayClient.session.isBackend(session.proxyBase)) {
      try {
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
          results.push(result.success
            ? `${leg.type} ${leg.strike} ${leg.action} -> ${result.order_id}`
            : `${leg.type} ${leg.strike} failed -> ${result.error}`);
        });
      } catch (error) {
        results.push(error instanceof Error ? error.message : String(error));
      }
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
          results.push(`${leg.type} ${leg.strike} ${leg.action} -> ${result.order_id}`);
        } catch (error) {
          results.push(error instanceof Error ? error.message : String(error));
        }
      }
    }

    notify({
      title: 'Execution result',
      message: results.join(' | ') || 'No orders sent.',
      tone: 'info',
    });
  }, [session, notify]);

  const value = useMemo(() => ({
    legs,
    addLeg,
    appendLegs,
    updateLeg,
    removeLeg,
    clearLegs,
    loadPosition,
    executeStrategy,
  }), [legs, addLeg, appendLegs, updateLeg, removeLeg, clearLegs, loadPosition, executeStrategy]);

  return <ExecutionStore.Provider value={value}>{children}</ExecutionStore.Provider>;
}

export function useExecutionStore() {
  const context = useContext(ExecutionStore);
  if (!context) throw new Error('useExecutionStore must be used within ExecutionProvider');
  return context;
}
