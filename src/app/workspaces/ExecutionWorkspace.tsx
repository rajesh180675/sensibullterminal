import React from 'react';
import { Activity, ArrowRight, ShieldAlert } from 'lucide-react';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { useMarketStore } from '../../domains/market/marketStore';
import { fmtPnL } from '../../utils/math';

export function ExecutionWorkspace({ onOpenStrategy }: { onOpenStrategy: () => void }) {
  const { legs, executeStrategy } = useExecutionStore();
  const { symbol, spotPrice } = useMarketStore();
  const premium = legs.reduce((total, leg) => total + leg.ltp * (leg.action === 'BUY' ? -1 : 1) * leg.lots, 0);

  return (
    <div className="grid h-full gap-4 p-4 xl:grid-cols-[1.2fr,0.8fr]">
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
                {symbol} · {leg.lots} lots · LTP {leg.ltp.toFixed(2)} · Delta {leg.delta.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
          <ShieldAlert size={13} />
          Preflight
        </div>
        <div className="mt-4 space-y-3 text-sm text-slate-300">
          <div className="rounded-3xl bg-white/5 px-4 py-3">Underlying: {symbol}</div>
          <div className="rounded-3xl bg-white/5 px-4 py-3">Spot: {spotPrice.toFixed(2)}</div>
          <div className="rounded-3xl bg-white/5 px-4 py-3">Net premium: {fmtPnL(premium)}</div>
          <div className="rounded-3xl bg-white/5 px-4 py-3">Leg count: {legs.length}</div>
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
            disabled={legs.length === 0}
            className="flex flex-1 items-center justify-center rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition enabled:hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Execute
          </button>
        </div>
      </section>
    </div>
  );
}
