// ================================================================
// ICICI BREEZE API — Browser-Native Client (v5 — with debug mode)
//
// VERIFIED FROM breeze_connect.py SDK SOURCE:
//
//   generate_session(api_secret, session_token):
//     self.secret_key = api_secret
//     body = json.dumps({"SessionToken": session_token, "AppKey": self.api_key})
//     # ↑ Python json.dumps adds spaces: {"key": "val", "key2": "val2"}
//     headers = generate_headers(body)
//     # ↑ checksum = SHA256(timestamp + body + secret_key)
//     # ↑ X-SessionToken = self.session_key (EMPTY on first call)
//     response = requests.get(url + "/customerdetails", headers=headers)
//     # ↑ GET with NO body. NO query params. ONLY headers.
//     self.session_key = response["Success"]["session_token"]
//
// BROWSER CONSTRAINTS:
//   1. GET body → Fetch throws "Request with GET/HEAD method cannot have body"
//   2. Python json.dumps spaces → must replicate with pyDumps()
//   3. CORS → must proxy through cors-anywhere or similar
//
// This version adds a DEBUG mode that logs the exact request construction
// so users can compare with what the Python SDK would produce.
// ================================================================

import { BreezeSession } from '../types/index';

export const BREEZE_BASE = 'https://api.icicidirect.com/breezeapi/api/v1';

// ── pyDumps — match Python's json.dumps() output EXACTLY ─────────
// Python: json.dumps({"SessionToken": "abc", "AppKey": "def"})
//   → '{"SessionToken": "abc", "AppKey": "def"}'
//   Separators: ", " between pairs, ": " between key/value
//
// JavaScript: JSON.stringify({SessionToken: "abc", AppKey: "def"})
//   → '{"SessionToken":"abc","AppKey":"def"}'
//   NO spaces → different SHA-256 hash!
//
// pyDumps replicates Python's exact output.
export function pyDumps(obj: Record<string, string>): string {
  const pairs = Object.entries(obj)
    .map(([k, v]) => {
      // Escape backslashes and quotes in values (matching Python json.dumps)
      const escaped = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `"${k}": "${escaped}"`;
    })
    .join(', ');
  return `{${pairs}}`;
}

// Compact JSON (JS default). Some ICICI gateways appear to validate checksums
// against this form (no spaces) even though the Python SDK uses json.dumps.
// We support both and auto-detect the working variant during /customerdetails.
export function compactJson(obj: Record<string, string>): string {
  // preserve insertion order exactly
  const pairs = Object.entries(obj)
    .map(([k, v]) => {
      const escaped = v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `"${k}":"${escaped}"`;
    })
    .join(',');
  return `{${pairs}}`;
}

// ── UTC timestamp matching SDK format exactly ─────────────────────
// SDK: datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
export function breezeTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

// ── SHA-256 checksum via Web Crypto API ───────────────────────────
// SDK formula: sha256((timestamp + body_str + secret_key).encode("utf-8")).hexdigest()
// This is a plain SHA-256 digest — NOT HMAC.
export async function generateChecksum(
  timestamp: string,
  bodyStr:   string,
  secretKey: string,
): Promise<string> {
  const message    = timestamp + bodyStr + secretKey;
  const encoded    = new TextEncoder().encode(message);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Extract ?apisession= from URL ─────────────────────────────────
export function extractApiSession(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('apisession');
  if (token) {
    const clean = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, clean);
  }
  return token;
}

// ── Build proxy URL ────────────────────────────────────────────────
function appendQuery(targetUrl: string, query?: Record<string, string>): string {
  if (!query || Object.keys(query).length === 0) return targetUrl;
  const qs = new URLSearchParams(query).toString();
  return targetUrl.includes('?') ? `${targetUrl}&${qs}` : `${targetUrl}?${qs}`;
}

// Build the final request URL.
// NOTE: For some ICICI endpoints, the server-side "request object" is built from
// query/body, not just headers. In a browser, we cannot send GET bodies, so we
// optionally also include the same payload as query params.
export function buildUrl(proxyBase: string, endpoint: string, query?: Record<string, string>): string {
  const fullTarget = appendQuery(`${BREEZE_BASE}/${endpoint}`, query);

  if (!proxyBase || proxyBase.startsWith('/')) {
    const base = (proxyBase || '/api/breeze').replace(/\/$/, '');
    return appendQuery(`${base}/${endpoint}`, query);
  }

  if (proxyBase.includes('allorigins')) {
    const cleanBase = proxyBase.split('?')[0].replace(/\/$/, '');
    return `${cleanBase}?url=${encodeURIComponent(fullTarget)}`;
  }

  // cors-anywhere: keep full https:// in the appended URL
  const base = proxyBase.replace(/\/$/, '');
  return `${base}/${fullTarget}`;
}

