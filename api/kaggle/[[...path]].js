// ════════════════════════════════════════════════════════════════════════════
// Vercel Serverless Proxy — /api/kaggle/[[...path]]
//
// FIXED BUGS:
//  1. Adds 'bypass-tunnel-reminder: true' for Cloudflare tunnel targets
//     (browser-side isCfUrl check can't work because browser only sees
//      /api/kaggle/... URLs, not the real CF URL behind the proxy)
//  2. Detects upstream HTML (CF interstitial) and returns a clean JSON error
//     instead of forwarding raw HTML to the browser
//  3. Explicit body reading as fallback for all Vercel runtime variants
//  4. Better upstream error messages (timeout, unreachable, CF blocked)
// ════════════════════════════════════════════════════════════════════════════

const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

function normalizeBase(url) {
  return (url || '').replace(/\/$/, '');
}

function joinUrl(base, path, query) {
  const safePath = path && path.length > 0 ? `/${path.join('/')}` : '';
  const qs = query?.toString();
  return `${base}${safePath}${qs ? `?${qs}` : ''}`;
}

function bodyForMethod(method, body) {
  if (method === 'GET' || method === 'HEAD') return undefined;
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body;
  return JSON.stringify(body);
}

/**
 * Reads request body. Vercel auto-parses JSON into req.body (object),
 * so we re-serialize it to forward correct JSON bytes downstream.
 */
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body;
    if (Buffer.isBuffer(req.body)) return req.body;
    return JSON.stringify(req.body);
  }
  // Fallback: stream read (Edge runtime / unparsed bodies)
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk =>
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    );
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8') || undefined));
    req.on('error', reject);
  });
}

// FIX #1: Server-side CF detection — browser-side isCfUrl can't work
// because the browser only sees /api/kaggle/... not the real target URL.
function isCfTarget(targetBase) {
  return (targetBase || '').toLowerCase().includes('trycloudflare.com');
}

// FIX #2: Detect CF/HTML interstitial in upstream response body
function isCfInterstitial(text) {
  const t = text.trim().toLowerCase();
  return (
    t.startsWith('<!') || t.startsWith('<html') ||
    t.includes('just a moment') || t.includes('cf-browser-verification') ||
    t.includes('cloudflare') || t.includes('challenge-platform')
  );
}

export default async function handler(req, res) {
  // Always allow CORS preflight (OPTIONS) from the browser
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', '*');
    return res.status(200).end();
  }

  const targetBase = normalizeBase(process.env.KAGGLE_BACKEND_URL);

  if (!targetBase) {
    return res.status(500).json({
      ok: false, success: false,
      error:
        'KAGGLE_BACKEND_URL is not set in Vercel environment variables.\n' +
        'Vercel Dashboard → Your Project → Settings → Environment Variables\n' +
        'Add: KAGGLE_BACKEND_URL = https://your-tunnel.trycloudflare.com',
    });
  }

  // Build target URL from catch-all path segments
  const path = Array.isArray(req.query.path) ? req.query.path : [];
  const query = new URLSearchParams();
  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (key === 'path') return;
    if (Array.isArray(value)) value.forEach(v => query.append(key, String(v)));
    else if (value != null) query.set(key, String(value));
  });
  const targetUrl = joinUrl(targetBase, path, query);

  // Build outbound headers (strip hop-by-hop)
  const outboundHeaders = {};
  Object.entries(req.headers || {}).forEach(([key, value]) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) return;
    if (value == null) return;
    outboundHeaders[key] = Array.isArray(value) ? value.join(',') : String(value);
  });

  // ── FIX #1: Inject CF bypass header when target is a Cloudflare tunnel ──────
  // The browser calls /api/kaggle/... so it never sees the real CF URL.
  // The proxy KNOWS the real target and must add the bypass header itself.
  if (isCfTarget(targetBase)) {
    outboundHeaders['bypass-tunnel-reminder'] = 'true';
  }

  // Optional terminal auth
  if (process.env.KAGGLE_TERMINAL_AUTH) {
    outboundHeaders['X-Terminal-Auth'] = process.env.KAGGLE_TERMINAL_AUTH;
  }

  // Read body (handles auto-parsed and raw stream cases)
  let requestBody;
  try { requestBody = await readBody(req); }
  catch { requestBody = undefined; }

  // Forward request with timeout
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 28_000);

    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        method: req.method,
        headers: outboundHeaders,
        body: bodyForMethod(req.method, requestBody),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const responseText = await upstream.text();

    // ── FIX #2: Detect CF interstitial in response — return clean JSON ──────
    if (isCfInterstitial(responseText)) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(503).json({
        ok: false, success: false,
        error:
          `Cloudflare interstitial blocked the request.\n\n` +
          `FIX: Open this in a NEW browser tab:\n  ${targetBase}/health\n\n` +
          `Wait until you see {"status":"online"}, then retry here.\n` +
          `(This unlocks the tunnel for ~30 minutes)`,
        cf_interstitial: true,
        target: targetBase,
      });
    }

    // Forward upstream response headers (strip hop-by-hop, content-encoding)
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP_HEADERS.has(lower)) return;
      if (lower === 'content-encoding') return;
      res.setHeader(key, value);
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', '*');

    return res.status(upstream.status).send(responseText);

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    let friendlyError = msg;
    if (msg.includes('abort') || msg.toLowerCase().includes('timeout')) {
      friendlyError =
        `Request timed out (28s). Kaggle cell may have stopped.\n` +
        `Check: ${targetBase}/health in a browser tab.`;
    } else if (
      msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') ||
      msg.includes('ECONNRESET') || msg.includes('network')
    ) {
      friendlyError =
        `Cannot reach backend at: ${targetBase}\n\n` +
        `Possible causes:\n` +
        `• Kaggle cell stopped — re-run it\n` +
        `• Tunnel URL changed — copy new URL from Kaggle output\n` +
        `• Internet not enabled in Kaggle Settings`;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(502).json({
      ok: false, success: false,
      error: friendlyError,
      target: targetUrl,
    });
  }
}
