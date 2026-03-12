import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AutomationCallbackEvent, AutomationRule, SymbolCode } from '../../types/index';
import { brokerGatewayClient } from '../../services/broker/brokerGatewayClient';
import { useNotificationStore } from '../../stores/notificationStore';
import { useExecutionStore } from '../execution/executionStore';
import { useMarketStore } from '../market/marketStore';
import { useSessionStore } from '../session/sessionStore';

function seedRules(symbol: SymbolCode): AutomationRule[] {
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

interface AutomationStoreValue {
  rules: AutomationRule[];
  callbacks: AutomationCallbackEvent[];
  syncStatus: 'idle' | 'loading' | 'ready' | 'fallback';
  createRuleFromStrategy: () => Promise<void>;
  toggleRuleStatus: (id: string) => Promise<void>;
  evaluateRules: () => Promise<void>;
}

const AutomationStore = createContext<AutomationStoreValue | null>(null);

export function AutomationProvider({ children }: { children: React.ReactNode }) {
  const { notify } = useNotificationStore();
  const { symbol, spotPrice } = useMarketStore();
  const { legs } = useExecutionStore();
  const { session } = useSessionStore();
  const [rules, setRules] = useState<AutomationRule[]>(() => seedRules(symbol));
  const [callbacks, setCallbacks] = useState<AutomationCallbackEvent[]>([]);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'loading' | 'ready' | 'fallback'>('idle');

  const backendReady = Boolean(session?.isConnected && session.proxyBase && brokerGatewayClient.session.isBackend(session.proxyBase));

  const loadBackendState = useCallback(async () => {
    if (!session || !backendReady) {
      setRules(seedRules(symbol));
      setCallbacks([]);
      setSyncStatus('fallback');
      return;
    }
    setSyncStatus('loading');
    const [rulesResult, callbacksResult] = await Promise.all([
      brokerGatewayClient.automation.fetchRules(session),
      brokerGatewayClient.automation.fetchCallbacks(session, 25),
    ]);
    if (!rulesResult.ok) {
      setRules(seedRules(symbol));
      setCallbacks([]);
      setSyncStatus('fallback');
      notify({
        title: 'Automation backend unavailable',
        message: rulesResult.error || 'Falling back to local automation drafts.',
        tone: 'warning',
      });
      return;
    }
    setRules(rulesResult.rules as AutomationRule[] ?? []);
    setCallbacks(callbacksResult.events as AutomationCallbackEvent[] ?? []);
    setSyncStatus('ready');
  }, [backendReady, notify, session, symbol]);

  useEffect(() => {
    void loadBackendState();
  }, [loadBackendState]);

  const createRuleFromStrategy = useCallback(async () => {
    if (legs.length === 0) {
      notify({
        title: 'No staged strategy',
        message: 'Build or load a strategy before creating an automation rule.',
        tone: 'warning',
      });
      return;
    }

    const lowerPrice = Math.max(1, Math.round(spotPrice * 0.995));
    const upperPrice = Math.round(spotPrice * 1.005);
    const draftRule: AutomationRule = {
      id: `rule-${Date.now()}`,
      name: `${symbol} staged exit`,
      kind: 'gtt',
      status: backendReady ? 'active' : 'draft',
      scope: `${legs.length} staged legs`,
      trigger: `Underlying breaks ${lowerPrice} / ${upperPrice}`,
      action: 'Place staged exit orders and record broker callback results',
      lastRun: 'Never',
      nextRun: backendReady ? 'Live' : 'Pending review',
      notes: backendReady
        ? 'Persisted to backend automation engine.'
        : 'Created locally. Connect a backend session to persist and evaluate it.',
      symbol,
      triggerConfig: {
        type: 'spot_range_break',
        referencePrice: spotPrice,
        lowerPrice,
        upperPrice,
      },
      actionConfig: {
        type: 'execute_strategy',
        legs: legs.map((leg) => ({
          symbol: leg.symbol,
          type: leg.type,
          strike: leg.strike,
          action: leg.action,
          lots: leg.lots,
          expiry: leg.expiry,
          orderType: leg.orderType ?? 'market',
          limitPrice: leg.limitPrice,
        })),
        message: `Auto-exit if ${symbol} breaks the staged guardrail.`,
      },
      runCount: 0,
      updatedAt: Date.now(),
    };

    if (!session || !backendReady) {
      setRules((current) => [draftRule, ...current]);
      setSyncStatus('fallback');
      notify({
        title: 'Automation draft created',
        message: draftRule.name,
        tone: 'success',
      });
      return;
    }

    const result = await brokerGatewayClient.automation.createRule(session, draftRule as unknown as Record<string, unknown>);
    if (!result.ok || !result.rule) {
      notify({
        title: 'Automation rule failed',
        message: result.error || 'Could not persist automation rule to backend.',
        tone: 'error',
      });
      return;
    }

    setRules((current) => [result.rule as AutomationRule, ...current.filter((rule) => rule.id !== result.rule?.id)]);
    notify({
      title: 'Automation rule created',
      message: result.rule.name,
      tone: 'success',
    });
    const callbackResult = await brokerGatewayClient.automation.fetchCallbacks(session, 25);
    if (callbackResult.ok) {
      setCallbacks(callbackResult.events as AutomationCallbackEvent[] ?? []);
    }
  }, [backendReady, legs, notify, session, spotPrice, symbol]);

  const toggleRuleStatus = useCallback(async (id: string) => {
    const current = rules.find((rule) => rule.id === id);
    if (!current) return;
    const nextStatus = current.status === 'active' ? 'paused' : 'active';

    if (!session || !backendReady) {
      setRules((existing) => existing.map((rule) => (
        rule.id === id ? { ...rule, status: nextStatus, nextRun: nextStatus === 'active' ? 'Live' : 'Paused' } : rule
      )));
      return;
    }

    const result = await brokerGatewayClient.automation.updateRuleStatus(session, id, nextStatus);
    if (!result.ok || !result.rule) {
      notify({
        title: 'Automation update failed',
        message: result.error || 'Could not update automation rule status.',
        tone: 'error',
      });
      return;
    }

    setRules((existing) => existing.map((rule) => rule.id === id ? result.rule as AutomationRule : rule));
    const callbackResult = await brokerGatewayClient.automation.fetchCallbacks(session, 25);
    if (callbackResult.ok) {
      setCallbacks(callbackResult.events as AutomationCallbackEvent[] ?? []);
    }
  }, [backendReady, notify, rules, session]);

  const evaluateRules = useCallback(async () => {
    if (!session || !backendReady) {
      notify({
        title: 'Backend required',
        message: 'Connect a backend session to evaluate automation rules.',
        tone: 'warning',
      });
      return;
    }
    const result = await brokerGatewayClient.automation.evaluate(session);
    if (!result.ok) {
      notify({
        title: 'Automation evaluation failed',
        message: result.error || 'Could not evaluate backend automation rules.',
        tone: 'error',
      });
      return;
    }
    await loadBackendState();
    notify({
      title: 'Automation evaluated',
      message: `${result.count ?? 0} automation event(s) recorded.`,
      tone: 'success',
    });
  }, [backendReady, loadBackendState, notify, session]);

  const value = useMemo(() => ({
    rules,
    callbacks,
    syncStatus,
    createRuleFromStrategy,
    toggleRuleStatus,
    evaluateRules,
  }), [rules, callbacks, syncStatus, createRuleFromStrategy, toggleRuleStatus, evaluateRules]);

  return <AutomationStore.Provider value={value}>{children}</AutomationStore.Provider>;
}

export function useAutomationStore() {
  const context = useContext(AutomationStore);
  if (!context) throw new Error('useAutomationStore must be used within AutomationProvider');
  return context;
}
