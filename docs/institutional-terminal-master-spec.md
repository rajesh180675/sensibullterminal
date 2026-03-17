
# SENSIBULL TERMINAL: DEFINITIVE SPECIFICATION

---

## PART I — FOUNDATIONS

---

### 1. What This System Is

This is a professional options-selling terminal for Indian index and liquid stock derivatives. It is not a portfolio tracker, a charting app, or a broker marketing wrapper. It is a workstation where a trader detects opportunity, constructs strategy, previews risk, executes safely, monitors positions, defends against adverse moves, automates recurring decisions, and reviews outcomes.

The terminal connects to the ICICI Breeze API for broker services. It runs as a React single-page application backed by a Python FastAPI server. The deployment target is Vercel (frontend) + a persistent backend (currently Kaggle notebook via Cloudflare tunnel, migrating to a proper server).

### 2. What Exists Today

The codebase has gone through two evolutionary stages.

**Stage 1 (v12)** produced a working three-tab terminal: option chain, strategy builder, positions panel. All state lived in `App.tsx`. All backend logic lived in `kaggle_backend.py`. The option chain was the strongest component — modular, accessible, performant, with flash animations, OI signals, max pain, and keyboard navigation. The strategy builder handled eight templates, payoff diagrams, and multi-leg execution. The positions panel had six sub-tabs with order book, trade book, funds, and a three-step square-off wizard.

**Stage 2 (current)** refactored into domain stores (session, market, execution, portfolio, risk, seller intelligence, journal, adjustment, automation), a custom workspace router with nine routes, a shell with navigation and command palette, and a backend that added depth, candles, margin preview, automation persistence, and review tracking.

The refactoring was structural. It created the right organizational containers but did not fundamentally change the underlying data transformations, their correctness properties, or their failure modes. The domain stores wrap the same primitives. The streaming pipeline has the same spot derivation cascade. The execution path has the same non-atomic multi-leg problem.

### 3. Governing Principles

These principles are not aspirational. They are constraints that every design decision in this spec must satisfy.

**Principle 1: Computation Provenance.** Every number displayed to the trader must declare its source and freshness. Broker-confirmed values (filled price, position quantity, funds balance), backend-computed values (normalized chain, aggregated risk), and analytical projections (payoff scenarios, adjustment rankings) must be visually distinguishable. A trader must never mistake a projection for a fact.

**Principle 2: State Consistency.** If the chain shows NIFTY 24500 CE at ₹145.20, the strategy builder must show the same price for the same instrument at the same moment. There must be one canonical price for each instrument at any point in time, and every surface that displays that instrument must derive from that canonical price.

**Principle 3: Execution Safety.** The system must never create a position state that the trader did not intend and cannot observe. Partial fills, orphaned legs, failed cancellations, and session expiry during execution must be detected, surfaced, and resolved. The default response to ambiguity is to stop and ask the trader, not to proceed silently.

**Principle 4: Failure Explicitness.** Every failure mode must be visible. Silent fallback is prohibited. If the WebSocket disconnects and polling starts, the trader sees it. If a staleness threshold is exceeded, the affected data dims. If a computation uses approximate Greeks instead of proper Black-Scholes, the column header says so. If rate limits are approaching, a warning appears before they are hit.

**Principle 5: Minimal Surface, Maximum Depth.** The terminal ships with the fewest workspaces that cover the seller's operational loop. Each workspace must be industrially complete — not a dashboard of cards, but a dense, interactive, keyboard-navigable operating surface. A workspace that exists but is shallow is worse than a workspace that doesn't exist yet.

---

## PART II — DATA ARCHITECTURE

---

### 4. Canonical Data Model

Every entity in the system belongs to exactly one of these categories.

#### 4.1 Instrument Reference Data

```typescript
interface Instrument {
  symbol: SymbolCode;            // 'NIFTY' | 'BSESEN'
  exchange: ExchangeCode;        // 'NFO' | 'BFO'
  strikeStep: number;            // 50 | 100
  lotSize: number;               // 75 | 20
  expiryDay: 'Tuesday' | 'Thursday';
}

interface OptionContract {
  instrument: SymbolCode;
  exchange: ExchangeCode;
  expiry: string;                // 'DD-MMM-YYYY'
  strike: number;
  right: 'CE' | 'PE';
}

// Two contracts are the same if and only if all five fields match.
// This is the canonical identity for any option instrument in the system.
function contractKey(c: OptionContract): string {
  return `${c.instrument}:${c.exchange}:${c.expiry}:${c.strike}:${c.right}`;
}
```

#### 4.2 Market Data

```typescript
interface SpotSnapshot {
  symbol: SymbolCode;
  price: number;
  source: 'breeze_ws' | 'breeze_rest' | 'put_call_parity';
  timestamp: number;              // Unix ms
}

interface QuoteSnapshot {
  contract: OptionContract;
  ltp: number;
  bid: number;
  ask: number;
  oi: number;
  oiChange: number;              // absolute change, not percentage
  volume: number;
  iv: number;                    // annualized implied volatility, decimal (0.14 = 14%)
  timestamp: number;
}

interface ChainSnapshot {
  instrument: SymbolCode;
  expiry: string;
  spot: SpotSnapshot;
  quotes: Map<string, QuoteSnapshot>;  // keyed by contractKey
  computedAt: number;
  source: 'breeze_rest' | 'breeze_ws_accumulated';
}

interface Greeks {
  delta: number;
  gamma: number;
  theta: number;                 // per day
  vega: number;                  // per 1% IV change
}
```

#### 4.3 Strategy Data

```typescript
interface StrategyLeg {
  id: string;                    // client-generated UUID
  contract: OptionContract;
  action: 'BUY' | 'SELL';
  lots: number;
  orderType: 'market' | 'limit';
  limitPrice?: number;
}

// A StrategyDraft has no prices — it is pure intent.
// Prices are looked up from the chain at display time.
interface StrategyDraft {
  id: string;
  name?: string;
  templateSource?: string;       // 'iron_condor', 'manual', etc.
  legs: StrategyLeg[];
  createdAt: number;
}

// A StrategyInstance is a persisted record of an executed strategy.
// It is created by the backend when execution begins.
interface StrategyInstance {
  id: string;
  draft: StrategyDraft;
  executionId: string;
  status: 'executing' | 'partial' | 'filled' | 'failed';
  legs: ExecutedLeg[];
  createdAt: number;
  updatedAt: number;
}

interface ExecutedLeg {
  legId: string;
  contract: OptionContract;
  action: 'BUY' | 'SELL';
  intendedLots: number;
  filledLots: number;
  averagePrice: number;
  orderId?: string;
  status: 'pending' | 'sent' | 'filled' | 'partial' | 'rejected' | 'failed';
  error?: string;
  timestamp: number;
}
```

#### 4.4 Position Data

```typescript
interface LivePosition {
  contract: OptionContract;
  action: 'BUY' | 'SELL';       // original action
  quantity: number;              // signed: positive = long, negative = short
  lots: number;
  averagePrice: number;
  ltp: number;
  pnl: number;                  // broker-reported if available, else computed
  strategyInstanceId?: string;   // link to originating strategy
  source: 'broker';             // always broker-confirmed
  timestamp: number;
}

// GroupedStrategy is a backend-persistent model.
// It groups positions that belong to the same logical strategy.
interface GroupedStrategy {
  id: string;
  name: string;
  positions: LivePosition[];
  netDelta: number;
  netGamma: number;
  netTheta: number;
  netVega: number;
  totalPnl: number;
  marginUsed: number;
  status: 'active' | 'partially_closed' | 'closed';
  strategyInstanceId: string;
}
```

#### 4.5 Execution Records

```typescript
interface ExecutionSession {
  id: string;
  strategyDraftId: string;
  legs: ExecutionLegRecord[];
  status: 'created' | 'executing' | 'completed' | 'partial' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  orphanDetected: boolean;
  orphanResolution?: 'pending' | 'reversed' | 'accepted' | 'manual';
}

interface ExecutionLegRecord {
  index: number;
  contract: OptionContract;
  action: 'BUY' | 'SELL';
  lots: number;
  orderType: 'market' | 'limit';
  limitPrice?: number;
  status: 'queued' | 'sending' | 'sent' | 'confirmed' | 'rejected' | 'error';
  orderId?: string;
  fillPrice?: number;
  fillQuantity?: number;
  error?: string;
  sentAt?: number;
  confirmedAt?: number;
}
```

### 5. Truth Tier System

Every value displayed in the terminal belongs to one of three tiers.

**Tier 1 — Broker Truth.** Values that come directly from the Breeze API and represent the actual state of the trader's account or the exchange's order book. Examples: filled order price, position quantity, funds balance, order status, market depth. These are the source of truth. The terminal displays them as-is with a timestamp.

**Tier 2 — Normalized Truth.** Values computed by the backend from Tier 1 inputs using deterministic transformations. Examples: chain snapshot merged from CE+PE calls, position PnL computed from entry price and current LTP, OI change computed from current and previous snapshots. These are correct given their inputs but may be stale if the inputs are stale.

**Tier 3 — Analytical Projection.** Values computed by either backend or frontend using models, heuristics, or approximations. Examples: Black-Scholes Greeks, payoff diagrams, max pain, expected move, regime classification, adjustment rankings, opportunity scores. These are always labeled as projections. The model assumptions are discoverable.

