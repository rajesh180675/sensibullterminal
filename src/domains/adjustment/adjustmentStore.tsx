import React, { createContext, useContext, useMemo } from 'react';
import { SYMBOL_CONFIG } from '../../config/market';
import type { AdjustmentSnapshot, AdjustmentSuggestion, OptionLeg, Position, PositionLeg } from '../../types/index';
import { buildExecutionPreview } from '../execution/executionStore';
import { useExecutionStore } from '../execution/executionStore';
import { useMarketStore } from '../market/marketStore';
import { usePortfolioStore } from '../portfolio/portfolioStore';

interface AdjustmentStoreValue {
  suggestions: AdjustmentSuggestion[];
  applySuggestion: (suggestion: AdjustmentSuggestion) => void;
}

const AdjustmentStore = createContext<AdjustmentStoreValue | null>(null);

function nextLegId(positionId: string, index: number) {
  return `adj-${positionId}-${index}`;
}

function approximateGreeks(leg: PositionLeg, spotPrice: number) {
  const distanceRatio = Math.abs(spotPrice - leg.strike) / Math.max(spotPrice, 1);
  const directionalWeight = Math.max(0.12, 0.5 - distanceRatio * 3.5);
  const delta = leg.type === 'CE' ? directionalWeight : -directionalWeight;
  return {
    iv: 14 + Math.max(0, 6 - distanceRatio * 100),
    delta,
    theta: -2.2 + distanceRatio * 3,
    gamma: 0.0015 + Math.max(0, 0.005 - distanceRatio * 0.015),
    vega: 0.12 + Math.max(0, 0.28 - distanceRatio * 0.5),
  };
}

function positionToOptionLegs(position: Position, spotPrice: number): OptionLeg[] {
  return position.legs.map((leg, index) => {
    const greeks = approximateGreeks(leg, spotPrice);
    return {
      id: nextLegId(position.id, index),
      symbol: position.symbol,
      type: leg.type,
      strike: leg.strike,
      action: leg.action,
      lots: leg.lots,
      ltp: leg.currentPrice,
      expiry: position.expiry,
      orderType: 'market',
      ...greeks,
    };
  });
}

function findStressedLegs(position: Position, spotPrice: number, step: number) {
  return position.legs.filter((leg) => {
    if (leg.action !== 'SELL') return false;
    const distance = leg.type === 'CE' ? leg.strike - spotPrice : spotPrice - leg.strike;
    return distance <= step * 1.5 || leg.pnl < 0;
  });
}

function summarize(legs: OptionLeg[], stressedLegs: string[]): AdjustmentSnapshot {
  const preview = buildExecutionPreview(legs);
  return {
    netCredit: preview.estimatedPremium,
    maxProfit: preview.maxProfit,
    maxLoss: preview.maxLoss,
    breakevens: preview.breakevens,
    lots: legs.reduce((sum, leg) => sum + leg.lots, 0),
    stressedLegs,
  };
}

function shiftLeg(leg: OptionLeg, shift: number) {
  return { ...leg, strike: leg.strike + shift };
}

function oppositeAction(action: OptionLeg['action']) {
  return action === 'BUY' ? 'SELL' : 'BUY';
}

function asRepairLeg(leg: OptionLeg, patch?: Partial<OptionLeg>): OptionLeg {
  return {
    ...leg,
    ...patch,
    id: `${leg.id}-repair-${Math.random().toString(16).slice(2, 6)}`,
  };
}

