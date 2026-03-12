import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { SellerJournalEntry, SellerJournalSummary, SellerOpportunity } from '../../types/index';
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
    sourceOpportunityId: opportunity.id,
  };
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
    };
  }, [entries]);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedEntryId) ?? entries[0] ?? null,
    [entries, selectedEntryId],
  );

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
