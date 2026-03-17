

# Implementation Plan: Gap Analysis and Completion

This document identifies every gap between the implementation plan and the definitive spec, resolves every contradiction, and fills in every missing detail needed to go to code.

---

## 1. Critical Ordering Defect

The plan starts with client infrastructure (Phases 0-2: scaffolding, Query/Zustand/event bus, shell/layout) before fixing the computational and safety defects documented in the spec. This is backwards.

A developer building the new shell on top of wrong Greeks, fragile spot derivation, a broken template handler, and non-atomic execution is building on a defective foundation. Every surface built during Phases 1-2 will inherit these defects and need rework later.

**Required fix:** Insert a new Phase between current Phase 0 and Phase 1. Call it Phase 0.5 or renumber all subsequent phases. I will renumber.

**Corrected phase order:**

| New # | Old # | Name |
|---|---|---|
| 0 | 0 | Freeze Architecture and Prepare Repo |
| 1 | — | **Foundation Corrections** (new, from spec Phase 1) |
| 2 | 1 | Client Platform Spine |
| 3 | 3 | Backend Modularization (moved earlier) |
| 4 | 2 | Shell and Layout |
| 5 | 4 | Market, Chain, and Launchpad |
| 6 | 5 | Strategy and Execution |
| 7 | 6 | Portfolio, Risk, Adjustment |
| 8 | 7 | Automation, Review, Ops |
| 9 | 8 | Hardening |

**Rationale for moving Backend Modularization (old Phase 3) to new Phase 3 (before Shell):** The shell and workspace surfaces in Phase 4 will issue queries to backend endpoints. If the backend is still monolithic when the frontend starts consuming structured API families, the migration creates double work: first building against old endpoints, then migrating to new ones. Modularize the backend before building the new frontend surfaces.

---

## 2. Missing Phase: Foundation Corrections (New Phase 1)

This phase does not exist in the plan. Every task below is required by the spec and missing from the plan.

### 2.1 Replace Chain Greeks with Analytical Black-Scholes

**What exists:** `mergeQuotesToChain()` in the frontend computes Greeks using linear/Gaussian approximations:
```
ce_delta = clamp(0.5 + mono * 2.5, 0.01, 0.99)
gamma = 0.00028 × exp(-((mono × 10)² / 2))
theta = -((ltp || 1) × 0.016 + 1.2)
```

**What must change:** Replace with analytical BS Greeks computed from `(spot, strike, T, r, iv)` where IV comes from Breeze quotes.

**Implementation location:** Create `src/lib/math/greeks.ts`:

```typescript
export interface GreeksInput {
  spot: number;
  strike: number;
  dte: number;        // calendar days
  riskFreeRate: number; // decimal, e.g. 0.065
  iv: number;          // decimal from Breeze, e.g. 0.14
  right: 'CE' | 'PE';
}

export interface GreeksOutput {
  delta: number;
  gamma: number;
  theta: number;  // per day
  vega: number;   // per 1% IV move
}

export function computeGreeks(input: GreeksInput): GreeksOutput | null {
  const { spot, strike, dte, riskFreeRate: r, iv: sigma, right } = input;
  
  if (spot <= 0 || strike <= 0 || sigma <= 0 || isNaN(sigma)) return null;
  
  const T = Math.max(dte, 0.5) / 365;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  
  const nd1 = normalPdf(d1);
  const Nd1 = normalCdf(d1);
  const Nd2 = normalCdf(d2);
  
  const gamma = nd1 / (spot * sigma * sqrtT);
  const vega = (spot * nd1 * sqrtT) / 100; // per 1% IV
  
  if (right === 'CE') {
    return {
      delta: Nd1,
      gamma,
      theta: (-(spot * nd1 * sigma) / (2 * sqrtT) - r * strike * Math.exp(-r * T) * Nd2) / 365,
      vega,
    };
  } else {
    return {
      delta: Nd1 - 1,
      gamma,
      theta: (-(spot * nd1 * sigma) / (2 * sqrtT) + r * strike * Math.exp(-r * T) * normalCdf(-d2)) / 365,
      vega,
    };
  }
}
```

**Where called:** In the chain display layer, not in `mergeQuotesToChain`. The merge function should produce rows with `ce_iv` and `pe_iv` from Breeze. Greeks are computed at render time:

```typescript
// In the chain row or a hook consumed by the chain row
const ceGreeks = useMemo(() => {
  if (!row.ce_iv || row.ce_iv <= 0) return null;
  return computeGreeks({
    spot: spotPrice,
    strike: row.strike,
    dte: daysToExpiry,
    riskFreeRate: 0.065,
    iv: row.ce_iv,
    right: 'CE',
  });
}, [spotPrice, row.strike, daysToExpiry, row.ce_iv]);
```

**Risk-free rate:** Default to 0.065. Add to config with comment noting it should be updated quarterly from RBI 91-day T-bill yield.

**Remove:** The linear `ce_delta`, `pe_delta`, `gamma`, `ce_theta`, `pe_theta`, `vega` computation blocks from `mergeQuotesToChain`. Keep the IV passthrough from Breeze quotes.

**Test file:** `src/lib/math/__tests__/greeks.test.ts` with at minimum:
- ATM CE delta ≈ 0.52 (slightly above 0.5 due to drift)
- Deep ITM CE delta → 1.0
- Deep OTM CE delta → 0.0
- Put-call delta relationship: `ce_delta + |pe_delta| ≈ 1.0`
- Gamma peaks at ATM
- Theta is negative for both CE and PE
- T=0 returns intrinsic value delta only

### 2.2 Make Spot Backend-Authoritative

**What exists:** `SPOT_PRICES` is a mutable module-level object. `spotPrice` React state, `currentSpot.current` ref, and the module object are updated independently in multiple places.

**What must change:** 

Backend side — create `backend/app/services/spot.py`:

```python
class SpotManager:
    def __init__(self):
        self.spots: dict[str, SpotRecord] = {}
    
    def update(self, symbol: str, price: float, source: str) -> bool:
        """Returns False if update was rejected by sanity check."""
        now = time.time()
        if symbol in self.spots:
            prev = self.spots[symbol]
            if abs(price - prev.price) / prev.price > 0.10:
                if now - prev.timestamp < 60:
                    logger.warning(f"Spot update rejected: {symbol} {prev.price} → {price} ({source})")
                    return False
        
        if symbol not in self.spots:
            day_open = price
        else:
            day_open = self.spots[symbol].day_open
        
        self.spots[symbol] = SpotRecord(
            price=price, source=source, timestamp=now, day_open=day_open
        )
        return True
    
    def get(self, symbol: str) -> SpotRecord | None:
        return self.spots.get(symbol)
```

Every backend endpoint that returns market data includes the current spot:
```python
@router.get("/api/market/chain")
async def get_chain(...):
    chain_data = ...
    spot = spot_manager.get(symbol)
    return {
        "chain": chain_data,
        "spot": {
            "price": spot.price,
            "source": spot.source,
            "timestamp": spot.timestamp,
            "day_open": spot.day_open
        }
    }
```

Frontend side:
- Remove `SPOT_PRICES` module-level mutable object.
- Remove `currentSpot.current` ref.
- Spot comes from: (a) chain query response, (b) tick bus spot updates.
- Create `useSpot(symbol)` hook that reads from tick bus via `useSyncExternalStore`.
- The tick bus is seeded with the spot from the initial chain fetch.

### 2.3 Fix Template setLegs Bug

**What exists:** `StrategyBuilder.tsx` template button calls `setLegs()` which is not in scope.

**Fix:** In the current provider-based architecture (before Phase 2 migrates to Zustand), add an `onLoadTemplate` prop to StrategyBuilder:

```typescript
interface Props {
  // ... existing props
  onLoadTemplate: (legs: Omit<OptionLeg, 'id'>[]) => void;
}
```

The template handler calls `onLoadTemplate(newLegs)` instead of `setLegs(prev => [...prev, ...newLegs])`.

The parent (App.tsx or the strategy workspace) implements:
```typescript
const handleLoadTemplate = useCallback((newLegs) => {
  setLegs(prev => [
    ...prev,
    ...newLegs.map(l => ({ ...l, id: nanoid() }))
  ]);
}, []);
```