**Display Rules:**
- Tier 1 values show a freshness indicator (green dot if < 5s, amber if < 30s, red if > 30s, gray if > 120s).
- Tier 2 values show their computation timestamp and input freshness.
- Tier 3 values show a subtle indicator (e.g., a small "~" prefix or italic rendering) that marks them as analytical.
- When a Tier 2 or Tier 3 value's inputs are invalidated (new tick arrived, position changed), the value is dimmed until recomputed.

### 6. Greeks — Correct Computation

The v12 codebase uses linear and Gaussian approximations for chain Greeks. This is unacceptable for a terminal that will build risk surfaces, run scenarios, or recommend adjustments.

The terminal must compute Greeks analytically from the Black-Scholes model using IV values provided by Breeze.

**Inputs for each option contract:**
- `S`: spot price (from SpotSnapshot)
- `K`: strike price
- `T`: time to expiry in years = `max(DTE, 0.5) / 365` where DTE is calendar days
- `r`: risk-free rate (use latest 91-day T-bill yield from RBI, default 0.065)
- `σ`: implied volatility from Breeze quote (decimal, e.g., 0.14)

**Formulas:**

```
d1 = (ln(S/K) + (r + σ²/2)·T) / (σ·√T)
d2 = d1 - σ·√T

n(x) = (1/√(2π)) · exp(-x²/2)     // standard normal PDF
N(x) = CDF of standard normal       // Abramowitz & Stegun approximation (already in math.ts)

delta_CE = N(d1)
delta_PE = N(d1) - 1

gamma = n(d1) / (S · σ · √T)       // same for CE and PE

theta_CE = -(S · n(d1) · σ) / (2·√T) - r · K · exp(-r·T) · N(d2)
theta_PE = -(S · n(d1) · σ) / (2·√T) + r · K · exp(-r·T) · N(-d2)
// Convert to per-day: divide by 365

vega = S · n(d1) · √T              // per unit σ; for "per 1% IV" divide by 100

rho_CE = K · T · exp(-r·T) · N(d2)
rho_PE = -K · T · exp(-r·T) · N(-d2)
```

**Edge cases:**
- `T ≤ 0`: intrinsic value only, delta = 1 (ITM) or 0 (OTM), all other Greeks = 0
- `σ ≤ 0` or `σ = NaN`: skip Greeks computation, display "—" in cells
- `S ≤ 0` or `K ≤ 0`: invalid input, display "—"

**Where computed:** Frontend, in a memoized function that takes `(chainSnapshot, spotSnapshot)` as inputs. The computation for 80 strikes × 2 rights = 160 contracts takes < 1ms on modern hardware. No need to move to backend unless running Monte Carlo scenarios.

**Display:** Chain columns that currently show `ce_delta`, `ce_theta` etc. switch to the analytically computed values. The column header tooltip says "Black-Scholes analytical Greeks, r=6.5%, from Breeze IV."

### 7. Spot Price — Authoritative Model

The v12 spot derivation uses a four-level priority cascade with dual-track mutation (module-level `SPOT_PRICES` object + React `spotPrice` state + `currentSpot` ref). This is replaced with a single authoritative model.

**Backend maintains:**

```python
class SpotManager:
    spots: Dict[str, SpotRecord]  # keyed by symbol
    
    class SpotRecord:
        price: float
        source: str          # 'breeze_ws' | 'breeze_rest' | 'breeze_quote_median'
        timestamp: float     # Unix seconds
        day_open: float      # first price of the session
```

**Update sources (in priority order):**
1. Breeze WebSocket spot broadcast → `source = 'breeze_ws'`
2. Breeze REST `/api/spot` fetch → `source = 'breeze_rest'`
3. Median of ATM CE+PE put-call parity from chain → `source = 'breeze_quote_median'`

**Sanity rules:**
- Any new spot that differs from the previous by more than 10% within 60 seconds is rejected and logged.
- After rejection, the system attempts source 2, then source 3.
- If all sources produce rejected values, the previous value is retained and a `SPOT_STALE` alert is emitted.

**Frontend receives:**
- Spot as part of every chain response: `chainSnapshot.spot: SpotSnapshot`
- Spot as part of every WebSocket tick update: `tickUpdate.spots: Record<string, SpotSnapshot>`
- Never computes spot independently. Never mutates a module-level variable.

**Freshness display:**
- The top ribbon shows spot with a freshness dot: green (< 5s), amber (< 30s), red (> 30s).
- During market closed hours, the dot is gray and shows "Market Closed" tooltip.

### 8. Streaming Pipeline

The real-time data pipeline is the terminal's circulatory system. It must be explicit, bounded, and recoverable.

#### 8.1 Backend Subscription Manager

```python
class SubscriptionManager:
    active: Dict[str, Set[str]]  # channel → set of contractKeys
    max_subscriptions: int = 100
    
    def set_chain_subscriptions(self, instrument, expiry, strikes, rights):
        """Replace all subscriptions for the given instrument+expiry.
        
        This is a REPLACE operation, not an ADD. When the trader switches
        expiry, the old expiry's subscriptions are removed and the new
        expiry's are added.
        
        If len(new_subs) > max_subscriptions, reduce strike range from
        the edges and log a warning.
        """
        
    def get_active_count(self) -> int:
        """Total active subscriptions for diagnostics."""
        
    def get_instruments(self) -> List[str]:
        """List of currently subscribed contractKeys for diagnostics."""
```

**Key behavior:** The frontend sends `POST /api/stream/subscribe` with `{ instrument, expiry, strikes, rights }`. The backend diffs against current subscriptions, unsubscribes removed contracts, subscribes new ones, and returns the actual subscription set. The frontend never assumes a subscription succeeded — it reads the response.

#### 8.2 Tick Normalization

The backend receives raw Breeze WebSocket ticks and normalizes them into the canonical `QuoteSnapshot` format before broadcasting.

```python
def normalize_tick(raw_tick) -> QuoteSnapshot:
    return QuoteSnapshot(
        contract=OptionContract(
            instrument=raw_tick['stock_code'],
            exchange=raw_tick['exchange_code'],
            expiry=raw_tick['expiry_date'],
            strike=float(raw_tick['strike_price']),
            right='CE' if raw_tick['right'] == 'Call' else 'PE'
        ),
        ltp=float(raw_tick.get('ltp', 0)),
        bid=float(raw_tick.get('best_bid_price', 0)),
        ask=float(raw_tick.get('best_offer_price', 0)),
        oi=int(raw_tick.get('open_interest', 0)),
        oiChange=int(raw_tick.get('oi_change', 0)),
        volume=int(raw_tick.get('total_quantity_traded', 0)),
        iv=float(raw_tick.get('implied_volatility', 0)) / 100,  # to decimal
        timestamp=time.time_ns() // 1_000_000
    )
```

#### 8.3 Frontend Tick Bus

The frontend receives tick updates through a single WebSocket connection (or REST polling fallback). A dedicated `TickBus` distributes updates to all subscribers without coupling to React's render cycle.

```typescript
class TickBus {
  private listeners: Map<string, Set<(quote: QuoteSnapshot) => void>>;
  private latestQuotes: Map<string, QuoteSnapshot>;
  private latestSpots: Map<string, SpotSnapshot>;
  
  // Called by the WS client on every tick update
  ingest(update: TickUpdate): void {
    for (const quote of update.quotes) {
      const key = contractKey(quote.contract);
      this.latestQuotes.set(key, quote);
      this.listeners.get(key)?.forEach(cb => cb(quote));
    }
    for (const [sym, spot] of Object.entries(update.spots)) {
      this.latestSpots.set(sym, spot);
    }
  }
  
  // Get the latest quote for a contract (no subscription)
  getQuote(contract: OptionContract): QuoteSnapshot | undefined {
    return this.latestQuotes.get(contractKey(contract));
  }
  
  // Get the latest spot for a symbol
  getSpot(symbol: SymbolCode): SpotSnapshot | undefined {
    return this.latestSpots.get(symbol);
  }
  
  // Subscribe to updates for a specific contract
  subscribe(contract: OptionContract, cb: (q: QuoteSnapshot) => void): () => void {
    const key = contractKey(contract);
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(cb);
    return () => this.listeners.get(key)?.delete(cb);
  }
}

// Singleton, created once, injected via context
export const tickBus = new TickBus();
```

**React integration:** A `useQuote(contract)` hook subscribes to the tick bus and returns the latest quote with React state. A `useSpot(symbol)` hook does the same for spot prices. These hooks use `useSyncExternalStore` to avoid tearing.

```typescript
function useQuote(contract: OptionContract): QuoteSnapshot | undefined {
  return useSyncExternalStore(
    (cb) => tickBus.subscribe(contract, cb),
    () => tickBus.getQuote(contract)
  );
}
```

**Consequence:** The chain component no longer receives the entire chain array as a prop that replaces on every tick. Instead, each `ChainRow` subscribes to its own two contracts (CE and PE) via `useQuote`. Only the rows that actually received ticks re-render. The flash animation triggers from the quote change, not from a map comparison in a parent component.

#### 8.4 WebSocket Connection Manager

The v12 `BreezeWsClient` is retained with these fixes:

1. **Add `_isConnecting` guard** to prevent StrictMode double-connect.
2. **Report subscription count** as part of health status.
3. **Heartbeat timeout:** If no message (including heartbeat) is received for 45 seconds, treat as disconnected and reconnect. The backend sends heartbeats every 15 seconds.
4. **Version dedup is retained** (monotonic version number, skip if ≤ lastVersion).

**Fallback:** When WebSocket is not available (Vercel proxy path, where the URL starts with `/`), the system falls back to REST polling at `/api/stream/poll?since_version=N` every 2 seconds. The fallback is announced in the UI with a persistent amber banner: "Live streaming unavailable — using 2-second polling."

### 9. Market Session Awareness

The terminal must understand market session phases.

```typescript
type SessionPhase = 
  | 'pre_open'        // 9:00 - 9:07 IST
  | 'open_auction'    // 9:07 - 9:15 IST  
  | 'normal'          // 9:15 - 15:30 IST
  | 'post_close'      // 15:40 - 16:00 IST
  | 'closed';         // all other times

function getCurrentPhase(): SessionPhase {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  const day = ist.getDay();
  
  if (day === 0 || day === 6) return 'closed';  // weekend
  if (minutes < 540) return 'closed';            // before 9:00
  if (minutes < 547) return 'pre_open';          // 9:00-9:07
  if (minutes < 555) return 'open_auction';      // 9:07-9:15
  if (minutes < 930) return 'normal';            // 9:15-15:30
  if (minutes < 960) return 'closed';            // 15:30-15:40 gap
  if (minutes < 1000) return 'post_close';       // 15:40-16:00 (approximate)
  return 'closed';
}
```

**Holiday handling:** A `holidays.json` file in the backend lists NSE/BSE trading holidays. The session phase function checks this list.

**UI implications:**
- During `closed`: spot shows "Prev Close", staleness indicator is gray, order placement is disabled (with tooltip "Market closed").
- During `pre_open`: banner "Pre-Open Session — Orders accepted, execution begins at 9:15" appears.
- During `normal`: full functionality.
- During `post_close`: order placement disabled, positions still updating.
- The global ribbon always shows current phase and a countdown to the next phase transition.

**Expiry awareness:** On expiry day (Tuesday for NIFTY, Thursday for SENSEX), the terminal shows a prominent banner: "EXPIRY DAY — [SYMBOL] [EXPIRY] expires at 15:30 IST". Time decay acceleration is noted in Greeks display.

---

## PART III — BACKEND ARCHITECTURE

---

### 10. Backend Structure

The backend migrates from `kaggle_backend.py` (single file) to a structured package. It remains a single FastAPI process.

```
backend/
  app/
    main.py                    # FastAPI app, startup/shutdown hooks
    config.py                  # Settings, env vars, constants
    auth.py                    # X-Terminal-Auth validation
    
    api/
      session.py               # /api/session/*
      market.py                # /api/market/*
      stream.py                # /api/stream/*
      execution.py             # /api/execution/*
      portfolio.py             # /api/portfolio/*
      automation.py            # /api/automation/*
      reviews.py               # /api/reviews/*
      diagnostics.py           # /api/diagnostics/*
    
    clients/
      breeze/
        session.py             # BreezeConnect init, generate_session
        market.py              # get_option_chain_quotes, get_quotes, get_market_depth
        execution.py           # place_order, cancel_order, modify_order
        portfolio.py           # get_portfolio_positions, get_portfolio_holdings, get_funds
        streaming.py           # ws_connect, subscribe_feeds, unsubscribe_feeds
        historical.py          # get_historical_data_v2
        preview.py             # margin_calculator, preview_order
    
    services/
      spot.py                  # SpotManager
      chain.py                 # Chain assembly, merge, cache
      subscription.py          # SubscriptionManager
      execution_engine.py      # ExecutionSession management
      position_grouping.py     # GroupedStrategy assembly
      risk.py                  # Greeks aggregation, scenarios
      automation.py            # Rule evaluation, trigger engine
      journal.py               # Entry creation, lifecycle linkage
    
    models/
      instruments.py           # Instrument, OptionContract
      market.py                # SpotSnapshot, QuoteSnapshot, ChainSnapshot
      strategy.py              # StrategyDraft, StrategyInstance, ExecutedLeg
      positions.py             # LivePosition, GroupedStrategy
      execution.py             # ExecutionSession, ExecutionLegRecord
      automation.py            # AutomationRule, AutomationEvent
      journal.py               # JournalCase
    
    storage/
      db.py                    # SQLite connection, migrations
      schema.sql               # Table definitions
    
    ws/
      tick_server.py           # WebSocket endpoint /ws/ticks
      tick_bus.py              # Internal tick distribution
```

### 11. API Contract

#### 11.1 Session

| Endpoint | Method | Request | Response |
|---|---|---|---|
| `/api/session/connect` | POST | `{ api_key, api_secret, session_token }` | `{ success, auth_token, customer: { name, email }, capabilities }` |
| `/api/session/status` | GET | — | `{ connected, phase, ws_status, subscriptions, uptime_s }` |
| `/api/session/disconnect` | POST | — | `{ success }` |

#### 11.2 Market

| Endpoint | Method | Request | Response |
|---|---|---|---|
| `/api/market/spot` | GET | `?symbol=NIFTY` | `SpotSnapshot` |
| `/api/market/expiries` | GET | `?symbol=NIFTY` | `{ expiries: ExpiryInfo[] }` |
| `/api/market/chain` | GET | `?symbol=NIFTY&expiry=01-Jul-2025` | `ChainSnapshot` |
| `/api/market/depth` | GET | `?symbol=NIFTY&expiry=...&strike=24500&right=CE` | `DepthSnapshot` |
| `/api/market/candles` | GET | `?symbol=NIFTY&interval=5m&from=...&to=...` | `CandleSeries` |

The chain endpoint returns quotes for both CE and PE in a single call. The backend fetches CE and PE in parallel from Breeze and merges them. This is a change from v12 where the frontend made two separate calls.

#### 11.3 Streaming

| Endpoint | Method | Request | Response |
|---|---|---|---|
| `/api/stream/subscribe` | POST | `{ symbol, expiry, strikes, rights }` | `{ subscribed: string[], total, dropped: string[] }` |
| `/api/stream/status` | GET | — | `{ ws_connected, subscriptions: string[], queue_depth }` |
| `/api/stream/poll` | GET | `?since_version=N` | `{ version, quotes: QuoteSnapshot[], spots: SpotSnapshot[] }` |
| `/ws/ticks` | WebSocket | — | Stream of `TickUpdate` messages |

**`TickUpdate` message format:**

```typescript
interface TickUpdate {
  version: number;
  quotes: QuoteSnapshot[];
  spots: Record<string, SpotSnapshot>;
  timestamp: number;
  heartbeat: boolean;  // if true, no data — just keepalive
}
```

#### 11.4 Execution

| Endpoint | Method | Request | Response |
|---|---|---|---|
| `/api/execution/preview` | POST | `{ legs: StrategyLeg[] }` | `{ margin, fees, charges, estimatedCredit }` |
| `/api/execution/submit` | POST | `{ draft: StrategyDraft }` | `{ executionId, status: 'created' }` |
| `/api/execution/{id}/status` | GET | — | `ExecutionSession` |
| `/api/execution/{id}/cancel` | POST | — | `{ success, legsReversed }` |
| `/api/execution/active` | GET | — | `ExecutionSession[]` |

The execution submit endpoint does **not** execute immediately. It creates an `ExecutionSession` record and begins sequential leg execution on the backend. The frontend polls the status endpoint (or receives updates via WebSocket) to track progress.

#### 11.5 Portfolio

| Endpoint | Method | Request | Response |
|---|---|---|---|
| `/api/portfolio/positions` | GET | — | `{ positions: LivePosition[], strategies: GroupedStrategy[] }` |
| `/api/portfolio/orders` | GET | — | `{ orders: OrderRecord[] }` |
| `/api/portfolio/trades` | GET | — | `{ trades: TradeRecord[] }` |
| `/api/portfolio/funds` | GET | — | `FundsSnapshot` |
| `/api/portfolio/squareoff` | POST | `{ legs: SquareOffLeg[] }` | `{ executionId }` |

**Key change:** The positions endpoint returns both raw positions AND grouped strategies. Strategy grouping is a backend operation, not a frontend heuristic.

#### 11.6 Diagnostics

| Endpoint | Method | Request | Response |
|---|---|---|---|
| `/api/diagnostics/health` | GET | — | `{ status, version, uptime, breeze_connected, ws_running, db_ok }` |
| `/api/diagnostics/rate-limits` | GET | — | `{ calls_last_minute, calls_last_hour, limit_minute, limit_hour }` |
| `/api/diagnostics/subscriptions` | GET | — | `{ active: string[], count, max }` |
| `/api/diagnostics/errors` | GET | `?last=50` | `{ errors: ErrorRecord[] }` |

### 12. Strategy Grouping — Backend Model

This is the single most consequential data model decision. It determines whether portfolio, risk, adjustment, and journal surfaces are reliable or heuristic.

**When a multi-leg execution succeeds**, the backend creates a `StrategyGroup` record:

```python
class StrategyGroup:
    id: str                       # UUID
    name: str                     # 'Iron Condor 24200/24400/24600/24800' (auto-generated)
    template: str | None          # 'iron_condor', 'bull_put_spread', etc.
    instrument: str               # 'NIFTY'
    expiry: str                   # '01-Jul-2025'
    legs: List[StrategyGroupLeg]
    execution_id: str
    created_at: float
    status: str                   # 'active', 'adjusted', 'closed'
    adjustments: List[str]        # execution_ids of adjustment trades

class StrategyGroupLeg:
    contract_key: str
    action: str                   # 'BUY' | 'SELL'
    original_lots: int
    current_lots: int             # decremented on partial close
    entry_price: float
    order_id: str
```

**When positions are fetched from Breeze**, the backend reconciles:
1. Fetch raw positions from `get_portfolio_positions`
2. For each position, check if its `(contract, action)` matches any active `StrategyGroupLeg`
3. If yes: update `current_lots` and LTP in the group
4. If no: the position is "ungrouped" — either manually entered via broker terminal, or from a strategy whose group record was lost
5. Return both grouped strategies and ungrouped positions

**Adjustment handling:** When an adjustment trade is executed, the backend:
1. Links the adjustment's `execution_id` to the original strategy group
2. Adds or modifies legs in the group
3. Updates the strategy's status to `'adjusted'`

**Close detection:** When all legs in a group have `current_lots = 0`, the strategy status changes to `'closed'` and a journal close event is triggered.

### 13. Execution Engine — Safety Model

This is the section that addresses the non-atomic multi-leg execution problem.

#### 13.1 Execution Flow

```
Frontend: POST /api/execution/submit { draft }
  │
Backend: create ExecutionSession (status: 'created', persisted to SQLite)
  │
Backend: begin sequential execution
  │
  ├── Leg 0: status → 'sending'
  │   ├── place_order() to Breeze
  │   ├── Success: status → 'confirmed', record orderId and timestamp
  │   ├── Rejected: status → 'rejected', record error
  │   │   └── STOP execution, session status → 'failed'
  │   │       └── If previous legs filled: session status → 'partial', orphanDetected = true
  │   └── Timeout/Network Error:
  │       ├── Wait 3 seconds
  │       ├── Query order book for matching order
  │       ├── Found and filled: status → 'confirmed'
  │       ├── Found and pending: status → 'sent', continue monitoring
  │       └── Not found: status → 'error', STOP, mark partial
  │
  ├── Leg 1: (same as above)
  ├── ...
  └── Leg N: all legs processed
      └── If all confirmed: session status → 'completed'
      └── If any rejected/error: session status → 'partial'

Backend: if session.status === 'partial':
  │
  ├── Compute orphan exposure (which legs filled, what's the net position)
  ├── Store orphan analysis in session
  └── Emit 'ORPHAN_DETECTED' event → WebSocket → frontend alert
```

#### 13.2 Orphan Handling

When the frontend receives an orphan alert:

1. A modal appears: "Partial Execution — [N of M] legs filled. You have unintended exposure."
2. The modal shows:
   - Which legs filled (with prices)
   - Which legs failed (with reasons)
   - The resulting net position (delta, max loss)
   - The estimated cost to reverse the filled legs
3. Options presented:
   - "Retry Failed Legs" — attempt to place the remaining legs
   - "Reverse Filled Legs" — place opposite orders to close filled legs
   - "Accept Partial" — keep the partial position, mark as acknowledged
   - "Go to Portfolio" — navigate to portfolio to manage manually

**The system never auto-reverses.** Automatic reversal during volatile markets can be worse than the partial position. The trader decides.

#### 13.3 Execution Recovery

If the browser disconnects during execution:
1. On reconnect, the frontend calls `GET /api/execution/active`
2. If any execution sessions are in `'executing'` or `'partial'` status, a recovery modal appears
3. The modal shows the execution state and offers the same options as the orphan modal

The backend execution is not blocked by frontend disconnect. It continues executing legs and updates the database. The frontend catches up on reconnect.

### 14. Backend Persistence

The backend uses SQLite for all persistent state. SQLite is appropriate because:
- Single-user terminal (no concurrent write contention)
- Zero configuration
- Single file, easy to backup
- Sufficient performance for the data volumes involved

**Tables:**

```sql
CREATE TABLE strategy_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template TEXT,
  instrument TEXT NOT NULL,
  expiry TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);

CREATE TABLE strategy_group_legs (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES strategy_groups(id),
  contract_key TEXT NOT NULL,
  action TEXT NOT NULL,
  original_lots INTEGER NOT NULL,
  current_lots INTEGER NOT NULL,
  entry_price REAL NOT NULL,
  order_id TEXT
);

CREATE TABLE execution_sessions (
  id TEXT PRIMARY KEY,
  strategy_draft_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  orphan_detected INTEGER NOT NULL DEFAULT 0,
  orphan_resolution TEXT,
  started_at REAL NOT NULL,
  completed_at REAL
);

CREATE TABLE execution_legs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES execution_sessions(id),
  leg_index INTEGER NOT NULL,
  contract_key TEXT NOT NULL,
  action TEXT NOT NULL,
  lots INTEGER NOT NULL,
  order_type TEXT NOT NULL,
  limit_price REAL,
  status TEXT NOT NULL DEFAULT 'queued',
  order_id TEXT,
  fill_price REAL,
  fill_quantity INTEGER,
  error TEXT,
  sent_at REAL,
  confirmed_at REAL
);

CREATE TABLE automation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_json TEXT NOT NULL,
  action_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  cooldown_seconds INTEGER NOT NULL DEFAULT 300,
  last_triggered_at REAL,
  created_at REAL NOT NULL
);

CREATE TABLE automation_events (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES automation_rules(id),
  trigger_snapshot_json TEXT NOT NULL,
  action_taken TEXT NOT NULL,
  result_json TEXT,
  timestamp REAL NOT NULL
);

CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  strategy_group_id TEXT REFERENCES strategy_groups(id),
  execution_id TEXT REFERENCES execution_sessions(id),
  entry_type TEXT NOT NULL,  -- 'trade_open', 'trade_close', 'adjustment', 'manual', 'review'
  content TEXT,
  tags TEXT,                 -- JSON array
  market_snapshot_json TEXT,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);

CREATE TABLE rate_limit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  timestamp REAL NOT NULL
);
```

**Migration:** On backend startup, the database is created if it doesn't exist. Schema versioning uses a simple `schema_version` table. Each startup checks the version and runs any pending migrations.

### 15. Rate Limit Management

The Breeze API has rate limits (typically 10-15 requests/second, 250-500 requests/minute depending on the endpoint). The backend must track and respect these.

```python
class RateLimiter:
    def __init__(self, per_second: int = 10, per_minute: int = 250):
        self.per_second = per_second
        self.per_minute = per_minute
        self.calls: deque[float] = deque()
    
    def can_call(self) -> bool:
        now = time.time()
        # Prune old entries
        while self.calls and self.calls[0] < now - 60:
            self.calls.popleft()
        
        # Check per-minute
        if len(self.calls) >= self.per_minute:
            return False
        
        # Check per-second
        one_sec_ago = now - 1
        recent = sum(1 for t in self.calls if t >= one_sec_ago)
        return recent < self.per_second
    
    def record_call(self):
        self.calls.append(time.time())
    
    def wait_if_needed(self) -> float:
        """Returns seconds waited. 0 if no wait needed."""
        if self.can_call():
            return 0.0
        # Wait until the oldest per-second call expires
        wait = max(0, self.calls[-self.per_second] + 1.001 - time.time())
        time.sleep(wait)
        return wait

    def status(self) -> dict:
        now = time.time()
        return {
            'calls_last_second': sum(1 for t in self.calls if t >= now - 1),
            'calls_last_minute': len([t for t in self.calls if t >= now - 60]),
            'limit_second': self.per_second,
            'limit_minute': self.per_minute,
            'headroom_pct': round(100 * (1 - len(self.calls) / self.per_minute), 1)
        }
```

Every Breeze SDK call goes through the rate limiter. If the limiter blocks, the backend waits (for market data calls) or returns a 429 (for trader-initiated calls that should not silently stall).

The frontend can query `/api/diagnostics/rate-limits` and displays a rate limit gauge in the operations workspace and a warning in the global ribbon when headroom drops below 20%.

---

## PART IV — FRONTEND ARCHITECTURE

---

### 16. State Management

The frontend state is split into three categories with different management strategies.

#### 16.1 Server State (TanStack Query)

All data that originates from the backend is managed through TanStack Query (React Query). This provides:
- Automatic caching and deduplication
- Background refetching
- Stale-while-revalidate
- Optimistic updates for mutations
- Loading and error states without manual booleans

**Query keys follow a consistent pattern:**

```typescript
// Market data
queryKey: ['market', 'chain', symbol, expiry]
queryKey: ['market', 'spot', symbol]
queryKey: ['market', 'expiries', symbol]
queryKey: ['market', 'depth', symbol, expiry, strike, right]

// Portfolio
queryKey: ['portfolio', 'positions']
queryKey: ['portfolio', 'orders']
queryKey: ['portfolio', 'trades']
queryKey: ['portfolio', 'funds']

// Execution
queryKey: ['execution', executionId]
queryKey: ['execution', 'active']

// Automation
queryKey: ['automation', 'rules']
queryKey: ['automation', 'events', ruleId]

// Journal
queryKey: ['journal', 'entries']
queryKey: ['journal', 'entry', entryId]
```

