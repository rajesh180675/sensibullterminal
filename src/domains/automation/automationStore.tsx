import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AutomationRule } from '../../types/index';
import { useNotificationStore } from '../../stores/notificationStore';
import { useExecutionStore } from '../execution/executionStore';
import { useMarketStore } from '../market/marketStore';

function seedRules(symbol: string): AutomationRule[] {
  const today = new Date();
  return [
    {
      id: 'rule-gtt-condor',
      name: 'Condor stop cluster',
      kind: 'gtt',
      status: 'active',
      scope: `${symbol} weekly spreads`,
      trigger: 'Net loss breaches -25% of collected credit',
      action: 'Place hedge buyback for short wings and raise long-wing target',
      lastRun: 'Today 09:26',
      nextRun: 'Live',
      notes: 'Intended for short premium structures held intraday.',
    },
    {
      id: 'rule-alert-vix',
      name: 'Volatility expansion alert',
      kind: 'alert',
      status: 'active',
      scope: `${symbol} watchlist`,
      trigger: 'IV rank rises 12 points in 15 minutes',
      action: 'Ping dock notification and open Risk workspace',
      lastRun: 'Yesterday 14:42',
      nextRun: 'Live',
    },
    {
      id: 'rule-hedge-delta',
      name: 'Delta rebalance guard',
      kind: 'hedge',
      status: 'draft',
      scope: 'Execution staging',
      trigger: 'Portfolio delta exceeds +0.60 or -0.60',
      action: 'Suggest ATM hedge leg in Strategy workspace',
      lastRun: 'Never',
      nextRun: today.toISOString().slice(0, 10),
    },
  ];
}

interface AutomationStoreValue {
  rules: AutomationRule[];
  createRuleFromStrategy: () => void;
  toggleRuleStatus: (id: string) => void;
}

const AutomationStore = createContext<AutomationStoreValue | null>(null);

export function AutomationProvider({ children }: { children: React.ReactNode }) {
  const { notify } = useNotificationStore();
  const { symbol, spotPrice } = useMarketStore();
  const { legs, preview } = useExecutionStore();
  const [rules, setRules] = useState<AutomationRule[]>(() => seedRules(symbol));

  const createRuleFromStrategy = useCallback(() => {
    if (legs.length === 0) {
      notify({
        title: 'No staged strategy',
        message: 'Build or load a strategy before creating an automation rule.',
        tone: 'warning',
      });
      return;
    }

    const rule: AutomationRule = {
      id: `rule-${Date.now()}`,
      name: `${symbol} staged exit`,
      kind: 'gtt',
      status: 'draft',
      scope: `${legs.length} staged legs`,
      trigger: `Underlying crosses ${Math.round(spotPrice)} or MTM drops below ${Math.round(preview.capitalAtRisk * -0.18)}`,
      action: 'Place staged exit orders and pin notification in blotter dock',
      lastRun: 'Never',
      nextRun: 'Pending review',
      notes: 'Created from current Strategy workspace selection.',
    };

    setRules((current) => [rule, ...current]);
    notify({
      title: 'Automation draft created',
      message: rule.name,
      tone: 'success',
    });
  }, [legs, notify, preview.capitalAtRisk, spotPrice, symbol]);

  const toggleRuleStatus = useCallback((id: string) => {
    setRules((current) => current.map((rule) => {
      if (rule.id !== id) return rule;
      return {
        ...rule,
        status: rule.status === 'active' ? 'paused' : 'active',
      };
    }));
  }, []);

  useEffect(() => {
    setRules((current) => current.map((rule) => (
      rule.scope.includes('weekly') || rule.scope.includes(symbol)
        ? rule
        : rule.id.startsWith('rule-') && rule.kind === 'gtt'
          ? { ...rule, scope: `${symbol} watchlist` }
          : rule
    )));
  }, [symbol]);

  const value = useMemo(() => ({
    rules,
    createRuleFromStrategy,
    toggleRuleStatus,
  }), [rules, createRuleFromStrategy, toggleRuleStatus]);

  return <AutomationStore.Provider value={value}>{children}</AutomationStore.Provider>;
}

export function useAutomationStore() {
  const context = useContext(AutomationStore);
  if (!context) throw new Error('useAutomationStore must be used within AutomationProvider');
  return context;
}
