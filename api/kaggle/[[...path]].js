// api/kaggle/[[...path]].js
// Robust Vercel proxy for Kaggle backend.
// - requires KAGGLE_BACKEND_URL in Vercel env
// - adds optional X-Terminal-Auth from KAGGLE_TERMINAL_AUTH
// - always returns JSON (either upstream JSON or { ok:false, raw: "..."} )
// - logs errors to Vercel (check Function Logs)

function normalizeBase(url) {
  return (url || '').replace(/\/$/, '');
}

function bodyForMethod(method, body) {
  if (method === 'GET' || method === 'HEAD') return undefined;
  if (!body) return undefined;
  if (typeof body === 'string') return body;
  try { return JSON.stringify(body); } catch { return String(body); }
}

export default async function handler(req, res) {
  const targetBase = normalizeBase(process.env.KAGGLE_BACKEND_URL);

  if (!targetBase) {
    return res.status(500).json({
      ok: false,
      error: 'KAGGLE_BACKEND_URL is not configured on the server.',
    });
  }

  const path = Array.isArray(req.query.path) ? req.query.path.join('/') : (req.query.path || '');
  const qs = req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const targetUrl = `${targetBase}/${path}${qs}`;

  const outboundHeaders = Object.assign({}, req.headers || {});
  delete outboundHeaders.host;
  delete outboundHeaders['content-length'];

  if (process.env.KAGGLE_TERMINAL_AUTH) {
    outboundHeaders['X-Terminal-Auth'] = process.env.KAGGLE_TERMINAL_AUTH;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: outboundHeaders,
      body: bodyForMethod(req.method, req.body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseText = await upstream.text();

    try {
      const json = JSON.parse(responseText);
      return res.status(upstream.status).json(json);
    } catch {
      return res.status(upstream.status).json({
        ok: false,
        upstreamStatus: upstream.status,
        raw: responseText.slice(0, 10_000),
      });
    }
  } catch (error) {
    console.error('[api/kaggle] proxy error', { targetUrl, error });
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      target: targetUrl,
    });
  }
}