In Phase 2 when moving to Zustand, this becomes the `loadTemplate` store action.

### 2.4 Add WebSocket Double-Connect Guard

**What exists:** `BreezeWsClient` is a module singleton. React StrictMode double-invokes effects.

**Fix:** Add to `BreezeWsClient`:

```typescript
private _isConnecting = false;

private _connect(): void {
  if (this._isConnecting) return;
  if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;
  this._isConnecting = true;
  // ... existing logic ...
  this.ws!.onopen = () => {
    this._isConnecting = false;
    // ... existing logic ...
  };
  this.ws!.onerror = () => {
    this._isConnecting = false;
    // ... existing logic ...
  };
  this.ws!.onclose = () => {
    this._isConnecting = false;
    // ... existing logic ...
  };
}
```

### 2.5 Add Heartbeat Timeout

**What exists:** The WS client only detects connection loss through `onerror` and `onclose` events.

**Fix:** Add to `BreezeWsClient`:

```typescript
private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
private HEARTBEAT_TIMEOUT_MS = 45_000;

private _resetHeartbeat(): void {
  if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
  this.heartbeatTimer = setTimeout(() => {
    console.warn('WS heartbeat timeout — no message in 45s, reconnecting');
    this.ws?.close();
  }, this.HEARTBEAT_TIMEOUT_MS);
}

// In onmessage handler, after processing:
this._resetHeartbeat();

// In disconnect():
if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
```

The backend must send heartbeat messages every 15 seconds when no tick data is available. Add to the backend WebSocket handler:

```python
async def heartbeat_loop(websocket):
    while True:
        await asyncio.sleep(15)
        try:
            await websocket.send_json({
                "version": tick_store.version,
                "quotes": [],
                "spots": {},
                "timestamp": time.time(),
                "heartbeat": True
            })
        except:
            break
```

### 2.6 Subscription Manager

**What exists:** `subscribeOptionChain()` sends `POST /api/ws/subscribe` but there is no unsubscription, no diffing, and no subscription tracking.

**Backend implementation** — create `backend/app/services/subscription.py`:

```python
class SubscriptionManager:
    MAX_SUBSCRIPTIONS = 100
    
    def __init__(self, breeze_client):
        self.breeze = breeze_client
        self.active: dict[str, set[str]] = {}  # channel → set of contract_keys
    
    def set_chain(self, instrument: str, expiry: str, strikes: list[int], rights: list[str]) -> dict:
        channel = f"{instrument}:{expiry}"
        new_keys = set()
        for strike in strikes:
            for right in rights:
                key = f"{instrument}:{'NFO' if instrument == 'NIFTY' else 'BFO'}:{expiry}:{strike}:{right}"
                new_keys.add(key)
        
        old_keys = self.active.get(channel, set())
        
        to_unsub = old_keys - new_keys
        to_sub = new_keys - old_keys
        
        # Enforce limit
        total_other = sum(len(v) for k, v in self.active.items() if k != channel)
        allowed = self.MAX_SUBSCRIPTIONS - total_other
        if len(new_keys) > allowed:
            # Trim from edges (keep ATM-centered)
            sorted_strikes = sorted(strikes)
            mid = len(sorted_strikes) // 2
            trimmed = []
            for i in range(mid, -1, -1):
                if len(trimmed) >= allowed // 2: break
                trimmed.append(sorted_strikes[i])
            for i in range(mid + 1, len(sorted_strikes)):
                if len(trimmed) >= allowed: break
                trimmed.append(sorted_strikes[i])
            # Recalculate new_keys with trimmed strikes
            # ... (omitted for brevity but straightforward)
        
        errors = []
        for key in to_unsub:
            try:
                self.breeze.unsubscribe_feeds(parse_contract_key(key))
            except Exception as e:
                errors.append(f"unsub {key}: {e}")
        
        for key in to_sub:
            try:
                self.breeze.subscribe_feeds(parse_contract_key(key))
            except Exception as e:
                errors.append(f"sub {key}: {e}")
        
        self.active[channel] = new_keys
        
        return {
            "subscribed": list(new_keys),
            "total": sum(len(v) for v in self.active.values()),
            "dropped": [],  # or trimmed keys if limit was hit
            "errors": errors
        }
    
    def get_status(self) -> dict:
        return {
            "active_count": sum(len(v) for v in self.active.values()),
            "max": self.MAX_SUBSCRIPTIONS,
            "channels": {k: len(v) for k, v in self.active.items()}
        }
```

Frontend side — the chain data hook calls subscribe after a successful chain fetch:

```typescript
const { data: chainSnapshot } = useQuery({
  queryKey: ['market', 'chain', symbol, expiry],
  queryFn: () => api.market.getChain(symbol, expiry),
  onSuccess: (data) => {
    // Seed tick bus
    for (const quote of data.quotes) {
      tickBus.seed(quote);
    }
    // Subscribe to ticks for this chain's strikes
    const strikes = data.quotes.map(q => q.contract.strike);
    const uniqueStrikes = [...new Set(strikes)];
    api.stream.subscribe(symbol, expiry, uniqueStrikes, ['CE', 'PE']);
  },
});
```

### 2.7 Write Foundation Tests

Tests that must exist before Phase 2 begins:

**`src/lib/math/__tests__/greeks.test.ts`** — covered in 2.1 above.

**`src/lib/math/__tests__/payoff.test.ts`:**
```typescript
test('long call payoff', () => {
  expect(legPnl('CE', 'BUY', 24500, 100, 24700)).toBe(100);
  expect(legPnl('CE', 'BUY', 24500, 100, 24400)).toBe(-100);
});
test('short put payoff', () => {
  expect(legPnl('PE', 'SELL', 24500, 80, 24400)).toBe(-20); // -(100-80)
  expect(legPnl('PE', 'SELL', 24500, 80, 24600)).toBe(80);
});
test('iron condor max profit is net credit', () => { ... });
test('unlimited detection uses 3-point boundary check', () => { ... });
```

**`src/lib/math/__tests__/maxPain.test.ts`:**
```typescript
test('max pain minimizes total payout', () => {
  const chain = generateTestChain();
  const mp = computeMaxPain(chain);
  const mpPayout = totalPayout(chain, mp);
  for (const row of chain) {
    expect(totalPayout(chain, row.strike)).toBeGreaterThanOrEqual(mpPayout);
  }
});
```

**`src/lib/formatting/__tests__/formatters.test.ts`:**
```typescript
test('fmtOI', () => {
  expect(fmtOI(15_000_000)).toBe('1.50Cr');
  expect(fmtOI(234_000)).toBe('2.34L');
  expect(fmtOI(4_500)).toBe('4.5K');
  expect(fmtOI(800)).toBe('800');
});
```

**Backend tests** — `backend/tests/test_spot_manager.py`:
```python
def test_sanity_clamp_rejects_large_jump():
    sm = SpotManager()
    sm.update('NIFTY', 24500, 'breeze_rest')
    assert sm.update('NIFTY', 27000, 'breeze_ws') == False
    assert sm.get('NIFTY').price == 24500

def test_accepts_normal_update():
    sm = SpotManager()
    sm.update('NIFTY', 24500, 'breeze_rest')
    assert sm.update('NIFTY', 24520, 'breeze_ws') == True
    assert sm.get('NIFTY').price == 24520
```

### Phase 1 Exit Criteria (additions to plan)

- Greeks columns in the chain show analytically computed values, not linear approximations.
- Spot is backend-authoritative with freshness timestamp in every API response.
- Template loading works without ReferenceError.
- WS client does not double-connect in StrictMode.
- WS client reconnects after 45s heartbeat timeout.
- Subscription manager diffs subscribe/unsubscribe on expiry change.
- All math functions have passing unit tests.

---

## 3. Workspace Count Contradiction

The spec defines 7 workspaces with explicit merger rationale. The plan defines 10 workspaces. This must be resolved.

**Resolution:** Follow the spec. Seven workspaces.

| Workspace | Absorbs |
|---|---|
| Launchpad | (new) |
| Market | Current Market + Chain — chain is the primary panel, market overview is context |
| Strategy | Opportunity leaderboard, builder, compare, playbooks |
| Execution | Ticket, execution monitor, blotter |
| Portfolio | Positions, strategies, funds, orders, trades |
| Risk | Greeks, scenarios, margin, adjustment desk (as sub-panel) |
| Ops | Connection, backend health, rate limits, automation rules/events, journal, diagnostics |

