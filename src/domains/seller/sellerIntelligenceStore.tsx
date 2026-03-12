import React, { createContext, useContext, useMemo } from 'react';
import { SYMBOL_CONFIG } from '../../config/market';
import type {
  OptionRow,
  Position,
  SellerExposureSnapshot,
  SellerOpportunity,
  SellerOpportunityAutomationPreset,
  SellerOpportunityLeg,
  SellerPlaybook,
  SellerRegime,
} from '../../types/index';
import { buildPayoff, combinedGreeks, findBreakevens, maxProfitLoss } from '../../utils/math';
import { useMarketStore } from '../market/marketStore';
import { usePortfolioStore } from '../portfolio/portfolioStore';
import { useRiskStore } from '../risk/riskStore';

interface SellerIntelligenceStoreValue {
  regime: SellerRegime;
  opportunities: SellerOpportunity[];
  suppressedOpportunities: SellerOpportunity[];
  playbooks: SellerPlaybook[];
  exposure: SellerExposureSnapshot;
}

const SellerIntelligenceStore = createContext<SellerIntelligenceStoreValue | null>(null);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nearestRow(chain: OptionRow[], spot: number) {
  return chain.reduce<OptionRow | null>((best, row) => {
    if (!best) return row;
    return Math.abs(row.strike - spot) < Math.abs(best.strike - spot) ? row : best;
  }, null);
}

function rowForStrike(chain: OptionRow[], strike: number) {
  return chain.find((row) => row.strike === strike) ?? nearestRow(chain, strike);
}

function strikeAtSteps(chain: OptionRow[], spot: number, step: number, offset: number) {
  const desired = Math.round((spot + step * offset) / step) * step;
  return rowForStrike(chain, desired)?.strike ?? desired;
}

function legFromRow(
  row: OptionRow | null | undefined,
  type: 'CE' | 'PE',
  action: 'BUY' | 'SELL',
  symbol: SellerOpportunityLeg['symbol'],
  expiry: string,
  lots: number,
): SellerOpportunityLeg {
  return {
    symbol,
    type,
    strike: row?.strike ?? 0,
    action,
    lots,
    ltp: type === 'CE' ? (row?.ce_ltp ?? 0) : (row?.pe_ltp ?? 0),
    iv: type === 'CE' ? (row?.ce_iv ?? 0) : (row?.pe_iv ?? 0),
    delta: type === 'CE' ? (row?.ce_delta ?? 0) : (row?.pe_delta ?? 0),
    theta: type === 'CE' ? (row?.ce_theta ?? 0) : (row?.pe_theta ?? 0),
    gamma: type === 'CE' ? (row?.ce_gamma ?? 0) : (row?.pe_gamma ?? 0),
    vega: type === 'CE' ? (row?.ce_vega ?? 0) : (row?.pe_vega ?? 0),
    expiry,
    orderType: 'market',
  };
}