**Stale times:**

| Query | Stale Time | Refetch Interval |
|---|---|---|
| Chain | 0 (always stale — live data from ticks) | None (tick bus updates) |
| Spot | 0 | None (tick bus updates) |
| Expiries | 5 minutes | None |
| Positions | 0 | 30 seconds when visible |
| Orders | 0 | 30 seconds when visible |
| Trades | 0 | 30 seconds when visible |
| Funds | 0 | 60 seconds when visible |
| Automation rules | 30 seconds | None |
| Journal entries | 60 seconds | None |

**Chain query integration with tick bus:** When the chain query initially loads (REST fetch), it populates the tick bus with the initial quotes. Subsequent ticks update the tick bus directly (not through React Query). The query data serves as the initial snapshot; the tick bus provides the live overlay.

```typescript
const { data: chainSnapshot } = useQuery({
  queryKey: ['market', 'chain', symbol, expiry],
  queryFn: () => api.market.getChain(symbol, expiry),
  onSuccess: (data) => {
    // Seed the tick bus with initial snapshot
    for (const quote of data.quotes.values()) {
      tickBus.seed(quote);
    }
  },
});
```

#### 16.2 Client State (Zustand)

Terminal-local state that does not come from the backend.

```typescript
interface TerminalStore {
  // Workspace
  activeWorkspace: WorkspaceId;
  setActiveWorkspace: (id: WorkspaceId) => void;
  
  // Selection context
  selectedSymbol: SymbolCode;
  selectedExpiry: string;
  setSelectedSymbol: (sym: SymbolCode) => void;
  setSelectedExpiry: (exp: string) => void;
  
  // Strategy draft
  draft: StrategyDraft | null;
  addLeg: (leg: Omit<StrategyLeg, 'id'>) => void;
  removeLeg: (id: string) => void;
  updateLeg: (id: string, update: Partial<StrategyLeg>) => void;
  clearDraft: () => void;
  loadTemplate: (template: TemplateDef, spot: number, step: number, expiry: string) => void;
  
  // Layout
  layouts: Record<WorkspaceId, LayoutConfig>;
  updateLayout: (workspace: WorkspaceId, config: LayoutConfig) => void;
  resetLayout: (workspace: WorkspaceId) => void;
  
  // Preferences
  chainPrefs: ChainPreferences;
  updateChainPrefs: (update: Partial<ChainPreferences>) => void;
  
  // UI transients
  commandPaletteOpen: boolean;
  toggleCommandPalette: () => void;
  focusedStrike: number | null;
  setFocusedStrike: (strike: number | null) => void;
}
```

**Persistence:** Zustand's `persist` middleware stores `layouts`, `chainPrefs`, `selectedSymbol`, and `selectedExpiry` in `localStorage`. Other state is ephemeral.

**The strategy draft no longer stores prices.** A leg is `{ id, contract, action, lots, orderType, limitPrice? }`. When the strategy builder needs to display LTP, Greeks, or payoff, it looks up the current quote from the tick bus:

```typescript
function useLegWithLiveData(leg: StrategyLeg) {
  const quote = useQuote(leg.contract);
  const spot = useSpot(leg.contract.instrument);
  
  const greeks = useMemo(() => {
    if (!quote || !spot) return null;
    return computeGreeks(spot.price, leg.contract.strike, dte, RISK_FREE_RATE, quote.iv, leg.contract.right);
  }, [quote, spot, leg.contract]);
  
  return { leg, ltp: quote?.ltp, greeks, iv: quote?.iv };
}
```

This eliminates the state consistency problem. The chain and the strategy builder always show the same price because they read from the same source.

#### 16.3 Streaming State (Tick Bus)

As described in Section 8.3. The tick bus is not React state. It is a plain JavaScript singleton that holds the latest quotes and spots. React components subscribe to it via `useSyncExternalStore` hooks.

### 17. Router

Replace the custom `window.history` router with React Router v6.

```typescript
const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/launchpad" /> },
      { path: 'launchpad', element: <LaunchpadWorkspace /> },
      { path: 'market', element: <MarketWorkspace /> },
      { path: 'market/:symbol', element: <MarketWorkspace /> },
      { path: 'market/:symbol/:expiry', element: <MarketWorkspace /> },
      { path: 'strategy', element: <StrategyWorkspace /> },
      { path: 'execution', element: <ExecutionWorkspace /> },
      { path: 'execution/:executionId', element: <ExecutionWorkspace /> },
      { path: 'portfolio', element: <PortfolioWorkspace /> },
      { path: 'portfolio/strategy/:strategyId', element: <PortfolioWorkspace /> },
      { path: 'risk', element: <RiskWorkspace /> },
      { path: 'automation', element: <AutomationWorkspace /> },
      { path: 'review', element: <ReviewWorkspace /> },
      { path: 'ops', element: <OpsWorkspace /> },
    ],
  },
]);
```

**URL-encoded state:** The symbol and expiry are encoded in the URL for the market workspace. This enables deep linking: a trader can bookmark `https://terminal.example.com/market/NIFTY/01-Jul-2025` and return to exactly the same view.

**Route guards:** The `AppShell` component checks `session.isConnected`. If not connected, non-diagnostic routes show a connection prompt overlay (not a redirect — the workspace is still visible in the background, using mock data).

### 18. Component Architecture

#### 18.1 Design System Primitives

The terminal needs a small set of high-quality primitives. These are not a generic component library. They are trading terminal primitives.

**DataGrid:** A virtualized, sortable, filterable, keyboard-navigable table optimized for financial data. Used for: chain, order book, trade book, positions, automation rules.

```typescript
interface DataGridProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  keyExtractor: (row: T) => string;
  onRowFocus?: (row: T) => void;
  onRowAction?: (row: T, action: string) => void;
  sortState?: SortState;
  onSort?: (column: string) => void;
  flashMap?: Map<string, FlashEntry>;  // for live data
  rowClassName?: (row: T) => string;
  virtualizeThreshold?: number;         // rows above which virtualization activates
  stickyHeader?: boolean;
  compact?: boolean;
}
```

**MetricStrip:** A horizontal row of labeled values. Used for: stats strip, Greek summary, P&L summary.

```typescript
interface MetricStripProps {
  items: Array<{
    label: string;
    value: string | number;
    format?: 'currency' | 'percent' | 'number' | 'oi';
    trend?: 'up' | 'down' | 'neutral';
    tier?: 1 | 2 | 3;           // truth tier indicator
    stale?: boolean;
  }>;
  compact?: boolean;
}
```

**InspectorPanel:** A right-rail detail panel that shows expanded information about a selected item. Used for: strike details, position details, order details, strategy analysis.

**ActionBar:** A strip of contextual actions. Used for: chain row actions, position actions, order actions.

**ConfirmDialog:** A modal that requires explicit confirmation for destructive actions. Supports a "type to confirm" pattern for critical operations (e.g., "Type EXECUTE to confirm live order").

**FreshnessIndicator:** A small dot or badge that shows data freshness. Color-coded: green/amber/red/gray. Always shows tooltip with exact timestamp and source.

#### 18.2 Option Chain — Refactored

The v12 option chain is the best component in the codebase. It is refactored, not rewritten.

**Changes from v12:**

1. **Greeks columns use proper BS computation.** The `mergeQuotesToChain` linear approximation is removed. Greeks are computed in a memoized function from `(spot, strike, dte, r, iv)`.

2. **Each row subscribes to its own ticks.** Instead of receiving the full chain array and comparing for changes, each `ChainRow` uses `useQuote(ceContract)` and `useQuote(peContract)`. Only rows with actual tick changes re-render.

3. **Flash animation triggers from quote change.** Each `DataCell` compares its current value to the previous render's value using a ref. No more centralized `useFlashCells` hook with a map.

```typescript
function DataCell({ value, format }: { value: number; format: (v: number) => string }) {
  const prevRef = useRef(value);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  
  useEffect(() => {
    if (prevRef.current !== value && prevRef.current !== 0) {
      setFlash(value > prevRef.current ? 'up' : 'down');
      const timer = setTimeout(() => setFlash(null), FLASH_DURATION_MS);
      prevRef.current = value;
      return () => clearTimeout(timer);
    }
    prevRef.current = value;
  }, [value]);
  
  return <td className={flash ? `flash-${flash}` : ''}>{format(value)}</td>;
}
```

4. **Toolbar, stats strip, footer, OI signals, keyboard navigation, max pain, CSV export — all retained** from v12. These are working, tested-by-use features.

5. **Strike Intelligence Inspector.** Clicking a strike (not the B/S action buttons, but the strike cell itself) opens an inspector panel showing: full depth (if available), IV rank for that strike across recent sessions, OI buildup timeline (if historical data is available), and the strike's distance from max pain and support/resistance levels.

#### 18.3 Strategy Builder — Refactored

**Changes from v12:**

1. **Legs are references, not copies.** A leg stores `{ id, contract, action, lots, orderType, limitPrice? }`. Display values (LTP, Greeks, IV) are derived from the tick bus at render time via `useLegWithLiveData()`.

