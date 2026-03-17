export interface ApiRequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  authToken?: string;
  body?: BodyInit | Record<string, unknown> | null;
  headers?: HeadersInit;
}

function buildHeaders(body: ApiRequestOptions['body'], authToken?: string, headers?: HeadersInit) {
  const nextHeaders = new Headers(headers);
  if (authToken) {
    nextHeaders.set('Authorization', `Bearer ${authToken}`);
  }
  if (body && !(body instanceof FormData) && !nextHeaders.has('Content-Type')) {
    nextHeaders.set('Content-Type', 'application/json');
  }
  return nextHeaders;
}

function normalizeBody(body: ApiRequestOptions['body']) {
  if (!body || body instanceof FormData || typeof body === 'string') {
    return body ?? undefined;
  }
  return JSON.stringify(body);
}

export async function apiRequest<TResponse>(input: string, options: ApiRequestOptions = {}): Promise<TResponse> {
  const response = await fetch(input, {
    ...options,
    headers: buildHeaders(options.body, options.authToken, options.headers),
    body: normalizeBody(options.body),
  });

  if (!response.ok) {
    throw new Error(`API request failed with ${response.status}`);
  }

  return response.json() as Promise<TResponse>;
}