function describeRegime(regime: SellerRegime['id']) {
  switch (regime) {
    case 'range_bound':
      return {
        label: 'Range-Bound',
        summary: 'Spot is rotating inside a contained range and realized movement is modest. Neutral premium-selling structures are favored.',
        preferredStructures: ['Iron Condor', 'Iron Fly', 'Short Strangle'],
        restrictedStructures: ['Naked trend sells'],
      };
    case 'trend_up':
      return {
        label: 'Trend-Up',
        summary: 'Upward drift is dominating. Seller edge shifts toward bullish credit structures instead of neutral short-vol selling.',
        preferredStructures: ['Bull Put Spread', 'Put Ratio Repair'],
        restrictedStructures: ['Short Call-heavy neutral structures'],
      };
    case 'trend_down':
      return {
        label: 'Trend-Down',
        summary: 'Downward drift is dominating. Seller edge shifts toward bearish credit structures and tighter downside risk control.',
        preferredStructures: ['Bear Call Spread', 'Call Ratio Repair'],
        restrictedStructures: ['Short Put-heavy neutral structures'],
      };
    case 'volatile_expansion':
      return {
        label: 'Volatile Expansion',
        summary: 'Range and realized volatility are expanding. Defined-risk sellers only should be preferred and naked short gamma should be curtailed.',
        preferredStructures: ['Wide Iron Condor', 'Defined-Risk Credit Spread'],
        restrictedStructures: ['Short Straddle', 'Short Strangle'],
      };
    case 'post_event_vol_crush':
      return {
        label: 'Post-Event Vol Crush',
        summary: 'Implied volatility is rich relative to movement. Premium sellers can harvest decay if liquidity and event cleanup are intact.',
        preferredStructures: ['Iron Condor', 'Short Strangle', 'Calendar Overlay'],
        restrictedStructures: ['Long Vega structures'],
      };
    case 'pre_event_uncertainty':
      return {
        label: 'Pre-Event Uncertainty',
        summary: 'Unpriced event or skew uncertainty is elevated. Defined-risk sellers and smaller size are required if trading at all.',
        preferredStructures: ['Hedged Credit Spread', 'Light Iron Condor'],
        restrictedStructures: ['Naked Short Premium'],
      };
    case 'expiry_pinning':
      return {
        label: 'Expiry Pinning',
        summary: 'Expiry is near and spot is gravitating toward ATM. Theta is attractive but gamma risk can rise abruptly.',
        preferredStructures: ['Iron Fly', 'Tight Iron Condor'],
        restrictedStructures: ['Wide naked structures'],
      };
  }
}

function buildRegime(
  chain: OptionRow[],
  historical: Array<{ open: number; high: number; low: number; close: number }>,
  spotPrice: number,
  expiryDays: number,
  breadthSignal: number,
): SellerRegime {
  const atm = nearestRow(chain, spotPrice);
  const avgIv = average(chain.flatMap((row) => [row.ce_iv, row.pe_iv]).filter((value) => value > 0));
  const avgRangePct = average(historical.map((candle) => ((candle.high - candle.low) / Math.max(candle.close, 1)) * 100));
  const trendPct = historical.length > 1
    ? ((historical[historical.length - 1].close - historical[0].open) / Math.max(historical[0].open, 1)) * 100
    : 0;
  const atmIv = average([atm?.ce_iv ?? avgIv, atm?.pe_iv ?? avgIv].filter((value) => value > 0));
  const skew = (atm?.pe_iv ?? avgIv) - (atm?.ce_iv ?? avgIv);

  let id: SellerRegime['id'] = 'range_bound';
  if (expiryDays <= 1 && Math.abs(trendPct) < 0.45) id = 'expiry_pinning';
  else if (avgIv >= 18 && avgRangePct <= 0.45) id = 'post_event_vol_crush';
  else if (avgIv >= 22 || avgRangePct >= 1.1) id = 'volatile_expansion';
  else if (trendPct >= 1.15) id = 'trend_up';
  else if (trendPct <= -1.15) id = 'trend_down';
  else if (avgIv >= 16 && Math.abs(trendPct) >= 0.7) id = 'pre_event_uncertainty';

  const descriptor = describeRegime(id);
  const suitabilityBase = id === 'volatile_expansion' || id === 'pre_event_uncertainty'
    ? 48
    : id === 'trend_up' || id === 'trend_down'
      ? 64
      : 78;
  const sellerSuitability = clamp(
    suitabilityBase
      + (avgIv >= 14 && avgIv <= 19 ? 8 : 0)
      + (Math.abs(skew) < 1.6 ? 4 : -5)
      + (breadthSignal >= 0 ? 2 : -3),
    18,
    94,
  );
  const confidence = clamp(
    45 + Math.round(Math.min(Math.abs(trendPct) * 18 + avgRangePct * 12 + Math.abs(skew) * 4, 45)),
    35,
    92,
  );

  return {
    id,
    label: descriptor.label,
    summary: descriptor.summary,
    sellerSuitability,
    confidence,
    metrics: [
      { label: 'ATM IV', value: `${atmIv.toFixed(1)}%`, tone: atmIv >= 18 ? 'positive' : atmIv < 12 ? 'warning' : 'neutral' },
      { label: 'Realized Range', value: `${avgRangePct.toFixed(2)}%`, tone: avgRangePct >= 1 ? 'warning' : 'positive' },
      { label: 'Trend', value: `${trendPct >= 0 ? '+' : ''}${trendPct.toFixed(2)}%`, tone: Math.abs(trendPct) >= 1 ? 'warning' : 'neutral' },
      { label: 'Put-Call Skew', value: `${skew >= 0 ? '+' : ''}${skew.toFixed(2)} iv`, tone: Math.abs(skew) >= 2 ? 'warning' : 'neutral' },
    ],
    preferredStructures: descriptor.preferredStructures,
    restrictedStructures: descriptor.restrictedStructures,
    warnings: [
      ...(avgIv < 12 ? ['Premium is thin. Force defined-risk or skip weak credits.'] : []),
      ...(expiryDays <= 1 ? ['Expiry-day gamma can expand quickly near ATM.'] : []),
      ...(id === 'volatile_expansion' ? ['Do not lean on naked short gamma while realized range is expanding.'] : []),
      ...(id === 'pre_event_uncertainty' ? ['Event or skew uncertainty is elevated. Reduce size and prefer hedges.'] : []),
    ],
  };
}

