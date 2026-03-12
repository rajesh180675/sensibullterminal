import { SYMBOL_CONFIG } from '../../config/market';
import type { OptionQuote } from '../../utils/kaggleClient';
import type { MarketIndex, OptionRow, Position, SymbolCode } from '../../types/index';
import type { TickData } from '../../utils/breezeWs';

export function mergeQuotesToChain(
  calls: OptionQuote[],
  puts: OptionQuote[],
  spot: number,
  step: number,
  daysToExpiry: number,
): OptionRow[] {
  const ceMap = new Map<number, OptionQuote>();
  const peMap = new Map<number, OptionQuote>();

  calls.forEach((quote) => {
    const strike = Math.round(parseFloat(quote['strike-price']) || 0);
    if (strike > 0) ceMap.set(strike, quote);
  });

  puts.forEach((quote) => {
    const strike = Math.round(parseFloat(quote['strike-price']) || 0);
    if (strike > 0) peMap.set(strike, quote);
  });

  const strikes = Array.from(new Set([...ceMap.keys(), ...peMap.keys()])).sort((a, b) => a - b);
  if (strikes.length === 0) return [];

  const atmStrike = strikes.reduce((best, strike) =>
    Math.abs(strike - spot) < Math.abs(best - spot) ? strike : best
  );

  const dte = Math.max(1, daysToExpiry);
  const timeToExpiry = dte / 365;

  return strikes.map((strike) => {
    const ce = ceMap.get(strike);
    const pe = peMap.get(strike);
    const value = (input: string | undefined, fallback = 0) => {
      const parsed = parseFloat(input ?? '');
      return Number.isNaN(parsed) ? fallback : parsed;
    };

    const ceLtp = value(ce?.ltp);
    const peLtp = value(pe?.ltp);
    const moneyness = (spot - strike) / spot;
    const ceDelta = Math.max(0.01, Math.min(0.99, 0.5 + moneyness * 2.5));
    const peDelta = -(1 - ceDelta);
    const gamma = 0.00028 * Math.exp(-Math.pow(moneyness * 10, 2) / 2);
    const ceTheta = -((ceLtp || 1) * 0.016 + 1.2);
    const peTheta = -((peLtp || 1) * 0.016 + 1.2);
    const vega = 18 * gamma * spot * 0.01 * Math.sqrt(timeToExpiry > 0 ? timeToExpiry : 0.019);

    return {
      strike,
      isATM: Math.abs(strike - atmStrike) < step / 2,
      ce_ltp: ceLtp,
      ce_oi: value(ce?.['open-interest']),
      ce_oiChg: value(ce?.['oi-change-percentage']),
      ce_volume: value(ce?.['total-quantity-traded']),
      ce_iv: value(ce?.['implied-volatility']),
      ce_delta: ceDelta,
      ce_theta: ceTheta,
      ce_gamma: gamma,
      ce_vega: vega,
      ce_bid: Math.max(0.05, value(ce?.['best-bid-price'])),
      ce_ask: value(ce?.['best-offer-price']),
      ce_ltpChg: 0,
      pe_ltp: peLtp,
      pe_oi: value(pe?.['open-interest']),
      pe_oiChg: value(pe?.['oi-change-percentage']),
      pe_volume: value(pe?.['total-quantity-traded']),
      pe_iv: value(pe?.['implied-volatility']),
      pe_delta: peDelta,
      pe_theta: peTheta,
      pe_gamma: gamma,
      pe_vega: vega,
      pe_bid: Math.max(0.05, value(pe?.['best-bid-price'])),
      pe_ask: value(pe?.['best-offer-price']),
      pe_ltpChg: 0,
    };
  });
}

export function deriveSpotFromMedian(chain: OptionRow[]): number | null {
  const estimates: number[] = [];
  chain.forEach((row) => {
    if (row.ce_ltp > 0.5 && row.pe_ltp > 0.5) {
      estimates.push(row.strike + row.ce_ltp - row.pe_ltp);
    }
  });

  if (estimates.length < 3) return null;
  estimates.sort((a, b) => a - b);
  const middle = Math.floor(estimates.length / 2);
  const median = estimates.length % 2 === 0
    ? (estimates[middle - 1] + estimates[middle]) / 2
    : estimates[middle];

  return Math.round(median);
}