// ── Shared types ───────────────────────────────────────────────────
export interface BreezeApiResponse<T = unknown> {
  Status:  number;
  Error:   string | null;
  Success: T;
}

// ── Debug info that can be shown to the user ───────────────────────
export interface DebugInfo {
  method:       string;
  url:          string;
  headers:      Record<string, string>;
  bodyStr:      string;    // pyDumps output used for checksum
  checksumInput: string;   // timestamp + bodyStr + "***" (secret masked)
  checksum:     string;
  timestamp:    string;
  httpStatus?:  number;
  responseBody?: string;
}

// ── Safe response body reader ──────────────────────────────────────
async function readBody(res: Response): Promise<string> {
  try { return await res.text(); } catch { return '(unreadable)'; }
}

// ── breezeGET with debug ──────────────────────────────────────────
async function breezeGET<T = unknown>(
  proxyBase:    string,
  endpoint:     string,
  apiKey:       string,
  apiSecret:    string,
  sessionToken: string,
  payloadDict:  Record<string, string>,
  debug?:       { capture: (d: DebugInfo) => void },
  urlQuery?:    Record<string, string>,
  bodyStrOverride?: string,
): Promise<BreezeApiResponse<T>> {
  const bodyStr = bodyStrOverride ?? pyDumps(payloadDict);
  const url     = buildUrl(proxyBase, endpoint, urlQuery);
  const ts      = breezeTimestamp();
  const checksum = await generateChecksum(ts, bodyStr, apiSecret);

  const headers: Record<string, string> = {
    'Content-Type':   'application/json',
    'X-Checksum':     `token ${checksum}`,
    'X-Timestamp':    ts,
    'X-AppKey':       apiKey,
    'X-SessionToken': sessionToken,
  };

  // Capture debug info if requested
  if (debug?.capture) {
    debug.capture({
      method: 'GET',
      url,
      headers: { ...headers },
      bodyStr,
      checksumInput: `${ts}${bodyStr}${'*'.repeat(Math.min(apiSecret.length, 8))}...`,
      checksum,
      timestamp: ts,
    });
  }

  // Console log for debugging (always)
  console.group(`[Breeze] GET /${endpoint}`);
  console.log('URL:', url);
  console.log('Timestamp:', ts);
  console.log('pyDumps body (for checksum):', bodyStr);
  console.log('Checksum:', checksum.slice(0, 16) + '...');
  console.log('X-SessionToken:', sessionToken ? `"${sessionToken.slice(0, 8)}..."` : '""(empty)');
  console.log('Headers:', headers);
  console.groupEnd();

  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Network/CORS error calling ${url}: ${msg}. ` +
      (proxyBase.includes('cors-anywhere')
        ? 'Unlock cors-anywhere first: open cors-anywhere.herokuapp.com/corsdemo → click "Request temporary access".'
        : 'Check proxy URL.')
    );
  }

  const responseText = await readBody(res);

  if (debug?.capture) {
    debug.capture({
      method: 'GET',
      url,
      headers,
      bodyStr,
      checksumInput: `${ts}${bodyStr}***`,
      checksum,
      timestamp: ts,
      httpStatus: res.status,
      responseBody: responseText.slice(0, 500),
    });
  }

  console.log(`[Breeze] Response HTTP ${res.status}:`, responseText.slice(0, 200));

  // Parse response
  let json: BreezeApiResponse<T>;
  try {
    json = JSON.parse(responseText) as BreezeApiResponse<T>;
  } catch {
    throw new Error(`Non-JSON from ${endpoint} (HTTP ${res.status}): ${responseText.slice(0, 300)}`);
  }

  return json;
}

// ── breezePOST ────────────────────────────────────────────────────
async function breezePOST<T = unknown>(
  proxyBase:    string,
  endpoint:     string,
  apiKey:       string,
  apiSecret:    string,
  sessionToken: string,
  payloadDict:  Record<string, string>,
): Promise<BreezeApiResponse<T>> {
  const bodyStr = pyDumps(payloadDict);
  // POST endpoints use a real request body, so we don't add query params here.
  const url     = buildUrl(proxyBase, endpoint);
  const ts      = breezeTimestamp();
  const checksum = await generateChecksum(ts, bodyStr, apiSecret);

  const headers: Record<string, string> = {
    'Content-Type':   'application/json',
    'X-Checksum':     `token ${checksum}`,
    'X-Timestamp':    ts,
    'X-AppKey':       apiKey,
    'X-SessionToken': sessionToken,
  };

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: bodyStr });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Network/CORS error calling POST ${url}: ${msg}.`);
  }

  const responseText = await readBody(res);
  let json: BreezeApiResponse<T>;
  try {
    json = JSON.parse(responseText) as BreezeApiResponse<T>;
  } catch {
    throw new Error(`Non-JSON from ${endpoint} (HTTP ${res.status}): ${responseText.slice(0, 300)}`);
  }
  return json;
}