function buildPlaybooks(): SellerPlaybook[] {
  return [
    {
      id: 'weekly-neutral-income',
      name: 'Weekly Neutral Income',
      description: 'Harvest theta in contained index ranges with hedged neutral structures and explicit margin caps.',
      targetRegimes: ['range_bound', 'post_event_vol_crush', 'expiry_pinning'],
      allowedStructures: ['Iron Condor', 'Iron Fly', 'Short Strangle'],
      riskBudgetPct: 18,
      style: 'neutral_income',
      noTradeConditions: [
        'Skip when seller suitability falls below 60.',
        'Skip when realized range expansion exceeds 1%.',
      ],
    },
    {
      id: 'trend-credit-book',
      name: 'Trend Credit Book',
      description: 'Lean into directional credit spreads instead of neutral shorts when the index trend is persistent.',
      targetRegimes: ['trend_up', 'trend_down', 'pre_event_uncertainty'],
      allowedStructures: ['Bull Put Spread', 'Bear Call Spread'],
      riskBudgetPct: 14,
      style: 'directional_credit',
      noTradeConditions: [
        'No naked call or naked put exposure.',
        'Reduce size when ATM IV is below 12%.',
      ],
    },
    {
      id: 'expiry-theta-harvest',
      name: 'Expiry Theta Harvest',
      description: 'Exploit decay near expiry with defined-risk structures and very explicit gamma controls.',
      targetRegimes: ['expiry_pinning', 'range_bound'],
      allowedStructures: ['Iron Fly', 'Tight Iron Condor'],
      riskBudgetPct: 10,
      style: 'expiry_decay',
      noTradeConditions: [
        'Avoid when spot is already probing a short strike.',
        'Flatten rather than defend if gamma accelerates rapidly.',
      ],
    },
  ];
}

