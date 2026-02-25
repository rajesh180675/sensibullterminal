// ================================================================
// MARKET CONFIGURATION — Single source of truth
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
    lotSize:            65,
    expiryDay:          'Tuesday',
    color:              '#3b82f6',
    bg:                 'rgba(59,130,246,0.08)',
  },
  BSESEN: {
    code:               'BSESEN',
    displayName:        'SENSEX',
    exchange:           'BFO',
    breezeStockCode:    'BSESEN',
    breezeExchangeCode: 'BFO',
    strikeStep:         100,
    lotSize:            20,
    expiryDay:          'Thursday',
    color:              '#f97316',
    bg:                 'rgba(249,115,22,0.08)',
  },
};

export const ALL_SYMBOLS: SymbolCode[] = ['NIFTY', 'BSESEN'];

// ── Weekly expiry date generator ─────────────────────────────
function nextWeeklyExpiries(dow: number, count: number): ExpiryDate[] {
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now    = new Date();
  const result: ExpiryDate[] = [];
  let cursor   = new Date(now);

  let ahead = (dow - cursor.getDay() + 7) % 7;
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
      breezeValue:  `${dd}-${mmm}-${yyyy}`,
      daysToExpiry: dte,
    });
    cursor.setDate(cursor.getDate() + 7);
  }
  return result;
}

export const NIFTY_EXPIRIES:  ExpiryDate[] = nextWeeklyExpiries(2, 5);
export const SENSEX_EXPIRIES: ExpiryDate[] = nextWeeklyExpiries(4, 5);

export function getExpiries(sym: SymbolCode): ExpiryDate[] {
  return sym === 'NIFTY' ? NIFTY_EXPIRIES : SENSEX_EXPIRIES;
}

export const SPOT_PRICES: Record<SymbolCode, number> = {
  NIFTY:  24520,
  BSESEN: 80450,
};

// FIX: Added dayOpen field to each index for accurate daily change calculation
export const MARKET_INDICES: MarketIndex[] = [
  { label: 'NIFTY 50',      value: 24520.85, change:  143.50, pct:  0.59, dayOpen: 24377.35 },
  { label: 'SENSEX',        value: 80450.40, change:  310.25, pct:  0.39, dayOpen: 80140.15 },
  { label: 'BANK NIFTY',    value: 52340.70, change: -215.80, pct: -0.41, dayOpen: 52556.50 },
  { label: 'FIN NIFTY',     value: 23890.15, change:   87.25, pct:  0.37, dayOpen: 23802.90 },
  { label: 'MIDCAP NIFTY',  value: 13120.55, change:   54.30, pct:  0.42, dayOpen: 13066.25 },
  { label: 'INDIA VIX',     value:    13.42, change:   -0.58, pct: -4.15, dayOpen: 14.00 },
  { label: 'USD/INR',       value:    83.52, change:   -0.12, pct: -0.14, dayOpen: 83.64 },
  { label: 'GOLD (MCX)',    value: 71850.00, change:  320.00, pct:  0.45, dayOpen: 71530.00 },
];

export const CORS_PROXIES = {
  vercelKaggle: '/api/kaggle',
  corsh:    'https://cors-anywhere.herokuapp.com/',
  allorigins: 'https://api.allorigins.win/raw?url=',
  vite:     '/api/breeze',
} as const;

export const BREEZE_BASE = 'https://api.icicidirect.com/breezeapi/api/v1';
