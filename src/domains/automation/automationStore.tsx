import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import type { AutomationCallbackEvent, AutomationRule, SellerOpportunity } from '../../types/index';
import { brokerGatewayClient } from '../../services/broker/brokerGatewayClient';
import {
  useAutomationCallbacksQuery,
  useAutomationRulesQuery,
  useCreateAutomationRuleMutation,
  useDeleteAutomationRuleMutation,
  useEvaluateAutomationRulesMutation,
  useSaveAutomationRuleMutation,
  useToggleAutomationRuleStatusMutation,
} from '../../services/api/terminalQueryHooks';
import { useNotificationStore } from '../../stores/notificationStore';
import { useExecutionStore } from '../execution/executionStore';
import { useMarketStore } from '../market/marketStore';
import { useSessionStore } from '../session/sessionStore';

interface AutomationStoreValue {
  rules: AutomationRule[];
  callbacks: AutomationCallbackEvent[];
  syncStatus: 'idle' | 'loading' | 'ready' | 'fallback';
  createRuleFromStrategy: () => Promise<AutomationRule | null>;
  createRuleFromOpportunity: (opportunity: SellerOpportunity, presetId?: string) => Promise<AutomationRule | null>;
  saveRule: (rule: AutomationRule) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  toggleRuleStatus: (id: string) => Promise<void>;
  evaluateRules: () => Promise<void>;
}

const AutomationStore = createContext<AutomationStoreValue | null>(null);

