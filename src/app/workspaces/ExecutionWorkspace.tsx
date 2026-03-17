import { useMemo } from 'react';
import { Activity, AlertTriangle, ArrowRight, ShieldAlert, TimerReset, Wallet } from 'lucide-react';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { useMarketStore } from '../../domains/market/marketStore';
import type { ExecutionBlotterItem, OptionLeg } from '../../types/index';
import { buildPayoff, combinedGreeks, findBreakevens, fmtPnL, fmtNum, maxProfitLoss } from '../../utils/math';

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

function blotterTone(status: ExecutionBlotterItem['status']) {
  if (status === 'all_filled' || status === 'partial_fill' || status === 'ready') {
    return 'bg-emerald-500/15 text-emerald-300';
  }
  if (status === 'partial_failure') {
    return 'bg-amber-500/15 text-amber-300';
  }
  if (status === 'all_failed' || status === 'cancelled') {
    return 'bg-red-500/15 text-red-300';
  }
  if (status === 'sending') {
    return 'bg-cyan-500/15 text-cyan-200';
  }
  return 'bg-slate-500/15 text-slate-300';
}

function resolveLiveLegs(item: ExecutionBlotterItem, chain: ReturnType<typeof useMarketStore>['chain']): OptionLeg[] {
  const chainByStrike = new Map(chain.map((row) => [row.strike, row]));
  const snapshotById = new Map((item.legsSnapshot ?? []).map((leg) => [leg.id, leg] as const));

  return (item.legStates ?? [])
    .filter((leg) => leg.status === 'filled' || leg.status === 'pending')
    .map((legState) => {
      const snapshot = snapshotById.get(legState.legId);
      if (!snapshot) return null;
      const row = chainByStrike.get(snapshot.strike);
      if (!row) return snapshot;
      const isCall = snapshot.type === 'CE';
      return {
        ...snapshot,
        ltp: isCall ? row.ce_ltp : row.pe_ltp,
        delta: isCall ? row.ce_delta : row.pe_delta,
        theta: isCall ? row.ce_theta : row.pe_theta,
        gamma: isCall ? row.ce_gamma : row.pe_gamma,
        vega: isCall ? row.ce_vega : row.pe_vega,
        iv: isCall ? row.ce_iv : row.pe_iv,
      };
    })
    .filter((leg): leg is OptionLeg => Boolean(leg));
}