**Impact on the plan:**

Phase 4 task list changes from "split Market into Launchpad/Market/Chain" to "split Market into Launchpad and Market (which includes chain as primary panel)."

Phase 7 task list changes from "rebuild Automation workspace and Journal workspace" to "add Automation and Journal as sub-panels within Ops workspace."

**Route tree (replacing plan's Phase 2 routes):**

```typescript
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
{ path: 'ops', element: <OpsWorkspace /> },
{ path: 'ops/automation', element: <OpsWorkspace /> },
{ path: 'ops/journal', element: <OpsWorkspace /> },
```

---

## 4. Missing Specification: Canonical Type Definitions

The plan does not specify where or when the canonical data types are created. These must be defined in Phase 0 (preparation) and refined in Phase 1 (foundation).

**Create `src/lib/types/instruments.ts`:**

```typescript
export type SymbolCode = 'NIFTY' | 'BSESEN';
export type ExchangeCode = 'NFO' | 'BFO';

export interface OptionContract {
  instrument: SymbolCode;
  exchange: ExchangeCode;
  expiry: string;       // 'DD-MMM-YYYY'
  strike: number;
  right: 'CE' | 'PE';
}

export function contractKey(c: OptionContract): string {
  return `${c.instrument}:${c.exchange}:${c.expiry}:${c.strike}:${c.right}`;
}
```

**Create `src/lib/types/market.ts`:**

```typescript
export interface SpotSnapshot {
  symbol: SymbolCode;
  price: number;
  source: 'breeze_ws' | 'breeze_rest' | 'breeze_quote_median';
  timestamp: number;
  dayOpen: number;
}

export interface QuoteSnapshot {
  contract: OptionContract;
  ltp: number;
  bid: number;
  ask: number;
  oi: number;
  oiChange: number;
  volume: number;
  iv: number;           // decimal
  timestamp: number;
}

export type TruthTier = 'broker' | 'normalized' | 'analytical';

export interface Stamped<T> {
  data: T;
  tier: TruthTier;
  source: string;
  asOf: number;         // Unix ms
}
```

**Create `src/lib/types/strategy.ts`:**

```typescript
export interface StrategyLeg {
  id: string;
  contract: OptionContract;
  action: 'BUY' | 'SELL';
  lots: number;
  orderType: 'market' | 'limit';
  limitPrice?: number;
}

export interface StrategyDraft {
  id: string;
  name?: string;
  templateSource?: string;
  legs: StrategyLeg[];
  createdAt: number;
}
```

**Create `src/lib/types/execution.ts`:**

```typescript
export type ExecutionStatus = 'created' | 'executing' | 'completed' | 'partial' | 'failed' | 'cancelled';
export type LegStatus = 'queued' | 'sending' | 'sent' | 'confirmed' | 'rejected' | 'error';

export interface ExecutionSession {
  id: string;
  draft: StrategyDraft;
  status: ExecutionStatus;
  legs: ExecutionLegRecord[];
  orphanDetected: boolean;
  orphanResolution?: 'pending' | 'reversed' | 'accepted' | 'manual';
  startedAt: number;
  completedAt?: number;
}

export interface ExecutionLegRecord {
  index: number;
  contract: OptionContract;
  action: 'BUY' | 'SELL';
  lots: number;
  orderType: 'market' | 'limit';
  limitPrice?: number;
  status: LegStatus;
  orderId?: string;
  fillPrice?: number;
  fillQuantity?: number;
  error?: string;
  sentAt?: number;
  confirmedAt?: number;
}
```

**Create `src/lib/types/positions.ts`:**

```typescript
export interface LivePosition {
  contract: OptionContract;
  action: 'BUY' | 'SELL';
  quantity: number;
  lots: number;
  averagePrice: number;
  ltp: number;
  pnl: number;
  strategyGroupId?: string;
  source: 'broker';
  timestamp: number;
}

export interface GroupedStrategy {
  id: string;
  name: string;
  template?: string;
  instrument: SymbolCode;
  expiry: string;
  status: 'active' | 'adjusted' | 'closed';
  positions: LivePosition[];
  netDelta: number;
  netGamma: number;
  netTheta: number;
  netVega: number;
  totalPnl: number;
  marginUsed: number;
  executionId: string;
  adjustmentIds: string[];
  createdAt: number;
}
```

These types become the lingua franca. Every API response, every store, every component uses these types. No more ad-hoc inline types.

---

## 5. Missing Specification: Tick Bus Implementation

The plan says "introduce a typed event bus" but does not specify the implementation. The spec defines a `TickBus` class with `useSyncExternalStore` integration.

**Create `src/services/streaming/tickBus.ts`:**

```typescript
import { OptionContract, QuoteSnapshot, SpotSnapshot, contractKey } from '@/lib/types';

type QuoteListener = (quote: QuoteSnapshot) => void;
type SpotListener = (spot: SpotSnapshot) => void;

class TickBus {
  private quoteListeners = new Map<string, Set<QuoteListener>>();
  private spotListeners = new Map<string, Set<SpotListener>>();
  private quotes = new Map<string, QuoteSnapshot>();
  private spots = new Map<string, SpotSnapshot>();
  private version = 0;

  // Called on initial chain load
  seed(quote: QuoteSnapshot): void {
    const key = contractKey(quote.contract);
    this.quotes.set(key, quote);
  }

  seedSpot(spot: SpotSnapshot): void {
    this.spots.set(spot.symbol, spot);
  }

  // Called by WS client on every tick update
  ingest(update: { quotes: QuoteSnapshot[]; spots: Record<string, SpotSnapshot>; version: number }): void {
    if (update.version <= this.version) return;
    this.version = update.version;

    for (const quote of update.quotes) {
      const key = contractKey(quote.contract);
      this.quotes.set(key, quote);
      this.quoteListeners.get(key)?.forEach(cb => cb(quote));
    }

    for (const [sym, spot] of Object.entries(update.spots)) {
      this.spots.set(sym, spot);
      this.spotListeners.get(sym)?.forEach(cb => cb(spot));
    }
  }

  getQuote(contract: OptionContract): QuoteSnapshot | undefined {
    return this.quotes.get(contractKey(contract));
  }

  getSpot(symbol: string): SpotSnapshot | undefined {
    return this.spots.get(symbol);
  }

  subscribeQuote(contract: OptionContract, cb: QuoteListener): () => void {
    const key = contractKey(contract);
    if (!this.quoteListeners.has(key)) this.quoteListeners.set(key, new Set());
    this.quoteListeners.get(key)!.add(cb);
    return () => { this.quoteListeners.get(key)?.delete(cb); };
  }

  subscribeSpot(symbol: string, cb: SpotListener): () => void {
    if (!this.spotListeners.has(symbol)) this.spotListeners.set(symbol, new Set());
    this.spotListeners.get(symbol)!.add(cb);
    return () => { this.spotListeners.get(symbol)?.delete(cb); };
  }

  getVersion(): number {
    return this.version;
  }
}

export const tickBus = new TickBus();
```

**Create `src/services/streaming/hooks.ts`:**

```typescript
import { useSyncExternalStore, useCallback } from 'react';
import { OptionContract, QuoteSnapshot, SpotSnapshot } from '@/lib/types';
import { tickBus } from './tickBus';

export function useQuote(contract: OptionContract | null): QuoteSnapshot | undefined {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!contract) return () => {};
      return tickBus.subscribeQuote(contract, cb);
    },
    [contract?.instrument, contract?.exchange, contract?.expiry, contract?.strike, contract?.right]
  );

  const getSnapshot = useCallback(() => {
    if (!contract) return undefined;
    return tickBus.getQuote(contract);
  }, [contract?.instrument, contract?.exchange, contract?.expiry, contract?.strike, contract?.right]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useSpot(symbol: string): SpotSnapshot | undefined {
  const subscribe = useCallback(
    (cb: () => void) => tickBus.subscribeSpot(symbol, cb),
    [symbol]
  );
  const getSnapshot = useCallback(() => tickBus.getSpot(symbol), [symbol]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
```

**Integration with WS client:** The existing `BreezeWsClient.onTick` callback feeds into the tick bus:

```typescript
// In the WS connection setup (wherever handleTickUpdate currently lives):
breezeWs.connect(url, (update: TickUpdate) => {
  tickBus.ingest({
    quotes: update.quotes,
    spots: update.spots,
    version: update.version,
  });
}, onStatus);
```

This replaces the current pattern where `handleTickUpdate` calls `applyTicksToChain` and `setChain`. Individual chain rows subscribe to their own contracts and re-render independently.

---

## 6. Missing Specification: Zustand Store Interface

The plan says "create terminal-local stores" but does not define the interface.

**Create `src/state/terminalStore.ts`:**

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import { SymbolCode, StrategyDraft, StrategyLeg, OptionContract } from '@/lib/types';

type WorkspaceId = 'launchpad' | 'market' | 'strategy' | 'execution' | 'portfolio' | 'risk' | 'ops';

interface ChainPreferences {
  showGreeks: boolean;
  showOIBars: boolean;
  showOISignals: boolean;
  strikeRange: number;  // 0 = all
}

interface TerminalState {
  // Workspace
  activeWorkspace: WorkspaceId;
  setActiveWorkspace: (id: WorkspaceId) => void;

  // Selection
  selectedSymbol: SymbolCode;
  selectedExpiry: string;
  setSelectedSymbol: (sym: SymbolCode) => void;
  setSelectedExpiry: (exp: string) => void;

  // Strategy draft (no prices — prices come from tick bus)
  draft: StrategyDraft | null;
  addLeg: (contract: OptionContract, action: 'BUY' | 'SELL') => void;
  removeLeg: (id: string) => void;
  updateLeg: (id: string, update: Partial<StrategyLeg>) => void;
  clearDraft: () => void;
  loadTemplate: (legs: Array<{ contract: OptionContract; action: 'BUY' | 'SELL'; lots: number }>) => void;

  // Chain preferences
  chainPrefs: ChainPreferences;
  updateChainPrefs: (update: Partial<ChainPreferences>) => void;

  // UI transients (not persisted)
  commandPaletteOpen: boolean;
  toggleCommandPalette: () => void;
  focusedStrike: number | null;
  setFocusedStrike: (strike: number | null) => void;
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      activeWorkspace: 'launchpad',
      setActiveWorkspace: (id) => set({ activeWorkspace: id }),

      selectedSymbol: 'NIFTY',
      selectedExpiry: '',
      setSelectedSymbol: (sym) => set({ selectedSymbol: sym }),
      setSelectedExpiry: (exp) => set({ selectedExpiry: exp }),

      draft: null,
      addLeg: (contract, action) => {
        const current = get().draft;
        const newLeg: StrategyLeg = {
          id: nanoid(),
          contract,
          action,
          lots: 1,
          orderType: 'market',
        };
        if (current) {
          set({ draft: { ...current, legs: [...current.legs, newLeg] } });
        } else {
          set({
            draft: {
              id: nanoid(),
              legs: [newLeg],
              createdAt: Date.now(),
            },
          });
        }
      },
      removeLeg: (id) => {
        const current = get().draft;
        if (!current) return;
        const legs = current.legs.filter(l => l.id !== id);
        set({ draft: legs.length > 0 ? { ...current, legs } : null });
      },
      updateLeg: (id, update) => {
        const current = get().draft;
        if (!current) return;
        set({
          draft: {
            ...current,
            legs: current.legs.map(l => l.id === id ? { ...l, ...update } : l),
          },
        });
      },
      clearDraft: () => set({ draft: null }),
      loadTemplate: (legs) => {
        set({
          draft: {
            id: nanoid(),
            legs: legs.map(l => ({ ...l, id: nanoid(), orderType: 'market' as const })),
            createdAt: Date.now(),
          },
        });
      },

      chainPrefs: { showGreeks: false, showOIBars: true, showOISignals: false, strikeRange: 0 },
      updateChainPrefs: (update) => set({ chainPrefs: { ...get().chainPrefs, ...update } }),

      commandPaletteOpen: false,
      toggleCommandPalette: () => set({ commandPaletteOpen: !get().commandPaletteOpen }),
      focusedStrike: null,
      setFocusedStrike: (strike) => set({ focusedStrike: strike }),
    }),
    {
      name: 'sensibull-terminal',
      partialize: (state) => ({
        selectedSymbol: state.selectedSymbol,
        selectedExpiry: state.selectedExpiry,
        chainPrefs: state.chainPrefs,
        activeWorkspace: state.activeWorkspace,
      }),
    }
  )
);
```

---

## 7. Missing Specification: TanStack Query Configuration

The plan says "adopt @tanstack/react-query" but does not specify query keys, stale times, or the API client layer.

**Create `src/services/api/client.ts`:**

```typescript
const API_BASE = ''; // Configured from session

