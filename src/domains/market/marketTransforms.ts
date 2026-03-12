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

  const grouped = new Map<string, Position>();
  const numeric = (value: unknown, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const readFirst = (row: Record<string, unknown>, keys: string[], fallback = 0) => {
    const match = keys.find((key) => row[key] !== undefined && row[key] !== null && row[key] !== '');
    return numeric(match ? row[match] : undefined, fallback);
  };

  (payload.positions as Array<Record<string, unknown>>).forEach((position, index) => {
    const isOptions = !!(position.right || position.strike_price);
    if (!isOptions) return;
    const stockCode = String(position.stock_code || '');
    const rawAction = String(position.action || position.transaction_type || '');
    const rawRight = String(position.right || '');

    const symbol: SymbolCode =
      stockCode.includes('SENSEX') || stockCode.includes('BSESEN')
        ? 'BSESEN'
        : 'NIFTY';

    const action: 'BUY' | 'SELL' = rawAction.toLowerCase().startsWith('b') ? 'BUY' : 'SELL';
    const type: 'CE' | 'PE' = rawRight.toLowerCase().startsWith('c') ? 'CE' : 'PE';
    const strike = numeric(position.strike_price);
    const entryPrice = readFirst(position, ['average_price', 'avg_price']);
    const currentPrice = readFirst(position, ['ltp', 'current_price', 'close_price'], entryPrice);
    const quantity = Math.max(1, Math.abs(Math.round(readFirst(position, ['quantity', 'net_quantity', 'net_qty'], 1))));
    const lotSize = SYMBOL_CONFIG[symbol].lotSize;
    const lots = Math.max(1, Math.round(quantity / lotSize));
    const realizedPnl = readFirst(position, ['realised_pnl', 'realized_pnl', 'booked_profit_loss', 'realized_mtm']);
    const unrealizedPnl = readFirst(
      position,
      ['unrealised_pnl', 'unrealized_pnl', 'open_profit_loss', 'open_mtm'],
      (action === 'BUY' ? 1 : -1) * (currentPrice - entryPrice) * quantity,
    );
    const pnl = readFirst(position, ['pnl', 'mtm', 'total_pnl'], realizedPnl + unrealizedPnl);
    const expiry = String(position.expiry_date || '');
    const bucketKey = [
      symbol,
      expiry,
      position.product || 'options',
      position.strategy_id || position.position_set || position.client_order_id || 'group',
    ].join('|');
    const brokerOrderId = String(position.order_id || position.parent_order_id || '');
    const brokerTradeId = String(position.trade_id || '');

    const existing = grouped.get(bucketKey);
    const nextLeg = {
      id: `live-leg-${index}`,
      type,
      strike,
      action,
      lots,
      quantity,
      entryPrice,
      currentPrice,
      pnl: Math.round(pnl),
      realizedPnl: Math.round(realizedPnl),
      unrealizedPnl: Math.round(unrealizedPnl),
      brokerLegKey: String(position.position_key || position.leg_id || `${bucketKey}-${type}-${strike}-${action}`),
      orderId: brokerOrderId || undefined,
      tradeId: brokerTradeId || undefined,
    };

    if (!existing) {
      grouped.set(bucketKey, {
        id: `live-${bucketKey.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`,
        symbol,
        expiry,
        strategy: `${symbol} ${expiry || 'live'} strategy`,
        entryDate: String(position.order_date || position.trade_date || new Date().toISOString().slice(0, 10)),
        status: 'ACTIVE',
        mtmPnl: Math.round(pnl),
        realizedPnl: Math.round(realizedPnl),
        unrealizedPnl: Math.round(unrealizedPnl),
        brokerPositionKey: bucketKey,
        brokerOrderIds: brokerOrderId ? [brokerOrderId] : [],
        brokerTradeIds: brokerTradeId ? [brokerTradeId] : [],
        maxProfit: Infinity,
        maxLoss: -Infinity,
        legs: [nextLeg],
      });
      return;
    }

    existing.legs.push(nextLeg);
    existing.mtmPnl += Math.round(pnl);
    existing.realizedPnl = (existing.realizedPnl ?? 0) + Math.round(realizedPnl);
    existing.unrealizedPnl = (existing.unrealizedPnl ?? 0) + Math.round(unrealizedPnl);
    if (brokerOrderId && !existing.brokerOrderIds?.includes(brokerOrderId)) {
      existing.brokerOrderIds = [...(existing.brokerOrderIds ?? []), brokerOrderId];
    }
    if (brokerTradeId && !existing.brokerTradeIds?.includes(brokerTradeId)) {
      existing.brokerTradeIds = [...(existing.brokerTradeIds ?? []), brokerTradeId];
    }
  });

  return [...grouped.values()].map((position) => ({
    ...position,
    strategy: inferStrategyName(position),
  }));
}

function inferStrategyName(position: Position) {
  const sellCalls = position.legs.filter((leg) => leg.action === 'SELL' && leg.type === 'CE').length;
  const sellPuts = position.legs.filter((leg) => leg.action === 'SELL' && leg.type === 'PE').length;
  const buyCalls = position.legs.filter((leg) => leg.action === 'BUY' && leg.type === 'CE').length;
  const buyPuts = position.legs.filter((leg) => leg.action === 'BUY' && leg.type === 'PE').length;

  if (sellCalls > 0 && sellPuts > 0 && buyCalls > 0 && buyPuts > 0) return 'Iron Condor';
  if (sellCalls > 0 && sellPuts > 0 && buyCalls === 0 && buyPuts === 0) return 'Short Strangle';
  if (sellCalls > 0 && buyCalls > 0 && sellPuts === 0 && buyPuts === 0) return 'Bear Call Spread';
  if (sellPuts > 0 && buyPuts > 0 && sellCalls === 0 && buyCalls === 0) return 'Bull Put Spread';
  if (sellCalls > 0 && buyCalls === 0 && sellPuts === 0 && buyPuts === 0) return 'Short Call';
  if (sellPuts > 0 && buyPuts === 0 && sellCalls === 0 && buyCalls === 0) return 'Short Put';
  return `${position.legs.length}-leg live structure`;
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