function buildExposure(positions: Position[], summary: { marginUtilization: number; grossExposure: number; hedgedExposure: number; availableFunds: number }): SellerExposureSnapshot {
  const base = positions.reduce((acc, position) => {
    position.legs.forEach((leg) => {
      if (leg.type === 'CE') {
        if (leg.action === 'SELL') acc.activeShortCallLots += leg.lots;
        else acc.activeLongCallLots += leg.lots;
      } else {
        if (leg.action === 'SELL') acc.activeShortPutLots += leg.lots;
        else acc.activeLongPutLots += leg.lots;
      }
      const deltaUnit = leg.type === 'CE' ? 0.4 : -0.4;
      const signedAction = leg.action === 'BUY' ? 1 : -1;
      acc.netDirectionalDelta += deltaUnit * signedAction * leg.lots;
      const gammaUnit = leg.action === 'SELL' ? 1 : -0.8;
      acc.netShortGammaProxy += gammaUnit * leg.lots;
    });
    return acc;
  }, {
    activeShortCallLots: 0,
    activeShortPutLots: 0,
    activeLongCallLots: 0,
    activeLongPutLots: 0,
    netDirectionalDelta: 0,
    netShortGammaProxy: 0,
  });

  const pressureFlags: string[] = [];
  if (summary.marginUtilization >= 0.72) pressureFlags.push('Margin utilization is already elevated.');
  if (base.activeShortPutLots > base.activeLongPutLots + 2) pressureFlags.push('Portfolio is already carrying heavy downside short premium.');
  if (base.activeShortCallLots > base.activeLongCallLots + 2) pressureFlags.push('Portfolio is already carrying heavy upside short premium.');
  if (summary.grossExposure > 0 && (summary.grossExposure - summary.hedgedExposure) / summary.grossExposure >= 0.68) {
    pressureFlags.push('Unhedged exposure is elevated.');
  }

  return {
    activePositions: positions.filter((position) => position.status === 'ACTIVE').length,
    ...base,
    marginUtilization: summary.marginUtilization,
    unhedgedExposurePct: summary.grossExposure === 0 ? 0 : (summary.grossExposure - summary.hedgedExposure) / summary.grossExposure,
    availableFunds: summary.availableFunds,
    dominantBias: base.netDirectionalDelta >= 1.5 ? 'bullish' : base.netDirectionalDelta <= -1.5 ? 'bearish' : 'neutral',
    pressureFlags,
  };
}

function derivePlaybookCompliance(
  structure: string,
  regime: SellerRegime,
  playbooks: SellerPlaybook[],
  marginUtilization: number,
) {
  const aligned = playbooks.find((playbook) => (
    playbook.targetRegimes.includes(regime.id) && playbook.allowedStructures.includes(structure)
  ));
  if (!aligned) return { compliance: 'watch' as const, preferredPlaybookId: undefined };
  if (marginUtilization * 100 > aligned.riskBudgetPct * 4.8) {
    return { compliance: 'violates' as const, preferredPlaybookId: aligned.id };
  }
  return { compliance: 'aligned' as const, preferredPlaybookId: aligned.id };
}

function createAutomationPresets(
  idea: Pick<SellerOpportunity, 'id' | 'title' | 'structure' | 'expectedCredit' | 'marginEstimate' | 'breakevens' | 'legs'>,
  playbook: SellerPlaybook | undefined,
  spotPrice: number,
): SellerOpportunityAutomationPreset[] {
  const lowerGuard = idea.breakevens[0] ?? Math.round(spotPrice * 0.995);
  const upperGuard = idea.breakevens[idea.breakevens.length - 1] ?? Math.round(spotPrice * 1.005);
  const drawdownLimit = -Math.max(2500, Math.round(Math.max(Math.abs(idea.marginEstimate), Math.abs(idea.expectedCredit)) * 0.22));
  const profitTarget = Math.max(1800, Math.round(Math.abs(idea.expectedCredit) * 0.45));
  const triggerDirection = playbook?.style === 'directional_credit'
    ? (idea.structure === 'Bull Put Spread' ? 'down' : 'up')
    : 'either';
  const triggerPrice = playbook?.style === 'directional_credit'
    ? (idea.structure === 'Bull Put Spread' ? lowerGuard : upperGuard)
    : spotPrice;

  return [
    {
      id: `${idea.id}-range-guard`,
      label: 'Range guard exit',
      description: 'Exit or alert when price leaves the expected seller corridor.',
      triggerSummary: `Spot leaves ${Math.round(lowerGuard)} to ${Math.round(upperGuard)}`,
      actionSummary: 'Execute staged exit strategy',
      triggerConfig: {
        type: playbook?.style === 'directional_credit'
          ? (idea.structure === 'Bull Put Spread' ? 'spot_cross_below' : 'spot_cross_above')
          : 'spot_range_break',
        lowerPrice: Math.round(lowerGuard),
        upperPrice: Math.round(upperGuard),
        thresholdPrice: Math.round(triggerPrice),
        referencePrice: Math.round(spotPrice),
        direction: triggerDirection,
      },
      actionConfig: {
        type: 'execute_strategy',
        legs: idea.legs.map((leg) => ({
          symbol: leg.symbol,
          type: leg.type,
          strike: leg.strike,
          action: leg.action === 'SELL' ? 'BUY' : 'SELL',
          lots: leg.lots,
          expiry: leg.expiry,
          orderType: leg.orderType ?? 'market',
          limitPrice: leg.limitPrice,
        })),
        message: `${idea.title}: close structure if the idea invalidates.`,
      },
    },
    {
      id: `${idea.id}-drawdown-stop`,
      label: 'MTM drawdown stop',
      description: 'Pause the idea when live PnL deterioration exceeds the seller budget.',
      triggerSummary: `Live MTM <= ${drawdownLimit}`,
      actionSummary: 'Notify and suggest hedge/defense review',
      triggerConfig: {
        type: 'mtm_drawdown',
        maxDrawdown: drawdownLimit,
      },
      actionConfig: {
        type: 'suggest_hedge',
        message: `${idea.title}: drawdown stop triggered. Review hedge or close the tested side.`,
      },
    },
    {
      id: `${idea.id}-profit-lock`,
      label: playbook?.style === 'expiry_decay' ? 'Expiry decay capture' : 'Profit lock',
      description: 'Lock gains once the target premium has decayed enough.',
      triggerSummary: `Live MTM >= ${profitTarget}`,
      actionSummary: 'Notify for profit booking discipline',
      triggerConfig: {
        type: 'mtm_profit_target',
        profitTarget,
      },
      actionConfig: {
        type: 'notify',
        message: `${idea.title}: profit objective reached. Review closure or partial exit.`,
      },
    },
  ];
}