export function createApiClient(baseUrl: string, authToken?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) headers['x-terminal-auth'] = authToken;

  async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(path, baseUrl);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(28_000) });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json();
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(new URL(path, baseUrl).toString(), {
      method: 'POST', headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(28_000),
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json();
  }

  return {
    session: {
      connect: (creds: ConnectRequest) => post<ConnectResponse>('/api/session/connect', creds),
      status: () => get<SessionStatus>('/api/session/status'),
      disconnect: () => post<void>('/api/session/disconnect', {}),
    },
    market: {
      getSpot: (symbol: string) => get<SpotSnapshot>('/api/market/spot', { symbol }),
      getExpiries: (symbol: string) => get<{ expiries: ExpiryInfo[] }>('/api/market/expiries', { symbol }),
      getChain: (symbol: string, expiry: string) => get<ChainResponse>('/api/market/chain', { symbol, expiry }),
      getDepth: (symbol: string, expiry: string, strike: string, right: string) =>
        get<DepthSnapshot>('/api/market/depth', { symbol, expiry, strike, right }),
    },
    stream: {
      subscribe: (symbol: string, expiry: string, strikes: number[], rights: string[]) =>
        post<SubscribeResponse>('/api/stream/subscribe', { symbol, expiry, strikes, rights }),
      status: () => get<StreamStatus>('/api/stream/status'),
    },
    execution: {
      preview: (legs: StrategyLeg[]) => post<PreviewResponse>('/api/execution/preview', { legs }),
      submit: (draft: StrategyDraft) => post<{ executionId: string }>('/api/execution/submit', { draft }),
      getStatus: (id: string) => get<ExecutionSession>(`/api/execution/${id}/status`),
      cancel: (id: string) => post<void>(`/api/execution/${id}/cancel`, {}),
      getActive: () => get<ExecutionSession[]>('/api/execution/active'),
    },
    portfolio: {
      getPositions: () => get<PortfolioResponse>('/api/portfolio/positions'),
      getOrders: () => get<{ orders: OrderRecord[] }>('/api/portfolio/orders'),
      getTrades: () => get<{ trades: TradeRecord[] }>('/api/portfolio/trades'),
      getFunds: () => get<FundsSnapshot>('/api/portfolio/funds'),
    },
    diagnostics: {
      health: () => get<HealthResponse>('/api/diagnostics/health'),
      rateLimits: () => get<RateLimitStatus>('/api/diagnostics/rate-limits'),
      subscriptions: () => get<SubscriptionStatus>('/api/diagnostics/subscriptions'),
    },
  };
}
```

**Create `src/services/api/queries.ts`:**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from './context';

// Market
export function useChainQuery(symbol: string, expiry: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['market', 'chain', symbol, expiry],
    queryFn: () => api.market.getChain(symbol, expiry),
    staleTime: 0,          // always stale — live data from ticks
    refetchInterval: false, // no polling — tick bus handles live updates
    enabled: !!symbol && !!expiry,
  });
}

export function useExpiriesQuery(symbol: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['market', 'expiries', symbol],
    queryFn: () => api.market.getExpiries(symbol),
    staleTime: 5 * 60 * 1000,
  });
}

// Portfolio
export function usePositionsQuery(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['portfolio', 'positions'],
    queryFn: () => api.portfolio.getPositions(),
    staleTime: 0,
    refetchInterval: enabled ? 30_000 : false,
  });
}

export function useOrdersQuery(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['portfolio', 'orders'],
    queryFn: () => api.portfolio.getOrders(),
    staleTime: 0,
    refetchInterval: enabled ? 30_000 : false,
  });
}

export function useFundsQuery(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['portfolio', 'funds'],
    queryFn: () => api.portfolio.getFunds(),
    staleTime: 0,
    refetchInterval: enabled ? 60_000 : false,
  });
}

// Execution
export function useExecutionStatusQuery(executionId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['execution', executionId],
    queryFn: () => api.execution.getStatus(executionId!),
    enabled: !!executionId,
    refetchInterval: 2_000,  // poll during active execution
  });
}

export function useExecuteStrategyMutation() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draft: StrategyDraft) => api.execution.submit(draft),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['execution', 'active'] });
    },
  });
}

export function usePreviewMutation() {
  const api = useApiClient();
  return useMutation({
    mutationFn: (legs: StrategyLeg[]) => api.execution.preview(legs),
  });
}
```