export function applyTicksToChain(chain: OptionRow[], ticks: TickData[]): OptionRow[] {
  if (ticks.length === 0) return chain;

  const ceUpdates = new Map<number, Partial<OptionRow>>();
  const peUpdates = new Map<number, Partial<OptionRow>>();

  ticks.forEach((tick) => {
    const isCe = tick.right === 'CE';
    const targetMap = isCe ? ceUpdates : peUpdates;
    const previous = targetMap.get(tick.strike) || {};
    targetMap.set(tick.strike, {
      ...previous,
      ...(isCe ? {
        ce_ltp: tick.ltp,
        ce_oi: tick.oi,
        ce_volume: tick.volume,
        ce_iv: tick.iv,
        ce_bid: tick.bid,
        ce_ask: tick.ask,
      } : {
        pe_ltp: tick.ltp,
        pe_oi: tick.oi,
        pe_volume: tick.volume,
        pe_iv: tick.iv,
        pe_bid: tick.bid,
        pe_ask: tick.ask,
      }),
    });
  });

  let changed = false;
  const next = chain.map((row) => {
    const ceUpdate = ceUpdates.get(row.strike);
    const peUpdate = peUpdates.get(row.strike);
    if (!ceUpdate && !peUpdate) return row;
    changed = true;
    return {
      ...row,
      ...ceUpdate,
      ...peUpdate,
      ce_ltpChg: ceUpdate?.ce_ltp != null ? ceUpdate.ce_ltp - row.ce_ltp : 0,
      pe_ltpChg: peUpdate?.pe_ltp != null ? peUpdate.pe_ltp - row.pe_ltp : 0,
    };
  });

  return changed ? next : chain;
}

export function mapBreezePositions(data: unknown): Position[] {
  const payload = data as { positions?: unknown[] } | null;
  if (!payload?.positions) return [];

  const positions: Position[] = [];
  (payload.positions as Array<Record<string, string>>).forEach((position, index) => {
    const isOptions = !!(position.right || position.strike_price);
    if (!isOptions) return;

    const symbol: SymbolCode =
      (position.stock_code || '').includes('SENSEX') || (position.stock_code || '').includes('BSESEN')
        ? 'BSESEN'
        : 'NIFTY';

    const action = (position.action || position.transaction_type || '').toLowerCase().startsWith('b') ? 'BUY' : 'SELL';
    const type: 'CE' | 'PE' = (position.right || '').toLowerCase().startsWith('c') ? 'CE' : 'PE';
    const strike = parseFloat(position.strike_price || '0');
    const entryPrice = parseFloat(position.average_price || '0');
    const currentPrice = parseFloat(position.ltp || position.current_price || String(entryPrice));
    const quantity = parseInt(position.quantity || '1', 10);
    const lotSize = SYMBOL_CONFIG[symbol].lotSize;
    const lots = Math.max(1, Math.round(quantity / lotSize));
    const pnl = (action === 'BUY' ? 1 : -1) * (currentPrice - entryPrice) * quantity;

    positions.push({
      id: `live-${index}`,
      symbol,
      expiry: position.expiry_date || '',
      strategy: `${symbol} ${type} ${strike}`,
      entryDate: position.order_date || new Date().toISOString().slice(0, 10),
      status: 'ACTIVE',
      mtmPnl: Math.round(pnl),
      maxProfit: Infinity,
      maxLoss: -Infinity,
      legs: [{
        type,
        strike,
        action,
        lots,
        entryPrice,
        currentPrice,
        pnl: Math.round(pnl),
      }],
    });
  });

  return positions;
}

export function updateIndicesWithSpot(indices: MarketIndex[], symbol: SymbolCode, spotPrice: number, dayOpen: number | undefined): MarketIndex[] {
  return indices.map((index) => {
    const matchesSymbol = (index.label === 'NIFTY 50' && symbol === 'NIFTY') || (index.label === 'SENSEX' && symbol === 'BSESEN');
    if (!matchesSymbol) return index;
    if (!dayOpen) return { ...index, value: spotPrice };
    const change = spotPrice - dayOpen;
    const pct = dayOpen > 0 ? (change / dayOpen) * 100 : 0;
    return { ...index, value: spotPrice, change, pct };
  });
}
