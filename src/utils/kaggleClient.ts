// ════════════════════════════════════════════════════════════════════════════
// Kaggle / Python Backend Client v5
// Covers ALL BreezeEngine v6 endpoints including:
//   square-off, cancel order, modify order, order book, trade book,
//   funds, historical data, single quote
// ════════════════════════════════════════════════════════════════════════════

let TERMINAL_AUTH_TOKEN: string | undefined;

/**
 * Sets the shared-secret used to authenticate to the Python backend.
 * The backend enforces this via `X-Terminal-Auth` header on all `/api/*` routes
 * when AUTH_ENABLED=true (i.e. when TERMINAL_AUTH_TOKEN env var is set in Kaggle).
 *
 * FIX (Bug #2): This was previously dead code — token was set but never used.
 * Now fetchJson includes this header whenever the token is set.
 */
export function setTerminalAuthToken(token?: string): void {
  TERMINAL_AUTH_TOKEN = token?.trim() || undefined;
}

function getBase(rawUrl: string): string {
  // Strip trailing slash only — do NOT strip /api suffix for Vercel proxy paths
  // e.g. '/api/kaggle' → '/api/kaggle'  (correct; it IS the base)
  //      'https://xyz.trycloudflare.com/api' → 'https://xyz.trycloudflare.com'
  //      'https://xyz.trycloudflare.com' → 'https://xyz.trycloudflare.com'
  if (rawUrl.startsWith('/')) {
    // Relative Vercel proxy path — use as-is (strip trailing slash only)
    return rawUrl.replace(/\/$/, '');
  }
  // Absolute URL — strip trailing /api and trailing slash
  return rawUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
}

function apiUrl(rawUrl: string, path: string): string {
  return `${getBase(rawUrl)}${path.startsWith('/') ? path : '/' + path}`;
}

/** Human-readable base URL for error messages (always an absolute URL if possible) */
function displayBase(rawUrl: string): string {
  if (rawUrl.startsWith('/')) {
    return `${window.location.origin}${rawUrl}`;
  }
  return getBase(rawUrl);
}

export function isKaggleBackend(proxyBase: string): boolean {
  if (!proxyBase) return false;
  const lower = proxyBase.toLowerCase().trim();
  if (lower === '/api/kaggle' || lower.startsWith('/api/kaggle/')) return true;
  return (
    lower.includes('trycloudflare.com') || lower.includes('ngrok-free.app') ||
    lower.includes('ngrok.io')          || lower.includes('ngrok.app')       ||
    lower.includes('localhost.run')     || lower.includes('lhr.life')        ||
    lower.includes('serveo.net')        || lower.includes('bore.pub')        ||
    lower.includes('localhost')         || lower.includes('127.0.0.1')       ||
    lower.includes('0.0.0.0')           ||
    (lower.endsWith('/api') && !lower.includes('cors-anywhere') && !lower.includes('allorigins'))
  );
}

function isCfUrl(url: string): boolean {
  return url.toLowerCase().includes('trycloudflare.com');
}

// ── Core fetch ────────────────────────────────────────────────────────────────

