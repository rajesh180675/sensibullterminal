import { useMemo } from 'react';
import { AreaChart, CandlestickChart, Clock3, Layers3, RefreshCw, Star, TrendingUp } from 'lucide-react';
import { OptionChain } from '../../components/OptionChain';
import { ALL_SYMBOLS, SYMBOL_CONFIG } from '../../config/market';
import { useExecutionStore } from '../../domains/execution/executionStore';
import { useMarketStore } from '../../domains/market/marketStore';
import { useSessionStore } from '../../domains/session/sessionStore';

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
  const { addLeg, legs } = useExecutionStore();
  const { isLive, statusMessage } = useSessionStore();

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

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="grid gap-4 xl:grid-cols-[0.9fr,1.1fr,0.8fr]">
        <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
            <Star size={13} />
            Watchlists
          </div>
          <div className="mt-4 grid gap-2">
            {ALL_SYMBOLS.map((code) => {
              const item = watchlist.find((entry) => entry.symbol === code);
              const active = code === symbol;
              return (
                <button
                  key={code}
                  onClick={() => setSymbol(code)}
                  className={`rounded-3xl border px-4 py-3 text-left transition ${active ? 'border-orange-400/40 bg-orange-500/10' : 'border-white/8 bg-white/5 hover:bg-white/10'}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white">{SYMBOL_CONFIG[code].displayName}</div>
                      <div className="text-xs text-slate-400">{code}</div>
                    </div>
                    <div className={`text-sm font-semibold ${item && item.change >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {item?.price.toFixed(2) ?? '--'}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className={`${item && item.change >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {item ? `${item.change >= 0 ? '+' : ''}${item.change.toFixed(2)} (${item.pct.toFixed(2)}%)` : 'No move'}
                    </span>
                    <span className="text-slate-500">Vol {item?.volume.toLocaleString('en-IN') ?? '--'}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            {liveIndices.slice(0, 4).map((index) => (
              <div key={index.label} className="rounded-2xl bg-white/5 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{index.label}</div>
                <div className="mt-2 text-lg font-semibold text-white">{index.value.toFixed(index.value > 1000 ? 2 : 3)}</div>
                <div className={`text-xs ${index.change >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  {index.change >= 0 ? '+' : ''}{index.change.toFixed(2)} ({index.pct.toFixed(2)}%)
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
                <CandlestickChart size={13} />
                Historical v2
              </div>
              <h2 className="mt-3 text-xl text-white">{SYMBOL_CONFIG[symbol].displayName} microstructure</h2>
            </div>
            <button
              onClick={() => void refreshMarket()}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white transition hover:bg-white/10"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {['1minute', '5minute', '30minute', '1day'].map((interval) => (
              <button
                key={interval}
                onClick={() => setChartInterval(interval)}
                className={`rounded-2xl px-3 py-2 text-xs transition ${chartInterval === interval ? 'bg-orange-500 text-white' : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}
              >
                {interval}
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-3xl border border-white/8 bg-[#08101c] p-4">
            <div className="mb-4 flex items-center justify-between text-xs text-slate-400">
              <span>{historical.length} candles</span>
              <span>{isHistoricalLoading ? 'Refreshing historical...' : `Range ${priceRange.low.toFixed(0)} - ${priceRange.high.toFixed(0)}`}</span>
            </div>
            {candlesReady ? (
              <div className="flex h-56 items-end gap-1">
                {historical.slice(-36).map((candle) => {
                  const isUp = candle.close >= candle.open;
                  const base = Math.max(priceRange.high - priceRange.low, 1);
                  const bodyHeight = Math.max(10, ((Math.abs(candle.close - candle.open) / base) * 180));
                  const wickHeight = Math.max(bodyHeight + 8, (((candle.high - candle.low) / base) * 190));
                  return (
                    <div key={candle.datetime} className="flex flex-1 flex-col items-center justify-end">
                      <div className={`w-px rounded-full ${isUp ? 'bg-emerald-400/70' : 'bg-red-400/70'}`} style={{ height: `${wickHeight}px` }} />
                      <div
                        className={`w-full rounded-md ${isUp ? 'bg-emerald-400/75' : 'bg-red-400/75'}`}
                        style={{ height: `${bodyHeight}px`, maxWidth: '10px', marginTop: `${-bodyHeight}px` }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-56 items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/5 text-center text-sm text-slate-400">
                Backend historical/candle stream is unavailable for this session.
              </div>
            )}
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span className="inline-flex items-center gap-1"><Clock3 size={12} /> Last update {lastUpdate.toLocaleTimeString()}</span>
              <span>{statusMessage}</span>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/8 bg-[#0b1321] p-5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-orange-300/70">
            <Layers3 size={13} />
            Depth
          </div>
          <div className="mt-3 text-xs text-slate-500">
            {marketDepth.instrumentLabel ?? 'No backend contract selected'}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-emerald-200/75">
                <span>Bids</span>
                <span>{(marketDepth.imbalance * 100).toFixed(0)}% skew</span>
              </div>
              <div className="space-y-2">
                {marketDepth.bids.map((level) => (
                  <div key={`bid-${level.price}`} className="flex items-center justify-between rounded-2xl bg-black/15 px-3 py-2">
                    <span className="font-medium text-emerald-200">{level.price.toFixed(2)}</span>
                    <span className="text-slate-300">{level.quantity.toLocaleString('en-IN')}</span>
                  </div>
                ))}
                {!depthReady && <div className="rounded-2xl bg-black/15 px-3 py-6 text-center text-xs text-slate-400">Backend depth unavailable</div>}
              </div>
            </div>
            <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-4">
              <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-red-200/75">
                <span>Asks</span>
                <span>Spread {marketDepth.spread.toFixed(2)}</span>
              </div>
              <div className="space-y-2">
                {marketDepth.asks.map((level) => (
                  <div key={`ask-${level.price}`} className="flex items-center justify-between rounded-2xl bg-black/15 px-3 py-2">
                    <span className="font-medium text-red-200">{level.price.toFixed(2)}</span>
                    <span className="text-slate-300">{level.quantity.toLocaleString('en-IN')}</span>
                  </div>
                ))}
                {!depthReady && <div className="rounded-2xl bg-black/15 px-3 py-6 text-center text-xs text-slate-400">Connect the backend for native depth</div>}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-slate-400">
            <div className="rounded-2xl bg-white/5 px-3 py-3">
              <div className="inline-flex items-center gap-1"><TrendingUp size={12} /> Spot</div>
              <div className="mt-2 text-lg font-semibold text-white">{spotPrice.toFixed(2)}</div>
            </div>
            <div className="rounded-2xl bg-white/5 px-3 py-3">
              <div className="inline-flex items-center gap-1"><AreaChart size={12} /> Expiry</div>
              <div className="mt-2 text-sm font-semibold text-white">{expiry.label}</div>
            </div>
            <div className="rounded-2xl bg-white/5 px-3 py-3">
              <div className="inline-flex items-center gap-1"><Clock3 size={12} /> Freshness</div>
              <div className="mt-2 text-sm font-semibold text-white">{marketDepth.source === 'backend' || candlesReady ? 'Backend native' : isLive ? 'Live chain only' : 'Simulated'}</div>
            </div>
          </div>
        </section>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[32px] border border-white/8 bg-[#07101b]">
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

        {legs.length > 0 && (
          <div className="pointer-events-none absolute bottom-6 right-6">
            <button
              onClick={onOpenStrategy}
              className="pointer-events-auto rounded-2xl bg-orange-500 px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(249,115,22,0.35)] transition hover:bg-orange-400"
            >
              Review {legs.length} strategy legs
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