---

## 8. Missing Specification: Market Session Phase

The spec defines this. The plan omits it entirely.

**Create `src/lib/time/sessionPhase.ts`:**

```typescript
export type SessionPhase = 'pre_open' | 'open_auction' | 'normal' | 'post_close' | 'closed';

// IST holidays — update annually
const HOLIDAYS_2025: string[] = [
  '2025-01-26', '2025-02-26', '2025-03-14', '2025-03-31',
  '2025-04-10', '2025-04-14', '2025-04-18', '2025-05-01',
  '2025-06-27', '2025-08-15', '2025-08-27', '2025-10-02',
  '2025-10-21', '2025-10-22', '2025-11-05', '2025-11-26',
  '2025-12-25',
];

export function getCurrentPhase(now: Date = new Date()): SessionPhase {
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  const dateStr = ist.toISOString().slice(0, 10);

  if (day === 0 || day === 6) return 'closed';
  if (HOLIDAYS_2025.includes(dateStr)) return 'closed';

  const minutes = ist.getHours() * 60 + ist.getMinutes();
  if (minutes < 540) return 'closed';        // before 9:00
  if (minutes < 547) return 'pre_open';       // 9:00-9:07
  if (minutes < 555) return 'open_auction';   // 9:07-9:15
  if (minutes < 930) return 'normal';         // 9:15-15:30
  if (minutes < 960) return 'closed';         // 15:30-16:00 gap
  if (minutes < 1000) return 'post_close';    // 16:00-16:40
  return 'closed';
}

export function isExpiryDay(symbol: SymbolCode, now: Date = new Date()): boolean {
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  if (symbol === 'NIFTY' && day === 2) return true;  // Tuesday
  if (symbol === 'BSESEN' && day === 4) return true;  // Thursday
  return false;
}

export function phaseLabel(phase: SessionPhase): string {
  switch (phase) {
    case 'pre_open': return 'Pre-Open';
    case 'open_auction': return 'Opening Auction';
    case 'normal': return 'Market Open';
    case 'post_close': return 'Post-Close';
    case 'closed': return 'Market Closed';
  }
}
```

**Where used:**
- Global ribbon shows phase badge with color
- Order placement is disabled when phase is `closed`, `pre_open`, or `post_close`
- Expiry day banner shows in Market workspace when `isExpiryDay` returns true

---

## 9. Missing Specification: Execution Safety Model

The plan mentions an execution state machine in Phase 5 but does not specify orphan handling, recovery, or the execution session backend model. The spec defines all of these.

### 9.1 Backend Execution Engine

**Create `backend/app/services/execution_engine.py`:**

```python
class ExecutionEngine:
    def __init__(self, breeze_client, db, rate_limiter):
        self.breeze = breeze_client
        self.db = db
        self.limiter = rate_limiter
    
    async def submit(self, draft: StrategyDraft) -> ExecutionSession:
        session = ExecutionSession(
            id=str(uuid4()),
            draft=draft,
            status='created',
            legs=[
                ExecutionLegRecord(
                    index=i,
                    contract=leg.contract,
                    action=leg.action,
                    lots=leg.lots,
                    order_type=leg.order_type,
                    limit_price=leg.limit_price,
                    status='queued',
                )
                for i, leg in enumerate(draft.legs)
            ],
            orphan_detected=False,
            started_at=time.time(),
        )
        self.db.save_execution_session(session)
        
        # Execute asynchronously
        asyncio.create_task(self._execute(session))
        return session
    
    async def _execute(self, session: ExecutionSession):
        session.status = 'executing'
        self.db.update_execution_session(session)
        
        filled_legs = []
        
        for leg in session.legs:
            # Wait for rate limit headroom
            self.limiter.wait_if_needed()
            
            leg.status = 'sending'
            leg.sent_at = time.time()
            self.db.update_execution_leg(leg)
            
            try:
                result = self.breeze.place_order(
                    stock_code=leg.contract.instrument,
                    exchange_code=leg.contract.exchange,
                    product='options',
                    action=leg.action.lower(),
                    order_type=leg.order_type,
                    quantity=str(leg.lots * get_lot_size(leg.contract.instrument)),
                    price=str(leg.limit_price or 0),
                    expiry_date=leg.contract.expiry,
                    right='call' if leg.contract.right == 'CE' else 'put',
                    strike_price=str(leg.contract.strike),
                )
                
                if result.get('Success'):
                    leg.order_id = result['Success'].get('order_id')
                    leg.status = 'confirmed'
                    leg.confirmed_at = time.time()
                    filled_legs.append(leg)
                else:
                    leg.status = 'rejected'
                    leg.error = str(result.get('Error', 'Unknown rejection'))
                    self._handle_failure(session, leg, filled_legs)
                    return
                    
            except Exception as e:
                leg.status = 'error'
                leg.error = str(e)
                
                # Attempt to find the order in the order book
                await asyncio.sleep(3)
                found = await self._find_order_in_book(leg)
                if found:
                    leg.order_id = found['order_id']
                    leg.status = 'confirmed'
                    filled_legs.append(leg)
                else:
                    self._handle_failure(session, leg, filled_legs)
                    return
            
            self.db.update_execution_leg(leg)
        
        # All legs confirmed
        session.status = 'completed'
        session.completed_at = time.time()
        self.db.update_execution_session(session)
        
        # Create strategy group
        self._create_strategy_group(session)
    
    def _handle_failure(self, session, failed_leg, filled_legs):
        if filled_legs:
            session.status = 'partial'
            session.orphan_detected = True
            session.orphan_resolution = 'pending'
        else:
            session.status = 'failed'
        
        # Mark remaining legs as cancelled
        for leg in session.legs:
            if leg.status == 'queued':
                leg.status = 'error'
                leg.error = 'Cancelled: previous leg failed'
                self.db.update_execution_leg(leg)
        
        session.completed_at = time.time()
        self.db.update_execution_session(session)
        
        # Emit orphan event to WebSocket
        self._emit_orphan_alert(session, failed_leg, filled_legs)
```

### 9.2 Frontend Orphan Modal

**Create `src/ui/overlays/OrphanResolutionModal.tsx`:**

This modal appears when the frontend receives an orphan alert via WebSocket or discovers one via `GET /api/execution/active`.

It shows:
1. Which legs filled (with order IDs and fill prices)
2. Which legs failed (with error messages)
3. The resulting net position exposure
4. Four action buttons:
   - "Retry Failed Legs" → `POST /api/execution/{id}/retry`
   - "Reverse Filled Legs" → `POST /api/execution/{id}/reverse`
   - "Accept Partial" → `POST /api/execution/{id}/accept`
   - "Go to Portfolio" → navigate to portfolio

The system never auto-reverses. The trader decides.

### 9.3 Recovery on Reconnect

When the WebSocket reconnects or the app loads:

```typescript
// In the app initialization hook
const { data: activeExecutions } = useQuery({
  queryKey: ['execution', 'active'],
  queryFn: () => api.execution.getActive(),
  refetchOnMount: 'always',
});

useEffect(() => {
  if (activeExecutions?.some(e => e.orphanDetected && e.orphanResolution === 'pending')) {
    setShowOrphanModal(true);
  }
}, [activeExecutions]);
```