2. **Template instantiation uses store action.** The `setLegs` ReferenceError bug is fixed by moving template logic to the Zustand store's `loadTemplate` action:

```typescript
loadTemplate: (template, spot, step, expiry) => {
  const legs = template.build(spot, step).map(leg => ({
    ...leg,
    id: nanoid(),
    contract: {
      instrument: get().selectedSymbol,
      exchange: SYMBOL_CONFIG[get().selectedSymbol].exchange,
      expiry,
      strike: leg.strike,
      right: leg.right,
    },
  }));
  set({ draft: { id: nanoid(), templateSource: template.name, legs, createdAt: Date.now() } });
},
```

3. **Payoff diagram uses live prices.** Each point on the payoff curve uses the leg's current LTP from the tick bus, not a stale copy. The payoff recomputes on every tick that affects any leg.

4. **Strategy comparison.** Two drafts can be compared side-by-side: payoff overlay on the same chart, Greeks comparison table, margin comparison (if previewed).

5. **Margin and fee preview.** A "Preview" button sends the draft to `/api/execution/preview` and displays the result: estimated margin, brokerage, STT, exchange fees, GST, total cost. The preview result is Tier 1 (broker-confirmed) and is displayed with a freshness indicator.

#### 18.4 Execution Surface

This is new. It replaces the simple "execute with confirmation" flow from v12 with a proper execution management surface.

**Layout:** Split into three horizontal sections.

**Top: Staged Ticket.** Shows the strategy draft with live prices, total margin, estimated credit/debit, and max risk. Has two buttons: "Preview" (fetches margin/fee preview) and "Execute" (submits to backend).

**Middle: Execution Monitor.** After submission, shows the `ExecutionSession` state with per-leg progress:

```
Leg 1: SELL NIFTY 24200 PE    ✓ Filled at ₹42.30    Order: 2025070100001
Leg 2: BUY  NIFTY 23800 PE    ✓ Filled at ₹18.45    Order: 2025070100002
Leg 3: SELL NIFTY 24800 CE    ⟳ Sending...
Leg 4: BUY  NIFTY 25200 CE    ○ Queued
```

Progress updates via WebSocket or 2-second polling of `/api/execution/{id}/status`.

**Bottom: Execution Blotter.** Shows recent execution sessions with status, legs, fill prices, and total credit/debit.

#### 18.5 Portfolio Surface

**Layout:**

**Left panel: Position Grid.** Shows all positions grouped by strategy. Each strategy group is a collapsible section showing:
- Strategy name and template type
- Status badge (active/adjusted/closing)
- Net P&L (large, colored)
- Net Greeks (delta, theta, gamma, vega)
- Expandable leg rows with per-leg P&L

Ungrouped positions appear in a separate "Manual / Ungrouped" section.

**Right panel: Strategy Inspector.** Selected strategy's details: payoff diagram at current prices, margin used, adjustment history, linked journal entries, days held.

**Bottom strip: Funds.** Cash balance, margin used, margin available, utilization percentage. Refreshed every 60 seconds. Tier 1 data.

#### 18.6 Risk Surface

**Layout:**

**Main panel: Risk Dashboard.** For the aggregate book and per-strategy:
- Net delta, gamma, theta, vega (Tier 3 — analytical, from BS Greeks)
- Max theoretical loss per strategy (from payoff computation)
- Margin utilization (Tier 1)
- Position concentration by instrument and expiry

**Top strip: Scenario Controls.** Three sliders:
- Spot change: -5% to +5%
- Days forward: 0 to DTE
- IV change: -10 to +10 percentage points

Adjusting any slider recomputes the portfolio's theoretical P&L using the BS model with the adjusted inputs. The scenario result is clearly labeled Tier 3.

**Right panel: Adjustment Desk.** For the selected strategy:
- Current payoff and Greeks
- Suggested adjustments (generated by the adjustment engine)
- Each suggestion shows: adjustment legs, new payoff overlay, Greek changes, margin delta, credit/debit delta
- "Stage Adjustment" button creates a new draft linked to the original strategy

The adjustment engine runs on the backend and returns ranked suggestions. The ranking considers:
1. Credit preservation (does the adjustment maintain or increase net credit?)
2. Risk reduction (does max loss decrease?)
3. Margin impact (does margin requirement decrease?)
4. Thesis preservation (does the adjustment maintain the original directional assumption?)
5. Simplicity (fewer legs preferred)

### 19. Workspace Inventory

Based on Principle 5 (minimal surface, maximum depth), the terminal ships with **seven workspaces**.

| ID | Label | Route | Purpose |
|---|---|---|---|
| `launchpad` | Launchpad | `/launchpad` | Morning orientation: regime, top opportunities, book status, alerts |
| `market` | Market | `/market/:symbol?/:expiry?` | Chain, depth, chart, watchlist — market situational awareness |
| `strategy` | Strategy | `/strategy` | Builder, templates, comparison, preview — trade construction |
| `execution` | Execution | `/execution/:id?` | Ticket, execution monitor, blotter — trade execution |
| `portfolio` | Portfolio | `/portfolio` | Positions, strategies, funds, orders, trades — book management |
| `risk` | Risk | `/risk` | Greeks, scenarios, adjustments, margin — risk management |
| `ops` | Ops | `/ops` | Connection, backend health, rate limits, automation, journal |

**Rationale for merges:**
- Market and Chain are merged. The chain is the primary surface; market overview is context around it.
- Strategy and Execution are separate because they represent different phases of the workflow with different cognitive requirements. Strategy is analytical; execution is operational.
- Risk includes the adjustment desk as a sub-panel.
- Automation and Journal are folded into Ops because they are operational concerns, not trading surfaces. A trader checks automation rules and journal entries periodically, not continuously.

**Each workspace has:**
- A default layout (arrangement of panels)
- Keyboard shortcut: `G` then first letter (e.g., `G L` for launchpad, `G M` for market)
- A layout reset button
- Panel show/hide toggles

### 20. Global Shell

The shell is the frame around every workspace.

**Top Ribbon (48px height):**
```
[Workspace Tabs] ──── [Market Phase Badge] ── [Spot: ₹24,520.45 ●] ── [Rate: 78%] ── [⌘K Search] ── [🔔 Alerts] ── [Connection Badge] ── [15:23:45 IST]
```

- Workspace tabs are always visible. The active tab is highlighted.
- Market Phase Badge shows current session phase with color: green (normal), amber (pre-open/post-close), gray (closed).
- Spot shows the active symbol's spot with freshness dot.
- Rate shows rate limit headroom percentage. Green > 50%, amber 20-50%, red < 20%.
- Search opens the command palette.
- Alerts badge shows count of unacknowledged alerts.
- Connection badge: green "Live" or amber "Polling" or red "Disconnected".
- Time is always IST, always visible.

**Command Palette (⌘K or Ctrl+K):**
- Fuzzy search across: workspaces, symbols, actions, recent items
- Actions: "Go to Market NIFTY", "Stage Iron Condor", "Show Positions", "Open Journal"
- Recent: last 10 navigations

**Persistent Bottom Dock (expandable, default collapsed to 32px):**
- Notification log (info, warnings, errors — last 100 items)
- Active execution sessions (if any are in progress)
- Automation event feed (if any rules triggered)

### 21. Keyboard Model

Every primary action is keyboard-accessible.

**Global:**
| Key | Action |
|---|---|
| `Ctrl+K` / `⌘K` | Command palette |
| `G L` | Go to Launchpad |
| `G M` | Go to Market |
| `G S` | Go to Strategy |
| `G E` | Go to Execution |
| `G P` | Go to Portfolio |
| `G R` | Go to Risk |
| `G O` | Go to Ops |
| `Escape` | Close modal / collapse inspector / exit command palette |
| `/` | Focus symbol search |

**Chain (when chain has focus):**
| Key | Action |
|---|---|
| `↑` / `↓` | Navigate strikes |
| `B` | BUY CE at focused strike |
| `S` | SELL CE at focused strike |
| `Shift+B` | BUY PE at focused strike |
| `Shift+S` | SELL PE at focused strike |
| `Enter` | Open strike inspector |
| `Home` | Go to ATM |
| `G` | Toggle Greeks columns |

**Strategy Builder:**
| Key | Action |
|---|---|
| `Ctrl+Enter` | Preview (fetch margin) |
| `Ctrl+Shift+Enter` | Execute (after preview) |
| `Delete` / `Backspace` | Remove focused leg |
| `+` / `-` | Increment / decrement lots on focused leg |

**Execution:**
| Key | Action |
|---|---|
| `Ctrl+Shift+X` | Emergency: cancel all pending orders (with type-to-confirm) |

### 22. Visual System

**Color Palette:**
- Background: `#0f1117` (near-black), `#1a1d27` (card/panel background)
- Surface: `#252833` (elevated surfaces), `#2f3341` (hover)
- Border: `#363a4a` (subtle), `#4a4f62` (emphasis)
- Text: `#e8eaed` (primary), `#9aa0b0` (secondary), `#636878` (tertiary)
- Accent: `#f5a623` (amber — focus, active, command)
- Positive: `#34d399` (emerald — profit, connected, success)
- Negative: `#f87171` (red — loss, error, sell)
- Analytical: `#818cf8` (indigo — projections, scenarios, tier 3)
- Streaming: `#22d3ee` (cyan — live data, connected indicator)