// ================================================================
// validateSession — /customerdetails
//
// Returns debug info so the user can see EXACTLY what was sent.
// ================================================================
export interface ValidateResult {
  ok:           boolean;
  reason:       string;
  sessionToken?: string;
  debug?:       DebugInfo;
}

export async function validateSession(
  session: BreezeSession,
): Promise<ValidateResult> {

  // The Breeze login redirect returns an "apisession" token.
  // We must exchange it for the day-valid "session_token".
  //
  // Problem in browser-only environments:
  // Different ICICI deployments accept different ways of sending this apisession:
  //   A) SDK-style: GET with headers only, X-SessionToken empty
  //   B) Variant:   GET with headers only, X-SessionToken = apisession
  //   C) Gateway:   requires query params to build a "request object" (no GET body possible)
  //
  // We implement a deterministic retry sequence and return debug info for the last attempt.

  const payloadDict: Record<string, string> = {
    SessionToken: session.sessionToken,
    AppKey:       session.apiKey,
  };

  let debugInfo: DebugInfo | undefined;

  const attempts: Array<{ name: string; xSessionToken: string; query?: Record<string, string>; bodyStr?: string }> = [
    // --- Python SDK-style checksum body (spaced json.dumps) ---
    { name: 'SDK pyDumps headers-only (X-SessionToken empty)', xSessionToken: '', bodyStr: pyDumps(payloadDict) },
    { name: 'SDK pyDumps headers-only (X-SessionToken = apisession)', xSessionToken: session.sessionToken, bodyStr: pyDumps(payloadDict) },
    { name: 'SDK pyDumps query+headers (X-SessionToken empty)', xSessionToken: '', query: payloadDict, bodyStr: pyDumps(payloadDict) },
    { name: 'SDK pyDumps query+headers (X-SessionToken = apisession)', xSessionToken: session.sessionToken, query: payloadDict, bodyStr: pyDumps(payloadDict) },

    // --- Compact JSON checksum body (no spaces) ---
    // Some ICICI environments appear to validate against compact JSON.
    { name: 'Compact headers-only (X-SessionToken empty)', xSessionToken: '', bodyStr: compactJson(payloadDict) },
    { name: 'Compact headers-only (X-SessionToken = apisession)', xSessionToken: session.sessionToken, bodyStr: compactJson(payloadDict) },
    { name: 'Compact query+headers (X-SessionToken empty)', xSessionToken: '', query: payloadDict, bodyStr: compactJson(payloadDict) },
    { name: 'Compact query+headers (X-SessionToken = apisession)', xSessionToken: session.sessionToken, query: payloadDict, bodyStr: compactJson(payloadDict) },
  ];

  let lastErr: unknown = null;
  let json: BreezeApiResponse<{ session_token?: string; email?: string } | null> | null = null;

  for (const a of attempts) {
    try {
      json = await breezeGET<{ session_token?: string; email?: string } | null>(
        session.proxyBase,
        'customerdetails',
        session.apiKey,
        session.apiSecret,
        a.xSessionToken,
        payloadDict,
        {
          capture: (d) => {
            const attempted = `[Attempt] ${a.name}`;
            debugInfo = {
              ...d,
              responseBody: d.responseBody ? `${d.responseBody}\n\n${attempted}` : attempted,
            };
          },
        },
        a.query,
        a.bodyStr,
      );

      // If ICICI returns Status 200 with Success.session_token we are done.
      if (json.Status === 200 && json.Success && json.Success.session_token) break;

      // If ICICI itself returns Status 500, try next attempt (proxy/gateway variance)
      if (json.Status === 500) continue;

      // For 401/403, no point retrying with other variants
      if (json.Status === 401 || json.Status === 403) break;

    } catch (err) {
      lastErr = err;
      // Network error — no point retrying variants
      break;
    }
  }

  if (lastErr) {
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    return { ...classifyNetworkError(msg, session.proxyBase), debug: debugInfo };
  }

  if (!json) {
    return { ok: false, reason: 'No response from ICICI.', debug: debugInfo };
  }

  // Success case
  if (json.Status === 200 && json.Success && json.Success.session_token) {
    return {
      ok: true,
      reason: `Session validated — ICICI Status 200. Email: ${json.Success.email ?? 'N/A'}`,
      sessionToken: json.Success.session_token,
      debug: debugInfo,
    };
  }

  const errMsg = json.Error ?? `Status ${json.Status}`;

  // Classify ICICI-level errors
  if (json.Status === 200 && (!json.Success || !json.Success?.session_token)) {
    return {
      ok: false,
      reason: `ICICI returned Status 200 but no session_token in Success. Response: ${JSON.stringify(json).slice(0, 300)}`,
      debug: debugInfo,
    };
  }
  if (json.Status === 401 || errMsg.toLowerCase().includes('unauthorized')) {
    return {
      ok: false,
      reason: `Token rejected (${errMsg}). Session token expires midnight IST — get fresh ?apisession= today.`,
      debug: debugInfo,
    };
  }
  if (json.Status === 403) {
    return {
      ok: false,
      reason: `Access forbidden (${errMsg}). Verify API Key matches ICICI developer portal.`,
      debug: debugInfo,
    };
  }
  if (json.Status === 500) {
    return {
      ok: false,
      reason:
        `ICICI returned Status 500 (Request Object is Null / server could not construct request). ` +
        `The app already retried multiple wire-format variants (headers-only and query+headers). ` +
        `If it still fails, 99% of cases are: stale token (not today's), API key mismatch, API secret mismatch, or proxy stripping headers.`,
      debug: debugInfo,
    };
  }

  return {
    ok: false,
    reason: `Unexpected response — Status ${json.Status}, Error: ${errMsg}`,
    debug: debugInfo,
  };
}