---

## 10. Missing Specification: Backend SQLite Schema

The plan mentions SQLite but does not define tables.

**Create `backend/app/storage/schema.sql`:**

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS strategy_groups (
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

CREATE TABLE IF NOT EXISTS strategy_group_legs (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES strategy_groups(id),
  contract_key TEXT NOT NULL,
  action TEXT NOT NULL,
  original_lots INTEGER NOT NULL,
  current_lots INTEGER NOT NULL,
  entry_price REAL NOT NULL,
  order_id TEXT
);

CREATE TABLE IF NOT EXISTS execution_sessions (
  id TEXT PRIMARY KEY,
  strategy_draft_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  orphan_detected INTEGER NOT NULL DEFAULT 0,
  orphan_resolution TEXT,
  started_at REAL NOT NULL,
  completed_at REAL
);

CREATE TABLE IF NOT EXISTS execution_legs (
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

CREATE TABLE IF NOT EXISTS automation_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_json TEXT NOT NULL,
  action_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  cooldown_seconds INTEGER NOT NULL DEFAULT 300,
  max_executions INTEGER NOT NULL DEFAULT 0,
  execution_count INTEGER NOT NULL DEFAULT 0,
  last_triggered_at REAL,
  created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_events (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES automation_rules(id),
  trigger_snapshot_json TEXT NOT NULL,
  action_taken TEXT NOT NULL,
  result_json TEXT,
  timestamp REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  strategy_group_id TEXT REFERENCES strategy_groups(id),
  execution_id TEXT REFERENCES execution_sessions(id),
  entry_type TEXT NOT NULL,
  content TEXT,
  tags_json TEXT,
  market_snapshot_json TEXT,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  timestamp REAL NOT NULL
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);
```

**Create `backend/app/storage/db.py`:**

```python
import sqlite3
import os

DB_PATH = os.environ.get('TERMINAL_DB_PATH', 'terminal.db')

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    conn = get_connection()
    schema_path = os.path.join(os.path.dirname(__file__), 'schema.sql')
    with open(schema_path) as f:
        conn.executescript(f.read())
    conn.close()
```

---

## 11. Missing Specification: Rate Limiter

**Create `backend/app/core/rate_limit.py`:**

```python
from collections import deque
import time

class RateLimiter:
    def __init__(self, per_second: int = 10, per_minute: int = 250):
        self.per_second = per_second
        self.per_minute = per_minute
        self.calls: deque[float] = deque()
    
    def can_call(self) -> bool:
        self._prune()
        if len(self.calls) >= self.per_minute:
            return False
        one_sec_ago = time.time() - 1
        recent = sum(1 for t in self.calls if t >= one_sec_ago)
        return recent < self.per_second
    
    def record_call(self):
        self.calls.append(time.time())
    
    def wait_if_needed(self) -> float:
        if self.can_call():
            self.record_call()
            return 0.0
        wait = max(0, self.calls[-self.per_second] + 1.001 - time.time())
        time.sleep(wait)
        self.record_call()
        return wait
    
    def status(self) -> dict:
        self._prune()
        now = time.time()
        return {
            'calls_last_second': sum(1 for t in self.calls if t >= now - 1),
            'calls_last_minute': len(self.calls),
            'limit_second': self.per_second,
            'limit_minute': self.per_minute,
            'headroom_pct': round(100 * (1 - len(self.calls) / self.per_minute), 1)
        }
    
    def _prune(self):
        cutoff = time.time() - 60
        while self.calls and self.calls[0] < cutoff:
            self.calls.popleft()
```

Every Breeze SDK call goes through `rate_limiter.wait_if_needed()` before executing.

---

## 12. Missing Specification: Visual System

The plan does not mention the visual system. This is needed before the shell is built (Phase 4).

**Create `src/ui/tokens.ts` (or CSS custom properties):**

```typescript
export const colors = {
  bg: {
    primary: '#0f1117',
    card: '#1a1d27',
    elevated: '#252833',
    hover: '#2f3341',
  },
  border: {
    subtle: '#363a4a',
    emphasis: '#4a4f62',
  },
  text: {
    primary: '#e8eaed',
    secondary: '#9aa0b0',
    tertiary: '#636878',
  },
  accent: '#f5a623',     // amber — focus, active, command
  positive: '#34d399',   // emerald — profit, buy, success
  negative: '#f87171',   // red — loss, sell, error
  analytical: '#818cf8', // indigo — projections, tier 3
  streaming: '#22d3ee',  // cyan — live data, connected
};

export const typography = {
  mono: "'JetBrains Mono', 'IBM Plex Mono', monospace",
  sans: "'Inter', system-ui, sans-serif",
  size: {
    xs: '11px',
    sm: '12px',
    base: '13px',
    lg: '14px',
    xl: '16px',
  },
};

export const spacing = {
  row: {
    normal: '28px',
    compact: '24px',
  },
  radius: '4px',     // maximum border radius
};
```

**Rules (to be documented in a style guide file):**
- No `border-radius` > 4px.
- No `box-shadow`. Elevation via background color steps only.
- No animations > 200ms except flash highlights (600ms).
- All numerical data uses monospace font.
- No icon-only buttons for critical actions.
- Every color signal is also conveyed by text or icon.

---

## 13. Missing Specification: Keyboard Model

**Create `src/app/command/keyboardBindings.ts`:**

```typescript
export const GLOBAL_BINDINGS = [
  { key: 'Ctrl+K', action: 'command_palette', label: 'Command Palette' },
  { key: 'Ctrl+Meta+K', action: 'command_palette', label: 'Command Palette (Mac)' },
  { key: '/', action: 'symbol_search', label: 'Symbol Search', ignoreInInputs: true },
  { key: 'Escape', action: 'close_overlay', label: 'Close Modal / Inspector' },
];

export const NAVIGATION_BINDINGS = [
  { sequence: 'g l', action: 'goto_launchpad', label: 'Go to Launchpad' },
  { sequence: 'g m', action: 'goto_market', label: 'Go to Market' },
  { sequence: 'g s', action: 'goto_strategy', label: 'Go to Strategy' },
  { sequence: 'g e', action: 'goto_execution', label: 'Go to Execution' },
  { sequence: 'g p', action: 'goto_portfolio', label: 'Go to Portfolio' },
  { sequence: 'g r', action: 'goto_risk', label: 'Go to Risk' },
  { sequence: 'g o', action: 'goto_ops', label: 'Go to Ops' },
];

export const CHAIN_BINDINGS = [
  { key: 'ArrowUp', action: 'chain_prev_strike' },
  { key: 'ArrowDown', action: 'chain_next_strike' },
  { key: 'b', action: 'buy_ce', ignoreInInputs: true },
  { key: 's', action: 'sell_ce', ignoreInInputs: true },
  { key: 'Shift+B', action: 'buy_pe' },
  { key: 'Shift+S', action: 'sell_pe' },
  { key: 'Enter', action: 'open_strike_inspector' },
  { key: 'Home', action: 'goto_atm' },
  { key: 'g', action: 'toggle_greeks', ignoreInInputs: true },
];

export const STRATEGY_BINDINGS = [
  { key: 'Ctrl+Enter', action: 'preview_strategy' },
  { key: 'Ctrl+Shift+Enter', action: 'execute_strategy' },
  { key: 'Delete', action: 'remove_focused_leg' },
  { key: '+', action: 'increment_lots', ignoreInInputs: true },
  { key: '-', action: 'decrement_lots', ignoreInInputs: true },
];

export const EMERGENCY_BINDINGS = [
  { key: 'Ctrl+Shift+X', action: 'cancel_all_pending', label: 'Cancel All Pending (with confirmation)' },
];
```

The keyboard handler should be a global `useEffect` in the shell that reads from the terminal store and dispatches actions. Sequence bindings (like `g l`) use a small state machine: the `g` key sets a "pending sequence" flag with a 1-second timeout, and the next key completes or cancels the sequence.

---

## 14. Missing Specification: Design System Primitives

The plan mentions "reusable workstation primitives" but does not specify them. These must be built in Phase 4 before workspace surfaces.

### FreshnessIndicator

```typescript
interface FreshnessIndicatorProps {
  timestamp: number;  // Unix ms
  tier: TruthTier;
}

function FreshnessIndicator({ timestamp, tier }: FreshnessIndicatorProps) {
  const age = useAge(timestamp); // re-renders every 5s
  const color = age < 5000 ? 'green' : age < 30000 ? 'amber' : age < 120000 ? 'red' : 'gray';
  const tierLabel = tier === 'broker' ? 'B' : tier === 'normalized' ? 'N' : '~';
  
  return (
    <span className={`freshness-dot freshness-${color}`} title={`${tierLabel} · ${formatAge(age)}`}>
      ●
    </span>
  );
}
```

### MetricStrip

```typescript
interface MetricItem {
  label: string;
  value: string | number;
  format?: 'currency' | 'percent' | 'number' | 'oi';
  trend?: 'up' | 'down' | 'neutral';
  tier?: TruthTier;
  timestamp?: number;
}

function MetricStrip({ items, compact }: { items: MetricItem[]; compact?: boolean }) {
  return (
    <div className="metric-strip">
      {items.map((item, i) => (
        <div key={i} className="metric-item">
          <span className="metric-label">{item.label}</span>
          <span className={`metric-value ${item.trend ? `trend-${item.trend}` : ''}`}>
            {formatMetric(item.value, item.format)}
          </span>
          {item.tier === 'analytical' && <span className="tier-marker">~</span>}
          {item.timestamp && <FreshnessIndicator timestamp={item.timestamp} tier={item.tier || 'normalized'} />}
        </div>
      ))}
    </div>
  );
}
```

### ConfirmDialog

For destructive actions, supports type-to-confirm:

```typescript
interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  typeToConfirm?: string;  // if set, user must type this string to enable confirm button
  onConfirm: () => void;
  onCancel: () => void;
  variant: 'warning' | 'danger';
}
```

---

## 15. Testing Phasing Defect

The plan defers all testing to Phase 9 (Hardening). This is wrong. Tests must be written alongside the code they verify.

**Corrected testing schedule:**

| Phase | Tests Written |
|---|---|
| 1 (Foundation) | Greeks, payoff, max pain, formatters, spot sanity, WS state machine |
| 2 (Platform Spine) | Tick bus ingest/subscribe, store actions, query key patterns |
| 3 (Backend Modular) | Rate limiter, subscription manager, execution engine state transitions, schema migrations |
| 4 (Shell) | Keyboard binding dispatch, session phase detection, layout persistence round-trip |
| 5 (Market/Chain) | Chain merge with real BS Greeks, OI signal classification, CSV export |
| 6 (Strategy/Execution) | Payoff with live prices, template instantiation, execution status polling, orphan detection |
| 7 (Portfolio/Risk) | Strategy grouping reconciliation, scenario repricing, adjustment ranking |
| 8 (Automation/Review/Ops) | Rule evaluation, cooldown enforcement, journal auto-creation |
| 9 (Hardening) | Integration tests, performance profiling, regression suite |

---

## 16. Missing Specification: Backend API Response Envelope

Every backend response should carry truth tier and freshness metadata. The plan mentions this requirement but does not define the envelope.

```python
def stamped_response(data, tier: str, source: str):
    return {
        "data": data,
        "meta": {
            "tier": tier,       # 'broker' | 'normalized' | 'analytical'
            "source": source,   # e.g. 'breeze_get_portfolio_positions', 'bs_greeks'
            "as_of": time.time(),
            "request_id": str(uuid4()),
        }
    }

# Usage:
@router.get("/api/portfolio/positions")
async def get_positions():
    raw = breeze.get_portfolio_positions()
    grouped = position_grouper.group(raw)
    return stamped_response(
        {"positions": raw, "strategies": grouped},
        tier="broker",
        source="breeze_get_portfolio_positions"
    )

@router.get("/api/market/chain")
async def get_chain(symbol: str, expiry: str):
    ce = breeze.get_option_chain_quotes(symbol, expiry, 'Call')
    pe = breeze.get_option_chain_quotes(symbol, expiry, 'Put')
    merged = merge_chain(ce, pe)
    spot = spot_manager.get(symbol)
    return stamped_response(
        {"chain": merged, "spot": spot},
        tier="normalized",
        source="breeze_get_option_chain_quotes_merged"
    )
```

Frontend API client unwraps the envelope:

```typescript
interface ApiResponse<T> {
  data: T;
  meta: {
    tier: TruthTier;
    source: string;
    as_of: number;
    request_id: string;
  };
}

// In the API client, every response is typed as ApiResponse<T>
// Components that display data can access meta.tier and meta.as_of
```

---

## 17. Missing from Phase 4 (Market Workspace): Chain Row Tick Subscription

After Phase 2 introduces the tick bus and Phase 4 builds the market workspace, the chain rows must subscribe to individual contracts instead of receiving the entire chain array.

**Migration path:**

Old pattern (v12):
```
App.tsx → handleTickUpdate → applyTicksToChain → setChain → OptionChain re-renders all rows
```

New pattern:
```
WS message → tickBus.ingest() → each ChainRow's useQuote() fires → only changed rows re-render
```

The chain component receives the initial chain snapshot from the query, renders rows, and each row subscribes to `useQuote(ceContract)` and `useQuote(peContract)`. The `DataCell` flash animation is local to each cell via a ref comparison (as specified in the spec Section 18.2, item 3).

The `useChainStats` hook must also update when ticks arrive. It should derive from the tick bus's latest quotes, not from a monolithic chain array:

```typescript
function useChainStats(strikes: number[], symbol: SymbolCode, expiry: string, spot: SpotSnapshot | undefined) {
  // Subscribe to all quotes for this chain (via a bulk subscription or by reading tick bus state)
  const quotes = useMemo(() => {
    return strikes.flatMap(strike => [
      tickBus.getQuote({ instrument: symbol, exchange: getExchange(symbol), expiry, strike, right: 'CE' }),
      tickBus.getQuote({ instrument: symbol, exchange: getExchange(symbol), expiry, strike, right: 'PE' }),
    ]).filter(Boolean) as QuoteSnapshot[];
  }, [strikes, symbol, expiry, tickBus.getVersion()]); // getVersion triggers re-evaluation
  
  // Compute stats from quotes
  // ...
}
```

Alternatively, `useChainStats` can re-derive on a 1-second interval using `useInterval` rather than on every tick, since stats (PCR, max pain, etc.) don't need per-tick granularity.

---

## 18. Missing from Phase 6 (Strategy/Execution): Preview and Margin

The plan mentions "move preview, margin, repair preview behind explicit execution services" but does not specify the preview response shape or how it integrates with the staged ticket.

**Preview response:**

```typescript
interface PreviewResponse {
  margin: {
    required: number;
    available: number;
    postTradeAvailable: number;
    utilizationPct: number;
  };
  fees: {
    brokerage: number;
    stt: number;
    exchangeFees: number;
    gst: number;
    sebi: number;
    stampDuty: number;
    total: number;
  };
  estimatedCredit: number;     // positive = receive premium, negative = pay premium
  maxLoss: number | null;      // null if unlimited
  maxProfit: number | null;
  breakevens: number[];
  tier: 'broker';              // preview comes from Breeze margin_calculator + preview_order
  timestamp: number;
}
```

**Staged ticket flow:**

```
Draft created (store) → user clicks "Preview" → useMutation(preview) → PreviewResponse displayed
→ user clicks "Execute" → ConfirmDialog (type "EXECUTE" for live orders) → useMutation(submit)
→ ExecutionSession created → redirect to /execution/{id} → poll status every 2s
```

The preview result is displayed inline in the strategy workspace, not in a separate execution workspace. The user only transitions to the execution workspace after clicking Execute.

---

## 19. Missing from Phase 7 (Portfolio/Risk): Strategy Grouping Reconciliation

The plan says "normalize grouped strategy identity using positions, orders, and trades rather than frontend heuristics." This is the right intent. Here is the algorithm.

**Backend `position_grouper.py`:**

```python
class PositionGrouper:
    def __init__(self, db):
        self.db = db
    
    def reconcile(self, broker_positions: list[dict]) -> dict:
        """
        Returns { 'strategies': [...], 'ungrouped': [...] }
        """
        active_groups = self.db.get_active_strategy_groups()
        ungrouped = []
        
        for pos in broker_positions:
            if not is_option(pos):
                continue
            
            contract_key = make_contract_key(pos)
            matched = False
            
            for group in active_groups:
                for leg in group.legs:
                    if leg.contract_key == contract_key and leg.action == pos['action']:
                        # Update leg with current market data
                        leg.current_lots = pos['lots']
                        leg.current_ltp = pos['ltp']
                        matched = True
                        break
                if matched:
                    break
            
            if not matched:
                ungrouped.append(normalize_position(pos))
        
        # Check for closed groups (all legs have current_lots = 0)
        for group in active_groups:
            if all(leg.current_lots == 0 for leg in group.legs):
                group.status = 'closed'
                self.db.update_strategy_group(group)
                self._create_close_journal_entry(group)
        
        # Compute aggregate Greeks for each group
        for group in active_groups:
            if group.status != 'closed':
                self._compute_group_greeks(group)
        
        return {
            'strategies': [g.to_dict() for g in active_groups if g.status != 'closed'],
            'closed': [g.to_dict() for g in active_groups if g.status == 'closed'],
            'ungrouped': ungrouped,
        }
```

---

## 20. Missing: Deployment Migration

The plan does not mention migrating from Kaggle. The spec requires it for persistence (SQLite is lost on Kaggle restart).

**Add to Phase 3 (Backend Modularization):**

- Create a `Dockerfile` for the backend:

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/
COPY kaggle_backend.py .
ENV TERMINAL_DB_PATH=/data/terminal.db
EXPOSE 8000
CMD ["python", "kaggle_backend.py"]
```

- Create a `docker-compose.yml` for local development.
- Document deployment to Railway/Render/Fly.io as a separate ops runbook, but ensure the code is container-ready by the end of Phase 3.
- Add a `VOLUME /data` for SQLite persistence.

---

## 21. Corrected Phase Plan Summary

| Phase | Name | Weeks | Key Deliverables |
|---|---|---|---|
| 0 | Prepare Repo | 1 | Dependencies, scaffolding, type definitions, file classification |
| 1 | Foundation Corrections | 2 | BS Greeks, spot authority, template fix, WS guards, subscription manager, foundation tests |
| 2 | Client Platform Spine | 2 | TanStack Query, Zustand store, tick bus, event bus, streaming refactor |
| 3 | Backend Modularization | 2 | Package split, route families, Breeze extraction, SQLite, rate limiter, Dockerfile, compatibility adapters |
| 4 | Shell and Layout | 2 | React Router, docking library, global ribbon, keyboard model, visual system, command palette, bottom dock |
| 5 | Market and Launchpad | 2 | Launchpad workspace, market workspace (chain as primary panel), chain tick subscription, design primitives |
| 6 | Strategy and Execution | 2 | Builder refactor (leg references), preview/margin, execution engine, orphan modal, execution workspace |
| 7 | Portfolio and Risk | 2 | Strategy grouping, portfolio workspace, scenario engine, adjustment desk, risk workspace |
| 8 | Ops (Automation, Journal, Diagnostics) | 2 | Automation rule editor, evaluation loop, journal auto-creation, ops workspace |
| 9 | Hardening | 2 | Integration tests, performance profiling, edge case coverage, regression suite |

Total: ~19 weeks for a single developer, ~10-12 weeks for two developers working on frontend and backend respectively.

---

## 22. Corrected PR Sequence

| # | Branch Name | Phases Covered | Contents |
|---|---|---|---|
| 1 | `foundation-types-and-math` | 0 + 1 (partial) | Canonical types, BS Greeks, formatters, spot sanity, tests |
| 2 | `foundation-fixes` | 1 (remaining) | Template fix, WS guard, heartbeat, subscription manager |
| 3 | `client-spine` | 2 | TanStack Query, Zustand, tick bus, API client, streaming refactor |
| 4 | `backend-modular` | 3 | Package split, route modules, Breeze extraction, SQLite, rate limiter, Dockerfile |
| 5 | `shell-layout` | 4 | React Router, docking, ribbon, keyboard, visual system, command palette |
| 6 | `market-launchpad` | 5 | Launchpad, market workspace, chain tick subscription, design primitives |
| 7 | `strategy-execution` | 6 | Builder refactor, preview, execution engine, orphan handling |
| 8 | `portfolio-risk` | 7 | Strategy grouping, portfolio, scenarios, adjustment desk |
| 9 | `ops-automation-journal` | 8 | Automation, journal, diagnostics, ops workspace |
| 10 | `hardening` | 9 | Integration tests, performance, regression |

PRs 1-2 can be developed in parallel (types/math is independent of bug fixes). PR 3 and PR 4 can be developed in parallel (frontend spine and backend split are independent). PR 5 depends on both 3 and 4. All subsequent PRs are sequential.

---

## 23. Verification Checklist

Before declaring the plan complete and moving to code, verify that every item below has a specific task assigned to a specific phase:

| Requirement | Phase | Task exists? |
|---|---|---|
| BS Greeks replace linear approximations | 1 | ✓ (Section 2.1) |
| Spot is backend-authoritative | 1 | ✓ (Section 2.2) |
| Template setLegs bug fixed | 1 | ✓ (Section 2.3) |
| WS double-connect guard | 1 | ✓ (Section 2.4) |
| WS heartbeat timeout | 1 | ✓ (Section 2.5) |
| Subscription diffing | 1 | ✓ (Section 2.6) |
| Foundation tests | 1 | ✓ (Section 2.7) |
| Canonical type definitions | 0 | ✓ (Section 4) |
| TanStack Query with query keys | 2 | ✓ (Section 7) |
| Zustand terminal store | 2 | ✓ (Section 6) |
| Tick bus with useSyncExternalStore | 2 | ✓ (Section 5) |
| API client layer | 2 | ✓ (Section 7) |
| Backend package split | 3 | ✓ (Plan Phase 3) |
| SQLite schema | 3 | ✓ (Section 10) |
| Rate limiter | 3 | ✓ (Section 11) |
| Dockerfile | 3 | ✓ (Section 20) |
| Compatibility adapters | 3 | ✓ (Plan Phase 3) |
| React Router with routes | 4 | ✓ (Section 3) |
| Docking layout | 4 | ✓ (Plan Phase 2/4) |
| Global ribbon | 4 | ✓ (Plan Phase 2/4) |
| Keyboard model | 4 | ✓ (Section 13) |
| Visual system | 4 | ✓ (Section 12) |
| Command palette | 4 | ✓ (Plan Phase 2/4) |
| Market session phases | 4 | ✓ (Section 8) |
| Design system primitives | 5 | ✓ (Section 14) |
| FreshnessIndicator | 5 | ✓ (Section 14) |
| Chain row tick subscription | 5 | ✓ (Section 17) |
| Launchpad workspace | 5 | ✓ (Plan Phase 4/5) |
| Market workspace (chain as primary) | 5 | ✓ (Section 3) |
| Strategy builder leg references | 6 | ✓ (Plan Phase 5/6) |
| Preview/margin endpoint | 6 | ✓ (Section 18) |
| Execution engine | 6 | ✓ (Section 9.1) |
| Orphan detection and modal | 6 | ✓ (Section 9.2) |
| Execution recovery | 6 | ✓ (Section 9.3) |
| Backend strategy grouping | 7 | ✓ (Section 19) |
| Position reconciliation | 7 | ✓ (Section 19) |
| Scenario engine | 7 | ✓ (Plan Phase 6/7) |
| Adjustment desk | 7 | ✓ (Plan Phase 6/7) |
| API response envelope | 3 | ✓ (Section 16) |
| Truth tier display rules | 5 | ✓ (Section 14, FreshnessIndicator) |
| Automation rule model | 8 | ✓ (Plan Phase 7/8) |
| Journal auto-creation | 8 | ✓ (Plan Phase 7/8) |
| Ops workspace | 8 | ✓ (Plan Phase 7/8) |
| 7 workspaces (not 10) | 4 | ✓ (Section 3) |
| Tests alongside each phase | 1-9 | ✓ (Section 15) |

No gaps remain. The plan plus this supplement covers every requirement in the spec.
