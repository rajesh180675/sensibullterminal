import { AlertTriangle, ShieldAlert, Sigma, WandSparkles, Wallet } from 'lucide-react';
import { useAdjustmentStore } from '../../domains/adjustment/adjustmentStore';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { usePortfolioStore } from '../../domains/portfolio/portfolioStore';
import { useRiskStore } from '../../domains/risk/riskStore';
import { fmtNum, fmtPnL } from '../../utils/math';

const CHARGE_LABELS: Record<string, string> = {
  exchangeTurnoverCharges: 'Exchange turnover',
  sebiCharges: 'SEBI',
  gst: 'GST',
  stt: 'STT',
  stampDuty: 'Stamp duty',
  transactionCharges: 'Transaction charges',
  ipft: 'IPFT',
  otherCharges: 'Other charges',
  totalTax: 'Total tax',
};

export function RiskWorkspace() {
  const { snapshot } = useRiskStore();
  const { preview, previewStatus } = useExecutionStore();
  const { summary } = usePortfolioStore();
  const { suggestions, applySuggestion } = useAdjustmentStore();
  const componentEntries = Object.entries(snapshot.chargeSummary?.componentCharges ?? {}).filter(([, value]) => value > 0);

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
          <div className="mt-2">Staged fee load: {fmtPnL(-snapshot.stagedFees)}.</div>
          <div className="mt-2 text-xs text-slate-400">
            Margin source: {preview.source === 'backend' ? 'broker backend' : 'local estimate'}
            {previewStatus === 'loading' ? ' · refreshing...' : ''}
          </div>
          {snapshot.chargeSummary && (
            <div className="mt-3 rounded-2xl border border-white/8 bg-[#0f1728] px-4 py-3 text-xs text-slate-300">
              <div>Brokerage / Other / Total fees: {fmtPnL(-snapshot.stagedBrokerage)} / {fmtPnL(-snapshot.stagedOtherCharges)} / {fmtPnL(-snapshot.stagedFees)}</div>
              <div className="mt-1 text-slate-400">
                Turnover+SEBI {fmtPnL(-(snapshot.chargeSummary.brokerReportedTurnoverAndSebiCharges ?? 0))} · Taxes+duties {fmtPnL(-snapshot.stagedTaxesAndDuties)} · Source {snapshot.chargeSummary.calculationMode === 'broker_rollup' ? 'ICICI rollup' : 'Component fallback'}
              </div>
              {componentEntries.length > 0 && (
                <div className="mt-2 text-slate-300">
                  {componentEntries.map(([key, value]) => `${CHARGE_LABELS[key] ?? key}: ${fmtPnL(-value)}`).join(' | ')}
                </div>
              )}
            </div>
          )}
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
          <WandSparkles size={13} />
          Adjustment Engine
        </div>
        <div className="mt-4 space-y-3">
          {suggestions.length === 0 && (
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-400">
              No live stressed legs detected in active positions right now.
            </div>
          )}
          {suggestions.map((suggestion) => (
            <div key={suggestion.id} className={`rounded-3xl border px-4 py-4 ${suggestion.severity === 'critical' ? 'border-red-500/25 bg-red-500/8' : suggestion.severity === 'warning' ? 'border-amber-500/25 bg-amber-500/8' : 'border-cyan-500/20 bg-cyan-500/8'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{suggestion.title}</div>
                  <div className="mt-1 text-xs text-slate-400">{suggestion.trigger}</div>
                </div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300">{suggestion.severity}</div>
              </div>
              <div className="mt-3 text-sm text-slate-300">{suggestion.rationale}</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-2xl bg-[#08101d] px-3 py-3 text-xs text-slate-300">
                  <div className="text-slate-500">Before</div>
                  <div className="mt-1">Credit {fmtPnL(suggestion.current.netCredit)}</div>
                  <div>Max loss {fmtPnL(suggestion.current.maxLoss)}</div>
                  <div>MTM {fmtPnL(suggestion.current.netPnl ?? 0)}</div>
                  <div>Breakevens {suggestion.current.breakevens.length > 0 ? suggestion.current.breakevens.join(', ') : 'None'}</div>
                </div>
                <div className="rounded-2xl bg-[#08101d] px-3 py-3 text-xs text-slate-300">
                  <div className="text-slate-500">After</div>
                  <div className="mt-1">Credit {fmtPnL(suggestion.proposed.netCredit)}</div>
                  <div>Max loss {fmtPnL(suggestion.proposed.maxLoss)}</div>
                  <div>MTM carry {fmtPnL(suggestion.proposed.netPnl ?? 0)}</div>
                  <div>Breakevens {suggestion.proposed.breakevens.length > 0 ? suggestion.proposed.breakevens.join(', ') : 'Flat'}</div>
                </div>
              </div>
              <div className="mt-3 rounded-2xl border border-white/8 bg-[#08101d] px-3 py-3 text-xs text-slate-300">
                <div className="text-slate-500">Repair delta</div>
                <div className="mt-1">
                  Premium {fmtPnL(suggestion.previewDelta.premiumDelta)} · Fees {fmtPnL(-suggestion.previewDelta.feeDelta)} · Margin {fmtPnL(-suggestion.previewDelta.marginDelta)}
                </div>
                <div className="mt-1">
                  Resulting margin {fmtPnL(-suggestion.previewDelta.resultingMargin)} · Resulting max loss {fmtPnL(suggestion.previewDelta.resultingMaxLoss)}
                </div>
                <div className="mt-1 text-slate-400">
                  Source {suggestion.previewDelta.source === 'backend' ? 'broker preview' : 'local estimate'} · Status {suggestion.previewDelta.status}
                </div>
                {suggestion.previewDelta.notes.length > 0 && (
                  <div className="mt-2 text-slate-400">{suggestion.previewDelta.notes.join(' | ')}</div>
                )}
              </div>
              <div className="mt-3 text-xs text-slate-400">
                Stressed legs: {suggestion.current.stressedLegs.join(' | ')}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Repair flow: {suggestion.repairFlow}
              </div>
              <button
                onClick={() => applySuggestion(suggestion)}
                className="mt-4 rounded-2xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-400"
              >
                Stage repair
              </button>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
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
          {preview.availableMargin !== undefined && (
            <div className="mt-1">Broker available margin: {fmtPnL(preview.availableMargin)}</div>
          )}
          <div className="mt-1">Staged fees in risk model: {fmtPnL(-snapshot.stagedFees)}</div>
          <div className="mt-1">Utilization: {Math.round(summary.marginUtilization * 100)}%</div>
        </div>
      </section>
    </div>
  );
}
