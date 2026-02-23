const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

function normalizeBase(url) {
  return (url || '').replace(/\/$/, '');
}

function joinUrl(base, path, query) {
  const safePath = path ? `/${path.join('/')}` : '';
  const qs = query?.toString();
  return `${base}${safePath}${qs ? `?${qs}` : ''}`;
}

function bodyForMethod(method, body) {
  if (method === 'GET' || method === 'HEAD') return undefined;
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

export default async function handler(req, res) {
  const targetBase = normalizeBase(process.env.KAGGLE_BACKEND_URL);

  if (!targetBase) {
    return res.status(500).json({
      ok: false,
      error: 'KAGGLE_BACKEND_URL is not configured on the server.',
    });
  }

  const path = Array.isArray(req.query.path) ? req.query.path : [];
  const query = new URLSearchParams();
  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (key === 'path') return;
    if (Array.isArray(value)) value.forEach(v => query.append(key, String(v)));
    else if (value != null) query.set(key, String(value));
  });

  const targetUrl = joinUrl(targetBase, path, query);

  const outboundHeaders = {};
  Object.entries(req.headers || {}).forEach(([key, value]) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) return;
    if (value == null) return;
    outboundHeaders[key] = Array.isArray(value) ? value.join(',') : String(value);
  });

  if (process.env.KAGGLE_TERMINAL_AUTH) {
    outboundHeaders['X-Terminal-Auth'] = process.env.KAGGLE_TERMINAL_AUTH;
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: outboundHeaders,
      body: bodyForMethod(req.method, req.body),
    });

    const responseText = await upstream.text();

    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (HOP_BY_HOP_HEADERS.has(lower)) return;
      res.setHeader(key, value);
    });

    return res.status(upstream.status).send(responseText);
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      target: targetUrl,
    });
  }
}