async function fetchJson<T = unknown>(
  url: string,
  options: RequestInit = {},
  timeoutMs = 28_000,
): Promise<T> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  // FIX (Bug #2): Forward auth token when set
  // Required by kaggle_backend.py middleware when AUTH_ENABLED=true
  if (TERMINAL_AUTH_TOKEN) {
    headers['x-terminal-auth'] = TERMINAL_AUTH_TOKEN;
  }

  // Cloudflare interstitial bypass
  if (isCfUrl(url)) headers['bypass-tunnel-reminder'] = 'true';

  try {
    const res  = await fetch(url, { ...options, headers, signal: controller.signal, mode: 'cors' });
    const text = await res.text();
    const trim = text.trim();

    // Detect Cloudflare HTML interstitial
    if (trim.startsWith('<!') || trim.startsWith('<html') ||
        trim.includes('Just a moment') || trim.includes('cloudflare') ||
        trim.includes('cf-browser-verification')) {
      // displayBase converts /api/kaggle → https://yoursite.com/api/kaggle
      const base = displayBase(url);
      throw new Error(
        `Cloudflare interstitial detected.\n\n` +
        `FIX: Open in a NEW browser tab:\n  ${base}/health\n\n` +
        `Wait for JSON {"status":"online"}, then retry.\n` +
        `(This unlocks the tunnel for ~30 minutes)`
      );
    }

    try { return JSON.parse(text) as T; }
    catch { throw new Error(`Non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`); }
  } catch (e) {
    if ((e as Error).name === 'AbortError')
      throw new Error(`Request timed out after ${timeoutMs/1000}s — check Kaggle cell is running`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OptionQuote {
  'stock-code':            string;
  'exchange-code':         string;
  'right':                 string;
  'strike-price':          string;
  'ltp':                   string;
  'open-interest':         string;
  'oi-change-percentage':  string;
  'total-quantity-traded': string;
  'implied-volatility':    string;
  'best-bid-price':        string;
  'best-offer-price':      string;
}

export interface ExpiryInfo {
  date:      string;
  label:     string;
  days_away: number;
  weekday:   string;
}

export interface ConnectResult {
  ok: boolean; reason: string; sessionToken?: string; user?: string;
}

export interface HealthResult {
  ok: boolean; connected: boolean; message: string;
  wsRunning?: boolean; restCallsMin?: number; queueDepth?: number;
}

export interface OrderResult {
  ok: boolean; orderId?: string; error?: string;
}

export interface FundsData {
  cash_balance?:     number;
  net_amount?:       number;
  utilized_margin?:  number;
  available_margin?: number;
  [key: string]: unknown;
}

export interface OrderBookRow {
  order_id:        string;
  stock_code:      string;
  action:          string;
  quantity:        string;
  price:           string;
  status:          string;
  order_type:      string;
  strike_price?:   string;
  right?:          string;
  expiry_date?:    string;
  exchange_code?:  string;
  [key: string]:   unknown;
}

export interface TradeBookRow {
  order_id:        string;
  stock_code:      string;
  action:          string;
  quantity:        string;
  price:           string;
  trade_price?:    string;
  strike_price?:   string;
  right?:          string;
  expiry_date?:    string;
  [key: string]:   unknown;
}

export interface PositionRow {
  stock_code:        string;
  action?:           string;
  right?:            string;
  strike_price?:     string;
  expiry_date?:      string;
  quantity?:         string;
  average_price?:    string;
  ltp?:              string;
  pnl?:              string;
  product?:          string;
  exchange_code?:    string;
  transaction_type?: string;
  [key: string]:     unknown;
}

export interface HistoricalCandle {
  datetime: string;
  open:     number;
  high:     number;
  low:      number;
  close:    number;
  volume:   number;
}

export interface BackendDepthLevel {
  price: number;
  quantity: number;
  orders?: number;
}

export interface BackendMarketDepth {
  bids: BackendDepthLevel[];
  asks: BackendDepthLevel[];
  spread?: number;
  imbalance?: number;
  updated_at?: number;
  instrument_label?: string;
  contract_key?: string;
}

export interface BackendExecutionPreview {
  estimatedPremium: number;
  estimatedFees: number;
  slippage: number;
  capitalAtRisk: number;
  marginRequired: number;
  availableMargin?: number;
  spanMargin?: number;
  blockTradeMargin?: number;
  orderMargin?: number;
  tradeMargin?: number;
  totalBrokerage?: number;
  chargesBreakdown?: Record<string, number>;
  chargeSummary?: {
    brokerage: number;
    brokerReportedOtherCharges: number;
    brokerReportedTurnoverAndSebiCharges: number;
    taxesAndDuties: number;
    totalFees: number;
    componentCharges: Record<string, number>;
    calculationMode?: 'broker_rollup' | 'component_fallback';
  };
  notes?: string[];
  updated_at?: number;
  validation?: BackendExecutionValidationSummary;
}

export interface BackendExecutionValidationLegSummary {
  kind: 'preview' | 'margin';
  captured_at: number;
  leg_count: number;
  rawTopLevelFields: string[];
  successFields: string[];
  captureFile?: string;
}

export interface BackendExecutionValidationSummary {
  kind: 'preview' | 'margin';
  captured_at: number;
  leg_count: number;
  captureFile?: string;
  rawTopLevelFields?: string[];
  successFields?: string[];
  previewLegs?: BackendExecutionValidationLegSummary[];
  margin?: BackendExecutionValidationLegSummary;
}

export interface BackendAutomationRule {
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
  symbol?: string;
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
    legs?: Array<Record<string, unknown>>;
    message?: string;
  };
  runCount?: number;
  updatedAt?: number;
}

export interface BackendAutomationCallbackEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  kind: BackendAutomationRule['kind'];
  eventType: 'triggered' | 'executed' | 'failed' | 'status_changed' | 'created' | 'updated' | 'deleted' | 'manual' | 'webhook';
  status: 'success' | 'warning' | 'error' | 'info';
  message: string;
  timestamp: number;
  brokerResults?: Array<{ leg_index?: number; success?: boolean; order_id?: string; error?: string }>;
  meta?: Record<string, unknown>;
}