// ── Network/CORS error classifier ─────────────────────────────────
function classifyNetworkError(
  msg:       string,
  proxyBase: string,
): { ok: false; reason: string } {
  const m = msg.toLowerCase();
  const isCorsAnywhere = proxyBase.includes('cors-anywhere');

  if (m.includes('failed to fetch') || m.includes('networkerror') ||
      m.includes('cors') || m.includes('network')) {
    return {
      ok: false,
      reason:
        `Network/CORS error: ${msg}. ` +
        (isCorsAnywhere
          ? 'Ensure you unlocked cors-anywhere at cors-anywhere.herokuapp.com/corsdemo first.'
          : 'Check your proxy URL is correct and reachable.'),
    };
  }
  return { ok: false, reason: msg };
}

// ── fetchOptionChain ───────────────────────────────────────────────
export interface BreezeQuote {
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

export async function fetchOptionChain(
  session:      BreezeSession,
  stockCode:    string,
  exchangeCode: string,
  expiryDate:   string,
  right:        'Call' | 'Put',
): Promise<BreezeQuote[]> {
  const payloadDict: Record<string, string> = {
    stock_code:    stockCode,
    exchange_code: exchangeCode,
    product_type:  'options',
    expiry_date:   expiryDate,
    right,
    strike_price:  '',
  };

  const res = await breezeGET<BreezeQuote[]>(
    session.proxyBase,
    'optionchain',
    session.apiKey,
    session.apiSecret,
    session.sessionToken,
    payloadDict,
    undefined,
    payloadDict, // include as query params for browser/proxy compatibility
  );

  return res.Status === 200 && Array.isArray(res.Success) ? res.Success : [];
}

// ── placeLegOrder ──────────────────────────────────────────────────
export interface OrderParams {
  stockCode:    string;
  exchangeCode: string;
  right:        'call' | 'put';
  strikePrice:  string;
  expiryDate:   string;
  action:       'buy' | 'sell';
  quantity:     string;
  price:        string;
  orderType:    'market' | 'limit';
}

export interface OrderResult {
  order_id: string;
  status:   string;
}

export async function placeLegOrder(
  session: BreezeSession,
  params:  OrderParams,
): Promise<OrderResult> {
  const payloadDict: Record<string, string> = {
    stock_code:         params.stockCode,
    exchange_code:      params.exchangeCode,
    product:            'options',
    action:             params.action,
    order_type:         params.orderType,
    stoploss:           '0',
    quantity:           params.quantity,
    price:              params.price,
    validity:           'day',
    validity_date:      params.expiryDate,
    disclosed_quantity: '0',
    expiry_date:        params.expiryDate,
    right:              params.right,
    strike_price:       params.strikePrice,
    user_remark:        'OptionsTerminal',
  };

  const res = await breezePOST<OrderResult>(
    session.proxyBase,
    'order',
    session.apiKey,
    session.apiSecret,
    session.sessionToken,
    payloadDict,
  );

  if (res.Status !== 200 && res.Status !== 201) {
    throw new Error(`Order failed (${res.Status}): ${res.Error ?? 'Unknown error'}`);
  }
  return res.Success;
}


// NOTE: Python/Kaggle backend support is implemented in src/utils/kaggleClient.ts.
// We intentionally do NOT keep any helper here that puts API secrets in URLs.
