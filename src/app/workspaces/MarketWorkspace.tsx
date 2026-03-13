import { useMemo } from 'react';
import {
  AreaChart,
  ArrowRight,
  CandlestickChart,
  Clock3,
  Layers3,
  RefreshCw,
  ShieldAlert,
  Star,
  TrendingUp,
} from 'lucide-react';
import { OptionChain } from '../../components/OptionChain';
import { ALL_SYMBOLS, SYMBOL_CONFIG } from '../../config/market';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { useMarketStore } from '../../domains/market/marketStore';
import { useSellerIntelligenceStore } from '../../domains/seller/sellerIntelligenceStore';
import { useSessionStore } from '../../domains/session/sessionStore';
import { fmtPnL } from '../../utils/math';

export function MarketWorkspace({ onOpenStrategy }: { onOpenStrategy: () => void }) {
  const {
    symbol,
    expiry,
    availableExpiries,
    chain,
    spotPrice,
    lastUpdate,
    isLoading,
    chainError,
    refreshMarket,
    setExpiry,
    setSymbol,
    liveIndices,
    watchlist,
    marketDepth,
    historical,
    chartInterval,
    setChartInterval,
    isHistoricalLoading,
  } = useMarketStore();
  const { addLeg, legs, stageStrategy, preview } = useExecutionStore();
  const { isLive, statusMessage } = useSessionStore();
  const { regime, opportunities } = useSellerIntelligenceStore();

  const nearestStrikeDiff = chain.length > 0
    ? Math.min(...chain.map((row) => Math.abs(row.strike - spotPrice)))
    : Number.POSITIVE_INFINITY;

  const chainWithAtm = chain.map((row) => ({
    ...row,
    isATM: Math.abs(row.strike - spotPrice) === nearestStrikeDiff,
  }));

  const priceRange = useMemo(() => {
    const highs = historical.map((candle) => candle.high);
    const lows = historical.map((candle) => candle.low);
    return {
      high: highs.length > 0 ? Math.max(...highs) : spotPrice,
      low: lows.length > 0 ? Math.min(...lows) : spotPrice,
    };
  }, [historical, spotPrice]);

  const depthReady = marketDepth.bids.length > 0 || marketDepth.asks.length > 0;
  const candlesReady = historical.length > 0;
  const selectedWatchlist = watchlist.find((entry) => entry.symbol === symbol);
  const topIdeas = opportunities.slice(0, 3);

  return (
    <div className="grid min-h-full gap-4 p-4 2xl:grid-cols-[280px,minmax(0,1fr),340px]">
      <aside className="space-y-4">
        <section id="market-overview" className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(15,24,39,0.98),rgba(9,16,28,0.94))] p-5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/75">
            <Star size={13} />
            Market Overview
          </div>
          <div className="mt-4 rounded-[24px] border border-orange-400/20 bg-orange-500/10 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-orange-100/70">Selected Contract</div>
                <div className="mt-2 text-2xl font-semibold text-white">{SYMBOL_CONFIG[symbol].displayName}</div>
                <div className="mt-1 text-sm text-slate-300">{expiry.label}</div>
              </div>
              <div className={`rounded-full px-3 py-1 text-xs ${isLive ? 'bg-emerald-500/15 text-emerald-200' : 'bg-amber-500/15 text-amber-200'}`}>
                {isLive ? 'Live' : 'Preview'}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-2xl bg-black/20 px-3 py-3">
                <div className="text-slate-500">Spot</div>
                <div className="mono mt-1 text-lg font-semibold text-white">{spotPrice.toFixed(2)}</div>
              </div>
              <div className="rounded-2xl bg-black/20 px-3 py-3">
                <div className="text-slate-500">Chain rows</div>
                <div className="mt-1 text-lg font-semibold text-white">{chain.length}</div>
              </div>
              <div className="rounded-2xl bg-black/20 px-3 py-3">
                <div className="text-slate-500">Feed</div>
                <div className="mt-1 text-sm font-semibold text-white">
                  {marketDepth.source === 'backend' || candlesReady ? 'Backend native' : isLive ? 'Live chain' : 'Simulated'}
                </div>
              </div>
              <div className="rounded-2xl bg-black/20 px-3 py-3">
                <div className="text-slate-500">Updated</div>
                <div className="mt-1 text-sm font-semibold text-white">{lastUpdate.toLocaleTimeString('en-IN')}</div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-[24px] border border-white/8 bg-white/5 p-4">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Seller Regime</div>
            <div className="mt-2 flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-white">{regime.label}</div>
                <div className="mt-1 text-sm text-slate-300">{regime.summary}</div>
              </div>
              <div className="rounded-2xl bg-black/20 px-3 py-2 text-right text-xs text-slate-300">
                <div>Suitability {regime.sellerSuitability}</div>
                <div>Confidence {regime.confidence}%</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {regime.metrics.slice(0, 4).map((metric) => (
                <div key={metric.label} className="rounded-2xl bg-black/20 px-3 py-2">
                  <div className="text-slate-500">{metric.label}</div>
                  <div className={`${metric.tone === 'positive' ? 'text-emerald-300' : metric.tone === 'warning' || metric.tone === 'critical' ? 'text-amber-300' : 'text-white'} mt-1 font-semibold`}>
                    {metric.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(14,23,37,0.96),rgba(9,16,28,0.9))] p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.3em] text-orange-300/75">Watchlist</div>
            <button
              onClick={() => void refreshMarket()}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/10"
            >
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {ALL_SYMBOLS.map((code) => {
              const item = watchlist.find((entry) => entry.symbol === code);
              const active = code === symbol;
              return (
                <button
                  key={code}
                  onClick={() => setSymbol(code)}
                  className={`w-full rounded-[22px] border px-4 py-3 text-left transition ${
                    active
                      ? 'border-orange-400/35 bg-orange-500/12 shadow-[0_14px_34px_rgba(249,115,22,0.14)]'
                      : 'border-white/8 bg-white/5 hover:bg-white/8'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{SYMBOL_CONFIG[code].displayName}</div>
                      <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">{code}</div>
                    </div>
                    <div className={`mono text-sm font-semibold ${item && item.change >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {item?.price.toFixed(2) ?? '--'}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className={`${item && item.change >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {item ? `${item.change >= 0 ? '+' : ''}${item.change.toFixed(2)} (${item.pct.toFixed(2)}%)` : 'No move'}
                    </span>
                    <span className="text-slate-500">{item?.volume.toLocaleString('en-IN') ?? '--'} vol</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </aside>

      <div className="flex min-h-[780px] min-w-0 flex-col gap-4">
        <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(13,22,36,0.98),rgba(8,14,24,0.94))] p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/75">
                <TrendingUp size={13} />
                Active Market
              </div>
              <h2 className="mt-2 text-2xl font-semibold text-white">{SYMBOL_CONFIG[symbol].displayName}</h2>
              <p className="mt-1 text-sm text-slate-400">
                Spot {spotPrice.toFixed(2)} · {selectedWatchlist ? `${selectedWatchlist.change >= 0 ? '+' : ''}${selectedWatchlist.change.toFixed(2)} (${selectedWatchlist.pct.toFixed(2)}%)` : 'awaiting watchlist quote'} · {statusMessage}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-xs">
                <div className="text-slate-500">Preferred structures</div>
                <div className="mt-1 font-semibold text-white">{regime.preferredStructures.slice(0, 2).join(', ') || 'Neutral premium selling'}</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-xs">
                <div className="text-slate-500">Restricted</div>
                <div className="mt-1 font-semibold text-white">{regime.restrictedStructures.slice(0, 2).join(', ') || 'None'}</div>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-xs">
                <div className="text-slate-500">ATM readiness</div>
                <div className="mt-1 font-semibold text-white">{chainWithAtm.length > 0 ? 'Chain aligned' : 'No live rows'}</div>
              </div>
            </div>
          </div>
        </section>

        <section id="market-chain" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(9,16,27,0.98),rgba(7,12,20,0.96))]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-5 py-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.32em] text-orange-300/75">Option Chain</div>
              <div className="mt-2 text-lg font-semibold text-white">{symbol} seller board</div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-slate-300">
                {expiry.label}
              </span>
              <span className={`rounded-full px-3 py-2 ${depthReady ? 'bg-emerald-500/12 text-emerald-200' : 'bg-amber-500/12 text-amber-200'}`}>
                {depthReady ? 'Depth linked' : 'Depth awaiting backend'}
              </span>
              <span className={`rounded-full px-3 py-2 ${chainError ? 'bg-red-500/12 text-red-200' : 'bg-cyan-500/12 text-cyan-100'}`}>
                {chainError || (isLoading ? 'Refreshing chain' : 'Chain ready')}
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-2">
            <OptionChain
              symbol={symbol}
              data={chainWithAtm}
              spotPrice={spotPrice}
              selectedExpiry={expiry}
              onExpiryChange={setExpiry}
              onAddLeg={(leg) => {
                addLeg(leg);
                onOpenStrategy();
              }}
              highlightedStrikes={new Set(legs.map((leg) => leg.strike))}
              lastUpdate={lastUpdate}
              isLoading={isLoading}
              onRefresh={refreshMarket}
              isLive={isLive}
              loadingMsg={statusMessage}
              error={chainError}
              availableExpiries={availableExpiries}
            />
          </div>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(14,23,38,0.96),rgba(8,14,24,0.92))] p-5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/75">
            <CandlestickChart size={13} />
            Candle Board
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {['1minute', '5minute', '30minute', '1day'].map((interval) => (
              <button
                key={interval}
                onClick={() => setChartInterval(interval)}
                className={`rounded-full px-3 py-2 text-xs transition ${
                  chartInterval === interval
                    ? 'bg-orange-500 text-white'
                    : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {interval}
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-[24px] border border-white/8 bg-[#08101c] p-4">
            <div className="mb-4 flex items-center justify-between text-xs text-slate-400">
              <span>{historical.length} candles</span>
              <span>{isHistoricalLoading ? 'Refreshing...' : `${priceRange.low.toFixed(0)} - ${priceRange.high.toFixed(0)}`}</span>
            </div>
            {candlesReady ? (
              <div className="flex h-40 items-end gap-1">
                {historical.slice(-28).map((candle) => {
                  const isUp = candle.close >= candle.open;
                  const base = Math.max(priceRange.high - priceRange.low, 1);
                  const bodyHeight = Math.max(8, (Math.abs(candle.close - candle.open) / base) * 120);
                  const wickHeight = Math.max(bodyHeight + 8, ((candle.high - candle.low) / base) * 136);
                  return (
                    <div key={candle.datetime} className="flex flex-1 flex-col items-center justify-end">
                      <div className={`w-px rounded-full ${isUp ? 'bg-emerald-400/70' : 'bg-red-400/70'}`} style={{ height: `${wickHeight}px` }} />
                      <div
                        className={`w-full rounded-md ${isUp ? 'bg-emerald-400/80' : 'bg-red-400/80'}`}
                        style={{ height: `${bodyHeight}px`, maxWidth: '10px', marginTop: `${-bodyHeight}px` }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/5 text-center text-sm text-slate-400">
                Backend candles unavailable for this session.
              </div>
            )}
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span className="inline-flex items-center gap-1"><Clock3 size={12} /> {lastUpdate.toLocaleTimeString('en-IN')}</span>
              <span>{candlesReady ? 'Live merge active' : 'Awaiting candles'}</span>
            </div>
          </div>
        </section>

        <section id="market-depth" className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(14,23,38,0.96),rgba(8,14,24,0.92))] p-5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/75">
            <Layers3 size={13} />
            Depth Ladder
          </div>
          <div className="mt-2 text-xs text-slate-500">{marketDepth.instrumentLabel ?? 'No backend contract selected'}</div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-[24px] border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-emerald-200/75">
                <span>Bids</span>
                <span>{(marketDepth.imbalance * 100).toFixed(0)}% skew</span>
              </div>
              <div className="space-y-2">
                {marketDepth.bids.map((level) => (
                  <div key={`bid-${level.price}`} className="flex items-center justify-between rounded-2xl bg-black/15 px-3 py-2">
                    <span className="mono font-medium text-emerald-200">{level.price.toFixed(2)}</span>
                    <span className="text-slate-300">{level.quantity.toLocaleString('en-IN')}</span>
                  </div>
                ))}
                {!depthReady && <div className="rounded-2xl bg-black/15 px-3 py-6 text-center text-xs text-slate-400">Backend depth unavailable</div>}
              </div>
            </div>
            <div className="rounded-[24px] border border-red-500/20 bg-red-500/10 p-4">
              <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-red-200/75">
                <span>Asks</span>
                <span>Spread {marketDepth.spread.toFixed(2)}</span>
              </div>
              <div className="space-y-2">
                {marketDepth.asks.map((level) => (
                  <div key={`ask-${level.price}`} className="flex items-center justify-between rounded-2xl bg-black/15 px-3 py-2">
                    <span className="mono font-medium text-red-200">{level.price.toFixed(2)}</span>
                    <span className="text-slate-300">{level.quantity.toLocaleString('en-IN')}</span>
                  </div>
                ))}
                {!depthReady && <div className="rounded-2xl bg-black/15 px-3 py-6 text-center text-xs text-slate-400">Connect backend for native depth</div>}
              </div>
            </div>
          </div>
        </section>

        <section id="market-ideas" className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(14,23,38,0.96),rgba(8,14,24,0.92))] p-5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/75">
            <ShieldAlert size={13} />
            Seller Ideas
          </div>
          <div className="mt-4 space-y-3">
            {topIdeas.map((idea) => (
              <div key={idea.id} className="rounded-[24px] border border-white/8 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{idea.title}</div>
                    <div className="mt-1 text-xs text-slate-400">{idea.structure} · score {idea.sellerScore}</div>
                  </div>
                  <div className="rounded-full bg-orange-500/15 px-3 py-1 text-xs text-orange-200">
                    Fit {idea.regimeFit}
                  </div>
                </div>
                <div className="mt-3 text-sm text-slate-300">{idea.thesis}</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-2xl bg-black/20 px-3 py-2 text-slate-300">Credit {fmtPnL(idea.expectedCredit)}</div>
                  <div className="rounded-2xl bg-black/20 px-3 py-2 text-slate-300">Risk {fmtPnL(idea.maxLossEstimate)}</div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => {
                      stageStrategy(idea.legs);
                      onOpenStrategy();
                    }}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-400"
                  >
                    Stage
                    <ArrowRight size={14} />
                  </button>
                  <div className="rounded-2xl border border-white/10 px-3 py-2 text-xs text-slate-300">
                    {idea.playbookMatches[0] ?? 'Direct idea'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(14,23,38,0.96),rgba(8,14,24,0.92))] p-5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/75">
            <AreaChart size={13} />
            Staged Order
          </div>
          <div className="mt-4 rounded-[24px] border border-white/8 bg-white/5 p-4 text-sm text-slate-300">
            <div className="flex items-center justify-between gap-3">
              <span>Strategy legs</span>
              <span className="text-lg font-semibold text-white">{legs.length}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span>Estimated fees</span>
              <span className="mono text-white">{fmtPnL(preview.estimatedFees)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span>Margin</span>
              <span className="mono text-white">{fmtPnL(-preview.marginRequired)}</span>
            </div>
            <button
              onClick={onOpenStrategy}
              className="mt-4 w-full rounded-2xl border border-orange-400/25 bg-orange-500/12 px-4 py-3 text-sm font-semibold text-orange-100 transition hover:bg-orange-500/18"
            >
              Review staged strategy
            </button>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(14,23,38,0.96),rgba(8,14,24,0.92))] p-5">
          <div className="text-[11px] uppercase tracking-[0.3em] text-orange-300/75">Market Tape</div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {liveIndices.slice(0, 4).map((index) => (
              <div key={index.label} className="rounded-2xl bg-white/5 px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{index.label}</div>
                <div className="mono mt-2 text-base font-semibold text-white">{index.value.toFixed(index.value > 1000 ? 2 : 3)}</div>
                <div className={`text-xs ${index.change >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {index.change >= 0 ? '+' : ''}{index.change.toFixed(2)} ({index.pct.toFixed(2)}%)
                </div>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
