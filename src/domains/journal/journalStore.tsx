import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { brokerGatewayClient } from '../../services/broker/brokerGatewayClient';
import type { OrderBookRow, TradeBookRow } from '../../utils/kaggleClient';
import type { OptionLeg, Position, SellerJournalEntry, SellerJournalSummary, SellerOpportunity, SellerPlaybookReview, SellerReviewState } from '../../types/index';
import { useExecutionStore } from '../execution/executionStore';
import { usePortfolioStore } from '../portfolio/portfolioStore';
import { useSellerIntelligenceStore } from '../seller/sellerIntelligenceStore';
import { useSessionStore } from '../session/sessionStore';

const STORAGE_KEY = 'sensibull.sellerJournal.v2';

const DEFAULT_MISTAKE_TAGS = [
  'over-sized',
  'ignored-regime',
  'late-entry',
  'premature-exit',
  'no-adjustment-plan',
  'chased-credit',
  'overlapped-exposure',
  'broke-playbook',
];

function loadEntries(): SellerJournalEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SellerJournalEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildEntryFromOpportunity(opportunity: SellerOpportunity): SellerJournalEntry {
  const now = Date.now();
  return {
    id: `journal-${now}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    symbol: opportunity.legs[0]?.symbol ?? 'NIFTY',
    title: opportunity.title,
    structure: opportunity.structure,
    mode: opportunity.mode,
    regimeLabel: opportunity.playbookMatches[0] ? `${opportunity.playbookMatches[0]} / seller idea` : 'Seller idea',
    sellerScore: opportunity.sellerScore,
    expectedCredit: opportunity.expectedCredit,
    marginEstimate: opportunity.marginEstimate,
    maxLossEstimate: opportunity.maxLossEstimate,
    rationale: `${opportunity.whyNow} ${opportunity.suppressed ? `Suppression risk: ${opportunity.suppressionReasons.join(' | ')}` : ''}`.trim(),
    thesis: opportunity.thesis,
    invalidation: opportunity.invalidation,
    adjustmentPlan: opportunity.adjustmentPlan,
    notes: '',
    playbookName: opportunity.playbookMatches[0],
    playbookCompliance: opportunity.playbookCompliance,
    exposureContext: opportunity.suppressed
      ? opportunity.suppressionReasons.join(' | ')
      : `Exposure fit ${opportunity.exposureFit}/100`,
    mistakeTags: [],
    automationRuleIds: [],
    source: 'opportunity',
    sourceOpportunityId: opportunity.id,
    legsSnapshot: opportunity.legs.map((leg) => ({ ...leg, id: `idea-${opportunity.id}-${leg.type}-${leg.strike}` })),
    linkedPositionIds: [],
    linkedOrderIds: [],
    linkedTradeIds: [],
    linkedPositionStatus: 'unlinked',
    realizedPnl: 0,
    unrealizedPnl: 0,
    netPnl: 0,
    outcome: 'pending',
    adjustmentCount: 0,
    adjustmentEffectiveness: 'unreviewed',
    lifecycleEvents: [{
      id: `event-captured-${now}`,
      type: 'captured',
      timestamp: now,
      detail: 'Seller idea captured into the journal.',
    }],
  };
}

function inferStructureFromSummary(summary: string, legCount: number) {
  if (summary.includes('SELL CE') && summary.includes('SELL PE') && summary.includes('BUY CE') && summary.includes('BUY PE')) {
    return 'Iron Condor';
  }
  if (legCount === 4 && summary.includes('SELL CE') && summary.includes('SELL PE')) return 'Iron Fly';
  if (legCount === 2 && summary.includes('SELL PE') && summary.includes('BUY PE')) return 'Bull Put Spread';
  if (legCount === 2 && summary.includes('SELL CE') && summary.includes('BUY CE')) return 'Bear Call Spread';
  if (legCount === 2 && summary.includes('SELL CE') && summary.includes('SELL PE')) return 'Short Strangle';
  return `${legCount}-leg execution`;
}

function tallyBuckets(values: string[]) {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));
}

function tallyPnlBuckets(entries: SellerJournalEntry[]) {
  const totals = new Map<string, number>();
  entries.forEach((entry) => totals.set(entry.structure, (totals.get(entry.structure) ?? 0) + entry.netPnl));
  return [...totals.entries()]
    .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
    .slice(0, 5)
    .map(([label, value]) => ({ label, value }));
}

function buildPlaybookReviews(entries: SellerJournalEntry[]): SellerPlaybookReview[] {
  const reviews = new Map<string, SellerPlaybookReview>();
  entries.forEach((entry) => {
    if (!entry.playbookName) return;
    const current = reviews.get(entry.playbookName) ?? {
      playbookName: entry.playbookName,
      entries: 0,
      alignedEntries: 0,
      violations: 0,
      netPnl: 0,
      lastReviewedAt: entry.updatedAt,
    };
    current.entries += 1;
    current.alignedEntries += entry.playbookCompliance === 'aligned' ? 1 : 0;
    current.violations += entry.playbookCompliance === 'violates' ? 1 : 0;
    current.netPnl += entry.netPnl;
    current.lastReviewedAt = Math.max(current.lastReviewedAt, entry.updatedAt);
    reviews.set(entry.playbookName, current);
  });
  return [...reviews.values()].sort((left, right) => right.lastReviewedAt - left.lastReviewedAt);
}

function mergeEntries(localEntries: SellerJournalEntry[], remoteEntries: SellerJournalEntry[]) {
  const byId = new Map<string, SellerJournalEntry>();
  [...remoteEntries, ...localEntries].forEach((entry) => {
    const existing = byId.get(entry.id);
    if (!existing || entry.updatedAt >= existing.updatedAt) {
      byId.set(entry.id, entry);
    }
  });
  return [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

function legMatchesRow(leg: OptionLeg, row: Record<string, unknown>) {
  const right = String(row.right || '').toUpperCase();
  const strike = Number(row.strike_price ?? 0);
  const expiry = String(row.expiry_date || '');
  const action = String(row.action || row.transaction_type || '').toUpperCase();
  const normalizedAction = action.startsWith('B') ? 'BUY' : action.startsWith('S') ? 'SELL' : '';
  return leg.type === right && leg.strike === strike && leg.expiry === expiry && normalizedAction === leg.action;
}

function matchesPosition(entry: SellerJournalEntry, position: Position) {
  if (entry.symbol !== position.symbol) return false;
  if (!entry.legsSnapshot || entry.legsSnapshot.length === 0) return false;
  return entry.legsSnapshot.some((leg) => position.legs.some((candidate) => (
    candidate.type === leg.type
    && candidate.strike === leg.strike
    && candidate.action === leg.action
  )));
}

function matchesOrder(entry: SellerJournalEntry, row: OrderBookRow | TradeBookRow) {
  if (entry.symbol !== (String(row.stock_code || '').includes('SENSEX') ? 'BSESEN' : 'NIFTY')) return false;
  if (!entry.legsSnapshot || entry.legsSnapshot.length === 0) return false;
  return entry.legsSnapshot.some((leg) => legMatchesRow(leg, row));
}

function deriveOutcome(entry: SellerJournalEntry, hasLinkedPositions: boolean): SellerJournalEntry['outcome'] {
  if (hasLinkedPositions) return entry.netPnl === 0 ? 'open' : 'open';
  if (entry.linkedTradeIds.length === 0 && entry.linkedOrderIds.length === 0) return 'pending';
  if (entry.netPnl > 0) return 'closed_win';
  if (entry.netPnl < 0) return 'closed_loss';
  return 'flat';
}

function deriveAdjustmentCount(entry: SellerJournalEntry, positions: Position[]) {
  const currentLegCount = positions.reduce((sum, position) => sum + position.legs.length, 0);
  const originalLegCount = entry.legsSnapshot?.length ?? 0;
  return Math.max(0, currentLegCount - originalLegCount);
}

function deriveAdjustmentEffectiveness(entry: SellerJournalEntry, priorNetPnl: number) {
  if (entry.adjustmentCount === 0) return 'unreviewed';
  const delta = entry.netPnl - priorNetPnl;
  if (Math.abs(delta) < 1) return 'flat';
  return delta > 0 ? 'improving' : 'worsening';
}

interface JournalStoreValue {
  entries: SellerJournalEntry[];
  summary: SellerJournalSummary;
  selectedEntry: SellerJournalEntry | null;
  mistakeTagCatalog: string[];
  selectEntry: (entryId: string | null) => void;
  captureOpportunity: (opportunity: SellerOpportunity) => SellerJournalEntry;
  updateEntry: (entryId: string, patch: Partial<SellerJournalEntry>) => void;
  toggleMistakeTag: (entryId: string, tag: string) => void;
  attachAutomationRule: (entryId: string, ruleId: string) => void;
}

const JournalStore = createContext<JournalStoreValue | null>(null);

export function JournalProvider({ children }: { children: React.ReactNode }) {
  const { regime } = useSellerIntelligenceStore();
  const { blotter } = useExecutionStore();
  const { livePositions, orders, trades } = usePortfolioStore();
  const { session } = useSessionStore();
  const [entries, setEntries] = useState<SellerJournalEntry[]>(() => loadEntries());
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [backendHydrated, setBackendHydrated] = useState(false);
  const lastSavedState = useRef('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, [entries]);

  const summary = useMemo<SellerJournalSummary>(() => {
    const reviewedEntries = entries.filter((entry) => entry.status === 'reviewed').length;
    const executedEntries = entries.filter((entry) => entry.status === 'executed').length;
    const compliantEntries = entries.filter((entry) => entry.playbookCompliance === 'aligned').length;
    const mistakeCounts = new Map<string, number>();
    entries.forEach((entry) => {
      entry.mistakeTags.forEach((tag) => {
        mistakeCounts.set(tag, (mistakeCounts.get(tag) ?? 0) + 1);
      });
    });
    return {
      totalEntries: entries.length,
      reviewedEntries,
      executedEntries,
      compliantEntries,
      complianceRate: entries.length === 0 ? 0 : compliantEntries / entries.length,
      topMistakeTags: [...mistakeCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([tag, count]) => ({ tag, count })),
      analytics: {
        autoCapturedEntries: entries.filter((entry) => entry.source === 'execution').length,
        entriesByStructure: tallyBuckets(entries.map((entry) => entry.structure)),
        entriesByRegime: tallyBuckets(entries.map((entry) => entry.regimeLabel)),
        mistakeClusters: tallyBuckets(entries.flatMap((entry) => entry.mistakeTags)),
        entriesByOutcome: tallyBuckets(entries.map((entry) => entry.outcome)),
        adjustmentEffectiveness: tallyBuckets(entries.map((entry) => entry.adjustmentEffectiveness)),
        netPnlByStructure: tallyPnlBuckets(entries),
      },
    };
  }, [entries]);

  const reviewState = useMemo<SellerReviewState>(() => ({
    entries,
    playbookReviews: buildPlaybookReviews(entries),
  }), [entries]);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedEntryId) ?? entries[0] ?? null,
    [entries, selectedEntryId],
  );

  useEffect(() => {
    const filledItems = blotter.filter((item) => (
      item.status === 'partial_fill' ||
      item.status === 'all_filled' ||
      item.status === 'partial_failure'
    ));
    if (filledItems.length === 0) return;
    setEntries((current) => {
      const seen = new Set(current.map((entry) => entry.sourceBlotterId).filter(Boolean));
      const additions = filledItems
        .filter((item) => !seen.has(item.id))
        .map((item) => ({
          id: `journal-exec-${item.id}`,
          createdAt: item.submittedAt,
          updatedAt: item.submittedAt,
          status: 'executed' as const,
          symbol: item.symbol,
          title: `Executed ${inferStructureFromSummary(item.summary, item.legCount)}`,
          structure: inferStructureFromSummary(item.summary, item.legCount),
          mode: item.legCount >= 4 ? 'defined_risk_only' as const : 'conservative_income' as const,
          regimeLabel: regime.label,
          sellerScore: 70,
          expectedCredit: item.premium,
          marginEstimate: Math.abs(item.previewSnapshot?.marginRequired ?? 0),
          maxLossEstimate: item.previewSnapshot?.maxLoss ?? 0,
          rationale: 'Auto-captured from execution blotter after broker submission.',
          thesis: item.summary,
          invalidation: 'Review live risk and position drift after execution.',
          adjustmentPlan: 'Use the adjustment engine to review challenged short legs or convert undefined risk to defined risk.',
          notes: item.response,
          playbookCompliance: 'watch' as const,
          exposureContext: 'Generated from actual execution event, pending post-trade review.',
          mistakeTags: [],
          automationRuleIds: [],
          source: 'execution' as const,
          sourceBlotterId: item.id,
          executionStatus: item.status,
          legsSnapshot: item.legsSnapshot,
          linkedPositionIds: [],
          linkedOrderIds: [],
          linkedTradeIds: [],
          linkedPositionStatus: 'unlinked' as const,
          realizedPnl: 0,
          unrealizedPnl: 0,
          netPnl: 0,
          outcome: 'pending' as const,
          adjustmentCount: 0,
          adjustmentEffectiveness: 'unreviewed' as const,
          lifecycleEvents: [{
            id: `event-executed-${item.id}`,
            type: 'executed' as const,
            timestamp: item.submittedAt,
            detail: 'Execution blotter item captured into the journal.',
            orderIds: [item.id],
          }],
        }));
      if (additions.length === 0) return current;
      return [...additions, ...current];
    });
  }, [blotter, regime.label]);

  useEffect(() => {
    if (!session?.isConnected || !brokerGatewayClient.session.isBackend(session.proxyBase)) {
      setBackendHydrated(false);
      return;
    }
    let cancelled = false;
    void brokerGatewayClient.reviews.fetchState(session).then((result) => {
      if (cancelled || !result.ok || !result.data) {
        setBackendHydrated(true);
        return;
      }
      const remoteEntries = Array.isArray(result.data.entries) ? result.data.entries as unknown as SellerJournalEntry[] : [];
      setEntries((current) => mergeEntries(current, remoteEntries));
      setBackendHydrated(true);
    }).catch(() => {
      if (!cancelled) setBackendHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (entries.length === 0) return;
    setEntries((current) => current.map((entry) => {
      const matchedPositions = livePositions.filter((position) => matchesPosition(entry, position));
      const matchedOrders = orders.filter((row) => matchesOrder(entry, row));
      const matchedTrades = trades.filter((row) => matchesOrder(entry, row));
      const realizedPnl = matchedPositions.reduce((sum, position) => sum + (position.realizedPnl ?? 0), 0);
      const unrealizedPnl = matchedPositions.reduce((sum, position) => sum + (position.unrealizedPnl ?? position.mtmPnl), 0);
      const netPnl = realizedPnl + unrealizedPnl;
      const linkedPositionStatus = matchedPositions.length > 0 ? 'open' as const : (
        (matchedOrders.length > 0 || matchedTrades.length > 0) ? 'closed' as const : 'unlinked' as const
      );
      const nextAdjustmentCount = deriveAdjustmentCount(entry, matchedPositions);
      const lifecycleEvents = [...(entry.lifecycleEvents ?? [])];
      if (linkedPositionStatus === 'open' && entry.linkedPositionStatus !== 'open') {
        lifecycleEvents.unshift({
          id: `event-linked-${entry.id}-${Date.now()}`,
          type: 'linked_position',
          timestamp: Date.now(),
          detail: `Journal entry linked to ${matchedPositions.length} live position(s).`,
          orderIds: matchedOrders.map((row) => row.order_id),
          tradeIds: matchedTrades.map((row) => row.order_id),
        });
      }
      if (nextAdjustmentCount > entry.adjustmentCount) {
        lifecycleEvents.unshift({
          id: `event-adjusted-${entry.id}-${Date.now()}`,
          type: 'adjusted',
          timestamp: Date.now(),
          detail: `Detected ${nextAdjustmentCount - entry.adjustmentCount} additional repair leg(s) relative to the original structure.`,
        });
      }
      const nextEntry: SellerJournalEntry = {
        ...entry,
        linkedPositionIds: matchedPositions.map((position) => position.id),
        linkedOrderIds: matchedOrders.map((row) => row.order_id),
        linkedTradeIds: matchedTrades.map((row) => row.order_id),
        linkedPositionStatus,
        realizedPnl,
        unrealizedPnl,
        netPnl,
        outcome: deriveOutcome({
          ...entry,
          linkedOrderIds: matchedOrders.map((row) => row.order_id),
          linkedTradeIds: matchedTrades.map((row) => row.order_id),
          netPnl,
        }, matchedPositions.length > 0),
        closedAt: matchedPositions.length === 0 && (matchedOrders.length > 0 || matchedTrades.length > 0)
          ? (entry.closedAt ?? Date.now())
          : undefined,
        lastSyncedAt: Date.now(),
        adjustmentCount: nextAdjustmentCount,
        lifecycleEvents,
      };
      const withEffectiveness: SellerJournalEntry = {
        ...nextEntry,
        adjustmentEffectiveness: deriveAdjustmentEffectiveness(nextEntry, entry.netPnl),
      };
      if (
        withEffectiveness.linkedPositionStatus === 'closed'
        && entry.linkedPositionStatus !== 'closed'
      ) {
        withEffectiveness.lifecycleEvents = [
          {
            id: `event-closed-${entry.id}-${Date.now()}`,
            type: 'closed',
            timestamp: withEffectiveness.closedAt ?? Date.now(),
            detail: 'Position lifecycle closed out and realized attribution captured from linked broker orders/trades.',
            realizedPnl: withEffectiveness.realizedPnl,
            orderIds: withEffectiveness.linkedOrderIds,
            tradeIds: withEffectiveness.linkedTradeIds,
          },
          ...(withEffectiveness.lifecycleEvents ?? []),
        ];
      }
      return withEffectiveness;
    }));
  }, [entries.length, livePositions, orders, trades]);

  useEffect(() => {
    if (!backendHydrated || !session?.isConnected || !brokerGatewayClient.session.isBackend(session.proxyBase)) return;
    const serialized = JSON.stringify(reviewState);
    if (serialized === lastSavedState.current) return;
    lastSavedState.current = serialized;
    void brokerGatewayClient.reviews.saveState(session, {
      entries: reviewState.entries,
      playbookReviews: reviewState.playbookReviews,
    }).catch(() => {
      lastSavedState.current = '';
    });
  }, [backendHydrated, reviewState, session]);

  const value = useMemo<JournalStoreValue>(() => ({
    entries,
    summary,
    selectedEntry,
    mistakeTagCatalog: DEFAULT_MISTAKE_TAGS,
    selectEntry(entryId) {
      setSelectedEntryId(entryId);
    },
    captureOpportunity(opportunity) {
      const entry = {
        ...buildEntryFromOpportunity(opportunity),
        regimeLabel: regime.label,
      };
      setEntries((current) => [entry, ...current]);
      setSelectedEntryId(entry.id);
      return entry;
    },
    updateEntry(entryId, patch) {
      setEntries((current) => current.map((entry) => (
        entry.id === entryId
          ? { ...entry, ...patch, updatedAt: Date.now() }
          : entry
      )));
    },
    toggleMistakeTag(entryId, tag) {
      setEntries((current) => current.map((entry) => {
        if (entry.id !== entryId) return entry;
        const nextTags = entry.mistakeTags.includes(tag)
          ? entry.mistakeTags.filter((item) => item !== tag)
          : [...entry.mistakeTags, tag];
        return { ...entry, mistakeTags: nextTags, updatedAt: Date.now() };
      }));
    },
    attachAutomationRule(entryId, ruleId) {
      setEntries((current) => current.map((entry) => (
        entry.id === entryId && !entry.automationRuleIds.includes(ruleId)
          ? { ...entry, automationRuleIds: [...entry.automationRuleIds, ruleId], updatedAt: Date.now() }
          : entry
      )));
    },
  }), [entries, regime.label, selectedEntry, summary]);

  return <JournalStore.Provider value={value}>{children}</JournalStore.Provider>;
}

export function useJournalStore() {
  const context = useContext(JournalStore);
  if (!context) throw new Error('useJournalStore must be used within JournalProvider');
  return context;
}
