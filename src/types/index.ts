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
  realizedPnl?: number;
  unrealizedPnl?: number;
  brokerPositionKey?: string;
  brokerOrderIds?: string[];
  brokerTradeIds?: string[];
  maxProfit: number;
  maxLoss:   number;
  legs:      PositionLeg[];
}

export interface PositionLeg {
  id?:          string;
  type:         'CE' | 'PE';
  strike:       number;
  action:       'BUY' | 'SELL';
  lots:         number;
  quantity?:    number;
  entryPrice:   number;
  currentPrice: number;
  pnl:          number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  brokerLegKey?: string;
  orderId?: string;
  tradeId?: string;
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
  legsSnapshot?: OptionLeg[];
  previewSnapshot?: ExecutionPreview;
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

export interface SellerMetric {
  label: string;
  value: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'critical';
}

export interface SellerRegime {
  id:
    | 'range_bound'
    | 'trend_up'
    | 'trend_down'
    | 'volatile_expansion'
    | 'post_event_vol_crush'
    | 'pre_event_uncertainty'
    | 'expiry_pinning';
  label: string;
  summary: string;
  sellerSuitability: number;
  confidence: number;
  metrics: SellerMetric[];
  preferredStructures: string[];
  restrictedStructures: string[];
  warnings: string[];
}

export interface SellerPlaybook {
  id: string;
  name: string;
  description: string;
  targetRegimes: SellerRegime['id'][];
  allowedStructures: string[];
  riskBudgetPct: number;
  style: 'neutral_income' | 'directional_credit' | 'expiry_decay';
  noTradeConditions: string[];
}

export interface SellerOpportunityAutomationPreset {
  id: string;
  label: string;
  description: string;
  triggerSummary: string;
  actionSummary: string;
  triggerConfig: NonNullable<AutomationRule['triggerConfig']>;
  actionConfig: NonNullable<AutomationRule['actionConfig']>;
}

export interface SellerExposureSnapshot {
  activePositions: number;
  activeShortCallLots: number;
  activeShortPutLots: number;
  activeLongCallLots: number;
  activeLongPutLots: number;
  netDirectionalDelta: number;
  netShortGammaProxy: number;
  marginUtilization: number;
  unhedgedExposurePct: number;
  availableFunds: number;
  dominantBias: 'bullish' | 'bearish' | 'neutral';
  pressureFlags: string[];
}

export interface SellerOpportunityLeg {
  symbol: SymbolCode;
  type: 'CE' | 'PE';
  strike: number;
  action: 'BUY' | 'SELL';
  lots: number;
  ltp: number;
  iv: number;
  delta: number;
  theta: number;
  gamma: number;
  vega: number;
  expiry: string;
  orderType?: 'market' | 'limit';
  limitPrice?: number;
}

export interface SellerOpportunity {
  id: string;
  title: string;
  structure: string;
  mode: 'conservative_income' | 'aggressive_theta' | 'hedged_only' | 'defined_risk_only' | 'expiry_day';
  regimeFit: number;
  sellerScore: number;
  thesis: string;
  whyNow: string;
  expectedCredit: number;
  marginEstimate: number;
  maxLossEstimate: number;
  thetaPerMargin: number;
  liquidityScore: number;
  tailRiskScore: number;
  breakevens: number[];
  invalidation: string;
  adjustmentPlan: string;
  warnings: string[];
  tags: string[];
  playbookMatches: string[];
  preferredPlaybookId?: string;
  playbookCompliance: 'aligned' | 'watch' | 'violates';
  exposureFit: number;
  suppressed: boolean;
  suppressionReasons: string[];
  automationPresets: SellerOpportunityAutomationPreset[];
  legs: SellerOpportunityLeg[];
}

export interface SellerJournalEntry {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: 'draft' | 'reviewed' | 'executed';
  symbol: SymbolCode;
  title: string;
  structure: string;
  mode: SellerOpportunity['mode'];
  regimeLabel: string;
  sellerScore: number;
  expectedCredit: number;
  marginEstimate: number;
  maxLossEstimate: number;
  rationale: string;
  thesis: string;
  invalidation: string;
  adjustmentPlan: string;
  notes: string;
  playbookName?: string;
  playbookCompliance: SellerOpportunity['playbookCompliance'];
  exposureContext: string;
  mistakeTags: string[];
  automationRuleIds: string[];
  source: 'opportunity' | 'execution';
  sourceOpportunityId?: string;
  sourceBlotterId?: string;
  executionStatus?: ExecutionBlotterItem['status'];
  legsSnapshot?: OptionLeg[];
  linkedPositionIds: string[];
  linkedOrderIds: string[];
  linkedTradeIds: string[];
  linkedPositionStatus: 'unlinked' | 'open' | 'closed';
  realizedPnl: number;
  unrealizedPnl: number;
  netPnl: number;
  closedAt?: number;
  lastSyncedAt?: number;
  outcome: 'pending' | 'open' | 'closed_win' | 'closed_loss' | 'flat';
  adjustmentCount: number;
  adjustmentEffectiveness: 'unreviewed' | 'improving' | 'worsening' | 'flat';
}

export interface SellerJournalAnalyticsBucket {
  label: string;
  count: number;
}

export interface SellerJournalAnalytics {
  autoCapturedEntries: number;
  entriesByStructure: SellerJournalAnalyticsBucket[];
  entriesByRegime: SellerJournalAnalyticsBucket[];
  mistakeClusters: SellerJournalAnalyticsBucket[];
  entriesByOutcome: SellerJournalAnalyticsBucket[];
  adjustmentEffectiveness: SellerJournalAnalyticsBucket[];
  netPnlByStructure: Array<{ label: string; value: number }>;
}

export interface SellerJournalSummary {
  totalEntries: number;
  reviewedEntries: number;
  executedEntries: number;
  compliantEntries: number;
  complianceRate: number;
  topMistakeTags: Array<{ tag: string; count: number }>;
  analytics: SellerJournalAnalytics;
}

export interface AdjustmentSnapshot {
  netCredit: number;
  maxProfit: number;
  maxLoss: number;
  breakevens: number[];
  lots: number;
  stressedLegs: string[];
  realizedPnl?: number;
  unrealizedPnl?: number;
  netPnl?: number;
}

export interface AdjustmentPreviewDelta {
  status: 'idle' | 'loading' | 'ready' | 'fallback';
  source: 'backend' | 'estimated';
  premiumDelta: number;
  feeDelta: number;
  marginDelta: number;
  resultingMargin: number;
  resultingMaxLoss: number;
  notes: string[];
}

export interface AdjustmentSuggestion {
  id: string;
  positionId: string;
  strategyFamily: 'short_strangle' | 'short_straddle' | 'iron_condor' | 'vertical_spread' | 'single_leg_short' | 'custom';
  repairType: 'roll_tested_side' | 'roll_spread_wider' | 'add_wings' | 'close_tested_side' | 'flatten_all' | 'recenter_structure' | 'reduce_winning_side';
  title: string;
  rationale: string;
  trigger: string;
  repairFlow: string;
  severity: 'info' | 'warning' | 'critical';
  current: AdjustmentSnapshot;
  proposed: AdjustmentSnapshot;
  legsBefore: OptionLeg[];
  legsAfter: OptionLeg[];
  repairLegs: OptionLeg[];
  previewDelta: AdjustmentPreviewDelta;
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
  symbol?: SymbolCode;
  triggerConfig?: {
    type:
      | 'spot_range_break'
      | 'spot_cross_above'
      | 'spot_cross_below'
      | 'spot_pct_move'
      | 'mtm_drawdown'
      | 'mtm_profit_target'
      | 'position_net_quantity_below'
      | 'position_net_quantity_above'
      | 'manual';
    referencePrice?: number;
    lowerPrice?: number;
    upperPrice?: number;
    thresholdPrice?: number;
    movePercent?: number;
    direction?: 'up' | 'down' | 'either';
    maxDrawdown?: number;
    profitTarget?: number;
    netQuantity?: number;
  };
  actionConfig?: {
    type: 'execute_strategy' | 'notify' | 'suggest_hedge';
    legs?: Array<{
      symbol: SymbolCode;
      type: 'CE' | 'PE';
      strike: number;
      action: 'BUY' | 'SELL';
      lots: number;
      expiry: string;
      orderType?: 'market' | 'limit';
      limitPrice?: number;
    }>;
    message?: string;
  };
  runCount?: number;
  updatedAt?: number;
}

export interface AutomationCallbackEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  kind: AutomationRule['kind'];
  eventType: 'triggered' | 'executed' | 'failed' | 'status_changed' | 'created' | 'updated' | 'deleted' | 'manual' | 'webhook';
  status: 'success' | 'warning' | 'error' | 'info';
  message: string;
  timestamp: number;
  brokerResults?: Array<{
    leg_index?: number;
    success?: boolean;
    order_id?: string;
    error?: string;
  }>;
  meta?: Record<string, unknown>;
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