// ── Health check ──────────────────────────────────────────────────────────────
// FIX (Bug #5): Improved messages — clearly distinguish:
//   ok:true  + connected:false  = "Backend reachable, click Validate Live to connect Breeze"
//   ok:true  + connected:true   = "Fully connected to Breeze ICICI"
//   ok:false                    = "Backend unreachable — check Kaggle cell"

export async function checkBackendHealth(backendUrl: string): Promise<HealthResult> {
  // Try /health first (most likely); fall back to /ping and root.
  // Timeout is 10s per attempt so UI feedback is fast.
  for (const endpoint of ['/health', '/ping', '/']) {
    const url = apiUrl(backendUrl, endpoint);
    try {
      const data = await fetchJson<{
        status?: string; ok?: boolean; success?: boolean;
        cf_interstitial?: boolean; error?: string;
        connected?: boolean; breeze?: boolean; breeze_connected?: boolean; is_connected?: boolean;
        data?: { connected?: boolean; breeze?: boolean };
        ws_running?: boolean; rest_calls_min?: number; queue_depth?: number; version?: string;
      }>(url, { method: 'GET' }, 10_000);

      // If the proxy (or upstream) returned an error JSON, surface it directly.
      // This happens when: CF interstitial was detected and proxy returned
      // {ok:false, cf_interstitial:true, error:"..."} as clean JSON.
      if (data.ok === false || data.success === false) {
        const msg = data.error || 'Backend returned an error response';
        // Only stop on CF interstitial — other errors try the next endpoint.
        if (data.cf_interstitial) {
          return { ok: false, connected: false, message: msg };
        }
        continue;  // try next endpoint
      }

      // A genuine health response must have status="online" or similar positive fields.
      const isOnline =
        data.status === 'online' ||
        data.status === 'ok' ||
        typeof data.connected === 'boolean' ||
        typeof data.breeze === 'boolean';

      if (!isOnline) continue;  // not a real health response, try next

      const breezeConnected =
        typeof data.connected === 'boolean'        ? data.connected :
        typeof data.breeze === 'boolean'           ? data.breeze :
        typeof data.breeze_connected === 'boolean' ? data.breeze_connected :
        typeof data.is_connected === 'boolean'     ? data.is_connected :
        typeof data.data?.connected === 'boolean'  ? data.data.connected :
        typeof data.data?.breeze === 'boolean'     ? data.data.breeze :
        undefined;

      const breezeMsg = breezeConnected === true
        ? '✓ Breeze ICICI connected'
        : breezeConnected === false
          ? 'Backend reachable but Breeze not yet connected — fill credentials & click Validate Live'
          : 'Backend reachable (Breeze status unknown)';

      return {
        ok: true,
        connected: breezeConnected === true,
        wsRunning:    data.ws_running,
        restCallsMin: data.rest_calls_min,
        queueDepth:   data.queue_depth,
        message: `Backend v${data.version ?? '?'} online. ${breezeMsg}`,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Stop immediately on CF or timeout — no point retrying other endpoints
      if (msg.includes('Cloudflare') || msg.includes('interstitial') || msg.includes('timed out')) {
        return { ok: false, connected: false, message: msg };
      }
      // Other errors (network, parse) — try next endpoint
    }
  }
  return {
    ok: false,
    connected: false,
    message:
      'Cannot reach backend.\n\n' +
      'Check:\n' +
      '• Kaggle cell is still running (may have timed out after ~12h)\n' +
      '• Tunnel URL is current (copy latest from Kaggle output)\n' +
      '• For Cloudflare URLs: open the URL in a browser tab first',
  };
}

// ── Connect ───────────────────────────────────────────────────────────────────

export async function connectToBreeze(params: {
  apiKey: string; apiSecret: string; sessionToken: string; backendUrl: string;
}): Promise<ConnectResult> {
  const { apiKey, apiSecret, sessionToken, backendUrl } = params;

  // NOTE: We removed the blocking health pre-check here. It was an extra round-trip
  // that caused the entire connection to fail on transient network issues or when
  // the CF interstitial was returned (before the proxy fix). The /api/connect
  // endpoint itself will surface a meaningful error if the backend is down.

  const url  = apiUrl(backendUrl, '/api/connect');
  const body = JSON.stringify({ api_key: apiKey, api_secret: apiSecret, session_token: sessionToken });

  try {
    const data = await fetchJson<{
      success: boolean; session_token?: string; message?: string; error?: string;
      name?: string; email?: string;
    }>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

    if (data.success) return {
      ok: true, reason: data.message || 'Connected via Python SDK',
      sessionToken: data.session_token, user: data.name || data.email,
    };
    return { ok: false, reason: data.error || data.message || 'Connection failed' };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

// ── Expiries ──────────────────────────────────────────────────────────────────

export async function fetchExpiryDates(
  backendUrl: string, stockCode: string, exchangeCode: string,
): Promise<{ ok: boolean; expiries: ExpiryInfo[]; error?: string }> {
  const qs  = new URLSearchParams({ stock_code: stockCode, exchange_code: exchangeCode });
  const url = apiUrl(backendUrl, `/api/expiries?${qs}`);
  try {
    const data = await fetchJson<{ success: boolean; expiries?: ExpiryInfo[]; error?: string }>(url);
    return data.success && data.expiries ? { ok: true, expiries: data.expiries } : { ok: false, expiries: [], error: data.error };
  } catch (e) {
    return { ok: false, expiries: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Option Chain ──────────────────────────────────────────────────────────────

export async function fetchOptionChain(
  backendUrl: string,
  params: { stockCode: string; exchangeCode: string; expiryDate: string; right?: string | null },
): Promise<{ ok: boolean; data?: OptionQuote[]; count?: number; error?: string }> {
  const qs  = new URLSearchParams({
    stock_code: params.stockCode, exchange_code: params.exchangeCode,
    expiry_date: params.expiryDate, right: params.right || 'Call',
  });
  const url = apiUrl(backendUrl, `/api/optionchain?${qs}`);
  try {
    const data = await fetchJson<{ success: boolean; data?: unknown; count?: number; error?: string }>(url);
    if (data.success) {
      const raw    = Array.isArray(data.data) ? data.data : [];
      const quotes: OptionQuote[] = raw.map((q: Record<string, unknown>) => ({
        'stock-code':            String(q['stock-code']            ?? q['stock_code']             ?? params.stockCode),
        'exchange-code':         String(q['exchange-code']         ?? q['exchange_code']          ?? params.exchangeCode),
        'right':                 String(q['right']                 ?? params.right ?? 'Call'),
        'strike-price':          String(q['strike-price']          ?? q['strike_price']           ?? q['StrikePrice']       ?? '0'),
        'ltp':                   String(q['ltp']                   ?? q['LTP']                    ?? q['close_price']       ?? '0'),
        'open-interest':         String(q['open-interest']         ?? q['open_interest']          ?? q['OpenInterest']      ?? '0'),
        'oi-change-percentage':  String(q['oi-change-percentage']  ?? q['oi_change']              ?? '0'),
        'total-quantity-traded': String(q['total-quantity-traded'] ?? q['total_quantity_traded']  ?? q['volume']            ?? '0'),
        'implied-volatility':    String(q['implied-volatility']    ?? q['implied_volatility']     ?? q['iv']                ?? '0'),
        'best-bid-price':        String(q['best-bid-price']        ?? q['best_bid_price']         ?? '0'),
        'best-offer-price':      String(q['best-offer-price']      ?? q['best_offer_price']       ?? '0'),
      }));
      return { ok: true, data: quotes, count: quotes.length };
    }
    return { ok: false, data: [], error: data.error || 'Unknown error' };
  } catch (e) {
    return { ok: false, data: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Place Order ───────────────────────────────────────────────────────────────

export async function placeOrder(backendUrl: string, params: {
  stockCode: string; exchangeCode: string; product?: string;
  action: 'BUY' | 'SELL'; orderType?: string; quantity: string;
  price?: string; validity?: string; stoploss?: string;
  expiryDate: string; right: 'call' | 'put'; strikePrice: string;
}): Promise<OrderResult> {
  const legPayload = {
    stock_code: params.stockCode,
    exchange_code: params.exchangeCode,
    product: params.product || 'options',
    action: params.action.toLowerCase(),
    order_type: params.orderType || 'market',
    quantity: params.quantity,
    price: params.price || '0',
    validity: params.validity || 'day',
    stoploss: params.stoploss || '0',
    expiry_date: params.expiryDate,
    right: params.right,
    strike_price: params.strikePrice,
  };

  try {
    // Primary route: /api/order (new backend contract)
    const directUrl = apiUrl(backendUrl, '/api/order');
    const data = await fetchJson<{ success: boolean; order_id?: string; orderId?: string; error?: string }>(directUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(legPayload),
    });
    if (data.success) {
      return { ok: true, orderId: data.order_id || data.orderId };
    }

    // Fallback route: /api/strategy/execute (legacy/alternate backend contract)
    const fallbackUrl = apiUrl(backendUrl, '/api/strategy/execute');
    const fallback = await fetchJson<{
      success: boolean;
      error?: string;
      results?: Array<{ success: boolean; order_id?: string; orderId?: string; error?: string }>;
    }>(fallbackUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs: [legPayload] }),
    });

    const first = fallback.results?.[0];
    if (fallback.success && first?.success) {
      return { ok: true, orderId: first.order_id || first.orderId };
    }

    return {
      ok: false,
      error:
        first?.error ||
        fallback.error ||
        data.error ||
        'Order failed',
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Square Off ────────────────────────────────────────────────────────────────

export async function squareOffPosition(backendUrl: string, params: {
  stockCode: string; exchangeCode: string; action: 'BUY' | 'SELL';
  quantity: string; expiryDate: string; right: 'call' | 'put'; strikePrice: string;
  orderType?: 'market' | 'limit'; price?: string;
}): Promise<OrderResult> {
  const url = apiUrl(backendUrl, '/api/squareoff');
  try {
    const data = await fetchJson<{ success: boolean; order_id?: string; error?: string }>(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stock_code: params.stockCode, exchange_code: params.exchangeCode,
        product: 'options', action: params.action.toLowerCase(),
        order_type: params.orderType ?? 'market',
        quantity: params.quantity,
        price: params.price ?? '0', validity: 'day', stoploss: '0',
        expiry_date: params.expiryDate, right: params.right,
        strike_price: params.strikePrice,
      }),
    });
    return data.success ? { ok: true, orderId: data.order_id } : { ok: false, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Cancel Order ──────────────────────────────────────────────────────────────

export async function cancelOrder(
  backendUrl: string, orderId: string, exchangeCode = 'NFO',
): Promise<{ ok: boolean; error?: string }> {
  const url = apiUrl(backendUrl, '/api/order/cancel');
  try {
    const data = await fetchJson<{ success: boolean; error?: string }>(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, exchange_code: exchangeCode }),
    });
    return { ok: data.success, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Fetch Order Book ──────────────────────────────────────────────────────────

export async function fetchOrderBook(
  backendUrl: string,
): Promise<{ ok: boolean; data: OrderBookRow[]; error?: string }> {
  const url = apiUrl(backendUrl, '/api/orders');
  try {
    const data = await fetchJson<{ success: boolean; data?: unknown[]; error?: string }>(url);
    return data.success
      ? { ok: true, data: (data.data || []) as OrderBookRow[] }
      : { ok: false, data: [], error: data.error };
  } catch (e) {
    return { ok: false, data: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Fetch Trade Book ──────────────────────────────────────────────────────────

export async function fetchTradeBook(
  backendUrl: string,
): Promise<{ ok: boolean; data: TradeBookRow[]; error?: string }> {
  const url = apiUrl(backendUrl, '/api/trades');
  try {
    const data = await fetchJson<{ success: boolean; data?: unknown[]; error?: string }>(url);
    return data.success
      ? { ok: true, data: (data.data || []) as TradeBookRow[] }
      : { ok: false, data: [], error: data.error };
  } catch (e) {
    return { ok: false, data: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Fetch Positions ───────────────────────────────────────────────────────────

export async function fetchPositions(
  backendUrl: string,
): Promise<{ ok: boolean; data?: { positions: PositionRow[]; holdings: unknown[] }; error?: string }> {
  const url = apiUrl(backendUrl, '/api/positions');
  try {
    const data = await fetchJson<{ success: boolean; data?: unknown; error?: string }>(url);
    return data.success
      ? { ok: true, data: data.data as { positions: PositionRow[]; holdings: unknown[] } }
      : { ok: false, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Fetch Funds ───────────────────────────────────────────────────────────────

export async function fetchFunds(
  backendUrl: string,
): Promise<{ ok: boolean; data?: FundsData; error?: string }> {
  const url = apiUrl(backendUrl, '/api/funds');
  try {
    const data = await fetchJson<{ success: boolean; data?: unknown; error?: string }>(url);
    return data.success
      ? { ok: true, data: data.data as FundsData }
      : { ok: false, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Fetch Historical ──────────────────────────────────────────────────────────

export async function fetchHistorical(
  backendUrl: string, params: {
    stockCode: string; exchangeCode: string; interval: string;
    fromDate: string; toDate: string;
    expiryDate?: string; right?: string; strikePrice?: string;
  },
): Promise<{ ok: boolean; data: HistoricalCandle[]; error?: string }> {
  const qs = new URLSearchParams({
    stock_code: params.stockCode, exchange_code: params.exchangeCode,
    interval: params.interval, from_date: params.fromDate, to_date: params.toDate,
    ...(params.expiryDate ? { expiry_date: params.expiryDate } : {}),
    ...(params.right        ? { right: params.right }               : {}),
    ...(params.strikePrice  ? { strike_price: params.strikePrice }  : {}),
  });
  const url = apiUrl(backendUrl, `/api/historical?${qs}`);
  try {
    const data = await fetchJson<{ success: boolean; data?: unknown[]; error?: string }>(url);
    return data.success
      ? { ok: true, data: (data.data || []) as HistoricalCandle[] }
      : { ok: false, data: [], error: data.error };
  } catch (e) {
    return { ok: false, data: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Fetch Market Depth ────────────────────────────────────────────────────────

export async function fetchMarketDepth(
  backendUrl: string,
  params: {
    stockCode: string;
    exchangeCode: string;
    expiryDate: string;
    right: string;
    strikePrice: string;
  },
): Promise<{ ok: boolean; data?: BackendMarketDepth; error?: string }> {
  const qs = new URLSearchParams({
    stock_code: params.stockCode,
    exchange_code: params.exchangeCode,
    expiry_date: params.expiryDate,
    right: params.right,
    strike_price: params.strikePrice,
  });
  const url = apiUrl(backendUrl, `/api/depth?${qs}`);
  try {
    const data = await fetchJson<{ success: boolean; data?: BackendMarketDepth; error?: string }>(url);
    return data.success
      ? { ok: true, data: data.data }
      : { ok: false, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchExecutionPreview(
  backendUrl: string,
  legs: unknown[],
): Promise<{ ok: boolean; data?: BackendExecutionPreview; error?: string }> {
  const url = apiUrl(backendUrl, '/api/preview');
  try {
    const data = await fetchJson<{ success: boolean; data?: BackendExecutionPreview; error?: string }>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs }),
    });
    return data.success ? { ok: true, data: data.data } : { ok: false, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchMarginPreview(
  backendUrl: string,
  legs: unknown[],
): Promise<{ ok: boolean; data?: BackendExecutionPreview; error?: string }> {
  const url = apiUrl(backendUrl, '/api/margin');
  try {
    const data = await fetchJson<{ success: boolean; data?: BackendExecutionPreview; error?: string }>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legs }),
    });
    return data.success ? { ok: true, data: data.data } : { ok: false, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchExecutionValidation(
  backendUrl: string,
  limit = 10,
): Promise<{ ok: boolean; records?: Array<Record<string, unknown>>; captureFile?: string; error?: string }> {
  const qs = new URLSearchParams({ limit: String(limit) });
  const url = apiUrl(backendUrl, `/api/diagnostics/execution-validation?${qs}`);
  try {
    const data = await fetchJson<{ success: boolean; records?: Array<Record<string, unknown>>; capture_file?: string; error?: string }>(url);
    return data.success
      ? { ok: true, records: data.records ?? [], captureFile: data.capture_file }
      : { ok: false, error: data.error ?? 'Unknown error' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchAutomationRules(
  backendUrl: string,
): Promise<{ ok: boolean; rules?: BackendAutomationRule[]; error?: string }> {
  const url = apiUrl(backendUrl, '/api/automation/rules');
  try {
    const data = await fetchJson<{ success: boolean; rules?: BackendAutomationRule[]; error?: string }>(url);
    return data.success ? { ok: true, rules: data.rules ?? [] } : { ok: false, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createAutomationRule(
  backendUrl: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; rule?: BackendAutomationRule; error?: string }> {
  const url = apiUrl(backendUrl, '/api/automation/rules');
  try {
    const data = await fetchJson<{ success: boolean; rule?: BackendAutomationRule; error?: string }>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return data.success ? { ok: true, rule: data.rule } : { ok: false, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateAutomationRule(
  backendUrl: string,
  ruleId: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; rule?: BackendAutomationRule; error?: string }> {
  const url = apiUrl(backendUrl, `/api/automation/rules/${encodeURIComponent(ruleId)}`);
  try {
    const data = await fetchJson<{ success: boolean; rule?: BackendAutomationRule; error?: string }>(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return data.success ? { ok: true, rule: data.rule } : { ok: false, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteAutomationRule(
  backendUrl: string,
  ruleId: string,
): Promise<{ ok: boolean; rule?: BackendAutomationRule; error?: string }> {
  const url = apiUrl(backendUrl, `/api/automation/rules/${encodeURIComponent(ruleId)}`);
  try {
    const data = await fetchJson<{ success: boolean; rule?: BackendAutomationRule; error?: string }>(url, {
      method: 'DELETE',
    });
    return data.success ? { ok: true, rule: data.rule } : { ok: false, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateAutomationRuleStatus(
  backendUrl: string,
  ruleId: string,
  status: 'active' | 'paused' | 'draft',
): Promise<{ ok: boolean; rule?: BackendAutomationRule; error?: string }> {
  const url = apiUrl(backendUrl, `/api/automation/rules/${encodeURIComponent(ruleId)}/status`);
  try {
    const data = await fetchJson<{ success: boolean; rule?: BackendAutomationRule; error?: string }>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    return data.success ? { ok: true, rule: data.rule } : { ok: false, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function evaluateAutomationRules(
  backendUrl: string,
): Promise<{ ok: boolean; events?: BackendAutomationCallbackEvent[]; count?: number; error?: string }> {
  const url = apiUrl(backendUrl, '/api/automation/evaluate');
  try {
    const data = await fetchJson<{ success: boolean; events?: BackendAutomationCallbackEvent[]; count?: number; error?: string }>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    return data.success ? { ok: true, events: data.events ?? [], count: data.count ?? 0 } : { ok: false, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchAutomationCallbacks(
  backendUrl: string,
  limit = 25,
): Promise<{ ok: boolean; events?: BackendAutomationCallbackEvent[]; error?: string }> {
  const qs = new URLSearchParams({ limit: String(limit) });
  const url = apiUrl(backendUrl, `/api/automation/callbacks?${qs}`);
  try {
    const data = await fetchJson<{ success: boolean; events?: BackendAutomationCallbackEvent[]; error?: string }>(url);
    return data.success ? { ok: true, events: data.events ?? [] } : { ok: false, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Spot Price ────────────────────────────────────────────────────────────────
// FIX: New function to fetch the actual index spot price from the backend.
// This replaces the broken put-call parity derivation that was seeded from
// a stale hardcoded SPOT_PRICES value.
//
// Exchange codes for NSE/BSE cash (index) market — NOT the derivatives exchange:
//   NIFTY  → stock_code="NIFTY",  exchange_code="NSE" (not NFO)
//   SENSEX → stock_code="SENSEX", exchange_code="BSE" (not BFO)

// Mapping from SymbolCode to the Breeze cash-market identifiers
const SPOT_FETCH_CONFIG: Record<string, { stockCode: string; exchangeCode: string }> = {
  NIFTY:  { stockCode: 'NIFTY',  exchangeCode: 'NSE' },
  BSESEN: { stockCode: 'SENSEX', exchangeCode: 'BSE' },
};

export async function fetchSpotPrice(
  backendUrl: string,
  symCode: string,
): Promise<{ ok: boolean; spot?: number; source?: string; error?: string }> {
  const cfg = SPOT_FETCH_CONFIG[symCode] ?? { stockCode: symCode, exchangeCode: 'NSE' };
  const qs  = new URLSearchParams({
    stock_code:    cfg.stockCode,
    exchange_code: cfg.exchangeCode,
  });
  const url = apiUrl(backendUrl, `/api/spot?${qs}`);
  try {
    const data = await fetchJson<{
      success: boolean;
      spot?:   number;
      source?: string;
      error?:  string;
    }>(url, {}, 8_000);   // 8s timeout — spot fetch is quick
    if (data.success && data.spot && data.spot > 0) {
      return { ok: true, spot: data.spot, source: data.source };
    }
    return { ok: false, error: data.error ?? 'No spot data returned' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