**Typography:**
- Monospace for all numerical data: `JetBrains Mono` or `IBM Plex Mono`
- Sans-serif for labels and text: `Inter`
- No font larger than 16px in data-dense surfaces. Default table cell: 12px. Default label: 11px.

**Rules:**
- No rounded corners larger than 4px. This is a terminal, not a consumer app.
- No shadows. Elevation is communicated through background color steps.
- No animations longer than 200ms except flash highlights (600ms).
- Dense table rows: 28px height. Compact mode: 24px.
- Every icon has a text label or tooltip. No icon-only buttons for critical actions.

---

## PART V — DOMAIN SPECIFICATIONS

---

### 23. Seller Intelligence Engine

The seller intelligence engine is the product differentiator. It answers: what should the seller trade right now, and why?

#### 23.1 Regime Detection

The regime engine classifies the current market environment into one of:

- **Low Vol Range**: VIX < 14, NIFTY in a ±2% range over 5 sessions → favor short strangles, iron condors
- **High Vol Range**: VIX > 18, NIFTY in a ±2% range → favor short straddles (premium is rich)
- **Trending Up**: NIFTY up > 2% over 5 sessions, VIX stable → favor bull put spreads
- **Trending Down**: NIFTY down > 2% over 5 sessions, VIX rising → favor bear call spreads
- **Breakout**: VIX spike > 30% in 2 sessions → reduce exposure, tighten stops
- **Expiry Compression**: DTE ≤ 2, VIX stable → favor ATM short strangles (rapid theta decay)

**Inputs:** Spot price history (from backend candles), current VIX (from market indices), DTE, current IV rank.

**Output:** `{ regime: string, confidence: number, description: string, favoredStrategies: string[] }`

**Where computed:** Backend, in `services/intelligence/regime.py`. Cached for 5 minutes. Refreshed on manual request or workspace entry.

**Display:** Launchpad workspace shows the regime prominently. Market workspace shows it in the stats strip. Strategy workspace filters templates by regime compatibility.

#### 23.2 Opportunity Scoring

For each candidate seller strategy (generated from current chain data), the engine scores it on:

- **Credit / Margin ratio**: higher is better (capital efficiency)
- **Probability of profit**: estimated from delta of short strikes
- **Expected value**: (probability of full profit × max profit) + (probability of loss × expected loss)
- **Regime fit**: does this strategy match the current regime?
- **Book compatibility**: does this strategy conflict with existing positions? (Same instrument/expiry increases concentration risk)

**Output:** Ranked list of `SellerOpportunity { strategy: StrategyDraft, score: number, breakdown: ScoreBreakdown }`

**Display:** Launchpad shows top 5 opportunities. Strategy workspace shows the full ranked list with explanations.

### 24. Automation Engine

The automation engine evaluates trigger conditions against live market data and executes actions when triggered.

#### 24.1 Rule Model

```typescript
interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: TriggerCondition;
  action: AutomationAction;
  cooldownSeconds: number;        // minimum time between consecutive triggers
  maxExecutions: number;          // 0 = unlimited, 1 = one-shot
  executionCount: number;
  lastTriggeredAt: number | null;
}

type TriggerCondition =
  | { type: 'spot_crosses'; symbol: SymbolCode; direction: 'above' | 'below'; level: number }
  | { type: 'pnl_threshold'; strategyId: string; direction: 'above' | 'below'; amount: number }
  | { type: 'delta_breach'; strategyId: string; absThreshold: number }
  | { type: 'time'; time: string; days: string[] }  // e.g., '15:00', ['Mon','Tue','Wed','Thu','Fri']
  | { type: 'iv_change'; contract: OptionContract; direction: 'above' | 'below'; level: number };

type AutomationAction =
  | { type: 'alert'; message: string }
  | { type: 'close_strategy'; strategyId: string }
  | { type: 'execute_adjustment'; adjustmentDraft: StrategyDraft }
  | { type: 'webhook'; url: string; payload: object };
```

#### 24.2 Evaluation Loop

The backend evaluates rules every 5 seconds when the market is open:

```python
async def evaluation_loop():
    while market_is_open():
        rules = db.get_enabled_rules()
        for rule in rules:
            if rule.is_cooled_down() and rule.has_executions_remaining():
                if evaluate_trigger(rule.trigger, current_state):
                    result = execute_action(rule.action)
                    db.record_event(rule.id, trigger_snapshot, result)
                    rule.record_execution()
        await asyncio.sleep(5)
```

**Safety constraints:**
- Automation actions that place orders require the rule to have been created with explicit acknowledgment: "This rule will place live orders automatically."
- One-shot rules (max_executions = 1) are automatically disabled after triggering.
- All automation events are persisted and auditable.

### 25. Journal System

The journal captures the trader's learning loop.

#### 25.1 Entry Creation

Journal entries are created:
1. **Automatically on trade open:** When an execution session completes, a journal entry is created with: strategy details, regime at the time, opportunity score, market snapshot (spot, VIX, IV rank).
2. **Automatically on trade close:** When a strategy group status changes to 'closed', a journal entry is created with: realized P&L, holding period, max drawdown during hold, market conditions at close.
3. **Automatically on adjustment:** When an adjustment execution completes, a journal entry links the adjustment to the original strategy.
4. **Manually:** The trader can add notes, tags, and ratings at any time.

#### 25.2 Review Analytics

The journal workspace shows:
- **Outcome distribution:** histogram of realized P&L across all closed strategies
- **Win rate by strategy type:** iron condor win rate, bull put spread win rate, etc.
- **Win rate by regime:** how do outcomes correlate with the regime at entry time?
- **Average holding period:** by strategy type
- **Adjustment effectiveness:** do adjusted strategies have better outcomes than non-adjusted?
- **Mistake tags:** trader-defined tags (e.g., "entered too early", "didn't follow stop loss") with frequency counts

---

## PART VI — OPERATIONS

---

### 26. Deployment

#### 26.1 Target Deployment Model

**Frontend:** Vercel (static SPA). No change from current.

**Backend:** Migrate from Kaggle notebook to a persistent server. Options:
- **Recommended:** Railway, Render, or Fly.io — managed container hosting with persistent storage and always-on processes.
- **Alternative:** Self-hosted VPS (DigitalOcean, AWS Lightsail) with Docker.

**Why Kaggle must be replaced:**
- Kaggle notebooks time out after inactivity.
- No persistent storage (SQLite database is lost on restart).
- Cloudflare tunnel URL changes on every restart.
- No process supervision or auto-restart.

**Migration path:** The backend code is structured as a standard FastAPI application. It runs identically in Kaggle, Docker, or any Python hosting. The only change is the deployment target, not the code.

#### 26.2 Deployment Modes

The backend supports two deployment modes, controlled by environment variable `DEPLOYMENT_MODE`:

**`production`**: Backend runs on a persistent server with a stable URL. Frontend connects directly. WebSocket is available. SQLite database persists across restarts.

**`development`**: Backend runs locally or on Kaggle with a tunnel. Frontend connects via tunnel URL or localhost. CF interstitial detection is active. Health check probes on connect.

The frontend detects the mode from the backend URL pattern (same `isKaggleBackend()` logic from v12, but renamed to `isDevBackend()`).

### 27. Testing Strategy

A live trading terminal without tests is a liability.

#### 27.1 Computation Tests (Unit)

Every mathematical function has tests with known inputs and outputs.

```typescript
// Greeks
test('BS call delta at-the-money is approximately 0.5', () => {
  const d = bsDelta(24500, 24500, 7/365, 0.065, 0.14, 'CE');
  expect(d).toBeCloseTo(0.52, 1);  // slightly above 0.5 due to drift
});

test('BS put delta is call delta minus 1', () => {
  const cd = bsDelta(24500, 24000, 7/365, 0.065, 0.14, 'CE');
  const pd = bsDelta(24500, 24000, 7/365, 0.065, 0.14, 'PE');
  expect(cd + Math.abs(pd)).toBeCloseTo(1.0, 4);
});

// Payoff
test('long call payoff at expiry', () => {
  const pnl = legPnl({ strike: 24500, right: 'CE', action: 'BUY', premium: 100 }, 24700);
  expect(pnl).toBe(100);  // (24700 - 24500) - 100 = 100
});

// Max pain
test('max pain is the strike with minimum total payout', () => {
  const chain = [...];
  const mp = computeMaxPain(chain);
  // Verify by computing total payout at mp and adjacent strikes
  expect(totalPayout(chain, mp)).toBeLessThanOrEqual(totalPayout(chain, mp - 50));
  expect(totalPayout(chain, mp)).toBeLessThanOrEqual(totalPayout(chain, mp + 50));
});

// Formatters
test('fmtOI formats crores correctly', () => {
  expect(fmtOI(15_000_000)).toBe('1.50Cr');
});
```

#### 27.2 Transform Tests (Unit)

```typescript
test('Breeze quote normalization handles both hyphenated and underscored keys', () => {
  const hyphenated = { 'strike-price': '24500', 'ltp': '123.45' };
  const underscored = { 'strike_price': '24500', 'ltp': '123.45' };
  expect(normalizeQuote(hyphenated).strike).toBe(24500);
  expect(normalizeQuote(underscored).strike).toBe(24500);
});

test('position mapping detects SENSEX from stock_code', () => {
  const raw = { stock_code: 'BSESEN', right: 'Call', strike_price: '80000', ... };
  const pos = mapPosition(raw);
  expect(pos.contract.instrument).toBe('BSESEN');
  expect(pos.contract.exchange).toBe('BFO');
});
```

