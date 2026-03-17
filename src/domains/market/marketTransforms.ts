import { DEFAULT_RISK_FREE_RATE, SYMBOL_CONFIG } from '../../config/market';
import { computeGreeks } from '../../lib/math/greeks';
import type { OptionQuote } from '../../utils/kaggleClient';
import type { MarketIndex, OptionRow, Position, SymbolCode } from '../../types/index';
import type { TickData } from '../../utils/breezeWs';

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function withComputedGreeks(row: OptionRow, spot: number, daysToExpiry: number): OptionRow {
  const ceGreeks = computeGreeks({
    spot,
    strike: row.strike,
    daysToExpiry,
    iv: row.ce_iv,
    right: 'CE',
    riskFreeRate: DEFAULT_RISK_FREE_RATE,
  });
  const peGreeks = computeGreeks({
    spot,
    strike: row.strike,
    daysToExpiry,
    iv: row.pe_iv,
    right: 'PE',
    riskFreeRate: DEFAULT_RISK_FREE_RATE,
  });

  return {
    ...row,
    greekSource: ceGreeks || peGreeks ? 'black-scholes' : row.greekSource ?? 'approximate',
    ce_delta: ceGreeks?.delta ?? row.ce_delta,
    ce_gamma: ceGreeks?.gamma ?? row.ce_gamma,
    ce_theta: ceGreeks?.theta ?? row.ce_theta,
    ce_vega: ceGreeks?.vega ?? row.ce_vega,
    pe_delta: peGreeks?.delta ?? row.pe_delta,
    pe_gamma: peGreeks?.gamma ?? row.pe_gamma,
    pe_theta: peGreeks?.theta ?? row.pe_theta,
    pe_vega: peGreeks?.vega ?? row.pe_vega,
  };
}

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

  return strikes.map((strike) => {
    const ce = ceMap.get(strike);
    const pe = peMap.get(strike);
    const baseRow: OptionRow = {
      strike,
      isATM: Math.abs(strike - atmStrike) < step / 2,
      greekSource: 'approximate',
      ce_ltp: numeric(ce?.ltp),
      ce_oi: numeric(ce?.['open-interest']),
      ce_oiChg: numeric(ce?.['oi-change-percentage']),
      ce_volume: numeric(ce?.['total-quantity-traded']),
      ce_iv: numeric(ce?.['implied-volatility']),
      ce_delta: 0,
      ce_theta: 0,
      ce_gamma: 0,
      ce_vega: 0,
      ce_bid: Math.max(0.05, numeric(ce?.['best-bid-price'])),
      ce_ask: numeric(ce?.['best-offer-price']),
      ce_ltpChg: 0,
      pe_ltp: numeric(pe?.ltp),
      pe_oi: numeric(pe?.['open-interest']),
      pe_oiChg: numeric(pe?.['oi-change-percentage']),
      pe_volume: numeric(pe?.['total-quantity-traded']),
      pe_iv: numeric(pe?.['implied-volatility']),
      pe_delta: 0,
      pe_theta: 0,
      pe_gamma: 0,
      pe_vega: 0,
      pe_bid: Math.max(0.05, numeric(pe?.['best-bid-price'])),
      pe_ask: numeric(pe?.['best-offer-price']),
      pe_ltpChg: 0,
    };

    return withComputedGreeks(baseRow, spot, daysToExpiry);
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

export function applyTicksToChain(
  chain: OptionRow[],
  ticks: TickData[],
  spot: number,
  daysToExpiry: number,
): OptionRow[] {
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
    const updatedRow: OptionRow = {
      ...row,
      ...ceUpdate,
      ...peUpdate,
      greekSource: row.greekSource ?? 'approximate',
      ce_ltpChg: ceUpdate?.ce_ltp != null ? ceUpdate.ce_ltp - row.ce_ltp : 0,
      pe_ltpChg: peUpdate?.pe_ltp != null ? peUpdate.pe_ltp - row.pe_ltp : 0,
    };
    return withComputedGreeks(updatedRow, spot, daysToExpiry);
  });

  return changed ? next : chain;
}

export function mapBreezePositions(data: unknown): Position[] {
  const payload = data as { positions?: unknown[] } | null;
  if (!payload?.positions) return [];

  const grouped = new Map<string, Position>();
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
    const entryPrice = readFirst(position, ['normalized_average_price', 'average_price', 'avg_price']);
    const currentPrice = readFirst(position, ['normalized_ltp', 'ltp', 'current_price', 'close_price'], entryPrice);
    const quantity = Math.max(1, Math.abs(Math.round(readFirst(position, ['quantity', 'net_quantity', 'net_qty'], 1))));
    const lotSize = SYMBOL_CONFIG[symbol].lotSize;
    const lots = Math.max(1, Math.round(quantity / lotSize));
    const realizedPnl = readFirst(position, ['normalized_realized_pnl', 'realised_pnl', 'realized_pnl', 'booked_profit_loss', 'realized_mtm']);
    const unrealizedPnl = readFirst(
      position,
      ['normalized_unrealized_pnl', 'unrealised_pnl', 'unrealized_pnl', 'open_profit_loss', 'open_mtm'],
      (action === 'BUY' ? 1 : -1) * (currentPrice - entryPrice) * quantity,
    );
    const pnl = readFirst(position, ['normalized_mtm', 'pnl', 'mtm', 'total_pnl'], realizedPnl + unrealizedPnl);
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
      delta: numeric((position.broker_greeks as Record<string, unknown> | undefined)?.delta),
      gamma: numeric((position.broker_greeks as Record<string, unknown> | undefined)?.gamma),
      theta: numeric((position.broker_greeks as Record<string, unknown> | undefined)?.theta),
      vega: numeric((position.broker_greeks as Record<string, unknown> | undefined)?.vega),
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
