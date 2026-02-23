// ════════════════════════════════════════════════════════════════════════════
// Kaggle / Python Backend Client v5
// Covers ALL BreezeEngine v6 endpoints including:
//   square-off, cancel order, modify order, order book, trade book,
//   funds, historical data, single quote
// ════════════════════════════════════════════════════════════════════════════

let TERMINAL_AUTH_TOKEN: string | undefined;

/**
 * Sets the shared-secret used to authenticate to the Python backend.
 * The backend enforces this via `X-Terminal-Auth` header on all `/api/*` routes.
 */
export function setTerminalAuthToken(token?: string): void {
  TERMINAL_AUTH_TOKEN = token?.trim() || undefined;
}

function getBase(rawUrl: string): string {
  return rawUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
}
function apiUrl(rawUrl: string, path: string): string {
  return `${getBase(rawUrl)}${path.startsWith('/') ? path : '/' + path}`;
}

export function isKaggleBackend(proxyBase: string): boolean {
  if (!proxyBase) return false;
  const lower = proxyBase.toLowerCase().trim();
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
  if (isCfUrl(url)) headers['bypass-tunnel-reminder'] = 'true';

  try {
    const res  = await fetch(url, { ...options, headers, signal: controller.signal, mode: 'cors' });
    const text = await res.text();
    const trim = text.trim();

    // Detect Cloudflare HTML interstitial
    if (trim.startsWith('<!') || trim.startsWith('<html') ||
        trim.includes('Just a moment') || trim.includes('cloudflare') ||
        trim.includes('cf-browser-verification')) {
      const cfBase = getBase(url);
      throw new Error(
        `Cloudflare interstitial detected.\n\n` +
        `FIX: Open in a NEW browser tab: ${cfBase}/health\n` +
        `Wait for JSON {"status":"online"}, then retry.`
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

// ── Health check ──────────────────────────────────────────────────────────────

export async function checkBackendHealth(backendUrl: string): Promise<HealthResult> {
  for (const endpoint of ['/health', '/ping', '/']) {
    const url = apiUrl(backendUrl, endpoint);
    try {
      const data = await fetchJson<{
        status?: string; connected?: boolean; ws_running?: boolean;
        rest_calls_min?: number; queue_depth?: number; version?: string;
      }>(url, { method: 'GET' }, 15_000);
      return {
        ok: true, connected: data.connected === true,
        wsRunning: data.ws_running, restCallsMin: data.rest_calls_min,
        queueDepth: data.queue_depth,
        message: `Backend v${data.version ?? '?'} online — Breeze: ${data.connected}`,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Cloudflare') || msg.includes('timed out')) {
        return { ok: false, connected: false, message: msg };
      }
    }
  }
  return { ok: false, connected: false, message: 'Cannot reach backend — check Kaggle cell is running' };
}

// ── Connect ───────────────────────────────────────────────────────────────────

export async function connectToBreeze(params: {
  apiKey: string; apiSecret: string; sessionToken: string; backendUrl: string;
}): Promise<ConnectResult> {
  const { apiKey, apiSecret, sessionToken, backendUrl } = params;

  const health = await checkBackendHealth(backendUrl);
  if (!health.ok) return { ok: false, reason: `Cannot reach backend.\n\n${health.message}` };

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
  const url = apiUrl(backendUrl, '/api/order');
  try {
    const data = await fetchJson<{ success: boolean; order_id?: string; orderId?: string; error?: string }>(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stock_code: params.stockCode, exchange_code: params.exchangeCode,
        product: params.product || 'options', action: params.action.toLowerCase(),
        order_type: params.orderType || 'market', quantity: params.quantity,
        price: params.price || '0', validity: params.validity || 'day',
        stoploss: params.stoploss || '0', expiry_date: params.expiryDate,
        right: params.right, strike_price: params.strikePrice,
      }),
    });
    return data.success
      ? { ok: true, orderId: data.order_id || data.orderId }
      : { ok: false, error: data.error || 'Order failed' };
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