function applyPortfolioSuppression(
  idea: SellerOpportunity,
  playbooks: SellerPlaybook[],
  regime: SellerRegime,
  exposure: SellerExposureSnapshot,
  spotPrice: number,
) {
  const suppressionReasons: string[] = [];
  const shortCallLots = idea.legs.filter((leg) => leg.action === 'SELL' && leg.type === 'CE').reduce((sum, leg) => sum + leg.lots, 0);
  const shortPutLots = idea.legs.filter((leg) => leg.action === 'SELL' && leg.type === 'PE').reduce((sum, leg) => sum + leg.lots, 0);
  const undefinedRisk = !idea.structure.includes('Condor') && !idea.structure.includes('Spread') && !idea.structure.includes('Fly');

  if (shortPutLots > 0 && exposure.activeShortPutLots > exposure.activeLongPutLots + 2) {
    suppressionReasons.push('Live book already has concentrated downside short premium.');
  }
  if (shortCallLots > 0 && exposure.activeShortCallLots > exposure.activeLongCallLots + 2) {
    suppressionReasons.push('Live book already has concentrated upside short premium.');
  }
  if (idea.structure === 'Bull Put Spread' && exposure.dominantBias === 'bullish' && exposure.netDirectionalDelta >= 2.5) {
    suppressionReasons.push('Bullish portfolio delta is already extended.');
  }
  if (idea.structure === 'Bear Call Spread' && exposure.dominantBias === 'bearish' && exposure.netDirectionalDelta <= -2.5) {
    suppressionReasons.push('Bearish portfolio delta is already extended.');
  }
  if (undefinedRisk && exposure.marginUtilization >= 0.7) {
    suppressionReasons.push('Margin utilization is too high for adding undefined-risk premium.');
  }
  if (undefinedRisk && exposure.unhedgedExposurePct >= 0.68) {
    suppressionReasons.push('Unhedged exposure is already elevated for naked premium.');
  }
  if (regime.id === 'volatile_expansion' && undefinedRisk) {
    suppressionReasons.push('Volatile expansion regime blocks additional naked short gamma.');
  }

  const compliance = derivePlaybookCompliance(idea.structure, regime, playbooks, exposure.marginUtilization);
  if (compliance.compliance === 'violates') {
    suppressionReasons.push('Playbook risk budget would be exceeded by the current portfolio state.');
  }

  const exposurePenalty = suppressionReasons.length * 10
    + (exposure.marginUtilization > 0.7 ? 8 : 0)
    + (exposure.unhedgedExposurePct > 0.65 ? 6 : 0);
  const exposureFit = clamp(92 - exposurePenalty, 8, 96);
  const playbook = playbooks.find((item) => item.id === compliance.preferredPlaybookId);

  return {
    ...idea,
    preferredPlaybookId: compliance.preferredPlaybookId,
    playbookCompliance: compliance.compliance,
    exposureFit,
    suppressed: suppressionReasons.length > 0,
    suppressionReasons,
    sellerScore: clamp(idea.sellerScore - Math.round((100 - exposureFit) * 0.35), 8, 98),
    automationPresets: createAutomationPresets(idea, playbook, spotPrice),
  };
}