export function AutomationProvider({ children }: { children: React.ReactNode }) {
  const { notify } = useNotificationStore();
  const { symbol, spotPrice } = useMarketStore();
  const { legs } = useExecutionStore();
  const { session } = useSessionStore();
  const backendReady = Boolean(session?.isConnected && session.proxyBase && brokerGatewayClient.session.isBackend(session.proxyBase));
  const rulesQuery = useAutomationRulesQuery({ session, symbol });
  const callbacksQuery = useAutomationCallbacksQuery({ session });
  const createRuleMutation = useCreateAutomationRuleMutation({ session, symbol });
  const saveRuleMutation = useSaveAutomationRuleMutation({ session, symbol });
  const deleteRuleMutation = useDeleteAutomationRuleMutation({ session, symbol });
  const toggleRuleMutation = useToggleAutomationRuleStatusMutation({ session, symbol });
  const evaluateMutation = useEvaluateAutomationRulesMutation({ session, symbol });
  const rules = rulesQuery.data ?? [];
  const callbacks = callbacksQuery.data ?? [];
  const syncStatus: AutomationStoreValue['syncStatus'] = !backendReady
    ? 'fallback'
    : rulesQuery.isFetching || callbacksQuery.isFetching || evaluateMutation.isPending
      ? 'loading'
      : rulesQuery.isError
        ? 'fallback'
        : 'ready';

  useEffect(() => {
    if (!backendReady || !rulesQuery.error) return;
    notify({
      title: 'Automation backend unavailable',
      message: rulesQuery.error.message || 'Falling back to local automation drafts.',
      tone: 'warning',
    });
  }, [backendReady, notify, rulesQuery.error]);

  const persistRule = useCallback(async (draftRule: AutomationRule) => {
    if (!backendReady) {
      await createRuleMutation.mutateAsync(draftRule);
      notify({
        title: 'Automation draft created',
        message: draftRule.name,
        tone: 'success',
      });
      return draftRule;
    }

    try {
      const rule = await createRuleMutation.mutateAsync(draftRule);
      notify({
        title: 'Automation rule created',
        message: rule.name,
        tone: 'success',
      });
      return rule;
    } catch (error) {
      notify({
        title: 'Automation rule failed',
        message: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
      return null;
    }
  }, [backendReady, createRuleMutation, notify]);

  const createRuleFromStrategy = useCallback(async () => {
    if (legs.length === 0) {
      notify({
        title: 'No staged strategy',
        message: 'Build or load a strategy before creating an automation rule.',
        tone: 'warning',
      });
      return null;
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
        type: 'spot_pct_move',
        referencePrice: spotPrice,
        movePercent: 0.5,
        direction: 'either',
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
    return persistRule(draftRule);
  }, [backendReady, legs, notify, persistRule, spotPrice, symbol]);

  const createRuleFromOpportunity = useCallback(async (opportunity: SellerOpportunity, presetId?: string) => {
    const preset = opportunity.automationPresets.find((item) => item.id === presetId) ?? opportunity.automationPresets[0];
    if (!preset) {
      notify({
        title: 'No automation preset',
        message: 'This seller idea does not have an automation preset yet.',
        tone: 'warning',
      });
      return null;
    }

    const draftRule: AutomationRule = {
      id: `rule-${Date.now()}`,
      name: `${opportunity.title} · ${preset.label}`,
      kind: preset.actionConfig.type === 'execute_strategy' ? 'gtt' : 'alert',
      status: backendReady ? 'active' : 'draft',
      scope: `${opportunity.structure} · ${opportunity.playbookMatches[0] ?? 'seller idea'}`,
      trigger: preset.triggerSummary,
      action: preset.actionSummary,
      lastRun: 'Never',
      nextRun: backendReady ? 'Live' : 'Pending review',
      notes: `Generated from seller opportunity ${opportunity.title}.`,
      symbol: opportunity.legs[0]?.symbol,
      triggerConfig: preset.triggerConfig,
      actionConfig: preset.actionConfig,
      runCount: 0,
      updatedAt: Date.now(),
    };

    return persistRule(draftRule);
  }, [backendReady, notify, persistRule]);

  const saveRule = useCallback(async (rule: AutomationRule) => {
    if (!rule.name.trim()) {
      notify({
        title: 'Rule name required',
        message: 'Provide a rule name before saving.',
        tone: 'warning',
      });
      return;
    }

    try {
      await saveRuleMutation.mutateAsync(rule);
      if (backendReady) {
        notify({
          title: 'Automation rule saved',
          message: rule.name,
          tone: 'success',
        });
      }
    } catch (error) {
      notify({
        title: 'Automation save failed',
        message: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    }
  }, [backendReady, notify, saveRuleMutation]);

  const deleteRule = useCallback(async (id: string) => {
    const current = rules.find((rule) => rule.id === id);
    if (!current) return;

    try {
      await deleteRuleMutation.mutateAsync({ id });
      if (backendReady) {
        notify({
          title: 'Automation rule deleted',
          message: current.name,
          tone: 'success',
        });
      }
    } catch (error) {
      notify({
        title: 'Automation delete failed',
        message: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    }
  }, [backendReady, deleteRuleMutation, notify, rules]);

  const toggleRuleStatus = useCallback(async (id: string) => {
    const current = rules.find((rule) => rule.id === id);
    if (!current) return;
    try {
      await toggleRuleMutation.mutateAsync({ rule: current });
    } catch (error) {
      notify({
        title: 'Automation update failed',
        message: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    }
  }, [notify, rules, toggleRuleMutation]);

  const evaluateRules = useCallback(async () => {
    if (!backendReady) {
      notify({
        title: 'Backend required',
        message: 'Connect a backend session to evaluate automation rules.',
        tone: 'warning',
      });
      return;
    }
    try {
      const result = await evaluateMutation.mutateAsync();
      notify({
        title: 'Automation evaluated',
        message: `${result.count ?? 0} automation event(s) recorded.`,
        tone: 'success',
      });
    } catch (error) {
      notify({
        title: 'Automation evaluation failed',
        message: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    }
  }, [backendReady, evaluateMutation, notify]);

  const value = useMemo(() => ({
    rules,
    callbacks,
    syncStatus,
    createRuleFromStrategy,
    createRuleFromOpportunity,
    saveRule,
    deleteRule,
    toggleRuleStatus,
    evaluateRules,
  }), [rules, callbacks, syncStatus, createRuleFromOpportunity, createRuleFromStrategy, saveRule, deleteRule, toggleRuleStatus, evaluateRules]);

  return <AutomationStore.Provider value={value}>{children}</AutomationStore.Provider>;
}

export function useAutomationStore() {
  const context = useContext(AutomationStore);
  if (!context) throw new Error('useAutomationStore must be used within AutomationProvider');
  return context;
}
