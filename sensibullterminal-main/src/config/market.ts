// ================================================================
// MARKET CONFIGURATION — Single source of truth
//
// NIFTY:  NFO, stock_code=NIFTY,  lot=65, step=50,  expiry=Tuesday
// SENSEX: BFO, stock_code=BSESEN, lot=20, step=100, expiry=Thursday
//
// Breeze API verified field names (from SDK source):
//   exchange_code: "NFO" | "BFO"
//   stock_code:    "NIFTY" | "BSESEN"
//   right:         "Call" | "Put"   (cap first letter)
//   action:        "buy"  | "sell"  (lowercase)
//   expiry_date:   "DD-MMM-YYYY"   e.g. "01-Jul-2025"
// ================================================================

import { SymbolConfig, SymbolCode, ExpiryDate, MarketIndex } from '../types/index';

export const SYMBOL_CONFIG: Record<SymbolCode, SymbolConfig> = {
  NIFTY: {
    code:               'NIFTY',
    displayName:        'NIFTY 50',
    exchange:           'NFO',
    breezeStockCode:    'NIFTY',
    breezeExchangeCode: 'NFO',
    strikeStep:         50,
    lotSize:            65,    // 2026 updated lot size
    expiryDay:          'Tuesday',
    color:              '#3b82f6',
    bg:                 'rgba(59,130,246,0.08)',
  },
  BSESEN: {
    code:               'BSESEN',
    displayName:        'SENSEX',
    exchange:           'BFO',
    breezeStockCode:    'BSESEN',   // ICICI code for BSE SENSEX
    breezeExchangeCode: 'BFO',
    strikeStep:         100,
    lotSize:            20,    // 2026 updated lot size
    expiryDay:          'Thursday',
    color:              '#f97316',
    bg:                 'rgba(249,115,22,0.08)',
  },
};

export const ALL_SYMBOLS: SymbolCode[] = ['NIFTY', 'BSESEN'];

// ── Weekly expiry date generator ─────────────────────────────
// dow: 2 = Tuesday (NIFTY), 4 = Thursday (SENSEX)
function nextWeeklyExpiries(dow: number, count: number): ExpiryDate[] {
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now    = new Date();
  const result: ExpiryDate[] = [];
  let cursor   = new Date(now);

  // Days until next occurrence of `dow`
  let ahead = (dow - cursor.getDay() + 7) % 7;
  // If today IS expiry day but IST market has closed (>15:30 IST = >10:00 UTC)
  if (ahead === 0 && cursor.getUTCHours() >= 10) ahead = 7;
  cursor.setDate(cursor.getDate() + ahead);

  for (let i = 0; i < count; i++) {
    const d   = new Date(cursor);
    const dte = Math.max(0, Math.ceil((d.getTime() - now.getTime()) / 86_400_000));
    const dd  = String(d.getDate()).padStart(2, '0');
    const mmm = M[d.getMonth()];
    const yyyy= d.getFullYear();
    result.push({
      label:        `${dd} ${mmm} ${String(yyyy).slice(2)}`,
      breezeValue:  `${dd}-${mmm}-${yyyy}`,   // Breeze expects "DD-MMM-YYYY"
      daysToExpiry: dte,
    });
    cursor.setDate(cursor.getDate() + 7);
  }
  return result;
}

// Computed once at app load (stable across renders)
export const NIFTY_EXPIRIES:  ExpiryDate[] = nextWeeklyExpiries(2, 5);
export const SENSEX_EXPIRIES: ExpiryDate[] = nextWeeklyExpiries(4, 5);

export function getExpiries(sym: SymbolCode): ExpiryDate[] {
  return sym === 'NIFTY' ? NIFTY_EXPIRIES : SENSEX_EXPIRIES;
}

// ── Spot prices (live via Breeze in production) ──────────────
export const SPOT_PRICES: Record<SymbolCode, number> = {
  NIFTY:  24520,
  BSESEN: 80450,
};

// ── Market indices ticker ─────────────────────────────────────
export const MARKET_INDICES: MarketIndex[] = [
  { label: 'NIFTY 50',      value: 24520.85, change:  143.50, pct:  0.59 },
  { label: 'SENSEX',        value: 80450.40, change:  310.25, pct:  0.39 },
  { label: 'BANK NIFTY',    value: 52340.70, change: -215.80, pct: -0.41 },
  { label: 'FIN NIFTY',     value: 23890.15, change:   87.25, pct:  0.37 },
  { label: 'MIDCAP NIFTY',  value: 13120.55, change:   54.30, pct:  0.42 },
  { label: 'INDIA VIX',     value:    13.42, change:   -0.58, pct: -4.15 },
  { label: 'USD/INR',       value:    83.52, change:   -0.12, pct: -0.14 },
  { label: 'GOLD (MCX)',    value: 71850.00, change:  320.00, pct:  0.45 },
];

// ── CORS proxies for Arena/sandbox environments ───────────────
// Usage: set PROXY_BASE in src/utils/breezeClient.ts to one of these
export const CORS_PROXIES = {
  vercelKaggle: '/api/kaggle',
  corsh:    'https://cors-anywhere.herokuapp.com/',
  allorigins: 'https://api.allorigins.win/raw?url=',
  vite:     '/api/breeze',   // Vite dev proxy (see vite.config.ts comment)
} as const;

export const BREEZE_BASE = 'https://api.icicidirect.com/breezeapi/api/v1';
