import { Activity, ArrowRight, ShieldAlert, TimerReset, Wallet } from 'lucide-react';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { useMarketStore } from '../../domains/market/marketStore';
import { fmtPnL } from '../../utils/math';

export function ExecutionWorkspace({ onOpenStrategy }: { onOpenStrategy: () => void }) {
  const { legs, preview, blotter, clearBlotter, executeStrategy, isExecuting } = useExecutionStore();
  const { symbol, spotPrice } = useMarketStore();

  return (
    <div className="grid h-full gap-4 p-4 xl:grid-cols-[1.1fr,0.9fr]">
      <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
          <Activity size={13} />
          Order Staging
        </div>
        <div className="mt-4 space-y-3">
          {legs.length === 0 && (
            <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-slate-400">
              No active legs. Build a structure in Strategy Lab first.
            </div>
          )}
          {legs.map((leg) => (
            <div key={leg.id} className="rounded-3xl border border-white/8 bg-white/5 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="text-white">{leg.action} {leg.type} {leg.strike}</div>
                <div className="text-sm text-slate-400">{leg.expiry}</div>
              </div>
              <div className="mt-2 text-sm text-slate-300">
                {symbol} · {leg.lots} lots · LTP {leg.ltp.toFixed(2)} · {leg.orderType ?? 'market'} order
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl bg-white/5 px-4 py-3 text-sm text-slate-300">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Premium</div>
            <div className="mt-2 text-lg font-semibold text-white">{fmtPnL(preview.estimatedPremium)}</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-3 text-sm text-slate-300">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Fees</div>
            <div className="mt-2 text-lg font-semibold text-white">{fmtPnL(-preview.estimatedFees)}</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-3 text-sm text-slate-300">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Slippage</div>
            <div className="mt-2 text-lg font-semibold text-white">{fmtPnL(-preview.slippage)}</div>
          </div>
          <div className="rounded-3xl bg-white/5 px-4 py-3 text-sm text-slate-300">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Capital At Risk</div>
            <div className="mt-2 text-lg font-semibold text-white">{fmtPnL(-preview.capitalAtRisk)}</div>
          </div>
        </div>
      </section>

      <div className="grid gap-4">
        <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
            <ShieldAlert size={13} />
            Preflight
          </div>
          <div className="mt-4 space-y-3 text-sm text-slate-300">
            <div className="rounded-3xl bg-white/5 px-4 py-3">Underlying: {symbol}</div>
            <div className="rounded-3xl bg-white/5 px-4 py-3">Spot: {spotPrice.toFixed(2)}</div>
            <div className="rounded-3xl bg-white/5 px-4 py-3">Margin required: {fmtPnL(-preview.marginRequired)}</div>
            <div className="rounded-3xl bg-white/5 px-4 py-3">Max profit / loss: {fmtPnL(preview.maxProfit)} / {fmtPnL(preview.maxLoss)}</div>
            <div className="rounded-3xl bg-white/5 px-4 py-3">Breakevens: {preview.breakevens.length > 0 ? preview.breakevens.join(', ') : 'None'}</div>
          </div>

          <div className="mt-5 flex gap-3">
            <button
              onClick={onOpenStrategy}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white transition hover:bg-white/10"
            >
              Review in Strategy
              <ArrowRight size={14} />
            </button>
            <button
              onClick={() => void executeStrategy(legs)}
              disabled={legs.length === 0 || isExecuting}
              className="flex flex-1 items-center justify-center rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition enabled:hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExecuting ? 'Executing...' : 'Execute'}
            </button>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
              <Wallet size={13} />
              Blotter
            </div>
            <button
              onClick={clearBlotter}
              className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10"
            >
              Clear
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {blotter.length === 0 && (
              <div className="rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-400">
                Execution events will appear here after you send staged legs.
              </div>
            )}
            {blotter.map((item) => (
              <div key={item.id} className="rounded-3xl border border-white/8 bg-white/5 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-white">{item.summary}</div>
                  <span className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.2em] ${item.status === 'sent' ? 'bg-emerald-500/15 text-emerald-300' : item.status === 'partial' ? 'bg-amber-500/15 text-amber-300' : item.status === 'failed' ? 'bg-red-500/15 text-red-300' : 'bg-slate-500/15 text-slate-300'}`}>
                    {item.status}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-4 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1"><TimerReset size={12} /> {new Date(item.submittedAt).toLocaleTimeString()}</span>
                  <span>{item.legCount} legs</span>
                  <span>{fmtPnL(item.premium)}</span>
                </div>
                <div className="mt-2 text-xs text-slate-300">{item.response}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