export function ExecutionWorkspace({ onOpenStrategy }: { onOpenStrategy: () => void }) {
  const {
    legs,
    activeBasket,
    preview,
    previewStatus,
    blotter,
    clearBlotter,
    executeStrategy,
    isExecuting,
    recoveringBasketId,
    retryFailedBasket,
    cancelRemainingBasket,
    squareOffFilledBasket,
    reconcileInterruptedBasket,
  } = useExecutionStore();
  const { symbol, spotPrice, stream, chain } = useMarketStore();
  const componentEntries = Object.entries(preview.chargeSummary?.componentCharges ?? {}).filter(([, value]) => value > 0);
  const executeDisabled = legs.length === 0 || isExecuting || !stream.canTrade;
  const executeLabel = isExecuting ? 'Executing...' : !stream.canTrade ? `Blocked · ${stream.label}` : 'Execute';
  const orphanPanels = useMemo(() => blotter
    .map((item) => {
      if (item.status !== 'partial_failure') return null;
      const liveLegs = resolveLiveLegs(item, chain);
      if (liveLegs.length === 0) return null;
      const failedLegs = (item.legStates ?? []).filter((leg) => leg.status === 'failed' || leg.status === 'rejected' || leg.status === 'cancelled');
      const payoff = buildPayoff(liveLegs, spotPrice);
      const greeks = combinedGreeks(liveLegs);
      const { maxLoss } = maxProfitLoss(payoff);
      return {
        item,
        liveLegs,
        failedLegs,
        greeks,
        breakevens: findBreakevens(payoff),
        maxLoss,
        exposurePremium: liveLegs.reduce((sum, leg) => sum + leg.ltp * leg.lots * (leg.action === 'SELL' ? 1 : -1), 0),
      };
    })
    .filter((panel): panel is NonNullable<typeof panel> => Boolean(panel)), [blotter, chain, spotPrice]);

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
        <div className="mt-4 rounded-3xl border border-white/8 bg-white/5 px-4 py-3 text-xs text-slate-300">
          Preview source: {preview.source === 'backend' ? 'Broker backend' : 'Local estimate'}
          {previewStatus === 'loading' ? ' · refreshing...' : ''}
          {preview.availableMargin !== undefined ? ` · Available margin ${fmtPnL(preview.availableMargin)}` : ''}
        </div>
        {activeBasket && (
          <div className="mt-3 rounded-3xl border border-white/8 bg-white/5 px-4 py-3 text-xs text-slate-300">
            Basket state: <span className="font-semibold text-white">{activeBasket.status}</span>
            {' · '}
            {activeBasket.legStates?.map((leg) => `${leg.summary}: ${leg.status}`).join(' | ') || 'No leg states yet'}
          </div>
        )}
        {!stream.canTrade && (
          <div className="mt-3 rounded-3xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
            Execution gated by market stream authority: {stream.detail}
          </div>
        )}
        {preview.validation && (
          <div className="mt-3 rounded-3xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-xs text-cyan-100">
            Preview fields: {preview.validation.previewLegs?.[0]?.successFields.join(', ') || 'not captured yet'}
            {preview.validation.margin ? ` · Margin fields: ${preview.validation.margin.successFields.join(', ') || 'not captured yet'}` : ''}
            {preview.validation.captureFile ? ` · Capture file: ${preview.validation.captureFile}` : ''}
          </div>
        )}
      </section>

      <div className="grid gap-4">
        {orphanPanels.length > 0 && (
          <section className="rounded-[28px] border border-red-500/20 bg-[linear-gradient(180deg,rgba(58,14,14,0.92),rgba(22,10,14,0.95))] p-5">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-red-200/80">
              <AlertTriangle size={13} />
              Partial Execution Resolution
            </div>
            <div className="mt-4 space-y-4">
              {orphanPanels.map(({ item, liveLegs, failedLegs, greeks, breakevens, maxLoss, exposurePremium }) => (
                <div key={item.id} className="rounded-3xl border border-red-500/20 bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-white">{item.summary}</div>
                      <div className="mt-1 text-sm text-red-100">
                        {liveLegs.length} live leg{liveLegs.length !== 1 ? 's' : ''} remain after partial execution.
                      </div>
                    </div>
                    <span className="rounded-full bg-red-500/15 px-3 py-1 text-xs text-red-100">{item.status}</span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4 text-xs">
                    <div className="rounded-2xl bg-white/5 px-3 py-3 text-slate-200">Net delta {fmtNum(greeks.delta, 2)}</div>
                    <div className="rounded-2xl bg-white/5 px-3 py-3 text-slate-200">Net theta {fmtNum(greeks.theta, 2)}</div>
                    <div className="rounded-2xl bg-white/5 px-3 py-3 text-slate-200">Exposure premium {fmtPnL(exposurePremium)}</div>
                    <div className="rounded-2xl bg-white/5 px-3 py-3 text-slate-200">Max loss {fmtPnL(maxLoss)}</div>
                  </div>
                  <div className="mt-3 text-xs text-slate-300">
                    Breakevens: {breakevens.length > 0 ? breakevens.join(', ') : 'None'} · Spot {spotPrice.toFixed(2)}
                  </div>
                  <div className="mt-3 text-xs text-red-50">
                    Live legs: {liveLegs.map((leg) => `${leg.action} ${leg.type} ${leg.strike} @ ${leg.ltp.toFixed(2)}`).join(' | ')}
                  </div>
                  {failedLegs.length > 0 && (
                    <div className="mt-2 text-xs text-amber-100">
                      Failed legs: {failedLegs.map((leg) => `${leg.summary}${leg.error ? ` (${leg.error})` : ''}`).join(' | ')}
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => void reconcileInterruptedBasket(item.id)}
                      disabled={recoveringBasketId === item.id}
                      className="rounded-xl border border-white/15 px-3 py-1.5 text-[11px] text-white transition hover:bg-white/10 disabled:opacity-40"
                    >
                      Reconcile order book
                    </button>
                    <button
                      onClick={() => void retryFailedBasket(item.id)}
                      disabled={recoveringBasketId === item.id}
                      className="rounded-xl border border-cyan-400/20 px-3 py-1.5 text-[11px] text-cyan-100 transition hover:bg-cyan-400/10 disabled:opacity-40"
                    >
                      Retry failed
                    </button>
                    <button
                      onClick={() => void cancelRemainingBasket(item.id)}
                      disabled={recoveringBasketId === item.id}
                      className="rounded-xl border border-amber-400/20 px-3 py-1.5 text-[11px] text-amber-100 transition hover:bg-amber-400/10 disabled:opacity-40"
                    >
                      Cancel remaining
                    </button>
                    <button
                      onClick={() => void squareOffFilledBasket(item.id)}
                      disabled={recoveringBasketId === item.id}
                      className="rounded-xl border border-red-400/20 px-3 py-1.5 text-[11px] text-red-100 transition hover:bg-red-400/10 disabled:opacity-40"
                    >
                      Square off filled
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
            <ShieldAlert size={13} />
            Preflight
          </div>
          <div className="mt-4 space-y-3 text-sm text-slate-300">
            <div className="rounded-3xl bg-white/5 px-4 py-3">Underlying: {symbol}</div>
            <div className="rounded-3xl bg-white/5 px-4 py-3">Spot: {spotPrice.toFixed(2)}</div>
            <div className="rounded-3xl bg-white/5 px-4 py-3">Stream: {stream.label} via {stream.transport}</div>
            <div className="rounded-3xl bg-white/5 px-4 py-3">Margin required: {fmtPnL(-preview.marginRequired)}</div>
            <div className="rounded-3xl bg-white/5 px-4 py-3">SPAN / Block / Order: {fmtPnL(-(preview.spanMargin ?? 0))} / {fmtPnL(-(preview.blockTradeMargin ?? 0))} / {fmtPnL(-(preview.orderMargin ?? 0))}</div>
            {preview.chargeSummary && (
              <div className="rounded-3xl border border-white/8 bg-white/5 px-4 py-3">
                <div>Brokerage / Other / Total fees: {fmtPnL(-(preview.chargeSummary.brokerage ?? 0))} / {fmtPnL(-(preview.chargeSummary.brokerReportedOtherCharges ?? 0))} / {fmtPnL(-(preview.chargeSummary.totalFees ?? preview.estimatedFees))}</div>
                <div className="mt-1 text-xs text-slate-400">
                  Turnover+SEBI {fmtPnL(-(preview.chargeSummary.brokerReportedTurnoverAndSebiCharges ?? 0))} · Taxes+duties {fmtPnL(-(preview.chargeSummary.taxesAndDuties ?? 0))} · Source {preview.chargeSummary.calculationMode === 'broker_rollup' ? 'ICICI rollup' : 'Component fallback'}
                </div>
                {componentEntries.length > 0 && (
                  <div className="mt-2 text-xs text-slate-300">
                    {componentEntries.map(([key, value]) => `${CHARGE_LABELS[key] ?? key}: ${fmtPnL(-value)}`).join(' | ')}
                  </div>
                )}
              </div>
            )}
            <div className="rounded-3xl bg-white/5 px-4 py-3">Max profit / loss: {fmtPnL(preview.maxProfit)} / {fmtPnL(preview.maxLoss)}</div>
            <div className="rounded-3xl bg-white/5 px-4 py-3">Breakevens: {preview.breakevens.length > 0 ? preview.breakevens.join(', ') : 'None'}</div>
            {preview.notes && preview.notes.length > 0 && (
              <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-amber-100">
                {preview.notes.join(' | ')}
              </div>
            )}
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
              disabled={executeDisabled}
              className="flex flex-1 items-center justify-center rounded-2xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition enabled:hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {executeLabel}
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
                  <span className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.2em] ${blotterTone(item.status)}`}>
                    {item.status}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-4 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1"><TimerReset size={12} /> {new Date(item.submittedAt).toLocaleTimeString()}</span>
                  <span>{item.legCount} legs</span>
                  <span>{fmtPnL(item.premium)}</span>
                </div>
                <div className="mt-2 text-xs text-slate-300">{item.response}</div>
                {item.recoveryAction && item.recoveryAction !== 'none' && (
                  <div className="mt-2 text-[11px] text-amber-200">Recovery: {item.recoveryAction}</div>
                )}
                {item.legStates && item.legStates.length > 0 && (
                  <div className="mt-2 text-[11px] text-slate-400">
                    {item.legStates.map((leg) => `${leg.summary} ${leg.status}${leg.orderId ? ` (${leg.orderId})` : ''}${leg.brokerStatus ? ` [${leg.brokerStatus}]` : ''}`).join(' | ')}
                  </div>
                )}
                {(item.status === 'partial_failure' || item.status === 'partial_fill') && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => void reconcileInterruptedBasket(item.id)}
                      disabled={recoveringBasketId === item.id}
                      className="rounded-xl border border-white/15 px-3 py-1.5 text-[11px] text-white transition hover:bg-white/10 disabled:opacity-40"
                    >
                      Reconcile order book
                    </button>
                    <button
                      onClick={() => void retryFailedBasket(item.id)}
                      disabled={recoveringBasketId === item.id}
                      className="rounded-xl border border-cyan-400/20 px-3 py-1.5 text-[11px] text-cyan-100 transition hover:bg-cyan-400/10 disabled:opacity-40"
                    >
                      Retry failed
                    </button>
                    <button
                      onClick={() => void cancelRemainingBasket(item.id)}
                      disabled={recoveringBasketId === item.id}
                      className="rounded-xl border border-amber-400/20 px-3 py-1.5 text-[11px] text-amber-100 transition hover:bg-amber-400/10 disabled:opacity-40"
                    >
                      Cancel remaining
                    </button>
                    <button
                      onClick={() => void squareOffFilledBasket(item.id)}
                      disabled={recoveringBasketId === item.id}
                      className="rounded-xl border border-red-400/20 px-3 py-1.5 text-[11px] text-red-100 transition hover:bg-red-400/10 disabled:opacity-40"
                    >
                      Square off filled
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
