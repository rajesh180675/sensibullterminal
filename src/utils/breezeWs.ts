// ════════════════════════════════════════════════════════════════════════════
// breezeWs.ts — Frontend WebSocket client for BreezeEngine tick streaming
//
// ARCHITECTURE (anti-ban, per spec):
//   REST  → ONE call per expiry change (initial snapshot via /api/optionchain)
//   WS    → ALL live price updates via /ws/ticks (zero REST polling)
//
// FLOW:
//   1. App fetches option chain snapshot → gets list of strikes
//   2. App calls subscribeOptionChain() → backend subscribes to Breeze WS
//   3. App connects to /ws/ticks WebSocket → receives tick deltas
//   4. onTickUpdate callback fires → React state updates → cell flash
//
// NO setInterval polling of REST endpoints.
// NO get_quotes() or get_option_chain_quotes() in any loop.
// ════════════════════════════════════════════════════════════════════════════

export interface TickData {
  stock_code:   string;
  strike:       number;
  right:        'CE' | 'PE';
  ltp:          number;
  oi:           number;
  volume:       number;
  iv:           number;
  bid:          number;
  ask:          number;
  change_pct:   number;
  last_updated: number;
}

export interface TickUpdate {
  type:    'tick_update' | 'heartbeat';
  version: number;
  ticks:   TickData[];
  ts:      number;
  ws_live: boolean;
}

export type TickCallback    = (update: TickUpdate) => void;
export type StatusCallback  = (status: WsStatus)  => void;

export type WsStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

// ── BreezeWsClient ────────────────────────────────────────────────────────────

export class BreezeWsClient {
  private ws:            WebSocket | null  = null;
  private backendUrl:    string            = '';
  private onTick:        TickCallback      = () => {};
  private onStatus:      StatusCallback    = () => {};
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 3000;     // ms — grows on repeated failures
  private maxDelay       = 30_000;   // ms
  private stopped        = false;
  private lastVersion    = -1;

  status: WsStatus = 'disconnected';

  // ── Public API ─────────────────────────────────────────────────────────────

  connect(backendUrl: string, onTick: TickCallback, onStatus: StatusCallback): void {
    this.backendUrl = backendUrl;
    this.onTick     = onTick;
    this.onStatus   = onStatus;
    this.stopped    = false;
    this._connect();
  }

  disconnect(): void {
    this.stopped = true;
    this._clearReconnect();
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this._setStatus('disconnected');
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private _connect(): void {
    if (this.stopped) return;
    this._setStatus('connecting');

    // Convert https:// → wss:// for WebSocket URL
    const base = this.backendUrl
      .replace(/\/api\/?$/, '')   // strip /api suffix
      .replace(/\/$/, '');
    const wsUrl = base
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://') + '/ws/ticks';

    console.log('[BreezeWs] Connecting to:', wsUrl);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[BreezeWs] ✓ Connected');
        this._setStatus('connected');
        this.reconnectDelay = 3000;   // reset backoff
        this.lastVersion = -1;
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as TickUpdate;
          if (msg.type === 'heartbeat') return;
          if (msg.version <= this.lastVersion) return;   // no-op if stale
          this.lastVersion = msg.version;
          this.onTick(msg);
        } catch (e) {
          console.warn('[BreezeWs] Parse error:', e);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[BreezeWs] Error:', err);
        this._setStatus('error');
      };

      this.ws.onclose = (ev) => {
        console.warn(`[BreezeWs] Closed — code=${ev.code} reason=${ev.reason}`);
        this.ws = null;
        if (!this.stopped) {
          this._setStatus('reconnecting');
          this._scheduleReconnect();
        } else {
          this._setStatus('disconnected');
        }
      };

    } catch (err) {
      console.error('[BreezeWs] Failed to create WebSocket:', err);
      this._setStatus('error');
      if (!this.stopped) this._scheduleReconnect();
    }
  }

  private _scheduleReconnect(): void {
    this._clearReconnect();
    console.log(`[BreezeWs] Reconnecting in ${this.reconnectDelay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxDelay);
      this._connect();
    }, this.reconnectDelay);
  }

  private _clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private _setStatus(s: WsStatus): void {
    this.status = s;
    this.onStatus(s);
  }
}

// ── Singleton instance ─────────────────────────────────────────────────────
export const breezeWs = new BreezeWsClient();

// ── subscribeOptionChain — tell backend to subscribe to Breeze WS feeds ────
// Called ONCE after initial REST chain load, per expiry change.
// Anti-ban: subscribes to WS feeds (push-based), NOT REST polling.

export async function subscribeOptionChain(
  backendUrl:    string,
  stockCode:     string,
  exchangeCode:  string,
  expiryDate:    string,
  strikes:       number[],
): Promise<{ ok: boolean; subscribed?: number; error?: string }> {
  const base = backendUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
  const url  = `${base}/api/ws/subscribe`;

  console.log(`[BreezeWs] Subscribing ${strikes.length} strikes for ${stockCode} ${expiryDate}`);

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        stock_code:    stockCode,
        exchange_code: exchangeCode,
        expiry_date:   expiryDate,
        strikes,
        rights: ['Call', 'Put'],
      }),
    });

    const data = await res.json() as {
      success:    boolean;
      subscribed?: number;
      total_subs?: number;
      errors?:    string[];
      error?:     string;
    };

    if (data.success) {
      console.log(`[BreezeWs] ✓ Subscribed ${data.subscribed} feeds (total: ${data.total_subs})`);
      if (data.errors?.length) {
        console.warn('[BreezeWs] Some subscription errors:', data.errors);
      }
      return { ok: true, subscribed: data.subscribed };
    }

    return { ok: false, error: data.error || 'Subscribe failed' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[BreezeWs] Subscribe error:', msg);
    return { ok: false, error: msg };
  }
}

// ── pollTicks — REST fallback when WS not available ────────────────────────
// Used only if the browser can't maintain a WebSocket connection.
// Polls /api/ticks every 2s (far less than REST limit of 100/min).

export function startTickPolling(
  backendUrl: string,
  onTick:     TickCallback,
): () => void {
  let lastVersion = -1;
  let timer: ReturnType<typeof setInterval> | null = null;
  const base = backendUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');

  console.log('[BreezeWs] Starting REST tick polling (WS fallback)...');

  const poll = async () => {
    try {
      const res  = await fetch(`${base}/api/ticks?since_version=${lastVersion}`);
      const data = await res.json() as {
        changed:  boolean;
        version:  number;
        ticks?:   TickData[];
        ws_live?: boolean;
      };

      if (data.changed && data.ticks) {
        lastVersion = data.version;
        onTick({
          type:    'tick_update',
          version: data.version,
          ticks:   data.ticks,
          ts:      Date.now() / 1000,
          ws_live: data.ws_live ?? false,
        });
      }
    } catch { /* silent — network may be briefly unavailable */ }
  };

  timer = setInterval(poll, 2000);   // 2s = 30 calls/min well within limits
  return () => { if (timer) clearInterval(timer); };
}
