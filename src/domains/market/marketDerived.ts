import { SYMBOL_CONFIG } from '../../config/market';
import type { HistoricalCandle } from '../../utils/kaggleClient';
import type {
  MarketDepthSnapshot,
  OptionRow,
  SymbolCode,
  WatchlistItem,
} from '../../types/index';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function buildWatchlist(symbol: SymbolCode, spotPrice: number, previous: WatchlistItem[]): WatchlistItem[] {
  const now = Date.now();
  const current = previous.find((item) => item.symbol === symbol);
  const priorPrice = current?.price ?? spotPrice * 0.997;
  const change = spotPrice - priorPrice;
  const pct = priorPrice === 0 ? 0 : (change / priorPrice) * 100;
  const updated: WatchlistItem = {
    id: `watch-${symbol}`,
    symbol,
    label: SYMBOL_CONFIG[symbol].displayName,
    price: spotPrice,
    change,
    pct,
    volume: Math.round(150000 + Math.abs(change) * 1800 + now % 10000),
    updatedAt: now,
  };

  const others = previous.filter((item) => item.symbol !== symbol);
  return [updated, ...others].sort((a, b) => a.label.localeCompare(b.label));
}

export function buildDepthFromChain(chain: OptionRow[], spotPrice: number): MarketDepthSnapshot {
  const atmRow = chain.reduce<OptionRow | null>((best, row) => {
    if (!best) return row;
    return Math.abs(row.strike - spotPrice) < Math.abs(best.strike - spotPrice) ? row : best;
  }, null);

  const mid = atmRow ? (atmRow.ce_bid + atmRow.ce_ask + atmRow.pe_bid + atmRow.pe_ask) / 4 : spotPrice;
  const step = clamp(mid * 0.0003, 0.05, 5);
  const baseQty = atmRow ? Math.max(atmRow.ce_volume, atmRow.pe_volume, 1) : 1000;

  const bids = Array.from({ length: 5 }, (_, index) => ({
    price: Number((mid - step * (index + 1)).toFixed(2)),
    quantity: Math.round(baseQty * (1 - index * 0.12)),
    orders: Math.max(1, 14 - index * 2),
  }));
  const asks = Array.from({ length: 5 }, (_, index) => ({
    price: Number((mid + step * (index + 1)).toFixed(2)),
    quantity: Math.round(baseQty * (0.94 - index * 0.1)),
    orders: Math.max(1, 13 - index * 2),
  }));

  const totalBidQty = bids.reduce((sum, level) => sum + level.quantity, 0);
  const totalAskQty = asks.reduce((sum, level) => sum + level.quantity, 0);

  return {
    bids,
    asks,
    spread: Number((asks[0].price - bids[0].price).toFixed(2)),
    imbalance: totalBidQty + totalAskQty === 0 ? 0 : (totalBidQty - totalAskQty) / (totalBidQty + totalAskQty),
    updatedAt: Date.now(),
  };
}

export function buildSyntheticCandles(spotPrice: number, interval: string, symbol: SymbolCode): HistoricalCandle[] {
  const points = interval === '1minute' ? 60 : interval === '5minute' ? 72 : interval === '30minute' ? 80 : 90;
  const cfg = SYMBOL_CONFIG[symbol];
  const amplitude = cfg.strikeStep * (interval === '1minute' ? 0.7 : interval === '5minute' ? 1.1 : 1.8);
  const now = Date.now();
  let lastClose = spotPrice * 0.992;

  return Array.from({ length: points }, (_, index) => {
    const swing = Math.sin(index / 5.5) * amplitude + Math.cos(index / 9) * amplitude * 0.45;
    const drift = ((index / points) - 0.5) * amplitude * 0.8;
    const open = lastClose;
    const close = Number((spotPrice + swing + drift).toFixed(2));
    const high = Number((Math.max(open, close) + amplitude * 0.35).toFixed(2));
    const low = Number((Math.min(open, close) - amplitude * 0.35).toFixed(2));
    lastClose = close;

    return {
      datetime: new Date(now - (points - index) * 300000).toISOString(),
      open: Number(open.toFixed(2)),
      high,
      low,
      close,
      volume: Math.round(1500 + Math.abs(close - open) * 100 + index * 14),
    };
  });
}
