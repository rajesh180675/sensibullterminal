import React from 'react';
import { AlertTriangle, ShieldAlert, Sigma, Wallet } from 'lucide-react';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { usePortfolioStore } from '../../domains/portfolio/portfolioStore';
import { useRiskStore } from '../../domains/risk/riskStore';
import { fmtNum, fmtPnL } from '../../utils/math';

export function RiskWorkspace() {
  const { snapshot } = useRiskStore();
  const { preview } = useExecutionStore();
  const { summary } = usePortfolioStore();

  return (
    <div className="grid h-full gap-4 p-4 xl:grid-cols-[1fr,1fr,0.9fr]">
      <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
          <Sigma size={13} />
          Risk Greeks
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-3xl bg-white/5 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Delta</div>
            <div className="mt-2 text-xl font-semibold text-white">{fmtNum(snapshot.portfolioDelta, 3)}</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Theta</div>
            <div className="mt-2 text-xl font-semibold text-white">{fmtNum(snapshot.portfolioTheta, 3)}</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Gamma</div>
            <div className="mt-2 text-xl font-semibold text-white">{fmtNum(snapshot.portfolioGamma, 4)}</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Vega</div>
            <div className="mt-2 text-xl font-semibold text-white">{fmtNum(snapshot.portfolioVega, 3)}</div>
          </div>
        </div>

        <div className="mt-4 rounded-3xl border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-300">
          Staged margin requirement: {fmtPnL(-preview.marginRequired)}. Estimated capital at risk: {fmtPnL(-preview.capitalAtRisk)}.
        </div>
      </section>

      <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
          <ShieldAlert size={13} />
          Stress grid
        </div>
        <div className="mt-4 space-y-3">
          <div className="rounded-3xl bg-white/5 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">1% move</div>
            <div className="mt-2 text-xl font-semibold text-white">{fmtPnL(-snapshot.stressLoss1Pct)}</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">2% move</div>
            <div className="mt-2 text-xl font-semibold text-white">{fmtPnL(-snapshot.stressLoss2Pct)}</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Concentration</div>
            <div className="mt-2 text-xl font-semibold text-white">{Math.round(snapshot.concentration * 100)}%</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Margin headroom</div>
            <div className={`mt-2 text-xl font-semibold ${snapshot.marginHeadroom >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
              {fmtPnL(snapshot.marginHeadroom)}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
          <AlertTriangle size={13} />
          Alerts
        </div>
        <div className="mt-4 space-y-3">
          {snapshot.alerts.map((alert) => (
            <div key={alert.id} className={`rounded-3xl border px-4 py-4 ${alert.severity === 'critical' ? 'border-red-500/30 bg-red-500/10' : alert.severity === 'warning' ? 'border-amber-500/30 bg-amber-500/10' : 'border-emerald-500/20 bg-emerald-500/10'}`}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-white">{alert.title}</div>
                <span className="text-[11px] uppercase tracking-[0.2em] text-slate-300">{alert.severity}</span>
              </div>
              <div className="mt-2 text-sm text-slate-300">{alert.detail}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
          <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">
            <Wallet size={12} />
            Funds context
          </div>
          <div className="mt-2">Available: {fmtPnL(summary.availableFunds)} · Used: {fmtPnL(-summary.marginUsed)}</div>
          <div className="mt-1">Utilization: {Math.round(summary.marginUtilization * 100)}%</div>
        </div>
      </section>
    </div>
  );
}
