// ================================================================
// MATH UTILITIES — Options calculations, payoff, Greeks
// Used by OptionChain, StrategyBuilder, Positions
// ================================================================

import { OptionLeg, PayoffPoint, Greeks } from '../types/index';
import { SYMBOL_CONFIG } from '../config/market';

// ── Number formatting ─────────────────────────────────────────
export function fmtOI(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 10_000_000) return (v / 10_000_000).toFixed(2) + 'Cr';
  if (abs >= 100_000)    return (v / 100_000).toFixed(2) + 'L';
  if (abs >= 1_000)      return (v / 1_000).toFixed(1) + 'K';
  return String(v);
}

export function fmtPnL(v: number): string {
  if (!isFinite(v)) return v > 0 ? '∞ Unlimited' : '-∞ Unlimited';
  const abs = Math.abs(v);
  const sign = v >= 0 ? '+' : '-';
  if (abs >= 100_000) return `${sign}₹${(abs / 100_000).toFixed(2)}L`;
  if (abs >= 1_000)   return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

export function fmtNum(v: number, decimals = 2): string {
  return v.toFixed(decimals);
}

// ── Black-Scholes helpers ─────────────────────────────────────
function normalCDF(x: number): number {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const poly = ((((a5 * t + a4) * t) + a3) * t + a2) * t + a1;
  const y = 1 - poly * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

export interface BSParams {
  S:   number;   // spot
  K:   number;   // strike
  T:   number;   // time to expiry in years
  r:   number;   // risk-free rate
  iv:  number;   // implied volatility (0–1)
  type: 'CE' | 'PE';
}

export function bsPrice(p: BSParams): number {
  const { S, K, T, r, iv, type } = p;
  if (T <= 0) return type === 'CE' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const d1 = (Math.log(S / K) + (r + 0.5 * iv * iv) * T) / (iv * Math.sqrt(T));
  const d2 = d1 - iv * Math.sqrt(T);
  if (type === 'CE') return S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
  return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}

// ── Payoff curve ──────────────────────────────────────────────
// Builds the P&L at expiry across a ±8% price range
export function buildPayoff(legs: OptionLeg[], spot: number): PayoffPoint[] {
  if (legs.length === 0) return [];

  const lo   = spot * 0.92;
  const hi   = spot * 1.08;
  const step = (hi - lo) / 120;
  const points: PayoffPoint[] = [];

  // Get lot size from first leg's symbol
  const sym     = legs[0].symbol;
  const lotSize = SYMBOL_CONFIG[sym]?.lotSize ?? 65;

  for (let price = lo; price <= hi; price += step) {
    let pnl = 0;
    for (const leg of legs) {
      const intrinsic = leg.type === 'CE'
        ? Math.max(0, price - leg.strike)
        : Math.max(0, leg.strike - price);
      const legPnL = (intrinsic - leg.ltp) * leg.lots * lotSize;
      pnl += leg.action === 'BUY' ? legPnL : -legPnL;
    }
    points.push({
      price:  Math.round(price),
      pnl:    Math.round(pnl),
      profit: pnl >= 0 ? Math.round(pnl) : 0,
      loss:   pnl <  0 ? Math.round(pnl) : 0,
    });
  }
  return points;
}

// ── Breakevent finder ─────────────────────────────────────────
export function findBreakevens(payoff: PayoffPoint[]): number[] {
  const bes: number[] = [];
  for (let i = 1; i < payoff.length; i++) {
    const a = payoff[i - 1];
    const b = payoff[i];
    if ((a.pnl < 0 && b.pnl >= 0) || (a.pnl >= 0 && b.pnl < 0)) {
      // Linear interpolation
      const frac = Math.abs(a.pnl) / (Math.abs(a.pnl) + Math.abs(b.pnl));
      bes.push(Math.round(a.price + frac * (b.price - a.price)));
    }
  }
  return bes;
}

// ── Max profit / loss ─────────────────────────────────────────
export function maxProfitLoss(payoff: PayoffPoint[]): { maxProfit: number; maxLoss: number } {
  if (payoff.length === 0) return { maxProfit: 0, maxLoss: 0 };
  let maxProfit = -Infinity;
  let maxLoss   =  Infinity;
  for (const p of payoff) {
    if (p.pnl > maxProfit) maxProfit = p.pnl;
    if (p.pnl < maxLoss)   maxLoss   = p.pnl;
  }
  // Check if unlimited (hit boundary)
  const lastPnl  = payoff[payoff.length - 1].pnl;
  const firstPnl = payoff[0].pnl;
  if (lastPnl > 0 && lastPnl === maxProfit)  maxProfit = Infinity;
  if (firstPnl > 0 && firstPnl === maxProfit) maxProfit = Infinity;
  if (lastPnl < 0 && lastPnl === maxLoss)    maxLoss   = -Infinity;
  if (firstPnl < 0 && firstPnl === maxLoss)  maxLoss   = -Infinity;
  return { maxProfit, maxLoss };
}

// ── Combined Greeks ───────────────────────────────────────────
export function combinedGreeks(legs: OptionLeg[]): Greeks {
  return legs.reduce((acc, leg) => {
    const m = leg.action === 'BUY' ? 1 : -1;
    return {
      delta: acc.delta + m * leg.delta * leg.lots,
      theta: acc.theta + m * leg.theta * leg.lots,
      gamma: acc.gamma + m * leg.gamma * leg.lots,
      vega:  acc.vega  + m * leg.vega  * leg.lots,
    };
  }, { delta: 0, theta: 0, gamma: 0, vega: 0 });
}