function estimateOpportunity(
  id: string,
  title: string,
  structure: string,
  mode: SellerOpportunity['mode'],
  thesis: string,
  whyNow: string,
  invalidation: string,
  adjustmentPlan: string,
  tags: string[],
  warnings: string[],
  legs: SellerOpportunityLeg[],
  regime: SellerRegime,
  playbooks: SellerPlaybook[],
): SellerOpportunity {
  const lotSize = SYMBOL_CONFIG[legs[0].symbol].lotSize;
  const payoffLegs = legs.map((leg, index) => ({ ...leg, id: `seller-${id}-${index}` }));
  const expectedCredit = legs.reduce((sum, leg) => (
    sum + leg.ltp * (leg.action === 'SELL' ? 1 : -1) * leg.lots * lotSize
  ), 0);
  const payoff = buildPayoff(payoffLegs, average(legs.map((leg) => leg.strike)));
  const { maxLoss } = maxProfitLoss(payoff);
  const greeks = combinedGreeks(payoffLegs);
  const grossPremium = legs.reduce((sum, leg) => sum + leg.ltp * leg.lots * lotSize, 0);
  const marginEstimate = Math.max(Math.abs(maxLoss), grossPremium * 1.18);
  const thetaPerMargin = marginEstimate === 0 ? 0 : Math.abs(greeks.theta) / marginEstimate * 1000;
  const liquidityScore = clamp(
    Math.round(average(legs.map((leg) => Math.max(0, 100 - Math.abs(leg.delta) * 90 + leg.iv * 0.8)))),
    35,
    92,
  );
  const tailRiskScore = clamp(
    Math.round(
      (maxLoss < 0 && !Number.isFinite(maxLoss) ? 88 : 40)
      + (structure.includes('Condor') || structure.includes('Spread') || structure.includes('Fly') ? -18 : 12)
      + (regime.id === 'volatile_expansion' ? 15 : 0),
    ),
    12,
    96,
  );
  const regimeFit = clamp(
    regime.sellerSuitability
      + (regime.preferredStructures.includes(structure) ? 10 : 0)
      - (regime.restrictedStructures.includes(structure) ? 18 : 0),
    12,
    96,
  );
  const sellerScore = clamp(
    Math.round(regimeFit * 0.35 + liquidityScore * 0.2 + (100 - tailRiskScore) * 0.2 + clamp(thetaPerMargin * 140, 0, 100) * 0.25),
    10,
    98,
  );

  return {
    id,
    title,
    structure,
    mode,
    regimeFit,
    sellerScore,
    thesis,
    whyNow,
    expectedCredit,
    marginEstimate,
    maxLossEstimate: maxLoss,
    thetaPerMargin,
    liquidityScore,
    tailRiskScore,
    breakevens: findBreakevens(payoff),
    invalidation,
    adjustmentPlan,
    warnings,
    tags,
    playbookMatches: playbooks
      .filter((playbook) => playbook.targetRegimes.includes(regime.id) && playbook.allowedStructures.includes(structure))
      .map((playbook) => playbook.name),
    preferredPlaybookId: undefined,
    playbookCompliance: 'watch',
    exposureFit: 100,
    suppressed: false,
    suppressionReasons: [],
    automationPresets: [],
    legs,
  };
}

