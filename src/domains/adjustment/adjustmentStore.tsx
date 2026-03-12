import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { SYMBOL_CONFIG } from '../../config/market';
import type { AdjustmentPreviewDelta, AdjustmentSnapshot, AdjustmentSuggestion, OptionLeg, Position, PositionLeg } from '../../types/index';
import { brokerGatewayClient } from '../../services/broker/brokerGatewayClient';
import { buildBackendLegPayload, buildExecutionPreview } from '../execution/executionStore';
import { useExecutionStore } from '../execution/executionStore';
import { useMarketStore } from '../market/marketStore';
import { usePortfolioStore } from '../portfolio/portfolioStore';
import { useSessionStore } from '../session/sessionStore';

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
      id: leg.id ?? nextLegId(position.id, index),
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
    return distance <= step * 1.35 || (leg.unrealizedPnl ?? leg.pnl) < 0;
  });
}

function summarize(position: Position, legs: OptionLeg[], stressedLegs: string[]): AdjustmentSnapshot {
  const preview = buildExecutionPreview(legs);
  const realizedPnl = position.realizedPnl ?? position.legs.reduce((sum, leg) => sum + (leg.realizedPnl ?? 0), 0);
  const unrealizedPnl = position.unrealizedPnl ?? position.legs.reduce((sum, leg) => sum + (leg.unrealizedPnl ?? leg.pnl), 0);
  return {
    netCredit: preview.estimatedPremium,
    maxProfit: preview.maxProfit,
    maxLoss: preview.maxLoss,
    breakevens: preview.breakevens,
    lots: legs.reduce((sum, leg) => sum + leg.lots, 0),
    stressedLegs,
    realizedPnl,
    unrealizedPnl,
    netPnl: realizedPnl + unrealizedPnl,
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

function previewDeltaFor(currentLegs: OptionLeg[], proposedLegs: OptionLeg[]): AdjustmentPreviewDelta {
  const current = buildExecutionPreview(currentLegs);
  const proposed = buildExecutionPreview(proposedLegs);
  return {
    status: 'fallback',
    source: 'estimated',
    premiumDelta: proposed.estimatedPremium - current.estimatedPremium,
    feeDelta: proposed.estimatedFees - current.estimatedFees,
    marginDelta: proposed.marginRequired - current.marginRequired,
    resultingMargin: proposed.marginRequired,
    resultingMaxLoss: proposed.maxLoss,
    notes: ['Using local payoff estimate until broker repair preview is available.'],
  };
}

function detectStrategyFamily(position: Position): AdjustmentSuggestion['strategyFamily'] {
  const sellCalls = position.legs.filter((leg) => leg.action === 'SELL' && leg.type === 'CE').length;
  const sellPuts = position.legs.filter((leg) => leg.action === 'SELL' && leg.type === 'PE').length;
  const buyCalls = position.legs.filter((leg) => leg.action === 'BUY' && leg.type === 'CE').length;
  const buyPuts = position.legs.filter((leg) => leg.action === 'BUY' && leg.type === 'PE').length;

  if (sellCalls > 0 && sellPuts > 0 && buyCalls === 0 && buyPuts === 0) {
    const sellStrikes = position.legs.filter((leg) => leg.action === 'SELL').map((leg) => leg.strike);
    return new Set(sellStrikes).size === 1 ? 'short_straddle' : 'short_strangle';
  }
  if (sellCalls > 0 && sellPuts > 0 && buyCalls > 0 && buyPuts > 0) return 'iron_condor';
  if ((sellCalls > 0 && buyCalls > 0) || (sellPuts > 0 && buyPuts > 0)) return 'vertical_spread';
  if (position.legs.filter((leg) => leg.action === 'SELL').length === 1) return 'single_leg_short';
  return 'custom';
}

function createBaseSuggestion(position: Position, partial: Omit<AdjustmentSuggestion, 'strategyFamily' | 'previewDelta'>): AdjustmentSuggestion {
  return {
    ...partial,
    strategyFamily: detectStrategyFamily(position),
    previewDelta: previewDeltaFor(partial.legsBefore, partial.legsAfter),
  };
}

function createSuggestionsForPosition(position: Position, spotPrice: number): AdjustmentSuggestion[] {
  const cfg = SYMBOL_CONFIG[position.symbol];
  const step = cfg.strikeStep;
  const baseLegs = positionToOptionLegs(position, spotPrice);
  const stressed = findStressedLegs(position, spotPrice, step);
  if (stressed.length === 0) return [];

  const stressedLabels = stressed.map((leg) => `${leg.action} ${leg.type} ${leg.strike}`);
  const suggestions: AdjustmentSuggestion[] = [];
  const current = summarize(position, baseLegs, stressedLabels);
  const primaryStress = stressed[0];
  const strategyFamily = detectStrategyFamily(position);
  const oppositeShort = position.legs.find((leg) => leg.action === 'SELL' && leg.type !== primaryStress.type);

  const rollShift = primaryStress.type === 'CE' ? step * 2 : -step * 2;
  const rolledLegs = baseLegs.map((leg) => {
    if (leg.action === 'SELL' && leg.type === primaryStress.type && leg.strike === primaryStress.strike) {
      return shiftLeg(leg, rollShift);
    }
    if (strategyFamily === 'iron_condor' && leg.action === 'BUY' && leg.type === primaryStress.type) {
      const hedgeOnSameSide = primaryStress.type === 'CE' ? leg.strike > primaryStress.strike : leg.strike < primaryStress.strike;
      return hedgeOnSameSide ? shiftLeg(leg, rollShift) : leg;
    }
    return leg;
  });

  const rollRepairLegs = baseLegs.flatMap((leg) => {
    if (leg.action === 'SELL' && leg.type === primaryStress.type && leg.strike === primaryStress.strike) {
      return [
        asRepairLeg(leg, { action: 'BUY' }),
        asRepairLeg(shiftLeg(leg, rollShift), { action: 'SELL' }),
      ];
    }
    if (strategyFamily === 'iron_condor' && leg.action === 'BUY' && leg.type === primaryStress.type) {
      const hedgeOnSameSide = primaryStress.type === 'CE' ? leg.strike > primaryStress.strike : leg.strike < primaryStress.strike;
      if (hedgeOnSameSide) {
        return [
          asRepairLeg(leg, { action: 'SELL' }),
          asRepairLeg(shiftLeg(leg, rollShift), { action: 'BUY' }),
        ];
      }
    }
    return [];
  });

  suggestions.push(createBaseSuggestion(position, {
    id: `${position.id}-roll-${primaryStress.type.toLowerCase()}`,
    repairType: strategyFamily === 'vertical_spread' || strategyFamily === 'iron_condor' ? 'roll_spread_wider' : 'roll_tested_side',
    positionId: position.id,
    title: strategyFamily === 'vertical_spread' || strategyFamily === 'iron_condor'
      ? `Roll the stressed ${primaryStress.type === 'CE' ? 'call spread' : 'put spread'} outward`
      : `Roll challenged ${primaryStress.type === 'CE' ? 'call' : 'put'} side`,
    rationale: strategyFamily === 'vertical_spread' || strategyFamily === 'iron_condor'
      ? `The ${primaryStress.type} spread is under stress. Rolling both the short and hedge leg preserves structure width while moving the risk pocket away from spot.`
      : `The short ${primaryStress.type} is close to spot or already losing MTM. Rolling it outward buys room and reduces immediate gamma pressure.`,
    trigger: `${primaryStress.type} short at ${primaryStress.strike} is under stress.`,
    repairFlow: 'Stage the repair spread, review the broker-confirmed credit and margin delta, then send only after confirming the target strikes remain liquid.',
    severity: (primaryStress.unrealizedPnl ?? primaryStress.pnl) < 0 ? 'critical' : 'warning',
    current,
    proposed: summarize(position, rolledLegs, stressedLabels),
    legsBefore: baseLegs,
    legsAfter: rolledLegs,
    repairLegs: rollRepairLegs,
  }));

  if ((strategyFamily === 'short_strangle' || strategyFamily === 'short_straddle') && oppositeShort) {
    const reducedLegs = baseLegs.filter((leg) => !(leg.action === 'SELL' && leg.type === oppositeShort.type && leg.strike === oppositeShort.strike));
    suggestions.push(createBaseSuggestion(position, {
      id: `${position.id}-reduce-winning-side`,
      repairType: 'reduce_winning_side',
      positionId: position.id,
      title: `Harvest the untested ${oppositeShort.type === 'CE' ? 'call' : 'put'} side`,
      rationale: 'One side is under pressure while the opposite short leg remains the theta cushion. Buying back the untested side cuts tail risk and frees margin without forcing a full exit.',
      trigger: `${oppositeShort.type} side remains untested while ${primaryStress.type} side is stressed.`,
      repairFlow: 'Use this when you want to simplify the structure before deciding whether to roll or flatten the tested side.',
      severity: 'warning',
      current,
      proposed: summarize(position, reducedLegs, stressedLabels),
      legsBefore: baseLegs,
      legsAfter: reducedLegs,
      repairLegs: [asRepairLeg(
        baseLegs.find((leg) => leg.action === 'SELL' && leg.type === oppositeShort.type && leg.strike === oppositeShort.strike) as OptionLeg,
        { action: 'BUY' },
      )],
    }));

    const recenteredLegs = baseLegs.map((leg) => {
      if (leg.action === 'SELL' && leg.type === primaryStress.type && leg.strike === primaryStress.strike) return shiftLeg(leg, rollShift);
      if (leg.action === 'SELL' && leg.type === oppositeShort.type && leg.strike === oppositeShort.strike) {
        return shiftLeg(leg, primaryStress.type === 'CE' ? step : -step);
      }
      return leg;
    });
    suggestions.push(createBaseSuggestion(position, {
      id: `${position.id}-recenter`,
      repairType: 'recenter_structure',
      positionId: position.id,
      title: strategyFamily === 'short_straddle' ? 'Shift the short straddle away from spot' : 'Re-center the short strangle',
      rationale: 'This keeps a seller structure alive but rebalances the premium around the latest spot path instead of defending only one side.',
      trigger: 'Neutral seller thesis still holds, but the current center is stale.',
      repairFlow: 'Stage both the tested-side roll and the opposite-side trim together only if the market still looks range-bound.',
      severity: 'info',
      current,
      proposed: summarize(position, recenteredLegs, stressedLabels),
      legsBefore: baseLegs,
      legsAfter: recenteredLegs,
      repairLegs: baseLegs.flatMap((leg) => {
        if (leg.action !== 'SELL') return [];
        if (leg.type === primaryStress.type && leg.strike === primaryStress.strike) {
          return [asRepairLeg(leg, { action: 'BUY' }), asRepairLeg(shiftLeg(leg, rollShift), { action: 'SELL' })];
        }
        if (leg.type === oppositeShort.type && leg.strike === oppositeShort.strike) {
          const shift = primaryStress.type === 'CE' ? step : -step;
          return [asRepairLeg(leg, { action: 'BUY' }), asRepairLeg(shiftLeg(leg, shift), { action: 'SELL' })];
        }
        return [];
      }),
    }));
  }

  const nakedShorts = baseLegs.filter((leg) => (
    leg.action === 'SELL'
    && !baseLegs.some((candidate) => candidate.action === 'BUY' && candidate.type === leg.type && (
      leg.type === 'CE' ? candidate.strike > leg.strike : candidate.strike < leg.strike
    ))
  ));
  if (nakedShorts.length > 0) {
    const hedgedLegs = [
      ...baseLegs,
      ...nakedShorts.map((shortLeg) => ({
        ...shortLeg,
        id: `${shortLeg.id}-wing`,
        action: 'BUY' as const,
        strike: shortLeg.type === 'CE' ? shortLeg.strike + step * 4 : shortLeg.strike - step * 4,
        ltp: Math.max(5, shortLeg.ltp * 0.35),
      })),
    ];
    suggestions.push(createBaseSuggestion(position, {
      id: `${position.id}-add-wings`,
      repairType: 'add_wings',
      positionId: position.id,
      title: nakedShorts.length > 1 ? 'Convert the naked structure into an iron condor' : 'Cap undefined risk with a wing',
      rationale: nakedShorts.length > 1
        ? 'Both short sides are uncovered. Adding wings converts the structure into defined risk and stabilizes tail loss under gap moves.'
        : 'The position carries naked short premium. Adding a wing converts the repair into a defined-risk structure.',
      trigger: `Undefined-risk ${nakedShorts.map((leg) => `${leg.type} ${leg.strike}`).join(' / ')} remains in the live book.`,
      repairFlow: 'Stage the hedge wings first. If the repair still consumes too much margin, flatten instead of layering more adjustments.',
      severity: 'critical',
      current,
      proposed: summarize(position, hedgedLegs, stressedLabels),
      legsBefore: baseLegs,
      legsAfter: hedgedLegs,
      repairLegs: nakedShorts.map((shortLeg) => asRepairLeg({
        ...shortLeg,
        action: 'BUY',
        strike: shortLeg.type === 'CE' ? shortLeg.strike + step * 4 : shortLeg.strike - step * 4,
        ltp: Math.max(5, shortLeg.ltp * 0.35),
      })),
    }));
  }

  const flattenedTypeLegs = baseLegs.filter((leg) => leg.type !== primaryStress.type);
  if (flattenedTypeLegs.length > 0) {
    suggestions.push(createBaseSuggestion(position, {
      id: `${position.id}-close-tested-side`,
      repairType: 'close_tested_side',
      positionId: position.id,
      title: `Close tested ${primaryStress.type === 'CE' ? 'call' : 'put'} side`,
      rationale: 'When one side is being tested, closing that side removes immediate stress while preserving the opposite side if you still want carry.',
      trigger: `Short ${primaryStress.type} side is the stressed leg cluster.`,
      repairFlow: 'Use this when repair quality is poor or you want to collapse the structure to its profitable side first.',
      severity: 'warning',
      current,
      proposed: summarize(position, flattenedTypeLegs, stressedLabels),
      legsBefore: baseLegs,
      legsAfter: flattenedTypeLegs,
      repairLegs: baseLegs
        .filter((leg) => leg.type === primaryStress.type)
        .map((leg) => asRepairLeg(leg, { action: oppositeAction(leg.action) })),
    }));
  }

  suggestions.push(createBaseSuggestion(position, {
    id: `${position.id}-flatten-all`,
    repairType: 'flatten_all',
    positionId: position.id,
    title: 'Flatten the position',
    rationale: 'If the stress is no longer consistent with the original thesis, closing the position prevents defensive overtrading.',
    trigger: 'Stress, margin pressure, or thesis invalidation is active.',
    repairFlow: 'Use when the broker-confirmed repair delta still leaves poor payoff asymmetry or margin relief is too small.',
    severity: 'critical',
    current,
    proposed: summarize(position, [], stressedLabels),
    legsBefore: baseLegs,
    legsAfter: [],
    repairLegs: baseLegs.map((leg) => asRepairLeg(leg, { action: oppositeAction(leg.action) })),
  }));

  return suggestions.slice(0, 6);
}

export function AdjustmentProvider({ children }: { children: React.ReactNode }) {
  const { spotPrice } = useMarketStore();
  const { livePositions } = usePortfolioStore();
  const { stageStrategy, clearLegs } = useExecutionStore();
  const { session } = useSessionStore();
  const baseSuggestions = useMemo(
    () => livePositions
      .filter((position) => position.status === 'ACTIVE')
      .flatMap((position) => createSuggestionsForPosition(position, spotPrice))
      .slice(0, 8),
    [livePositions, spotPrice],
  );
  const [suggestions, setSuggestions] = useState<AdjustmentSuggestion[]>(baseSuggestions);

  useEffect(() => {
    setSuggestions(baseSuggestions);
    if (
      !session?.isConnected
      || !brokerGatewayClient.session.isBackend(session.proxyBase)
      || baseSuggestions.length === 0
    ) {
      return;
    }

    let cancelled = false;
    setSuggestions((current) => current.map((suggestion) => ({
      ...suggestion,
      previewDelta: { ...suggestion.previewDelta, status: 'loading', notes: ['Loading broker-confirmed repair preview.'] },
    })));

    const hydrate = async () => {
      const next = await Promise.all(baseSuggestions.map(async (suggestion) => {
        try {
          const [currentPreview, proposedPreview, currentMargin, proposedMargin] = await Promise.all([
            brokerGatewayClient.execution.previewStrategy(session, buildBackendLegPayload(suggestion.legsBefore)),
            suggestion.legsAfter.length > 0
              ? brokerGatewayClient.execution.previewStrategy(session, buildBackendLegPayload(suggestion.legsAfter))
              : Promise.resolve({ ok: true, data: buildExecutionPreview([]) }),
            brokerGatewayClient.execution.fetchMargin(session, suggestion.legsBefore),
            suggestion.legsAfter.length > 0
              ? brokerGatewayClient.execution.fetchMargin(session, suggestion.legsAfter)
              : Promise.resolve({ ok: true, data: buildExecutionPreview([]) }),
          ]);

          if (!currentPreview.ok || !proposedPreview.ok || !currentMargin.ok || !proposedMargin.ok) {
            return suggestion;
          }

          const currentMarginRequired = currentMargin.data?.marginRequired ?? currentPreview.data?.marginRequired ?? suggestion.current.maxLoss;
          const proposedMarginRequired = proposedMargin.data?.marginRequired ?? proposedPreview.data?.marginRequired ?? suggestion.proposed.maxLoss;
          return {
            ...suggestion,
            previewDelta: {
              status: 'ready' as const,
              source: 'backend' as const,
              premiumDelta: (proposedPreview.data?.estimatedPremium ?? 0) - (currentPreview.data?.estimatedPremium ?? 0),
              feeDelta: (proposedPreview.data?.estimatedFees ?? 0) - (currentPreview.data?.estimatedFees ?? 0),
              marginDelta: proposedMarginRequired - currentMarginRequired,
              resultingMargin: proposedMarginRequired,
              resultingMaxLoss: suggestion.proposed.maxLoss,
              notes: [
                'Broker-confirmed repair preview loaded.',
                ...(proposedPreview.data?.notes ?? []),
                ...(proposedMargin.data?.notes ?? []),
              ],
            },
          };
        } catch {
          return suggestion;
        }
      }));
      if (!cancelled) setSuggestions(next);
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [baseSuggestions, session]);

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