function createSuggestionsForPosition(position: Position, spotPrice: number): AdjustmentSuggestion[] {
  const step = SYMBOL_CONFIG[position.symbol].strikeStep;
  const baseLegs = positionToOptionLegs(position, spotPrice);
  const stressed = findStressedLegs(position, spotPrice, step);
  if (stressed.length === 0) return [];

  const stressedLabels = stressed.map((leg) => `${leg.action} ${leg.type} ${leg.strike}`);
  const suggestions: AdjustmentSuggestion[] = [];
  const primaryStress = stressed[0];

  const rollShift = primaryStress.type === 'CE' ? step * 2 : -step * 2;
  const rolledLegs = baseLegs.map((leg) => {
    if (leg.action === 'SELL' && leg.type === primaryStress.type && leg.strike === primaryStress.strike) {
      return shiftLeg(leg, rollShift);
    }
    if (leg.action === 'BUY' && leg.type === primaryStress.type) {
      const hedgeOnSameSide = primaryStress.type === 'CE' ? leg.strike > primaryStress.strike : leg.strike < primaryStress.strike;
      return hedgeOnSameSide ? shiftLeg(leg, rollShift) : leg;
    }
    return leg;
  });
  suggestions.push({
    id: `${position.id}-roll-${primaryStress.type.toLowerCase()}`,
    positionId: position.id,
    title: `Roll challenged ${primaryStress.type === 'CE' ? 'call' : 'put'} side`,
    rationale: `The short ${primaryStress.type} is close to spot or already losing MTM. Rolling it outward buys room and reduces immediate gamma pressure.`,
    trigger: `${primaryStress.type} short at ${primaryStress.strike} is under stress.`,
    repairFlow: 'Stage the rolled side, review credit and margin in Execution, then send only after confirming liquidity.',
    severity: primaryStress.pnl < 0 ? 'critical' : 'warning',
    current: summarize(baseLegs, stressedLabels),
    proposed: summarize(rolledLegs, stressedLabels),
    legsBefore: baseLegs,
    legsAfter: rolledLegs,
    repairLegs: baseLegs.flatMap((leg) => {
      if (leg.action === 'SELL' && leg.type === primaryStress.type && leg.strike === primaryStress.strike) {
        return [
          asRepairLeg(leg, { action: 'BUY' }),
          asRepairLeg(shiftLeg(leg, rollShift), { action: 'SELL' }),
        ];
      }
      if (leg.action === 'BUY' && leg.type === primaryStress.type) {
        const hedgeOnSameSide = primaryStress.type === 'CE' ? leg.strike > primaryStress.strike : leg.strike < primaryStress.strike;
        if (hedgeOnSameSide) {
          return [
            asRepairLeg(leg, { action: 'SELL' }),
            asRepairLeg(shiftLeg(leg, rollShift), { action: 'BUY' }),
          ];
        }
      }
      return [];
    }),
  });

  const nakedShort = baseLegs.find((leg) => (
    leg.action === 'SELL'
    && !baseLegs.some((candidate) => candidate.action === 'BUY' && candidate.type === leg.type && (
      leg.type === 'CE' ? candidate.strike > leg.strike : candidate.strike < leg.strike
    ))
  ));
  if (nakedShort) {
    const hedgeStrike = nakedShort.type === 'CE' ? nakedShort.strike + step * 4 : nakedShort.strike - step * 4;
    const hedgedLegs = [
      ...baseLegs,
      {
        ...nakedShort,
        id: `${nakedShort.id}-wing`,
        action: 'BUY' as const,
        strike: hedgeStrike,
        ltp: Math.max(5, nakedShort.ltp * 0.35),
      },
    ];
    suggestions.push({
      id: `${position.id}-cap-risk`,
      positionId: position.id,
      title: 'Cap undefined risk with a wing',
      rationale: 'The position carries naked short premium. Adding a wing converts the repair into a defined-risk structure.',
      trigger: `Undefined-risk ${nakedShort.type} short remains in the live book.`,
      repairFlow: 'Stage the added wing and execute the hedge before considering any further rolls.',
      severity: 'critical',
      current: summarize(baseLegs, stressedLabels),
      proposed: summarize(hedgedLegs, stressedLabels),
      legsBefore: baseLegs,
      legsAfter: hedgedLegs,
      repairLegs: [asRepairLeg({
        ...nakedShort,
        action: 'BUY',
        strike: hedgeStrike,
        ltp: Math.max(5, nakedShort.ltp * 0.35),
      })],
    });
  }

  const flattenedTypeLegs = baseLegs.filter((leg) => leg.type !== primaryStress.type);
  if (flattenedTypeLegs.length > 0) {
    suggestions.push({
      id: `${position.id}-close-tested-side`,
      positionId: position.id,
      title: `Close tested ${primaryStress.type === 'CE' ? 'call' : 'put'} side`,
      rationale: 'When one side is being tested, closing that side removes the immediate stress while preserving the opposite side if desired.',
      trigger: `Short ${primaryStress.type} side is the stressed leg cluster.`,
      repairFlow: 'Stage the remaining untested side only if you still want carry; otherwise flatten the entire position.',
      severity: 'warning',
      current: summarize(baseLegs, stressedLabels),
      proposed: summarize(flattenedTypeLegs, stressedLabels),
      legsBefore: baseLegs,
      legsAfter: flattenedTypeLegs,
      repairLegs: baseLegs
        .filter((leg) => leg.type === primaryStress.type)
        .map((leg) => asRepairLeg(leg, { action: oppositeAction(leg.action) })),
    });
  }

  suggestions.push({
    id: `${position.id}-flatten-all`,
    positionId: position.id,
    title: 'Flatten the position',
    rationale: 'If the stress is no longer consistent with the original thesis, closing the position prevents defensive overtrading.',
    trigger: 'Stress, margin pressure, or thesis invalidation is active.',
    repairFlow: 'Use when repair quality is poor or the market regime has changed materially.',
    severity: 'critical',
    current: summarize(baseLegs, stressedLabels),
    proposed: summarize([], stressedLabels),
    legsBefore: baseLegs,
    legsAfter: [],
    repairLegs: baseLegs.map((leg) => asRepairLeg(leg, { action: oppositeAction(leg.action) })),
  });

  return suggestions;
}

export function AdjustmentProvider({ children }: { children: React.ReactNode }) {
  const { spotPrice } = useMarketStore();
  const { livePositions } = usePortfolioStore();
  const { stageStrategy, clearLegs } = useExecutionStore();

  const suggestions = useMemo(
    () => livePositions
      .filter((position) => position.status === 'ACTIVE')
      .flatMap((position) => createSuggestionsForPosition(position, spotPrice))
      .slice(0, 8),
    [livePositions, spotPrice],
  );

  const value = useMemo<AdjustmentStoreValue>(() => ({
    suggestions,
    applySuggestion(suggestion) {
      if (suggestion.repairLegs.length === 0) {
        clearLegs();
        return;
      }
      stageStrategy(suggestion.repairLegs.map((leg) => ({
        symbol: leg.symbol,
        type: leg.type,
        strike: leg.strike,
        action: leg.action,
        lots: leg.lots,
        ltp: leg.ltp,
        iv: leg.iv,
        delta: leg.delta,
        theta: leg.theta,
        gamma: leg.gamma,
        vega: leg.vega,
        expiry: leg.expiry,
        orderType: leg.orderType,
        limitPrice: leg.limitPrice,
      })));
    },
  }), [clearLegs, stageStrategy, suggestions]);

  return <AdjustmentStore.Provider value={value}>{children}</AdjustmentStore.Provider>;
}

export function useAdjustmentStore() {
  const context = useContext(AdjustmentStore);
  if (!context) throw new Error('useAdjustmentStore must be used within AdjustmentProvider');
  return context;
}