function buildOpportunities(
  chain: OptionRow[],
  spotPrice: number,
  symbol: SellerOpportunityLeg['symbol'],
  expiry: string,
  regime: SellerRegime,
  playbooks: SellerPlaybook[],
  exposure: SellerExposureSnapshot,
) {
  if (chain.length === 0) return [];
  const step = SYMBOL_CONFIG[symbol].strikeStep;
  const lots = 1;

  const ironCondorLegs = [
    legFromRow(rowForStrike(chain, strikeAtSteps(chain, spotPrice, step, 3)), 'CE', 'SELL', symbol, expiry, lots),
    legFromRow(rowForStrike(chain, strikeAtSteps(chain, spotPrice, step, 7)), 'CE', 'BUY', symbol, expiry, lots),
    legFromRow(rowForStrike(chain, strikeAtSteps(chain, spotPrice, step, -3)), 'PE', 'SELL', symbol, expiry, lots),
    legFromRow(rowForStrike(chain, strikeAtSteps(chain, spotPrice, step, -7)), 'PE', 'BUY', symbol, expiry, lots),
  ];
  const ironFlyLegs = [
    legFromRow(rowForStrike(chain, strikeAtSteps(chain, spotPrice, step, 0)), 'CE', 'SELL', symbol, expiry, lots),
    legFromRow(rowForStrike(chain, strikeAtSteps(chain, spotPrice, step, 3)), 'CE', 'BUY', symbol, expiry, lots),
    legFromRow(rowForStrike(chain, strikeAtSteps(chain, spotPrice, step, 0)), 'PE', 'SELL', symbol, expiry, lots),
    legFromRow(rowForStrike(chain, strikeAtSteps(chain, spotPrice, step, -3)), 'PE', 'BUY', symbol, expiry, lots),
  ];
  const bullPutSpreadLegs = [
    legFromRow(rowForStrike(chain, strikeAtSteps(chain, spotPrice, step, -2)), 'PE', 'SELL', symbol, expiry, lots),
    legFromRow(rowForStrike(chain, strikeAtSteps(chain, spotPrice, step, -6)), 'PE', 'BUY', symbol, expiry, lots),
  ];
  const bearCallSpreadLegs = [
    legFromRow(rowForStrike(chain, strikeAtSteps(chain, spotPrice, step, 2)), 'CE', 'SELL', symbol, expiry, lots),
    legFromRow(rowForStrike(chain, strikeAtSteps(chain, spotPrice, step, 6)), 'CE', 'BUY', symbol, expiry, lots),
  ];
  const shortStrangleLegs = [
    legFromRow(rowForStrike(chain, strikeAtSteps(chain, spotPrice, step, 4)), 'CE', 'SELL', symbol, expiry, lots),
    legFromRow(rowForStrike(chain, strikeAtSteps(chain, spotPrice, step, -4)), 'PE', 'SELL', symbol, expiry, lots),
  ];

  return [
    estimateOpportunity(
      `${symbol}-iron-condor`,
      'Wide Theta Condor',
      'Iron Condor',
      'defined_risk_only',
      'Neutral short-vol carry with long wings sized for contained ranges.',
      'Current range behavior supports harvesting theta while keeping tails bounded.',
      'Invalidate if spot migrates beyond the short strike corridor with rising realized range.',
      'Roll the tested side inward or close the winning side and re-center only if seller suitability remains above 60.',
      ['theta-per-margin', 'defined-risk', 'neutral-income'],
      regime.id === 'volatile_expansion' ? ['Keep size light until realized range compresses.'] : [],
      ironCondorLegs,
      regime,
      playbooks,
    ),
    estimateOpportunity(
      `${symbol}-iron-fly`,
      'Expiry Pin Iron Fly',
      'Iron Fly',
      'expiry_day',
      'ATM premium harvest with tight wings for decay-heavy sessions.',
      'Expiry proximity and contained drift make ATM premium rich, but the structure remains defined-risk.',
      'Invalidate when spot breaks away from ATM and gamma accelerates.',
      'Close early after 35-45% premium decay or shift the body if the market re-centers around a new ATM.',
      ['expiry-day', 'high-theta', 'defined-risk'],
      regime.id !== 'expiry_pinning' ? ['Use only with smaller size outside expiry-pinning sessions.'] : [],
      ironFlyLegs,
      regime,
      playbooks,
    ),
    estimateOpportunity(
      `${symbol}-bull-put`,
      'Trend Defense Bull Put',
      'Bull Put Spread',
      'conservative_income',
      'Directional short premium aligned with bullish drift and capped downside.',
      'Upside drift allows premium collection without leaning on call-side risk.',
      'Invalidate on loss of support or if downside realized range starts expanding.',
      'Roll the short put lower only if trend and breadth remain constructive; otherwise flatten rather than defend mechanically.',
      ['directional-credit', 'bullish', 'defined-risk'],
      regime.id === 'trend_down' ? ['Do not use while the prevailing regime remains trend-down.'] : [],
      bullPutSpreadLegs,
      regime,
      playbooks,
    ),
    estimateOpportunity(
      `${symbol}-bear-call`,
      'Trend Defense Bear Call',
      'Bear Call Spread',
      'conservative_income',
      'Directional short premium aligned with bearish drift and capped upside risk.',
      'Downside drift supports call-side credit selling without taking naked put exposure.',
      'Invalidate on recovery above resistance or broad-based reversal in index strength.',
      'Compress risk by rolling the short call up only if volatility is receding and the trend signal is weakening.',
      ['directional-credit', 'bearish', 'defined-risk'],
      regime.id === 'trend_up' ? ['Do not use while the prevailing regime remains trend-up.'] : [],
      bearCallSpreadLegs,
      regime,
      playbooks,
    ),
    estimateOpportunity(
      `${symbol}-short-strangle`,
      'High IV Strangle',
      'Short Strangle',
      'aggressive_theta',
      'Short premium at wider wings when implied volatility is paying enough for undefined risk.',
      'Only attractive when IV is rich and the book still has headroom for active defense.',
      'Invalidate immediately if realized range starts expanding beyond expected move assumptions.',
      'Convert to an iron condor on the challenged side or cut size rather than waiting for mean reversion blindly.',
      ['aggressive-theta', 'undefined-risk', 'vol-crush'],
      ['Use only with explicit margin discipline and active monitoring.'],
      shortStrangleLegs,
      regime,
      playbooks,
    ),
  ]
    .map((idea) => applyPortfolioSuppression(idea, playbooks, regime, exposure, spotPrice))
    .sort((left, right) => right.sellerScore - left.sellerScore);
}

