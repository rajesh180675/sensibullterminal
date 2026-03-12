import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { SellerJournalEntry, SellerJournalSummary, SellerOpportunity } from '../../types/index';
import { useExecutionStore } from '../execution/executionStore';
import { useSellerIntelligenceStore } from '../seller/sellerIntelligenceStore';

const STORAGE_KEY = 'sensibull.sellerJournal.v1';

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
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));
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
  const [entries, setEntries] = useState<SellerJournalEntry[]>(() => loadEntries());
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

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
      },
    };
  }, [entries]);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedEntryId) ?? entries[0] ?? null,
    [entries, selectedEntryId],
  );

  useEffect(() => {
    const filledItems = blotter.filter((item) => item.status === 'sent' || item.status === 'partial');
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
        }));
      if (additions.length === 0) return current;
      return [...additions, ...current];
    });
  }, [blotter, regime.label]);

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
