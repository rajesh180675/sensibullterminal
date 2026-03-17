import { useEffect } from 'react';
import { BarChart3, BriefcaseBusiness, RefreshCw } from 'lucide-react';
import { Positions } from '../../components/Positions';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { useMarketStore } from '../../domains/market/marketStore';
import { usePortfolioStore } from '../../domains/portfolio/portfolioStore';
import { useSessionStore } from '../../domains/session/sessionStore';
import { fmtPnL } from '../../utils/math';

export function PortfolioWorkspace({ onOpenStrategy }: { onOpenStrategy: () => void }) {
  const {
    livePositions,
    refreshPositions,
    summary,
    selectedPosition,
    selectPosition,
    funds,
    orders,
    trades,
    isRefreshing,
  } = usePortfolioStore();
  const { loadPosition } = useExecutionStore();
  const { setSymbol, stream } = useMarketStore();
  const { session } = useSessionStore();

  useEffect(() => {
    if (stream.canRefreshBrokerData) {
      void refreshPositions();
    }
  }, [stream.canRefreshBrokerData, refreshPositions]);

  return (
    <div className="grid h-full gap-4 p-4 xl:grid-cols-[1.25fr,0.75fr]">
      <div className="min-h-0 overflow-hidden rounded-[32px] border border-white/8 bg-[#07101b]">
        <Positions
          onLoadToBuilder={(position) => {
            selectPosition(position);
            loadPosition(position);
            setSymbol(position.symbol);
            onOpenStrategy();
          }}
          livePositions={livePositions}
          isLive={stream.mode !== 'simulated'}
          session={session}
          onRefreshPositions={() => void refreshPositions()}
        />
      </div>

      <div className="grid min-h-0 gap-4">
        <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
              <BriefcaseBusiness size={13} />
              Portfolio cockpit
            </div>
            <button
              onClick={() => void refreshPositions()}
              disabled={isRefreshing || !stream.canRefreshBrokerData}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw size={12} />
              {stream.canRefreshBrokerData ? 'Refresh' : `Blocked · ${stream.label}`}
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-3xl bg-white/5 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">MTM</div>
              <div className="mt-2 text-lg font-semibold text-white">{fmtPnL(summary.totalMtm)}</div>
            </div>
            <div className="rounded-3xl bg-white/5 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Active</div>
              <div className="mt-2 text-lg font-semibold text-white">{summary.activePositions}</div>
            </div>
            <div className="rounded-3xl bg-white/5 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Gross exposure</div>
              <div className="mt-2 text-lg font-semibold text-white">{fmtPnL(summary.grossExposure)}</div>
            </div>
            <div className="rounded-3xl bg-white/5 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Hedged</div>
              <div className="mt-2 text-lg font-semibold text-white">{fmtPnL(summary.hedgedExposure)}</div>
            </div>
          </div>
          <div className="mt-4 rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-300">
            Funds: {fmtPnL(funds?.available_margin ?? funds?.cash_balance ?? 0)} available · {Math.round(summary.marginUtilization * 100)}% utilized
          </div>
          {!stream.canRefreshBrokerData && (
            <div className="mt-3 rounded-3xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
              Portfolio refresh is gated by market stream authority: {stream.detail}
            </div>
          )}
        </section>

        <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
            <BarChart3 size={13} />
            Drilldown
          </div>
          {selectedPosition ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-3xl bg-white/5 px-4 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-lg font-semibold text-white">{selectedPosition.strategy}</div>
                    <div className="text-sm text-slate-400">{selectedPosition.symbol} · {selectedPosition.expiry}</div>
                  </div>
                  <div className={`text-sm font-semibold ${selectedPosition.mtmPnl >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                    {fmtPnL(selectedPosition.mtmPnl)}
                  </div>
                </div>
              </div>
              {selectedPosition.legs.map((leg, index) => (
                <div key={`${selectedPosition.id}-${index}`} className="rounded-3xl border border-white/8 bg-white/5 px-4 py-3 text-sm text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="text-white">{leg.action} {leg.type} {leg.strike}</span>
                    <span>{leg.lots} lots</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                    <span>Entry {leg.entryPrice.toFixed(2)} -&gt; LTP {leg.currentPrice.toFixed(2)}</span>
                    <span className={leg.pnl >= 0 ? 'text-emerald-300' : 'text-red-300'}>{fmtPnL(leg.pnl)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-3xl bg-white/5 px-4 py-4 text-sm text-slate-400">
              Select a position to inspect its leg-level exposure.
            </div>
          )}
        </section>

        <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.3em] text-orange-300/70">Orders</div>
              <div className="mt-3 space-y-2">
                {orders.slice(0, 4).map((order) => (
                  <div key={order.order_id} className="rounded-2xl bg-white/5 px-3 py-2 text-xs text-slate-300">
                    <div className="font-semibold text-white">{order.stock_code} {order.action}</div>
                    <div>{order.quantity} @ {order.price} · {order.status}</div>
                  </div>
                ))}
                {orders.length === 0 && <div className="rounded-2xl bg-white/5 px-3 py-2 text-xs text-slate-400">No recent orders loaded.</div>}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.3em] text-orange-300/70">Trades</div>
              <div className="mt-3 space-y-2">
                {trades.slice(0, 4).map((trade) => (
                  <div key={`${trade.order_id}-${trade.trade_price ?? trade.price}`} className="rounded-2xl bg-white/5 px-3 py-2 text-xs text-slate-300">
                    <div className="font-semibold text-white">{trade.stock_code} {trade.action}</div>
                    <div>{trade.quantity} @ {trade.trade_price ?? trade.price}</div>
                  </div>
                ))}
                {trades.length === 0 && <div className="rounded-2xl bg-white/5 px-3 py-2 text-xs text-slate-400">No recent trades loaded.</div>}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
