// ================================================================
// MOCK DATA — Realistic option chain + simulated tick updates
// Production: replace generateChain() with fetchOptionChain() calls
// Production: replace simulateTick()  with WebSocket tick handler
// ================================================================

import { OptionRow, Position, SymbolCode } from '../types/index';
import { SYMBOL_CONFIG, SPOT_PRICES }      from '../config/market';

export function generateChain(symbol: SymbolCode, spotOverride?: number): OptionRow[] {
  const cfg   = SYMBOL_CONFIG[symbol];
  const spot  = spotOverride ?? SPOT_PRICES[symbol];
  const step  = cfg.strikeStep;
  const ATM   = Math.round(spot / step) * step;
  const N     = 15;

  return Array.from({ length: N*2+1 }, (_, i) => {
    const strike    = ATM + (i-N)*step;
    const isATM     = Math.abs(strike - ATM) < step/2;
    const mono      = (spot - strike) / spot;
    const distSteps = Math.abs(strike - ATM) / step;
    const dte       = 7;
    const tv        = Math.max(0.01, 0.18 * Math.sqrt(dte/365));

    const ceIV    = 12 + Math.abs(mono)*40 + (isATM ? 0 : 2);
    const ceIntr  = Math.max(0, spot - strike);
    const ceBase  = isATM ? 90 : Math.max(0.5, 90*Math.exp(-distSteps*0.72));
    const ceLTP   = Math.max(0.05, Math.round((ceIntr + ceBase*tv)*20)/20);
    const ceDelta = Math.max(0.01, Math.min(0.99, 0.5 + mono*2.5));

    const peIV    = ceIV + (mono > 0 ? 1.5 : -0.5);
    const peIntr  = Math.max(0, strike - spot);
    const peBase  = isATM ? 90 : Math.max(0.5, 90*Math.exp(-distSteps*0.72));
    const peLTP   = Math.max(0.05, Math.round((peIntr + peBase*tv)*20)/20);
    const peDelta = -(1 - ceDelta);

    const gamma = 0.00028 * Math.exp(-Math.pow(mono*10, 2)/2);
    const theta = -(ceLTP*0.016 + 1.2);
    const vega  = 18*gamma*spot*0.01*Math.sqrt(dte/365);

    const baseOI = Math.max(400_000, 7_500_000*Math.exp(-distSteps*0.28));
    const ceOI   = Math.round(baseOI*(0.9+Math.random()*0.3)*(mono > 0 ? 1.2 : 0.8));
    const peOI   = Math.round(baseOI*(0.9+Math.random()*0.3)*(mono < 0 ? 1.2 : 0.8));

    return {
      strike, isATM,
      ce_ltp:    ceLTP,
      ce_oi:     ceOI,
      ce_oiChg:  Math.round((Math.random()-0.42)*ceOI*0.05),
      ce_volume: Math.round(ceOI*(0.04+Math.random()*0.09)),
      ce_iv:     Math.round(ceIV*10)/10,
      ce_delta:  Math.round(ceDelta*1000)/1000,
      ce_theta:  Math.round(theta*100)/100,
      ce_gamma:  Math.round(gamma*100000)/100000,
      ce_vega:   Math.round(vega*100)/100,
      ce_bid:    Math.round((ceLTP-0.5)*20)/20,
      ce_ask:    Math.round((ceLTP+0.5)*20)/20,
      pe_ltp:    peLTP,
      pe_oi:     peOI,
      pe_oiChg:  Math.round((Math.random()-0.42)*peOI*0.05),
      pe_volume: Math.round(peOI*(0.04+Math.random()*0.09)),
      pe_iv:     Math.round(Math.max(0, peIV)*10)/10,
      pe_delta:  Math.round(peDelta*1000)/1000,
      pe_theta:  Math.round(theta*100)/100,
      pe_gamma:  Math.round(gamma*100000)/100000,
      pe_vega:   Math.round(vega*100)/100,
      pe_bid:    Math.round((peLTP-0.5)*20)/20,
      pe_ask:    Math.round((peLTP+0.5)*20)/20,
    };
  });
}

// Simulates WebSocket tick → updates LTP/OI on each call
export function simulateTick(rows: OptionRow[]): OptionRow[] {
  return rows.map(row => {
    const cn = (Math.random()-0.5)*0.9;
    const pn = (Math.random()-0.5)*0.9;
    const on = Math.round((Math.random()-0.5)*5000);
    return {
      ...row,
      ce_ltp: Math.max(0.05, Math.round((row.ce_ltp+cn)*20)/20),
      pe_ltp: Math.max(0.05, Math.round((row.pe_ltp+pn)*20)/20),
      ce_oi:  Math.max(0, row.ce_oi+on),
      pe_oi:  Math.max(0, row.pe_oi+on),
    };
  });
}

// Sample positions for Positions tab
export const MOCK_POSITIONS: Position[] = [
  {
    id:'p1', symbol:'NIFTY', expiry:'01 Jul 25',
    strategy:'Bull Call Spread', entryDate:'2025-06-20',
    status:'ACTIVE', mtmPnl:3250, maxProfit:8750, maxLoss:-3750,
    legs:[
      { type:'CE', strike:24500, action:'BUY',  lots:1, entryPrice:185.00, currentPrice:210.50, pnl: 3250 },
      { type:'CE', strike:24700, action:'SELL', lots:1, entryPrice: 98.00, currentPrice: 95.25, pnl:  179 },
    ],
  },
  {
    id:'p2', symbol:'NIFTY', expiry:'01 Jul 25',
    strategy:'Short Strangle', entryDate:'2025-06-18',
    status:'ACTIVE', mtmPnl:-1450, maxProfit:12600, maxLoss:-Infinity,
    legs:[
      { type:'CE', strike:25000, action:'SELL', lots:2, entryPrice:125.00, currentPrice:142.50, pnl:-2275 },
      { type:'PE', strike:24000, action:'SELL', lots:2, entryPrice:110.00, currentPrice:101.25, pnl: 1138 },
    ],
  },
  {
    id:'p3', symbol:'BSESEN', expiry:'03 Jul 25',
    strategy:'Iron Condor', entryDate:'2025-06-22',
    status:'DRAFT', mtmPnl:0, maxProfit:5400, maxLoss:-2100,
    legs:[
      { type:'CE', strike:81000, action:'SELL', lots:1, entryPrice:280, currentPrice:275, pnl: 100 },
      { type:'CE', strike:81500, action:'BUY',  lots:1, entryPrice:155, currentPrice:148, pnl:-140 },
      { type:'PE', strike:79000, action:'SELL', lots:1, entryPrice:260, currentPrice:252, pnl: 160 },
      { type:'PE', strike:78500, action:'BUY',  lots:1, entryPrice:148, currentPrice:143, pnl:-100 },
    ],
  },
];
