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

export interface WatchlistItem {
  id: string;
  symbol: SymbolCode;
  label: string;
  price: number;
  change: number;
  pct: number;
  volume: number;
  updatedAt: number;
}

export interface DepthLevel {
  price: number;
  quantity: number;
  orders: number;
}

export interface MarketDepthSnapshot {
  bids: DepthLevel[];
  asks: DepthLevel[];
  spread: number;
  imbalance: number;
  updatedAt: number;
  instrumentLabel?: string;
  contractKey?: string;
  source?: 'backend' | 'stream' | 'unavailable';
}

export interface CandleStreamBucket {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ExecutionChargeSummary {
  brokerage: number;
  brokerReportedOtherCharges: number;
  brokerReportedTurnoverAndSebiCharges: number;
  taxesAndDuties: number;
  totalFees: number;
  componentCharges: Record<string, number>;
  calculationMode?: 'broker_rollup' | 'component_fallback';
}

export interface ExecutionPreview {
  estimatedPremium: number;
  estimatedFees: number;
  slippage: number;
  capitalAtRisk: number;
  marginRequired: number;
  maxProfit: number;
  maxLoss: number;
  breakevens: number[];
  source?: 'backend' | 'estimated';
  availableMargin?: number;
  spanMargin?: number;
  blockTradeMargin?: number;
  orderMargin?: number;
  tradeMargin?: number;
  totalBrokerage?: number;
  chargesBreakdown?: Record<string, number>;
  chargeSummary?: ExecutionChargeSummary;
  updatedAt?: number;
  notes?: string[];
  validation?: ExecutionValidationSummary;
}

export interface ExecutionValidationLegSummary {
  kind: 'preview' | 'margin';
  captured_at: number;
  leg_count: number;
  rawTopLevelFields: string[];
  successFields: string[];
  captureFile?: string;
}

export interface ExecutionValidationSummary {
  kind: 'preview' | 'margin';
  captured_at: number;
  leg_count: number;
  captureFile?: string;
  rawTopLevelFields?: string[];
  successFields?: string[];
  previewLegs?: ExecutionValidationLegSummary[];
  margin?: ExecutionValidationLegSummary;
}

export interface ExecutionBlotterItem {
  id: string;
  submittedAt: number;
  symbol: SymbolCode;
  legCount: number;
  summary: string;
  premium: number;
  status: 'queued' | 'sent' | 'partial' | 'failed';
  response: string;
}

export interface PortfolioSummary {
  totalMtm: number;
  totalMaxProfit: number;
  totalMaxLoss: number;
  activePositions: number;
  winners: number;
  losers: number;
  grossExposure: number;
  hedgedExposure: number;
  availableFunds: number;
  marginUsed: number;
  marginUtilization: number;
}

export interface RiskAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
}

export interface RiskSnapshot {
  portfolioDelta: number;
  portfolioTheta: number;
  portfolioGamma: number;
  portfolioVega: number;
  stressLoss1Pct: number;
  stressLoss2Pct: number;
  marginHeadroom: number;
  concentration: number;
  stagedFees: number;
  stagedBrokerage: number;
  stagedOtherCharges: number;
  stagedTaxesAndDuties: number;
  chargeSummary?: ExecutionChargeSummary;
  alerts: RiskAlert[];
}

export interface AutomationRule {
  id: string;
  name: string;
  kind: 'gtt' | 'alert' | 'hedge' | 'rebalance';
  status: 'active' | 'paused' | 'draft';
  scope: string;
  trigger: string;
  action: string;
  lastRun: string;
  nextRun: string;
  notes?: string;
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
