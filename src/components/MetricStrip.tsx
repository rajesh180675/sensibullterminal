import React from 'react';

interface MetricStripProps {
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning';
}

const toneMap = {
  neutral: 'text-slate-200',
  positive: 'text-emerald-400',
  negative: 'text-rose-400',
  warning: 'text-amber-400',
};

export function MetricStrip({ label, value, subValue, tone = 'neutral' }: MetricStripProps) {
  return (
    <div className="flex flex-col justify-center rounded-md border border-slate-700/50 bg-slate-800/50 px-3 py-2 transition-colors duration-200 hover:border-slate-600/50">
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-sm ${toneMap[tone]}`}>
        {value}
        {subValue && <span className="ml-1 text-[11px] text-slate-500">{subValue}</span>}
      </div>
    </div>
  );
}
