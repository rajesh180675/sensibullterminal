// ================================================================
// TYPES — Options Terminal (Sensibull-style)
// All field names aligned with ICICI Breeze REST API responses
// ================================================================

export type SymbolCode = 'NIFTY' | 'BSESEN';

export interface SymbolConfig {
  code:               SymbolCode;
  displayName:        string;
  exchange:           'NFO' | 'BFO';
  breezeStockCode:    string;
  breezeExchangeCode: string;
  strikeStep:         number;
  lotSize:            number;
  expiryDay:          'Tuesday' | 'Thursday';
  color:              string;
  bg:                 string;
}

export interface OptionRow {
  strike:     number;
  isATM?:     boolean;
  ce_ltp:     number;
  ce_oi:      number;
  ce_oiChg:   number;
  ce_volume:  number;
  ce_iv:      number;
  ce_delta:   number;
  ce_theta:   number;
  ce_gamma:   number;
  ce_vega:    number;
  ce_bid:     number;
  ce_ask:     number;
  // FIX: LTP change fields for OI signal price-direction component
  ce_ltpChg:  number;
  pe_ltp:     number;
  pe_oi:      number;
  pe_oiChg:   number;
  pe_volume:  number;
  pe_iv:      number;
  pe_delta:   number;
  pe_theta:   number;
  pe_gamma:   number;
  pe_vega:    number;
  pe_bid:     number;
  pe_ask:     number;
  // FIX: LTP change fields for OI signal price-direction component
  pe_ltpChg:  number;
}

export interface OptionLeg {
  id:         string;
  symbol:     SymbolCode;
  type:       'CE' | 'PE';
  strike:     number;
  action:     'BUY' | 'SELL';
  lots:       number;
  ltp:        number;
  iv:         number;
  delta:      number;
  theta:      number;
  gamma:      number;
  vega:       number;
  expiry:     string; // 'DD-MMM-YYYY'
  orderType?: 'market' | 'limit';
  limitPrice?: number;
}

export interface Greeks {
  delta: number;
  theta: number;
  gamma: number;
  vega:  number;
}

export interface PayoffPoint {
  price:  number;
  pnl:    number;
  profit: number;
  loss:   number;
}

export interface ExpiryDate {
  label:        string;  // '01 Jul 25'
  breezeValue:  string;  // '01-Jul-2025'
  daysToExpiry: number;
}

export interface Position {
  id:        string;
  symbol:    SymbolCode;
  expiry:    string;
  strategy:  string;
  entryDate: string;
  status:    'ACTIVE' | 'DRAFT' | 'CLOSED';
  mtmPnl:    number;
  maxProfit: number;
  maxLoss:   number;
  legs:      PositionLeg[];
}

export interface PositionLeg {
  type:         'CE' | 'PE';
  strike:       number;
  action:       'BUY' | 'SELL';
  lots:         number;
  entryPrice:   number;
  currentPrice: number;
  pnl:          number;
}

export interface MarketIndex {
  label:   string;
  value:   number;
  change:  number;
  pct:     number;
  dayOpen: number;  // FIX: track day-open for accurate change%
}

// ── Breeze session (browser state — no backend) ─────────────
export interface BreezeCredentials {
  apiKey:       string;
  apiSecret:    string;
  sessionToken: string;
}

export interface BreezeSession extends BreezeCredentials {
  isConnected:  boolean;
  connectedAt?: Date;
  proxyBase:    string;
  backendAuthToken?: string;
}