#### 27.3 State Machine Tests (Unit)

```typescript
test('WS reconnection respects backoff', () => {
  const client = new BreezeWsClient();
  client.connect('wss://test', jest.fn(), jest.fn());
  // Simulate 3 consecutive failures
  client._simulateClose();
  expect(client._reconnectDelay).toBe(3000);
  client._simulateClose();
  expect(client._reconnectDelay).toBe(4500);
  client._simulateClose();
  expect(client._reconnectDelay).toBe(6750);
});

test('execution session transitions correctly on partial fill', () => {
  const session = createExecutionSession(draft);
  session.legConfirmed(0, 'ORD001', 42.30);
  expect(session.status).toBe('executing');
  session.legRejected(1, 'Insufficient margin');
  expect(session.status).toBe('partial');
  expect(session.orphanDetected).toBe(true);
});
```

#### 27.4 Integration Tests

```typescript
test('chain fetch → merge → display pipeline', async () => {
  // Mock backend response with known CE+PE quotes
  // Verify merged chain has correct strikes, LTPs, OI
  // Verify Greeks are within 1% of known BS values
  // Verify ATM is correctly identified
});

test('tick update → quote change → flash animation', async () => {
  // Render chain with initial data
  // Simulate tick update for strike 24500 CE with higher LTP
  // Verify the cell shows 'up' flash class
  // Wait FLASH_DURATION_MS + 50
  // Verify flash class is removed
});
```

#### 27.5 Safety Tests

```typescript
test('spot sanity clamp rejects > 10% change', () => {
  const spotManager = new SpotManager();
  spotManager.update('NIFTY', 24500, 'breeze_ws');
  const accepted = spotManager.update('NIFTY', 27000, 'breeze_ws');  // +10.2%
  expect(accepted).toBe(false);
  expect(spotManager.get('NIFTY').price).toBe(24500);  // unchanged
});

test('rate limiter blocks when per-second limit reached', () => {
  const limiter = new RateLimiter(10, 250);
  for (let i = 0; i < 10; i++) limiter.recordCall();
  expect(limiter.canCall()).toBe(false);
});
```

### 28. Observability

The backend logs structured JSON to stdout. Each log entry includes:

```json
{
  "ts": "2025-07-01T10:30:00.000Z",
  "level": "info",
  "module": "execution",
  "event": "leg_confirmed",
  "data": {
    "session_id": "exec_001",
    "leg_index": 0,
    "order_id": "ORD001",
    "fill_price": 42.30,
    "latency_ms": 234
  }
}
```

**Key metrics tracked:**
- Breeze API call count (per endpoint, per minute)
- Breeze API latency (p50, p95, p99)
- WebSocket uptime percentage
- Tick delivery latency (backend receive → frontend display)
- Subscription count
- Rate limit headroom
- Execution session outcomes (completed, partial, failed)
- Automation trigger evaluations per minute

These are available via `/api/diagnostics/*` and displayed in the Ops workspace.

---

## PART VII — BUILD PLAN

---

### 29. Phasing

#### Phase 1: Foundation Corrections (Weeks 1-3)

**Goal:** Make the existing codebase correct and safe before adding features.

**Tasks:**
1. Replace chain Greeks approximation with analytical BS computation from Breeze IV.
2. Make spot backend-authoritative with freshness tracking and sanity clamping.
3. Fix template `setLegs` bug by moving template logic to store.
4. Add `_isConnecting` guard to WS client.
5. Split `kaggle_backend.py` into structured modules.
6. Add SQLite persistence for execution records, automation rules, journal entries.
7. Implement subscription manager with explicit subscribe/unsubscribe diff.
8. Write computation tests for Greeks, payoff, max pain, formatters.
9. Write transform tests for Breeze response normalization.

**Exit criteria:** All existing features work as before. Greeks are correct. Spot is authoritative. Tests pass. Backend is modular.

#### Phase 2: State Architecture (Weeks 4-6)

**Goal:** Replace prop drilling and provider nesting with the target state architecture.

**Tasks:**
1. Introduce TanStack Query for all backend data fetching.
2. Create Zustand terminal store for client state.
3. Implement tick bus with `useSyncExternalStore` integration.
4. Refactor chain rows to subscribe to individual quotes.
5. Refactor strategy builder to use leg references (not copied prices).
6. Migrate to React Router v6 with URL-encoded symbol/expiry.
7. Remove the nested provider tree.
8. Remove `SPOT_PRICES` module-level mutation.
9. Remove `currentChain.current` and `currentSpot.current` refs (replaced by tick bus and Zustand `getState`).

**Exit criteria:** The terminal has the same functionality as before but with the new state architecture. No prop drilling beyond one level. No module-level mutable state.

#### Phase 3: Execution Safety (Weeks 7-9)

**Goal:** Make multi-leg execution trustworthy.

**Tasks:**
1. Implement `ExecutionSession` model on backend with SQLite persistence.
2. Implement sequential execution with per-leg status tracking.
3. Implement orphan detection and the orphan resolution modal.
4. Implement execution recovery on reconnect (`GET /api/execution/active`).
5. Implement rate limiter with headroom monitoring.
6. Implement margin/fee preview endpoint.
7. Build the execution workspace with ticket, monitor, and blotter.
8. Implement strategy grouping as backend-persistent model.
9. Add market session phase awareness.
10. Write execution state machine tests and safety tests.

**Exit criteria:** A 4-leg iron condor can be executed with full per-leg status visibility. If leg 3 fails, the trader sees the partial state and is offered resolution options. Execution records persist across backend restarts.

#### Phase 4: Terminal Shell (Weeks 10-12)

**Goal:** Make it look and feel like a terminal.

**Tasks:**
1. Adopt FlexLayout (or equivalent) for dockable panels.
2. Build design system primitives: DataGrid, MetricStrip, InspectorPanel, ActionBar, ConfirmDialog, FreshnessIndicator.
3. Build the global shell: top ribbon, workspace tabs, command palette, bottom dock.
4. Implement keyboard navigation model (global shortcuts, chain shortcuts, strategy shortcuts).
5. Apply the visual system: color palette, typography, spacing.
6. Build the Launchpad workspace.
7. Refactor the market workspace to use new layout and primitives.
8. Refactor the portfolio workspace with strategy grouping and inspector.
9. Implement saved layouts (localStorage persistence).

**Exit criteria:** The terminal looks and operates like a professional workstation. Keyboard navigation works. Layouts are dockable and saveable. The Launchpad provides a useful morning orientation surface.

#### Phase 5: Risk and Intelligence (Weeks 13-16)

**Goal:** Make the terminal smart.

**Tasks:**
1. Build the risk workspace with scenario engine (spot/time/IV sliders).
2. Build the adjustment desk with ranked suggestions and before/after preview.
3. Implement the regime detection engine on the backend.
4. Implement the opportunity scoring engine on the backend.
5. Build the automation rule editor and evaluation loop.
6. Build the journal system with automatic entry creation.
7. Build the Ops workspace with connection health, rate limits, automation events, journal.
8. Write integration tests for the intelligence pipeline.

**Exit criteria:** The terminal can detect a regime, suggest strategies, execute them safely, monitor risk, recommend adjustments, automate triggers, and record outcomes for review. The complete seller workflow — detect, compare, stage, preview, execute, defend, automate, review — is operational.

### 30. What Is Explicitly Not in Scope

The following are not in this spec and should not be built until the above is complete:

- Multi-broker support (only Breeze)
- Multi-asset support beyond NIFTY and SENSEX F&O
- Backtesting engine
- Social features
- Mobile layout
- Multi-user / team accounts
- Cloud-hosted user data (stays local / single-instance)
- Options analytics beyond BS (no stochastic vol, no jump diffusion)
- Algorithmic execution (TWAP, VWAP, etc. — legs are placed sequentially at market or limit)

These are valid future features. They are not valid now. The terminal must be correct, safe, and operationally excellent for one trader on one broker trading two instruments before it attempts anything else.

---

### 31. How to Know This Spec Succeeded

The spec is successful when a professional options seller can:

1. Open the terminal at 9:10 AM and understand the regime, their book status, and the best opportunities in under 60 seconds.
2. Construct a strategy, see accurate Greeks and payoff, preview margin, and execute — without switching workspaces for steps 2-4.
3. Watch a multi-leg execution proceed with per-leg visibility, and recover cleanly if any leg fails.
4. See their portfolio organized by logical strategy with accurate P&L, not as a flat list of positions.
5. Run a scenario ("what if spot drops 3% tomorrow?") and see the portfolio impact with accurate BS repricing.
6. Receive an adjustment recommendation when a position is stressed, stage it, and execute it without losing context.
7. Set an automation rule ("if NIFTY crosses 25000, close this strangle") and trust it will execute correctly.
8. Review their trading outcomes after a month and see which strategy types, regimes, and holding periods produced the best results.
9. Do all of the above primarily with the keyboard.
10. Trust every number on the screen because it declares its source, freshness, and computational tier.