export function SellerIntelligenceProvider({ children }: { children: React.ReactNode }) {
  const { chain, spotPrice, historical, expiry, symbol, watchlist } = useMarketStore();
  const { summary, livePositions } = usePortfolioStore();
  const { snapshot } = useRiskStore();

  const value = useMemo<SellerIntelligenceStoreValue>(() => {
    const breadthSignal = watchlist.reduce((sum, item) => sum + Math.sign(item.pct), 0)
      + Math.sign(snapshot.portfolioDelta)
      - Math.sign(summary.marginUtilization - 0.5);
    const regime = buildRegime(chain, historical, spotPrice, expiry.daysToExpiry, breadthSignal);
    const playbooks = buildPlaybooks();
    const exposure = buildExposure(livePositions, summary);
    const opportunities = buildOpportunities(chain, spotPrice, symbol, expiry.breezeValue, regime, playbooks, exposure);

    return {
      regime,
      opportunities: opportunities.filter((idea) => !idea.suppressed),
      suppressedOpportunities: opportunities.filter((idea) => idea.suppressed),
      playbooks,
      exposure,
    };
  }, [chain, expiry.breezeValue, expiry.daysToExpiry, historical, livePositions, snapshot.portfolioDelta, spotPrice, summary, symbol, watchlist]);

  return <SellerIntelligenceStore.Provider value={value}>{children}</SellerIntelligenceStore.Provider>;
}

export function useSellerIntelligenceStore() {
  const context = useContext(SellerIntelligenceStore);
  if (!context) throw new Error('useSellerIntelligenceStore must be used within SellerIntelligenceProvider');
  return context;
}
