// components/OptionChain/components/StatsStrip.tsx

import React, { memo, useMemo } from 'react';
import type { ExpiryDate } from '../../../types/index';
import type { ChainStats, StatItem } from '../types';
import { fmtOI } from '../../../utils/math';

interface StatsStripProps {
  spotPrice: number;
  stats: ChainStats;
  selectedExpiry: ExpiryDate;
}

export const StatsStrip = memo<StatsStripProps>(function StatsStrip({
  spotPrice,
  stats,
  selectedExpiry,
}) {
  const items: StatItem[] = useMemo(() => [
    {
      label: 'SPOT',
      value: `₹${spotPrice.toLocaleString('en-IN')}`,
      cls: 'text-white font-bold mono',
    },
    {
      label: 'PCR',
      value: stats.pcr,
      cls: `font-bold mono ${
        stats.pcrNumeric > 1
          ? 'text-emerald-400'
          : stats.pcr === 'N/A' ? 'text-gray-500' : 'text-red-400'
      }`,
    },
    {
      label: 'ATM IV',
      value: stats.atmRow ? `${stats.atmRow.ce_iv.toFixed(1)}%` : '—',
      cls: 'text-purple-400 font-bold mono',
    },
    {
      label: 'Max Pain',
      value: stats.maxPain > 0 ? `₹${stats.maxPain.toLocaleString('en-IN')}` : '—',
      cls: 'text-amber-400 font-bold mono',
      title: 'Strike where option writers profit most',
    },
    // SPEC-F3: Straddle premium
    {
      label: 'Straddle',
      value: stats.atmStraddlePremium > 0
        ? `₹${stats.atmStraddlePremium.toFixed(0)}`
        : '—',
      cls: 'text-cyan-400 font-bold mono',
      title: stats.atmRow
        ? `ATM Straddle = CE ₹${stats.atmRow.ce_ltp.toFixed(0)} + PE ₹${stats.atmRow.pe_ltp.toFixed(0)}`
        : 'ATM CE + PE LTP',
    },
    // SPEC-F3: Expected move
    {
      label: 'Exp Move',
      value: stats.expectedMovePercent > 0
        ? `±${stats.expectedMovePercent.toFixed(1)}%`
        : '—',
      cls: 'text-cyan-300 mono',
      title: 'Expected move from ATM straddle premium',
    },
    {
      label: 'DTE',
      value: `${selectedExpiry.daysToExpiry}d`,
      cls: 'text-blue-400 font-bold',
    },
    {
      label: 'Resistance',
      value: stats.totalCeOI > 0 ? `₹${stats.maxCeOIStrike.toLocaleString('en-IN')}` : '—',
      cls: 'text-blue-300 mono',
      title: 'Highest CE OI strike',
    },
    {
      label: 'Support',
      value: stats.totalPeOI > 0 ? `₹${stats.maxPeOIStrike.toLocaleString('en-IN')}` : '—',
      cls: 'text-orange-300 mono',
      title: 'Highest PE OI strike',
    },
    {
      label: 'CE OI',
      value: fmtOI(stats.totalCeOI),
      cls: 'text-blue-400',
    },
    {
      label: 'PE OI',
      value: fmtOI(stats.totalPeOI),
      cls: 'text-orange-400',
    },
  ], [spotPrice, stats, selectedExpiry.daysToExpiry]);

  return (
    <div
      className="flex items-center gap-4 px-3 py-1 bg-[#0e1018] border-b border-gray-800/50
                 text-[10px] flex-shrink-0 overflow-x-auto no-scroll"
      role="status"
      aria-label="Option chain summary"
    >
      {items.map((s) => (
        <span key={s.label} className="flex items-center gap-1 shrink-0" title={s.title}>
          <span className="text-gray-700">{s.label}</span>
          <span className={s.cls}>{s.value}</span>
        </span>
      ))}
      <span className="ml-auto flex items-center gap-2 shrink-0 text-[9px]" aria-hidden="true">
        <span className="text-blue-500">■ CE</span>
        <span className="text-orange-500">■ PE</span>
      </span>
    </div>
  );
});
