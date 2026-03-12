import React, { createContext, useContext, useMemo } from 'react';
import type { RiskAlert, RiskSnapshot } from '../../types/index';
import { combinedGreeks } from '../../utils/math';
import { useExecutionStore } from '../execution/executionStore';
import { usePortfolioStore } from '../portfolio/portfolioStore';

function severityFor(value: number, warning: number, critical: number): RiskAlert['severity'] {
  if (value >= critical) return 'critical';
  if (value >= warning) return 'warning';
  return 'info';
}

interface RiskStoreValue {
  snapshot: RiskSnapshot;
}

const RiskStore = createContext<RiskStoreValue | null>(null);

export function RiskProvider({ children }: { children: React.ReactNode }) {
  const { legs, preview } = useExecutionStore();
  const { summary, livePositions } = usePortfolioStore();

  const snapshot = useMemo<RiskSnapshot>(() => {
    const stagedGreeks = combinedGreeks(legs);
    const positionCount = Math.max(livePositions.length, 1);
    const availableFunds = preview.availableMargin ?? summary.availableFunds;
    const chargeSummary = preview.chargeSummary;
    const stagedFees = chargeSummary?.totalFees ?? preview.estimatedFees;
    const stagedBrokerage = chargeSummary?.brokerage ?? 0;
    const stagedOtherCharges = chargeSummary?.brokerReportedOtherCharges ?? Math.max(stagedFees - stagedBrokerage, 0);
    const stagedTaxesAndDuties = chargeSummary?.taxesAndDuties ?? 0;
    const portfolioDelta = stagedGreeks.delta + summary.grossExposure / 100000;
    const portfolioTheta = stagedGreeks.theta - positionCount * 1.8;
    const portfolioGamma = stagedGreeks.gamma + positionCount * 0.0025;
    const portfolioVega = stagedGreeks.vega + positionCount * 0.65;
    const stressLoss1Pct = preview.capitalAtRisk * 0.35 + summary.totalMaxLoss * 0.08;
    const stressLoss2Pct = preview.capitalAtRisk * 0.62 + summary.totalMaxLoss * 0.14;
    const marginHeadroom = availableFunds - preview.marginRequired;
    const concentration = summary.grossExposure === 0 ? 0 : (summary.grossExposure - summary.hedgedExposure) / summary.grossExposure;

    const alerts: RiskAlert[] = [
      {
        id: 'margin-headroom',
        severity: marginHeadroom < 0 ? 'critical' : marginHeadroom < availableFunds * 0.15 ? 'warning' : 'info',
        title: 'Margin headroom',
        detail: marginHeadroom < 0
          ? 'Staged execution exceeds available funds.'
          : `Headroom after staged execution is ${Math.round(marginHeadroom).toLocaleString('en-IN')} with ${Math.round(stagedFees).toLocaleString('en-IN')} in staged fees.`,
      },
      {
        id: 'concentration',
        severity: severityFor(concentration, 0.62, 0.8),
        title: 'Directional concentration',
        detail: `${Math.round(concentration * 100)}% of gross exposure remains unhedged.`,
      },
      {
        id: 'stress-2',
        severity: severityFor(stressLoss2Pct, availableFunds * 0.18, availableFunds * 0.35),
        title: 'Two-sigma stress',
        detail: `Estimated drawdown under a 2% move is ${Math.round(stressLoss2Pct).toLocaleString('en-IN')}.`,
      },
    ];

    return {
      portfolioDelta,
      portfolioTheta,
      portfolioGamma,
      portfolioVega,
      stressLoss1Pct,
      stressLoss2Pct,
      marginHeadroom,
      concentration,
      stagedFees,
      stagedBrokerage,
      stagedOtherCharges,
      stagedTaxesAndDuties,
      chargeSummary,
      alerts,
    };
  }, [legs, livePositions.length, preview.availableMargin, preview.capitalAtRisk, preview.chargeSummary, preview.estimatedFees, preview.marginRequired, summary]);

  const value = useMemo(() => ({ snapshot }), [snapshot]);
  return <RiskStore.Provider value={value}>{children}</RiskStore.Provider>;
}

export function useRiskStore() {
  const context = useContext(RiskStore);
  if (!context) throw new Error('useRiskStore must be used within RiskProvider');
  return context;
}
