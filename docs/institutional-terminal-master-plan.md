

<thinking>
The user wants me to write a final, comprehensive specification based on:

1. The Institutional Master Architecture spec (forward-looking, architectural)
2. The Exhaustive Architecture & Specification (backward-looking, implementation-level)
3. My own critical analysis of both
4. The Implementation Plan they've already created
5. My own rigorous thinking to fill gaps

They want this to be the definitive spec they can code against - no ambiguity, no gaps, no contradictions. Let me think deeply about what this needs to be.

Let me identify what's missing or deficient across all three documents:

**Critical gaps I need to address:**

1. **The version mismatch problem**: The Exhaustive spec describes v12 (App.tsx with 21 useState calls, 3 tabs, no domain stores). The Institutional spec describes a system with domain stores, workspace routing, AppShell, etc. The implementation plan assumes the Institutional spec's codebase. I need to reconcile which is the actual starting point and write the spec accordingly.

2. **Concrete data models**: Neither spec provides complete TypeScript interfaces for all canonical entities. The Exhaustive spec has some (OptionRow, OptionLeg, TickData) but the Institutional spec's entities (GroupedPosition, StrategyDraft, ScenarioRun, etc.) are names without shapes.

3. **The execution state machine**: Both specs mention it, the implementation plan describes phases, but nobody has written the actual state machine with transitions, guards, and error states.

4. **Streaming backpressure design**: Mentioned as needed but never specified. The Exhaustive spec documents the current singleton WS client. Nobody has designed the batching/throttling layer.

5. **The keyboard state machine**: Mentioned as modal (normal/chain/ticket/command modes) but never specified with transitions.

6. **Concrete component API contracts**: The Exhaustive spec documents existing components exhaustively. The Institutional spec names new components (terminal panel, data grid, blotter grid, etc.) but doesn't spec them.

7. **SQLite schema**: The implementation plan says use SQLite but doesn't define tables.

8. **The event bus contract**: Mentioned in both specs and the plan but never typed.

9. **Authority metadata**: Both specs say "every surface must show authority" but neither defines the metadata structure or how it flows through the system.

10. **Error recovery flows**: The Exhaustive spec documents current error handling. Neither forward-looking doc specifies recovery flows for partial basket fills, stream degradation, etc.

11. **The actual Greek computation problem**: The Exhaustive spec reveals Greeks are computed with a rough approximation. Neither forward doc addresses whether to move to real BS on the backend or keep the approximation with labeling.

12. **Spot price consolidation**: The Exhaustive spec identifies four representations. The implementation plan doesn't provide the specific consolidation design.

13. **The deployment model**: Vercel + Kaggle notebook + Cloudflare tunnel. The implementation plan doesn't address how backend modularization affects this.

14. **Rate limiting strategy**: The Exhaustive spec mentions Breeze rate limits. Neither forward doc specifies the terminal's rate limiting architecture.

15. **Testing strategy**: The implementation plan mentions tests in Phase 8 but doesn't specify what kind, what coverage, what tooling.

Let me now write the definitive spec. It should be:
- Grounded in what actually exists (using both source specs)
- Specific enough to code against
- Resolving every contradiction
- Filling every gap
- Providing concrete types, schemas, state machines, and algorithms where the previous docs only provided names

Let me structure this carefully.

Actually, let me re-read the user's request more carefully. They say they've already implemented the plan based on the spec, and now want me to go through it and fill in gaps/defects so they can "finally put it in code." So they want the FINAL definitive version.

Let me think about what the structure should be:

1. **Ground truth reconciliation** - What actually exists, resolving the version conflict
2. **Concrete data models** - Full TypeScript types for every entity
3. **State architecture** - Exactly how state flows, with specific store shapes
4. **Execution state machine** - Full specification
5. **Streaming architecture** - Backpressure, batching, event bus types
6. **Keyboard architecture** - State machine with transitions
7. **Backend modules** - Exact file contents and responsibilities
8. **Storage schema** - SQLite tables
9. **Component contracts** - Workstation primitive APIs
10. **Authority metadata** - How it flows through the system
11. **Error recovery** - Specific flows for each failure mode
12. **Migration sequences** - File-by-file migration instructions
13. **Testing** - What to test, how, with what tooling
14. **Performance** - Specific budgets and techniques

This is going to be a very long document. Let me be thorough.

Actually, I want to think about what the user really needs. They have:
- A conceptual architecture spec (Institutional Master)
- A detailed implementation analysis (Exhaustive)
- My critical analysis reconciling the two
- An implementation plan with phases and PRs

What's missing for them to "put it in code"? The concrete engineering specifications:
- Exact type definitions
- Exact state shapes
- Exact API contracts (request/response types)
- Exact state machine definitions
- Exact component interfaces
- Exact file responsibilities
- Exact migration steps
- Exact test requirements

Let me write this as a engineering specification that a developer can directly implement from, filling in all the gaps from the previous documents.

Let me also think about the real defects in the implementation plan:

1. **Phase ordering concern**: The plan puts backend modularization (Phase 3) after shell/layout (Phase 2). But the shell needs new API contracts which need the backend structure. This should be interleaved.

2. **Missing Phase 0 detail**: "Classify files" is vague. Need exact file-by-file decisions.

3. **Missing streaming redesign timing**: The event bus is in Phase 1 but the streaming manager refactor needs to coordinate with WS singleton constraints from the Exhaustive spec.

4. **The template bug fix is not in any phase**: The Exhaustive spec found a runtime crash in StrategyBuilder templates. This isn't in the implementation plan.

5. **Spot price consolidation is not in any phase**: Four representations → one is mentioned nowhere in the phases.

6. **The Greek computation decision is unmade**: Approximate client-side vs. real BS on backend. This affects multiple phases.

7. **No performance budget**: "The terminal remains fast" is not a measurable criterion.

8. **No rollback strategy**: If Phase 2 (shell replacement) fails mid-flight, how do you recover?

9. **The LaunchPad workspace is specified but has no data sources**: What backend endpoints feed it? What queries populate the "morning trader workflow"?

10. **Automation "dry-run" is mentioned but never specified**: How does simulation work? Does it use historical data? Real-time shadow execution?

Let me write the comprehensive final spec now. I'll be extremely thorough.

Let me organize this into sections that map directly to implementation work:

Part I: Ground Truth & Starting Point
Part II: Canonical Data Models (full TypeScript)
Part III: State Architecture (stores, queries, events)
Part IV: Backend Architecture (modules, routes, services)
Part V: Storage Schema
Part VI: Streaming & Real-Time Architecture
Part VII: Execution State Machine
Part VIII: Shell & Layout Architecture
Part IX: Keyboard Architecture
Part X: Workstation Component System
Part XI: Workspace Specifications (concrete panel compositions)
Part XII: Authority & Provenance System
Part XIII: Error Recovery Flows
Part XIV: Performance Budgets & Techniques
Part XV: Testing Strategy
Part XVI: Migration Sequences (file-by-file)
Part XVII: Deployment Architecture
Part XVIII: Defect Register (bugs to fix before any architectural work)
Part XIX: Open Risks & Mitigations

This will be comprehensive. Let me write it.

Hmm, this is going to be extremely long. Let me focus on what adds value beyond what's already written. The user has three documents plus my analysis. I shouldn't repeat what's well-covered. I should:

1. Resolve contradictions definitively
2. Fill in every concrete gap
3. Provide codeable specifications where previous docs gave only concepts
4. Fix defects in the implementation plan
5. Add what's missing entirely

Let me write this now, being thorough but not redundant with well-covered material.
</thinking>

# Sensibull Terminal: Final Engineering Specification

**Version**: 1.0 — Definitive  
**Purpose**: This is the single document a developer opens to build. It resolves every contradiction between the Institutional Master Spec, the Exhaustive v12 Spec, and the Implementation Plan. It fills every gap those documents leave. It provides concrete types, state machines, schemas, component contracts, migration sequences, and performance budgets. Nothing in this document is aspirational without being implementable.

---

## Part I: Ground Truth Reconciliation

The three source documents describe two different evolutionary snapshots of the codebase. This must be resolved before anything else.

### 1.1 The Two Codebases

**Codebase A** (documented by the Exhaustive Spec):
- `App.tsx` holds 21 `useState` calls and 6 refs
- Navigation is a `tab` state variable with three values: `optionchain`, `strategy`, `positions`
- No domain stores exist as runtime state containers
- No router exists
- No shell component exists
- The backend is `kaggle_backend.py` as a single file
- Components: `TopBar`, `OptionChain/*`, `StrategyBuilder`, `Positions`, `ConnectBrokerModal`

**Codebase B** (documented by the Institutional Spec and Implementation Plan):
- `App.tsx` delegates to `AppShell`
- Routing via `useWorkspaceRoute.ts` custom hook with 8+ workspace routes
- Domain stores exist under `src/domains/*`: session, market, execution, portfolio, risk, seller, journal, automation, adjustment
- Shell lives in `src/app/shell/AppShell.tsx` with `WorkspaceNav`, `WorkspaceHeader`, `WorkspaceSubnav`, `CommandPalette`
- Backend is still `kaggle_backend.py` but with more endpoints (preview, margin, repair-preview, automation rules, callbacks, reviews)
- Broker access centralized in `src/services/broker/brokerGatewayClient.ts`
- Streaming in `src/services/streaming/unifiedStreamingManager.ts`

**Resolution**: Codebase B is the current state. Codebase A represents an earlier version. The Implementation Plan's starting point description (Section 3) confirms Codebase B. However, the Exhaustive Spec's detailed implementation knowledge (authentication, tick processing, chain merging, Greek computation, WebSocket singleton behavior) still applies because those fundamentals were carried forward into Codebase B.

**Governing assumption for this spec**: The starting point is Codebase B with the implementation internals documented in the Exhaustive Spec still operative underneath.

### 1.2 What Survives From Each Source

From the Exhaustive Spec, these implementation details are carried forward as ground truth:
- SHA-256 checksum generation and 8-variant validation sequence
- `SPOT_PRICES` mutable module-level object (still exists, still a problem)
- `BreezeWsClient` singleton with version dedup and reconnection backoff
- `mergeQuotesToChain()` algorithm with approximate Greek computation
- `applyTicksToChain()` delta merge
- `mapBreezePositions()` polymorphic response handling
- Max pain O(n²) computation
- Flash cell animation infrastructure
- All Breeze API field name variants (hyphenated and underscored)
- Cloudflare interstitial detection

From the Institutional Spec, these architectural targets are carried forward:
- Three-tier truth model
- Seller-first workflow orientation
- Bloomberg-class terminal UX direction
- Eight architectural planes
- Workspace specifications
- Backend modularization target

From the Implementation Plan, the phase structure and PR sequence are carried forward with corrections specified in Part XVI.

---

## Part II: Defect Register

These must be fixed before or during Phase 0. They are not optional and they are not "tech debt to address later."

### Defect 1: StrategyBuilder Template ReferenceError

**Location**: `src/components/StrategyBuilder.tsx`, template button onClick handlers  
**Severity**: Runtime crash — `ReferenceError: setLegs is not defined`  
**Root cause**: Template handlers reference `setLegs` which is not in the component's scope. The component receives `onUpdateLeg` and `onRemoveLeg` but not a legs setter.

**Fix**:
```typescript
// Add to StrategyBuilder props:
interface StrategyBuilderProps {
  // existing props...
  onSetLegs: (legs: OptionLeg[]) => void;
}

// In App.tsx or parent:
const handleSetLegs = useCallback((newLegs: OptionLeg[]) => {
  setLegs(newLegs);
}, []);

// In template handler:
onClick={() => {
  const newLegs = template.build(spotPrice, cfg.strikeStep)
    .map(l => ({ ...l, id: nextId(), symbol, expiry: expiry.breezeValue }));
  onSetLegs(newLegs);
}}
```

### Defect 2: Four Spot Price Representations

**Locations**:
- `SPOT_PRICES[sym]` — mutable module constant in `config/market.ts`
- `spotPrice` — React state in App.tsx (or marketStore)
- `currentSpot.current` — ref in App.tsx tick handler
- `dayOpenRef.current[sym]` — ref for day-open snapshot

**Fix**: Consolidate to one authoritative source:
```typescript
// src/state/market/spotPriceStore.ts
import { create } from 'zustand';

interface SpotPriceState {
  prices: Record<SymbolCode, number>;
  dayOpens: Record<SymbolCode, number>;
  lastUpdated: Record<SymbolCode, number>;
  
  setSpot: (symbol: SymbolCode, price: number) => void;
  setDayOpen: (symbol: SymbolCode, price: number) => void;
  getSpot: (symbol: SymbolCode) => number;
}

export const useSpotPriceStore = create<SpotPriceState>((set, get) => ({
  prices: { NIFTY: 24520, BSESEN: 80450 },
  dayOpens: {},
  lastUpdated: {},
  
  setSpot: (symbol, price) => {
    const current = get().prices[symbol];
    // 15% sanity clamp
    if (current && Math.abs(price - current) / current > 0.15) return;
    set(state => ({
      prices: { ...state.prices, [symbol]: price },
      lastUpdated: { ...state.lastUpdated, [symbol]: Date.now() }
    }));
  },
  
  setDayOpen: (symbol, price) => set(state => ({
    dayOpens: { ...state.dayOpens, [symbol]: price }
  })),
  
  getSpot: (symbol) => get().prices[symbol] ?? 0,
}));
```

Remove `SPOT_PRICES` module constant. Remove `currentSpot.current` ref. Remove `dayOpenRef.current`. The Zustand store's `getState()` replaces refs in non-React callbacks (WS handler).

### Defect 3: WS Double-Connect in StrictMode

**Location**: `src/utils/breezeWs.ts` (or `src/services/streaming/unifiedStreamingManager.ts`)

**Fix**:
```typescript
private _connectingPromise: Promise<void> | null = null;

async connect(url: string, onTick: TickCallback, onStatus: StatusCallback): Promise<void> {
  if (this._connectingPromise) return this._connectingPromise;
  this._connectingPromise = this._doConnect(url, onTick, onStatus);
  try {
    await this._connectingPromise;
  } finally {
    this._connectingPromise = null;
  }
}
```

### Defect 4: Approximate Greeks Not Labeled

**Location**: `mergeQuotesToChain()` in App.tsx or marketStore

**Current**: `ce_delta = clamp(0.5 + mono * 2.5, 0.01, 0.99)` — unlabeled approximation.

**Fix**: Every `OptionRow` must carry a `greekSource` field:

```typescript
interface OptionRow {
  // existing fields...
  greekSource: 'approximate' | 'black-scholes' | 'broker';
}
```

UI must display a visual indicator when `greekSource === 'approximate'`. The Chain desk header should show "Greeks: Approx" or "Greeks: BS" based on computation mode.

**Phase 1 action**: Add the field and label. **Phase 4 action**: Move to real BS computation on the backend via `/api/market/greeks` endpoint.

### Defect 5: PE Theta Bug

**Location**: `mergeQuotesToChain()`

**Current code** (from Exhaustive Spec): PE theta was computed using `ce_ltp` instead of `pe_ltp`.

**Verification needed**: Check if this was already fixed in the current codebase (the Exhaustive Spec says "FIX-2: uses pe_ltp (was ce_ltp bug)" — suggesting it may have been fixed). If not fixed, apply:
```typescript
pe_theta = -((pe_ltp || 1) * 0.016 + 1.2);  // NOT ce_ltp
```

---

## Part III: Canonical Data Models

These are the authoritative TypeScript types for the entire system. Every component, store, query, and API response must use these types or strict subtypes of them.

### 3.1 Authority Metadata

```typescript
// Every piece of data in the system carries this
interface AuthorityMeta {
  authority: 'broker' | 'normalized' | 'analytical';
  source: string;        // e.g. 'breeze-rest', 'breeze-ws', 'bs-model', 'heuristic'
  asOf: number;          // Unix timestamp ms
  stale: boolean;        // computed: Date.now() - asOf > STALE_THRESHOLD
}

// Wrapper for any authoritative value
interface Authoritative<T> {
  value: T;
  meta: AuthorityMeta;
}

// Constants
const STALE_THRESHOLDS = {
  quote: 30_000,       // 30s for live quotes
  position: 60_000,    // 60s for positions
  order: 10_000,       // 10s for order status
  greeks: 60_000,      // 60s for Greeks
  risk: 120_000,       // 2min for risk aggregates
} as const;
```

### 3.2 Market Domain

```typescript
type SymbolCode = 'NIFTY' | 'BSESEN';
type Exchange = 'NFO' | 'BFO';
type CashExchange = 'NSE' | 'BSE';
type OptionRight = 'CE' | 'PE';
type BreezeRight = 'Call' | 'Put';

interface SymbolConfig {
  code: SymbolCode;
  displayName: string;
  exchange: Exchange;
  cashExchange: CashExchange;
  breezeStockCode: string;
  breezeExchangeCode: string;
  cashBreezeStockCode: string;   // 'NIFTY' for NSE, 'SENSEX' for BSE
  cashBreezeExchangeCode: string; // 'NSE' or 'BSE'
  strikeStep: number;
  lotSize: number;
  expiryDay: 'Tuesday' | 'Thursday';
  color: string;
  bg: string;
}

interface ExpiryDate {
  label: string;              // '01 Jul 25'
  breezeValue: string;        // '01-Jul-2025'
  daysToExpiry: number;
  weekday: string;
  isWeekly: boolean;
  isMonthly: boolean;
}

interface OptionRow {
  strike: number;
  isATM: boolean;
  
  ce_ltp: number;
  ce_bid: number;
  ce_ask: number;
  ce_oi: number;
  ce_oiChg: number;
  ce_volume: number;
  ce_iv: number;
  ce_delta: number;
  ce_theta: number;
  ce_gamma: number;
  ce_vega: number;
  ce_ltpChg: number;
  
  pe_ltp: number;
  pe_bid: number;
  pe_ask: number;
  pe_oi: number;
  pe_oiChg: number;
  pe_volume: number;
  pe_iv: number;
  pe_delta: number;
  pe_theta: number;
  pe_gamma: number;
  pe_vega: number;
  pe_ltpChg: number;
  
  greekSource: 'approximate' | 'black-scholes' | 'broker';
}

interface DepthLevel {
  price: number;
  quantity: number;
  orders: number;
}

interface DepthSnapshot {
  symbol: SymbolCode;
  strike: number;
  right: OptionRight;
  bids: DepthLevel[];
  asks: DepthLevel[];
  meta: AuthorityMeta;
}

interface CandleBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

### 3.3 Strategy Domain

```typescript
interface OptionLeg {
  id: string;
  symbol: SymbolCode;
  type: OptionRight;
  strike: number;
  action: 'BUY' | 'SELL';
  lots: number;
  ltp: number;
  iv: number;
  delta: number;
  theta: number;
  gamma: number;
  vega: number;
  expiry: string;           // breezeValue format
  orderType: 'market' | 'limit';
  limitPrice?: number;
}

interface StrategyDraft {
  id: string;
  name: string;
  legs: OptionLeg[];
  symbol: SymbolCode;
  createdAt: number;
  source: 'manual' | 'template' | 'opportunity' | 'repair';
  sourceId?: string;        // links to opportunity or adjustment
  notes?: string;
}

interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  legs: Array<{
    type: OptionRight;
    action: 'BUY' | 'SELL';
    strikeOffset: number;   // multiples of strikeStep from ATM
    lotsMultiplier: number;
  }>;
  category: 'bullish' | 'bearish' | 'neutral' | 'volatility';
}

interface PayoffPoint {
  price: number;
  pnl: number;
  profit: number | null;    // pnl if >= 0, null otherwise
  loss: number | null;      // pnl if < 0, null otherwise
}

interface StrategyAnalysis {
  payoff: PayoffPoint[];
  maxProfit: number;        // Infinity for unlimited
  maxLoss: number;          // -Infinity for unlimited
  breakevens: number[];
  netGreeks: { delta: number; theta: number; gamma: number; vega: number };
  netPremium: number;       // positive = credit, negative = debit
  popEstimate?: number;     // probability of profit (analytical)
}
```

### 3.4 Execution Domain

```typescript
type OrderStatus = 
  | 'drafted'
  | 'staged'
  | 'previewing'
  | 'previewed'
  | 'sending'
  | 'pending'
  | 'partial'
  | 'filled'
  | 'rejected'
  | 'cancelled'
  | 'failed';

type BasketStatus =
  | 'staged'
  | 'previewing'
  | 'ready'
  | 'sending'
  | 'partial_fill'     // some legs filled, others pending
  | 'all_filled'
  | 'partial_failure'  // some legs filled, some rejected
  | 'all_failed'
  | 'manual_intervention';

interface ExecutionPreview {
  legs: Array<{
    legId: string;
    estimatedFill: number;
    estimatedSlippage: number;
    fees: {
      brokerage: number;
      stt: number;
      transactionCharges: number;
      gst: number;
      sebiCharges: number;
      stampDuty: number;
      total: number;
    };
  }>;
  totalFees: number;
  netPremium: number;
  marginRequired: Authoritative<number>;
  marginAvailable: Authoritative<number>;
  marginUtilization: number;
  meta: AuthorityMeta;
}

interface LiveOrder {
  orderId: string;
  legId?: string;         // links to OptionLeg.id if part of a strategy
  basketId?: string;      // links to basket if multi-leg
  symbol: SymbolCode;
  strike: number;
  right: OptionRight;
  action: 'BUY' | 'SELL';
  quantity: number;
  filledQuantity: number;
  price: number;
  averageFillPrice: number;
  status: OrderStatus;
  orderType: 'market' | 'limit';
  exchange: Exchange;
  expiry: string;
  timestamps: {
    created: number;
    lastModified: number;
    filled?: number;
    cancelled?: number;
    rejected?: number;
  };
  rejectionReason?: string;
  meta: AuthorityMeta;
}

interface BasketOrder {
  basketId: string;
  strategyDraftId: string;
  legs: LiveOrder[];
  status: BasketStatus;
  preview: ExecutionPreview;
  timestamps: {
    staged: number;
    previewed?: number;
    sendStarted?: number;
    completed?: number;
  };
  recoveryAction?: 'cancel_remaining' | 'manual_intervention' | 'auto_hedge';
}
```

### 3.5 Portfolio Domain

```typescript
interface LivePosition {
  positionId: string;
  symbol: SymbolCode;
  strike: number;
  right: OptionRight;
  action: 'BUY' | 'SELL';
  quantity: number;
  lots: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  expiry: string;
  meta: AuthorityMeta;
}

interface GroupedPosition {
  groupId: string;
  name: string;                     // e.g. "NIFTY 24000/24500 Bull Call Spread"
  symbol: SymbolCode;
  legs: LivePosition[];
  strategy: string;                 // detected strategy type
  netPremium: number;
  currentValue: number;
  pnl: number;
  maxProfit: number;
  maxLoss: number;
  breakevens: number[];
  greeks: {
    delta: number;
    theta: number;
    gamma: number;
    vega: number;
  };
  linkedOrderIds: string[];
  linkedTradeIds: string[];
  createdAt: number;
  expiresAt: number;
  meta: AuthorityMeta;
}

interface FundsSnapshot {
  cashBalance: number;
  marginUsed: number;
  marginAvailable: number;
  collateral: number;
  totalEquity: number;
  meta: AuthorityMeta;
}
```

### 3.6 Risk Domain

```typescript
interface RiskSnapshot {
  portfolioDelta: number;
  portfolioTheta: number;
  portfolioGamma: number;
  portfolioVega: number;
  marginUtilization: number;
  maxDrawdown: number;           // worst scenario loss
  concentrationBySymbol: Record<SymbolCode, number>;  // % of margin
  concentrationByExpiry: Record<string, number>;
  meta: AuthorityMeta;
}

interface ScenarioResult {
  spotChange: number;            // percentage
  ivChange: number;              // percentage points
  daysForward: number;
  pnl: number;
  marginRequired: number;
}

interface StressMatrix {
  spotChanges: number[];         // [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10]
  ivChanges: number[];           // [-5, -3, 0, 3, 5]
  results: ScenarioResult[][];   // [spotIdx][ivIdx]
  meta: AuthorityMeta;
}

interface AdjustmentSuggestion {
  id: string;
  targetGroupId: string;
  type: 'repair' | 'roll' | 'close';
  reason: string;
  legs: OptionLeg[];             // new legs to add
  closingLegs?: string[];        // existing leg IDs to close
  metrics: {
    marginDelta: Authoritative<number>;
    maxLossDelta: number;
    breakEvenDelta: number[];
    creditOrDebit: number;
    thesisPreservation: number;  // 0-100 analytical score
  };
  meta: AuthorityMeta;
}
```

### 3.7 Automation Domain

```typescript
type TriggerType = 'price_cross' | 'iv_cross' | 'oi_threshold' | 'pnl_threshold' | 'margin_threshold' | 'time' | 'regime_change';
type ActionType = 'place_order' | 'cancel_order' | 'send_alert' | 'stage_repair' | 'log_event';

interface AutomationRule {
  ruleId: string;
  name: string;
  enabled: boolean;
  trigger: {
    type: TriggerType;
    params: Record<string, number | string>;
    // e.g. { symbol: 'NIFTY', strike: 24000, right: 'CE', field: 'ltp', threshold: 100, direction: 'above' }
  };
  action: {
    type: ActionType;
    params: Record<string, unknown>;
  };
  semantics: 'one_shot' | 'recurring';
  cooldownMs: number;
  lastTriggered?: number;
  triggerCount: number;
  linkedGroupId?: string;
  createdAt: number;
  meta: AuthorityMeta;
}

interface AutomationEvent {
  eventId: string;
  ruleId: string;
  timestamp: number;
  triggerSnapshot: Record<string, unknown>;
  actionResult: {
    success: boolean;
    orderId?: string;
    error?: string;
  };
  idempotencyKey: string;
}
```

### 3.8 Review Domain

```typescript
type JournalSource = 'opportunity' | 'execution' | 'manual' | 'automation';

interface JournalCase {
  caseId: string;
  source: JournalSource;
  sourceId?: string;               // opportunity ID, basket ID, or rule ID
  symbol: SymbolCode;
  strategy: string;
  
  // Entry
  entryDate: number;
  entryRegime?: string;
  entryThesis?: string;
  entryLegs: OptionLeg[];
  
  // Lifecycle
  adjustments: Array<{
    date: number;
    reason: string;
    legs: OptionLeg[];
    resultPnl: number;
  }>;
  
  // Exit
  exitDate?: number;
  exitReason?: string;
  exitLegs?: OptionLeg[];
  realizedPnl?: number;
  
  // Review
  review?: {
    rating: 1 | 2 | 3 | 4 | 5;
    mistakeTags: string[];
    notes: string;
    playBookCompliance: boolean;
    lessonsLearned: string;
    reviewedAt: number;
  };
  
  // Linking
  linkedOrderIds: string[];
  linkedGroupId?: string;
  linkedRuleIds: string[];
}

interface Playbook {
  playbookId: string;
  name: string;
  description: string;
  regime: string;
  strategyType: string;
  entryRules: string[];
  exitRules: string[];
  adjustmentRules: string[];
  riskLimits: {
    maxLots: number;
    maxLoss: number;
    maxMarginPercent: number;
  };
  createdAt: number;
  updatedAt: number;
}
```

### 3.9 Terminal State

```typescript
interface WorkspaceLayout {
  layoutId: string;
  workspaceId: string;
  name: string;
  panels: Array<{
    panelId: string;
    component: string;
    position: { x: number; y: number; w: number; h: number };
    props: Record<string, unknown>;
  }>;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

type KeyboardMode = 'normal' | 'chain' | 'ticket' | 'command';

interface TerminalState {
  activeWorkspace: string;
  symbolLinks: Record<string, SymbolCode>;  // per-workspace linked symbol
  activeExpiry: Record<SymbolCode, string>;
  keyboardMode: KeyboardMode;
  commandPaletteOpen: boolean;
  focusedStrike: number | null;
  stagedDraft: StrategyDraft | null;
  bottomDockVisible: boolean;
  bottomDockActiveTab: string;
  inspectorVisible: boolean;
  inspectorContent: string | null;
}
```

---

## Part IV: State Architecture

### 4.1 Three State Layers

```
┌──────────────────────────────────────────┐
│  Layer 1: Server State                    │
│  @tanstack/react-query                    │
│  - chain, positions, orders, trades       │
│  - funds, margin, preview                 │
│  - automation rules, events               │
│  - reviews, playbooks                     │
│  - all read from backend                  │
│  - all mutations through useMutation      │
│  - automatic staleness, refetch, retry    │
└──────────────────┬───────────────────────┘
                   │ reads
┌──────────────────┴───────────────────────┐
│  Layer 2: Live State                      │
│  Zustand stores (non-React WS callbacks)  │
│  - spot prices                            │
│  - tick accumulator                       │
│  - WS connection status                   │
│  - stream health metrics                  │
│  - live chain overlay (merged with L1)    │
└──────────────────┬───────────────────────┘
                   │ reads
┌──────────────────┴───────────────────────┐
│  Layer 3: Terminal State                  │
│  Zustand stores (UI-local)                │
│  - workspace, layout, panels              │
│  - keyboard mode                          │
│  - selections, filters, sorts             │
│  - staged draft                           │
│  - preferences                            │
│  - command palette                        │
└──────────────────────────────────────────┘
```

### 4.2 Query Keys Convention

```typescript
const queryKeys = {
  chain: (symbol: SymbolCode, expiry: string) => ['chain', symbol, expiry] as const,
  expiries: (symbol: SymbolCode) => ['expiries', symbol] as const,
  spot: (symbol: SymbolCode) => ['spot', symbol] as const,
  depth: (symbol: SymbolCode, strike: number, right: OptionRight) => 
    ['depth', symbol, strike, right] as const,
  candles: (symbol: SymbolCode, interval: string, from: string, to: string) => 
    ['candles', symbol, interval, from, to] as const,
  positions: () => ['positions'] as const,
  groupedPositions: () => ['grouped-positions'] as const,
  orders: () => ['orders'] as const,
  trades: () => ['trades'] as const,
  funds: () => ['funds'] as const,
  preview: (draftId: string) => ['preview', draftId] as const,
  margin: (draftId: string) => ['margin', draftId] as const,
  automationRules: () => ['automation', 'rules'] as const,
  automationEvents: (ruleId?: string) => ['automation', 'events', ruleId] as const,
  journal: () => ['journal'] as const,
  playbooks: () => ['playbooks'] as const,
  riskSnapshot: () => ['risk', 'snapshot'] as const,
  stressMatrix: () => ['risk', 'stress'] as const,
} as const;
```

### 4.3 Zustand Store Definitions

```typescript
// src/state/terminal/terminalStore.ts
export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      activeWorkspace: 'market',
      symbolLinks: {},
      activeExpiry: {},
      keyboardMode: 'normal' as KeyboardMode,
      commandPaletteOpen: false,
      focusedStrike: null,
      stagedDraft: null,
      bottomDockVisible: true,
      bottomDockActiveTab: 'blotter',
      inspectorVisible: false,
      inspectorContent: null,
      
      setWorkspace: (ws: string) => set({ activeWorkspace: ws }),
      setKeyboardMode: (mode: KeyboardMode) => set({ keyboardMode: mode }),
      toggleCommandPalette: () => set(s => ({ commandPaletteOpen: !s.commandPaletteOpen })),
      setFocusedStrike: (strike: number | null) => set({ focusedStrike: strike }),
      stageDraft: (draft: StrategyDraft) => set({ stagedDraft: draft }),
      clearDraft: () => set({ stagedDraft: null }),
      linkSymbol: (workspace: string, symbol: SymbolCode) => 
        set(s => ({ symbolLinks: { ...s.symbolLinks, [workspace]: symbol } })),
    }),
    { name: 'terminal-state', partialize: (s) => ({ 
      symbolLinks: s.symbolLinks, 
      activeExpiry: s.activeExpiry,
      bottomDockVisible: s.bottomDockVisible,
    })}
  )
);
```

```typescript
// src/state/streaming/streamStore.ts
export const useStreamStore = create<StreamState>()((set, get) => ({
  wsStatus: 'disconnected' as WsStatus,
  lastTickVersion: -1,
  ticksPerSecond: 0,
  chainOverlay: new Map<string, Partial<OptionRow>>(), // key: `${strike}-${right}`
  spotPrices: {} as Record<SymbolCode, number>,
  
  applyTicks: (ticks: TickData[]) => {
    const overlay = new Map(get().chainOverlay);
    for (const tick of ticks) {
      const key = `${tick.strike}-${tick.right}`;
      overlay.set(key, {
        ...(overlay.get(key) || {}),
        [`${tick.right === 'CE' ? 'ce' : 'pe'}_ltp`]: tick.ltp,
        [`${tick.right === 'CE' ? 'ce' : 'pe'}_oi`]: tick.oi,
        [`${tick.right === 'CE' ? 'ce' : 'pe'}_volume`]: tick.volume,
        [`${tick.right === 'CE' ? 'ce' : 'pe'}_iv`]: tick.iv,
        [`${tick.right === 'CE' ? 'ce' : 'pe'}_bid`]: tick.bid,
        [`${tick.right === 'CE' ? 'ce' : 'pe'}_ask`]: tick.ask,
      });
    }
    set({ chainOverlay: overlay, lastTickVersion: get().lastTickVersion + 1 });
  },
}));
```

### 4.4 Event Bus

```typescript
// src/services/streaming/eventBus.ts
type EventType = 
  | 'tick'
  | 'spot_update'
  | 'order_update'
  | 'position_update'
  | 'callback_fired'
  | 'connection_change'
  | 'alert'
  | 'notification';

interface TerminalEvent<T = unknown> {
  type: EventType;
  payload: T;
  timestamp: number;
  source: string;
}

type EventHandler<T = unknown> = (event: TerminalEvent<T>) => void;

class EventBus {
  private handlers = new Map<EventType, Set<EventHandler>>();
  private buffer: TerminalEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_WINDOW_MS = 100;
  
  on<T>(type: EventType, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler as EventHandler);
    return () => this.handlers.get(type)?.delete(handler as EventHandler);
  }
  
  emit<T>(type: EventType, payload: T, source: string): void {
    const event: TerminalEvent<T> = { type, payload, timestamp: Date.now(), source };
    
    if (type === 'tick') {
      // Batch tick events
      this.buffer.push(event);
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => this.flush(), this.BATCH_WINDOW_MS);
      }
    } else {
      // Deliver non-tick events immediately
      this.deliver(event);
    }
  }
  
  private flush(): void {
    this.flushTimer = null;
    const events = this.buffer.splice(0);
    // Coalesce: keep only latest tick per strike-right
    const latest = new Map<string, TerminalEvent>();
    for (const e of events) {
      const tick = e.payload as TickData;
      latest.set(`${tick.strike}-${tick.right}`, e);
    }
    for (const event of latest.values()) {
      this.deliver(event);
    }
  }
  
  private deliver(event: TerminalEvent): void {
    this.handlers.get(event.type)?.forEach(h => h(event));
  }
}

export const eventBus = new EventBus();
```

---

## Part V: Execution State Machine

This is the hardest engineering problem in the system and requires complete specification.

### 5.1 Single-Leg Order State Machine

```
                    ┌──────────┐
                    │ DRAFTED  │ (leg exists in StrategyDraft)
                    └────┬─────┘
                         │ user stages
                    ┌────┴─────┐
                    │ STAGED   │ (in staged ticket, editable)
                    └────┬─────┘
                         │ user requests preview
                    ┌────┴─────────┐
                    │ PREVIEWING   │ (backend computing fees/margin)
                    └────┬────┬────┘
                         │    │ preview failed
                    ┌────┴──┐ └──→ STAGED (with error)
                    │PREVIEWED│
                    └────┬────┘
                         │ user confirms send
                    ┌────┴─────┐
                    │ SENDING  │ (API call in flight)
                    └────┬─────┘
                    ┌────┴─────────────────────┐
                    │                          │
               ┌────┴────┐             ┌──────┴──────┐
               │ PENDING │             │   FAILED    │
               └────┬────┘             └─────────────┘
                    │
          ┌────────┼────────┐
          │        │        │
     ┌────┴───┐┌───┴────┐┌──┴───────┐
     │PARTIAL ││ FILLED ││REJECTED  │
     └────┬───┘└────────┘└──────────┘
          │
     ┌────┴────┐
     │ FILLED  │
     └─────────┘

Any state → CANCELLED (via cancel action, if not FILLED)
```

### 5.2 Basket State Machine

```
STAGED
  │ all legs previewed successfully
  ▼
READY
  │ user confirms "Send All"
  ▼
SENDING ─────────────────────────────────────────────┐
  │ legs sent sequentially (Breeze has no atomic multi-leg)  │
  │ after each leg:                                          │
  │   leg.status = PENDING | FAILED | REJECTED               │
  │                                                          │
  ├─ all legs PENDING/FILLED → PARTIAL_FILL (monitoring)     │
  │     │                                                    │
  │     ├─ all legs FILLED → ALL_FILLED ✓                    │
  │     │                                                    │
  │     └─ any leg REJECTED while others FILLED              │
  │           → PARTIAL_FAILURE                              │
  │              │                                           │
  │              ├─ recovery: CANCEL_REMAINING               │
  │              ├─ recovery: MANUAL_INTERVENTION            │
  │              └─ recovery: AUTO_HEDGE (future)            │
  │                                                          │
  └─ first leg FAILED → ALL_FAILED (network/auth error)     │
       (don't send remaining legs)                           │
                                                             │
◄────────────────────────────────────────────────────────────┘
```

### 5.3 Basket Execution Algorithm

```typescript
async function executeBasket(basket: BasketOrder): Promise<BasketOrder> {
  basket.status = 'sending';
  basket.timestamps.sendStarted = Date.now();
  
  const results: LiveOrder[] = [];
  
  for (let i = 0; i < basket.legs.length; i++) {
    const leg = basket.legs[i];
    
    try {
      const response = await apiClient.placeOrder({
        stock_code: getConfig(leg.symbol).breezeStockCode,
        exchange_code: getConfig(leg.symbol).breezeExchangeCode,
        product: 'options',
        action: leg.action.toLowerCase(),
        order_type: leg.orderType,
        quantity: String(leg.quantity),
        price: leg.orderType === 'limit' ? String(leg.limitPrice) : '0',
        stoploss: '0',
        validity: 'day',
        expiry_date: leg.expiry,
        right: leg.right === 'CE' ? 'call' : 'put',
        strike_price: String(leg.strike),
      });
      
      if (response.success) {
        leg.status = 'pending';
        leg.orderId = response.order_id;
        results.push(leg);
      } else {
        leg.status = 'rejected';
        leg.rejectionReason = response.error;
        
        // If any previous legs were filled, we have a partial failure
        const filledLegs = results.filter(r => r.status === 'filled' || r.status === 'pending');
        if (filledLegs.length > 0) {
          basket.status = 'partial_failure';
          basket.recoveryAction = 'manual_intervention';
          // Do NOT send remaining legs
          break;
        } else {
          // No legs filled yet, mark as all_failed and stop
          basket.status = 'all_failed';
          break;
        }
      }
    } catch (networkError) {
      leg.status = 'failed';
      // Network error: stop immediately
      const filledLegs = results.filter(r => r.status === 'filled' || r.status === 'pending');
      basket.status = filledLegs.length > 0 ? 'partial_failure' : 'all_failed';
      basket.recoveryAction = filledLegs.length > 0 ? 'manual_intervention' : undefined;
      break;
    }
    
    // Brief pause between legs to avoid rate limiting
    if (i < basket.legs.length - 1) {
      await sleep(200);
    }
  }
  
  // If all legs sent successfully
  if (results.length === basket.legs.length && results.every(r => r.status !== 'rejected')) {
    basket.status = 'partial_fill'; // monitoring until all confirmed filled
  }
  
  basket.timestamps.completed = Date.now();
  
  // Emit audit event
  eventBus.emit('order_update', {
    basketId: basket.basketId,
    status: basket.status,
    legs: basket.legs.map(l => ({ legId: l.id, status: l.status, orderId: l.orderId })),
  }, 'execution-service');
  
  return basket;
}
```

### 5.4 Recovery Flows

**Partial Failure with filled legs**:
1. Show "Basket Partial Failure" alert with details
2. List filled legs and their exposure
3. Offer three actions:
   - "Cancel Remaining": cancel any pending legs (no action on filled)
   - "Retry Failed": re-attempt only failed/rejected legs
   - "Square Off Filled": immediately exit the filled legs to eliminate exposure
4. Log everything to automation events for audit

**Network failure during basket**:
1. The current leg's status is unknown — mark as `failed` locally
2. On recovery, fetch order book and compare
3. If the order actually went through, reconcile status
4. Show "Execution Interrupted" modal with order book reconciliation

---

## Part VI: Streaming Architecture

### 6.1 Transport Layer

The `UnifiedStreamingManager` (or `BreezeWsClient` in earlier code) handles transport only. It does not process business logic.

```typescript
// src/services/streaming/transportManager.ts
class TransportManager {
  private ws: WebSocket | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private mode: 'websocket' | 'polling' | 'disconnected' = 'disconnected';
  private reconnectDelay = 3000;
  private maxDelay = 30000;
  private lastVersion = -1;
  private connectingPromise: Promise<void> | null = null;
  
  async connect(url: string, authToken?: string): Promise<void> {
    if (this.connectingPromise) return this.connectingPromise;
    
    if (this.canUseWebSocket(url)) {
      this.connectingPromise = this.connectWs(url, authToken);
    } else {
      this.connectingPromise = this.startPolling(url, authToken);
    }
    
    try {
      await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }
  
  // All incoming data goes to the event bus
  private onRawMessage(data: TickUpdate): void {
    if (data.version <= this.lastVersion) return; // dedup
    this.lastVersion = data.version;
    
    if (data.spot_prices) {
      for (const [sym, price] of Object.entries(data.spot_prices)) {
        eventBus.emit('spot_update', { symbol: sym, price }, 'ws-transport');
      }
    }
    
    if (data.ticks?.length > 0) {
      for (const tick of data.ticks) {
        eventBus.emit('tick', tick, 'ws-transport');
      }
    }
  }
  
  private canUseWebSocket(url: string): boolean {
    if (!url || url.startsWith('/')) return false;
    return true;
  }
}
```

### 6.2 Backpressure

The event bus's tick batching (100ms window with coalescing) handles backpressure at the distribution layer.

Additionally, consumers should implement visible-row priority:

```typescript
// In the chain grid component:
function useVisibleStrikeTicks(
  allTicks: Map<string, Partial<OptionRow>>,
  visibleRange: { startStrike: number; endStrike: number }
) {
  return useMemo(() => {
    const visible = new Map<string, Partial<OptionRow>>();
    for (const [key, update] of allTicks) {
      const strike = parseInt(key.split('-')[0]);
      if (strike >= visibleRange.startStrike && strike <= visibleRange.endStrike) {
        visible.set(key, update);
      }
    }
    return visible;
  }, [allTicks, visibleRange.startStrike, visibleRange.endStrike]);
}
```

### 6.3 Staleness Detection

```typescript
function useStaleDetection(meta: AuthorityMeta, thresholdMs: number): boolean {
  const [stale, setStale] = useState(false);
  
  useEffect(() => {
    const check = () => setStale(Date.now() - meta.asOf > thresholdMs);
    check();
    const timer = setInterval(check, 10_000);
    return () => clearInterval(timer);
  }, [meta.asOf, thresholdMs]);
  
  return stale;
}
```

---

## Part VII: Backend Module Structure

### 7.1 Module Responsibilities

Each module has exactly one purpose and a clear API boundary.

```
backend/app/
  __init__.py
  create_app.py              # FastAPI app factory, CORS, middleware
  
  core/
    settings.py              # All config: env vars, defaults, feature flags
    auth.py                  # X-Terminal-Auth validation, token generation
    logging.py               # Structured logging setup
    rate_limit.py            # Per-route rate limiting (existing logic extracted)
    errors.py                # Exception types and error response formatting
  
  clients/
    breeze/
      __init__.py
      session.py             # BreezeConnect(), generate_session(), get_customer_details()
      market.py              # get_option_chain_quotes(), get_quotes(), get_historical_data_v2()
                             # get_market_depth()
      execution.py           # place_order(), cancel_order(), modify_order()
                             # preview_order(), margin_calculator()
      portfolio.py           # get_portfolio_positions(), get_portfolio_holdings()
                             # get_funds(), get_order_list(), get_trade_list()
      streaming.py           # ws_connect(), ws_disconnect(), subscribe_feeds()
                             # unsubscribe_feeds()
  
  services/
    market/
      chain_service.py       # Chain fetch, normalization, Greek computation
      spot_service.py        # Spot price fetch with fallback chain
      expiry_service.py      # Expiry date computation and caching
      depth_service.py       # Depth snapshot normalization
      candle_service.py      # Historical data fetch and caching
    execution/
      preview_service.py     # Order preview with fee breakdown
      margin_service.py      # Margin calculation normalization
      order_service.py       # Order placement, cancel, modify
      basket_service.py      # Multi-leg basket execution with per-leg tracking
      repair_service.py      # Repair preview generation
    portfolio/
      position_service.py    # Position fetch and normalization
      grouping_service.py    # Grouped strategy detection from positions/orders
      funds_service.py       # Funds fetch and normalization
    risk/
      risk_service.py        # Portfolio-level Greek aggregation
      scenario_service.py    # Stress matrix computation
      adjustment_service.py  # Repair suggestion generation
    automation/
      rule_service.py        # Rule CRUD and evaluation
      trigger_service.py     # Trigger evaluation engine
      callback_service.py    # Webhook handling and auth
      event_service.py       # Event logging and retrieval
    review/
      journal_service.py     # Journal case CRUD
      playbook_service.py    # Playbook CRUD and compliance checking
      attribution_service.py # Close-out attribution logic
    streaming/
      tick_store.py          # In-memory tick accumulator (existing TickStore extracted)
      ws_manager.py          # Breeze WS lifecycle management
      broadcast.py           # WebSocket broadcast to frontend clients
    diagnostics/
      health_service.py      # Health check aggregation
      rate_limit_report.py   # Rate limit status reporting
  
  api/
    routes/
      session.py             # /api/session/*
      market.py              # /api/market/*
      stream.py              # /api/stream/*, /ws/stream
      execution.py           # /api/execution/*
      orders.py              # /api/orders/*
      portfolio.py           # /api/portfolio/*
      risk.py                # /api/risk/*
      automation.py          # /api/automation/*
      reviews.py             # /api/reviews/*
      diagnostics.py         # /api/diagnostics/*
      compat.py              # Old route aliases → new routes (compatibility layer)
    deps.py                  # FastAPI dependency injection (auth, rate limit, breeze client)
  
  models/
    market.py                # Pydantic models for market data
    execution.py             # Pydantic models for orders, previews
    portfolio.py             # Pydantic models for positions, funds
    automation.py            # Pydantic models for rules, events
    review.py                # Pydantic models for journal, playbooks
    common.py                # AuthorityMeta, paginated response, etc.
  
  storage/
    database.py              # SQLite connection management
    migrations.py            # Schema creation and versioning
    repositories/
      automation_repo.py     # Rule and event persistence
      review_repo.py         # Journal and playbook persistence
      layout_repo.py         # Workspace layout persistence
      audit_repo.py          # Audit event log
```

### 7.2 Compatibility Layer

```python
# backend/app/api/routes/compat.py
from fastapi import APIRouter, Request, Response
from . import session, market, stream, execution, orders, portfolio

router = APIRouter()

# Old routes redirect to new routes
@router.post("/api/connect")
async def compat_connect(request: Request):
    return await session.connect(request)

@router.get("/api/optionchain")
async def compat_chain(request: Request):
    return await market.chain(request)

@router.get("/api/spot")
async def compat_spot(request: Request):
    return await market.spot(request)

# ... one adapter per old route
```

All old routes remain functional. Frontend migration happens independently of backend migration.

### 7.3 SQLite Schema

```sql
-- backend/app/storage/schema.sql

CREATE TABLE IF NOT EXISTS automation_rules (
    rule_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    trigger_type TEXT NOT NULL,
    trigger_params TEXT NOT NULL,  -- JSON
    action_type TEXT NOT NULL,
    action_params TEXT NOT NULL,   -- JSON
    semantics TEXT NOT NULL DEFAULT 'one_shot',
    cooldown_ms INTEGER NOT NULL DEFAULT 0,
    last_triggered INTEGER,
    trigger_count INTEGER NOT NULL DEFAULT 0,
    linked_group_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_events (
    event_id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    trigger_snapshot TEXT NOT NULL,  -- JSON
    action_success INTEGER NOT NULL,
    action_order_id TEXT,
    action_error TEXT,
    idempotency_key TEXT NOT NULL,
    FOREIGN KEY (rule_id) REFERENCES automation_rules(rule_id)
);

CREATE TABLE IF NOT EXISTS journal_cases (
    case_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_id TEXT,
    symbol TEXT NOT NULL,
    strategy TEXT NOT NULL,
    entry_date INTEGER NOT NULL,
    entry_regime TEXT,
    entry_thesis TEXT,
    entry_legs TEXT NOT NULL,       -- JSON
    adjustments TEXT,               -- JSON array
    exit_date INTEGER,
    exit_reason TEXT,
    exit_legs TEXT,                 -- JSON
    realized_pnl REAL,
    review_rating INTEGER,
    review_mistake_tags TEXT,       -- JSON array
    review_notes TEXT,
    review_playbook_compliance INTEGER,
    review_lessons TEXT,
    review_reviewed_at INTEGER,
    linked_order_ids TEXT,          -- JSON array
    linked_group_id TEXT,
    linked_rule_ids TEXT,           -- JSON array
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playbooks (
    playbook_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    regime TEXT,
    strategy_type TEXT,
    entry_rules TEXT,               -- JSON array
    exit_rules TEXT,                -- JSON array
    adjustment_rules TEXT,          -- JSON array
    risk_limits TEXT,               -- JSON
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_layouts (
    layout_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    panels TEXT NOT NULL,           -- JSON
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,            -- 'user', 'automation', 'system'
    details TEXT NOT NULL,          -- JSON
    basket_id TEXT,
    order_id TEXT,
    rule_id TEXT
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_event_type ON audit_log(event_type);
CREATE INDEX idx_automation_events_rule ON automation_events(rule_id);
CREATE INDEX idx_journal_symbol ON journal_cases(symbol);
CREATE INDEX idx_journal_source ON journal_cases(source);
```

---

## Part VIII: Keyboard Architecture

### 8.1 Mode State Machine

```
NORMAL ──── '/' ────────────────→ COMMAND (search focused)
   │                                  │
   │   Ctrl+K                         │ Esc
   │ ──────→ COMMAND (palette open)   │──→ NORMAL
   │                                  
   │   Enter on chain row             
   │ ──────→ CHAIN (strike focused)   
   │              │                   
   │              │ B/S/Shift+B/S     
   │              │ ──→ leg staged, stay in CHAIN
   │              │                   
   │              │ Shift+Enter       
   │              │ ──→ TICKET (staged ticket focused)
   │              │        │
   │              │        │ Ctrl+Enter → send (with confirmation modal)
   │              │        │ Esc → CHAIN
   │              │        │
   │              │ Esc    │
   │              │ ──→ NORMAL
   │              │
   │   G+M, G+S, etc.
   │ ──────→ workspace switch (stay in NORMAL)
```

### 8.2 Key Bindings

```typescript
const KEY_BINDINGS: Record<KeyboardMode, Record<string, Action>> = {
  normal: {
    'Ctrl+K':     { action: 'open_command_palette' },
    '/':          { action: 'open_search' },
    'g m':        { action: 'goto_workspace', params: { workspace: 'market' } },
    'g c':        { action: 'goto_workspace', params: { workspace: 'chain' } },
    'g s':        { action: 'goto_workspace', params: { workspace: 'strategy' } },
    'g e':        { action: 'goto_workspace', params: { workspace: 'execution' } },
    'g p':        { action: 'goto_workspace', params: { workspace: 'portfolio' } },
    'g r':        { action: 'goto_workspace', params: { workspace: 'risk' } },
    'g a':        { action: 'goto_workspace', params: { workspace: 'automation' } },
    'g j':        { action: 'goto_workspace', params: { workspace: 'review' } },
    'Alt+1..9':   { action: 'activate_layout', params: { index: 'dynamic' } },
    'Ctrl+`':     { action: 'toggle_bottom_dock' },
  },
  chain: {
    'ArrowUp':    { action: 'focus_prev_strike' },
    'ArrowDown':  { action: 'focus_next_strike' },
    'Home':       { action: 'focus_first_strike' },
    'End':        { action: 'focus_last_strike' },
    'a':          { action: 'scroll_to_atm' },
    'b':          { action: 'add_leg', params: { right: 'CE', action: 'BUY' } },
    's':          { action: 'add_leg', params: { right: 'CE', action: 'SELL' } },
    'Shift+B':    { action: 'add_leg', params: { right: 'PE', action: 'BUY' } },
    'Shift+S':    { action: 'add_leg', params: { right: 'PE', action: 'SELL' } },
    'Shift+Enter':{ action: 'stage_draft' },
    'Escape':     { action: 'exit_chain_mode' },
  },
  ticket: {
    'Tab':        { action: 'next_field' },
    'Shift+Tab':  { action: 'prev_field' },
    'ArrowUp':    { action: 'increment_value' },
    'ArrowDown':  { action: 'decrement_value' },
    'Ctrl+Enter': { action: 'send_order' },
    'Escape':     { action: 'exit_ticket_mode' },
  },
  command: {
    'Escape':     { action: 'close_palette' },
    'ArrowUp':    { action: 'prev_result' },
    'ArrowDown':  { action: 'next_result' },
    'Enter':      { action: 'execute_command' },
  },
};
```

### 8.3 Mode Indicator

The bottom-left of the shell always shows the current keyboard mode:

```
[NORMAL]     — gray badge
[CHAIN ▸ NIFTY 24000]  — blue badge with focused context
[TICKET ▸ 3 legs staged]  — amber badge
[COMMAND]    — purple badge with palette visible
```

---

## Part IX: Shell Layout Architecture

### 9.1 Shell Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 1: Global Top Ribbon                                         │
│ ┌──────────────────────────────┬─────────────┬──────────┬────────┐ │
│ │ Workspace Tabs               │ Search (/)  │ Alerts 🔔│ HH:MM │ │
│ │ MKT CHN STG EXE PFO RSK ... │             │ WS●Live  │ IST   │ │
│ └──────────────────────────────┴─────────────┴──────────┴────────┘ │
├─────┬───────────────────────────────────────────────────────────────┤
│     │ LAYER 3: Workspace Header + Submenu                         │
│  L  │ ┌──────────────────────────────────────────────────────────┐ │
│  A  │ │ Market Desk │ NIFTY ▾ │ 01 Jul 25 ▾ │ [Actions...]     │ │
│  Y  │ │ Overview | Chain | Depth | Charts | Tape                │ │
│  E  │ └──────────────────────────────────────────────────────────┘ │
│  R  │                                                             │
│     │ LAYER 4: Main Window Grid (dockable)                        │
│  2  │ ┌──────────────────────┬───────────────────────────────────┐ │
│     │ │                      │                                   │ │
│  L  │ │  Panel A (chain)     │  Panel B (depth/chart)            │ │
│  E  │ │                      │                                   │ │
│  F  │ │                      ├───────────────────────────────────┤ │
│  T  │ │                      │  Panel C (stats/inspector)        │ │
│     │ │                      │                                   │ │
│  L  │ └──────────────────────┴───────────────────────────────────┘ │
│  A  │                                                             │
│  U  │ LAYER 5: Bottom Dock (persistent, collapsible)              │
│  N  │ ┌──────────────────────────────────────────────────────────┐ │
│  C  │ │ Blotter │ Alerts │ Events │ Diagnostics │ Notes          │ │
│  H  │ │ [Live order blotter / notification stream]               │ │
│  E  │ └──────────────────────────────────────────────────────────┘ │
│  R  │                                                             │
├─────┤ LAYER 0: Status Bar                                         │
│     │ [NORMAL] │ Spot: 24,520.35 │ WS: 42 tps │ Margin: 78%     │
└─────┴───────────────────────────────────────────────────────────────┘
```

### 9.2 Docking Library Integration

**Choice**: `flexlayout-react`

**Spike acceptance criteria** (must pass within one implementation day):
1. Can render five panels in a split layout
2. Panels can be dragged and rearranged
3. Layout can be serialized to JSON and restored
4. Tab stacking works within panels
5. Works with React 18 (or React 19 if upgraded)
6. Does not block keyboard event propagation

**If spike fails**: Fall back to a custom CSS Grid layout with fixed split ratios and a simpler tab system. Defer full docking to a later phase. The rest of the architecture does not depend on docking.

### 9.3 Router Configuration

```typescript
// src/app/router/routes.tsx
import { createBrowserRouter } from 'react-router-dom';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/market" /> },
      { path: 'launchpad', element: <LaunchpadWorkspace /> },
      { 
        path: 'market',
        element: <MarketWorkspace />,
        children: [
          { index: true, element: <MarketOverview /> },
          { path: 'depth', element: <DepthView /> },
          { path: 'charts', element: <ChartView /> },
          { path: 'tape', element: <TapeView /> },
        ]
      },
      { 
        path: 'chain',
        element: <ChainWorkspace />,
        children: [
          { index: true, element: <PrimaryChain /> },
          { path: 'skew', element: <SkewSurface /> },
          { path: 'oi', element: <OIMap /> },
        ]
      },
      {
        path: 'strategy',
        element: <StrategyWorkspace />,
        children: [
          { index: true, element: <OpportunityFeed /> },
          { path: 'builder', element: <StrategyBuilder /> },
          { path: 'compare', element: <StrategyCompare /> },
          { path: 'playbooks', element: <PlaybookBrowser /> },
        ]
      },
      {
        path: 'execution',
        element: <ExecutionWorkspace />,
        children: [
          { index: true, element: <StagedTicket /> },
          { path: 'blotter', element: <OrderBlotter /> },
          { path: 'orders', element: <OrderBook /> },
          { path: 'trades', element: <TradeBook /> },
        ]
      },
      {
        path: 'portfolio',
        element: <PortfolioWorkspace />,
        children: [
          { index: true, element: <PositionsView /> },
          { path: 'holdings', element: <HoldingsView /> },
          { path: 'capital', element: <CapitalView /> },
        ]
      },
      {
        path: 'risk',
        element: <RiskWorkspace />,
        children: [
          { index: true, element: <LiveRisk /> },
          { path: 'scenarios', element: <ScenarioLab /> },
          { path: 'adjustments', element: <AdjustmentDesk /> },
          { path: 'margin', element: <MarginAnalysis /> },
        ]
      },
      {
        path: 'automation',
        element: <AutomationWorkspace />,
        children: [
          { index: true, element: <RuleGrid /> },
          { path: 'events', element: <EventStream /> },
          { path: 'audit', element: <AuditLog /> },
        ]
      },
      {
        path: 'review',
        element: <ReviewWorkspace />,
        children: [
          { index: true, element: <JournalList /> },
          { path: ':caseId', element: <JournalDetail /> },
          { path: 'playbooks', element: <PlaybookList /> },
          { path: 'analytics', element: <OutcomeAnalytics /> },
        ]
      },
      {
        path: 'ops',
        element: <OpsWorkspace />,
        children: [
          { index: true, element: <ConnectionStatus /> },
          { path: 'health', element: <BackendHealth /> },
          { path: 'streams', element: <StreamDiagnostics /> },
          { path: 'logs', element: <EventLogs /> },
        ]
      },
    ],
  },
]);
```

---

## Part X: Workstation Component System

These are the shared primitives that every workspace uses. They must be built before or during Phase 2.

### 10.1 Component Inventory

```typescript
// src/ui/panels/TerminalPanel.tsx
interface TerminalPanelProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;      // header action buttons
  status?: 'live' | 'stale' | 'loading' | 'error';
  authority?: 'broker' | 'normalized' | 'analytical';
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}

// src/ui/grids/DataGrid.tsx
interface DataGridProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  sortable?: boolean;
  filterable?: boolean;
  paginated?: boolean;
  pageSize?: number;
  virtualRows?: boolean;          // enable for > 100 rows
  flashFields?: string[];         // fields that flash on change
  selectedRow?: string;           // row key of selected row
  emptyMessage?: string;
  loading?: boolean;
}

interface ColumnDef<T> {
  key: string;
  header: string;
  accessor: (row: T) => unknown;
  format?: (value: unknown) => string;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  sortable?: boolean;
  colorFn?: (value: unknown) => string | undefined;
}

// src/ui/ribbons/MetricRibbon.tsx
interface MetricRibbonProps {
  items: Array<{
    label: string;
    value: string | number;
    format?: 'number' | 'currency' | 'percent' | 'oi';
    trend?: 'up' | 'down' | 'neutral';
    authority?: AuthorityMeta['authority'];
  }>;
}

// src/ui/inspectors/InspectorRail.tsx
interface InspectorRailProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;                 // default 320px
}

// src/ui/docks/BlotterDock.tsx
interface BlotterDockProps {
  visible: boolean;
  activeTab: string;
  onTabChange: (tab: string) => void;
  height?: number;                // default 200px
  tabs: Array<{
    id: string;
    label: string;
    badge?: number;               // unread count
    content: React.ReactNode;
  }>;
}

// src/ui/forms/ActionConfirmation.tsx
interface ActionConfirmationProps {
  open: boolean;
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'danger';
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  details?: React.ReactNode;      // expandable detail section
}
```

### 10.2 Authority Badge Component

Every data surface must include authority indication:

```typescript
// src/ui/badges/AuthorityBadge.tsx
function AuthorityBadge({ meta }: { meta: AuthorityMeta }) {
  const stale = Date.now() - meta.asOf > STALE_THRESHOLDS[meta.source] ?? 60_000;
  
  const colors = {
    broker: 'text-emerald-400 bg-emerald-400/10',
    normalized: 'text-blue-400 bg-blue-400/10',
    analytical: 'text-purple-400 bg-purple-400/10',
  };
  
  const labels = {
    broker: 'Broker',
    normalized: 'Normalized',
    analytical: 'Analytical',
  };
  
  return (
    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-mono', colors[meta.authority])}>
      {labels[meta.authority]}
      {stale && <span className="text-amber-400 ml-1">●</span>}
    </span>
  );
}
```

---

## Part XI: Performance Budgets

### 11.1 Measurable Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Option chain initial render | < 100ms for 80 strikes | `performance.mark/measure` around chain mount |
| Chain tick update to paint | < 50ms per tick batch | Event bus emit to `requestAnimationFrame` callback |
| Workspace switch | < 200ms to interactive | Router transition start to `useEffect` completion |
| Layout restore | < 300ms | Layout JSON parse to all panels mounted |
| Command palette open | < 50ms | Keyboard event to palette visible |
| Memory (chain active) | < 80MB heap | Chrome DevTools → Memory snapshot |
| Memory (all workspaces visited) | < 150MB heap | After visiting all workspaces and returning |

### 11.2 Techniques

**Chain grid virtualization**: Use `@tanstack/react-virtual` for > 40 visible rows. The existing `VirtualOptionChain.tsx` should be completed and become the default for full-expiry views.

**Tick batching**: The event bus batches ticks in 100ms windows. Chain consumers should further batch with `requestAnimationFrame`:

```typescript
function useChainTicks() {
  const pendingRef = useRef<Map<string, Partial<OptionRow>>>(new Map());
  const rafRef = useRef<number | null>(null);
  const [applied, setApplied] = useState(new Map<string, Partial<OptionRow>>());
  
  useEffect(() => {
    return eventBus.on('tick', (event) => {
      const tick = event.payload as TickData;
      const key = `${tick.strike}-${tick.right}`;
      pendingRef.current.set(key, /* merge */);
      
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          setApplied(new Map(pendingRef.current));
          pendingRef.current.clear();
          rafRef.current = null;
        });
      }
    });
  }, []);
  
  return applied;
}
```

**Memoization rules**: Every component receiving `OptionRow[]` must use `React.memo` with a custom comparator. The existing chain pattern (§9.9 of Exhaustive Spec) is the template.

**Worker offload candidates**:
- Max pain computation (O(n²) — move to a Web Worker if n > 200)
- Black-Scholes Greek computation for full chain (move to backend in Phase 4)
- Stress matrix computation (always on backend)

---

## Part XII: Error Recovery Specifications

### 12.1 Stream Degradation

```
WS connected → WS error
  │
  ├─ Immediate: show "WS Error" badge in ribbon
  ├─ 0-3s: reconnecting (exponential backoff)
  ├─ After 3 failed reconnects: switch to REST polling automatically
  │    └─ Show "REST Polling (2s)" badge
  ├─ Continue attempting WS reconnect in background every 30s
  └─ When WS reconnects: stop polling, switch back
```

### 12.2 Backend Disconnect

```
Backend unreachable (health check fails)
  │
  ├─ All queries enter error state (react-query handles this)
  ├─ Show "Backend Offline" banner in ribbon (red)
  ├─ Disable all mutation buttons
  ├─ Show last-known data with staleness indicators
  ├─ Retry health check every 10s
  └─ On recovery: invalidate all queries, re-establish WS
```

### 12.3 Preview Failure During Execution

```
Preview request fails
  │
  ├─ Keep basket in STAGED state (not PREVIEWED)
  ├─ Show error inline on the preview panel
  ├─ Allow retry
  ├─ Never allow sending without successful preview
  └─ If preview returns warnings (high margin utilization, event risk):
       └─ Show warnings but allow user to override with explicit checkbox
```

### 12.4 Partial Basket Failure

Specified in Part V, Section 5.4.

### 12.5 Callback Authentication Failure

```
Webhook endpoint returns 401/403
  │
  ├─ Log event to automation_events with action_success=false
  ├─ Show alert in bottom dock events tab
  ├─ Disable the rule that generated the callback
  ├─ Show "Callback Auth Failed" in Ops workspace
  └─ Do NOT retry — auth failures are not transient
```

### 12.6 Storage Write Failure

```
SQLite write fails (disk full, corruption, etc.)
  │
  ├─ Log to Python stderr (always available)
  ├─ Return 503 on affected API routes
  ├─ Show "Storage Error" in Ops workspace
  ├─ Continue serving read-only data from memory
  └─ DO NOT lose the data — queue writes in memory and retry on next successful write
```

---

## Part XIII: Testing Strategy

### 13.1 What to Test

| Layer | Tool | Coverage Target |
|-------|------|----------------|
| Backend routes | `pytest` + `httpx.AsyncClient` | Every route, happy path + error path |
| Backend services | `pytest` | All normalization, grouping, Greek computation |
| SQLite storage | `pytest` | CRUD for every repository |
| Frontend stores | `vitest` | Every store action and derived state |
| Event bus | `vitest` | Batching, coalescing, delivery |
| Execution state machine | `vitest` | Every state transition, including error paths |
| Chain merging | `vitest` | `mergeQuotesToChain`, `applyTicksToChain` with edge cases |
| Components | `vitest` + `@testing-library/react` | DataGrid, TerminalPanel, ActionConfirmation |
| Keyboard | `vitest` + `@testing-library/react` | Mode transitions, key bindings |
| E2E critical paths | `playwright` | Connect → chain → stage → preview → (mock) send |

### 13.2 What NOT to Test

- Individual CSS styling
- Third-party library internals (flexlayout, recharts)
- Mock data generators (they are test support, not product code)
- Breeze API behavior (we don't control it — test our normalization of its output)

### 13.3 Test Data Strategy

Create `backend/tests/fixtures/` with:
- Realistic Breeze API responses (chain, positions, orders, trades, funds)
- Both hyphenated and underscored field variants
- Edge cases: zero OI, zero LTP, missing fields, null values
- Large chain (200 strikes) for performance tests

Create `src/__tests__/fixtures/` with:
- OptionRow arrays (small and large)
- TickData sequences (including out-of-order, duplicate versions)
- BasketOrder in every state

---

## Part XIV: Implementation Plan Corrections

The Implementation Plan is structurally sound. These corrections address specific defects.

### 14.1 Phase 0 Must Include Defect Fixes

Add to Phase 0 tasks:
- Fix StrategyBuilder template ReferenceError (Defect 1)
- Consolidate spot price representations (Defect 2)
- Add WS double-connect guard (Defect 3)
- Add `greekSource` field to OptionRow (Defect 4)
- Verify PE theta bug fix (Defect 5)

### 14.2 Phase 0 File Classification

The Implementation Plan says "classify files" but doesn't specify. Here is the classification:

**Canonical** (keep, evolve):
- `src/app/shell/AppShell.tsx`
- `src/app/router.ts` → evolve into `src/app/router/routes.tsx`
- `src/app/workspaces/*`
- `src/components/OptionChain/*`
- `src/components/StrategyBuilder.tsx`
- `src/components/ConnectBrokerModal.tsx`
- `src/domains/*` (all domain stores)
- `src/services/broker/brokerGatewayClient.ts`
- `src/services/streaming/unifiedStreamingManager.ts`
- `src/config/market.ts` → evolve (remove mutable SPOT_PRICES)
- `kaggle_backend.py` → evolve into `backend/app/`

**Compatibility** (keep alive during migration, then retire):
- `src/app/useWorkspaceRoute.ts` → retire after React Router migration
- `src/utils/breezeClient.ts` → move to `src/services/broker/diagnosticBreezeClient.ts`
- `src/utils/breezeWs.ts` → absorbed into new TransportManager
- `src/utils/kaggleClient.ts` → absorbed into new API client layer

**Retirement candidate** (remove in Phase 0 or early Phase 1):
- `src/components/OptionChain.old` → delete
- `src/components/TopBar.tsx` → replaced by shell ribbon (verify no unique logic first)
- `src/components/Positions.tsx` → replaced by PortfolioWorkspace (verify no unique logic first)
- `src/app/shell/RightDrawer.tsx` → evaluate if any logic needed, otherwise delete

**Evaluation needed**:
- `src/app/shell/BottomDock.tsx` → may contain useful structure for the new bottom dock. Inspect and salvage or delete.

### 14.3 Phase 1 and Phase 3 Should Interleave

The Implementation Plan puts backend modularization (Phase 3) after shell replacement (Phase 2). This creates a problem: the shell needs new API contracts, which need the backend structure.

**Correction**: Start backend modularization in parallel with Phase 1, not after Phase 2.

Revised order:
1. Phase 0: Defects + scaffold
2. Phase 1A (frontend): Client platform spine
3. Phase 1B (backend): Module extraction (can run in parallel)
4. Phase 2: Shell and layout
5. Phase 4: Market, Chain, Launchpad desks
6. Phase 5: Strategy and Execution
7. Phase 6: Portfolio, Risk, Adjustment
8. Phase 7: Automation, Review, Ops
9. Phase 8: Hardening

### 14.4 Missing Rollback Strategy

If Phase 2 (shell replacement) breaks the product mid-flight:

1. The old `AppShell` with `useWorkspaceRoute` is preserved as compatibility code
2. A feature flag `USE_NEW_SHELL=true` gates the new shell
3. Setting the flag to false restores the old navigation
4. The flag is removed only when Phase 2 exits successfully

```typescript
// src/app/App.tsx
function App() {
  const useNewShell = import.meta.env.VITE_USE_NEW_SHELL === 'true';
  
  if (useNewShell) {
    return <RouterProvider router={newRouter} />;
  }
  
  return <LegacyAppShell />;
}
```

### 14.5 Launchpad Data Sources

The Implementation Plan and Institutional Spec describe a Launchpad workspace but never specify what feeds it. Here are the concrete data sources:

| Launchpad Panel | Data Source | Query Key |
|-----------------|-----------|-----------|
| Market overview strip | `/api/market/spot` for each symbol | `['spot', sym]` |
| Seller regime board | `/api/risk/regime` (new endpoint, analytical) | `['regime']` |
| Best opportunity leaderboard | `/api/market/opportunities` (new, analytical) | `['opportunities']` |
| Book stress summary | `/api/risk/snapshot` | `['risk', 'snapshot']` |
| Active alerts and callbacks | `/api/automation/events?status=active` | `['automation', 'events', 'active']` |
| Today's journal agenda | `/api/reviews/journal?today=true` | `['journal', { today: true }]` |
| Recent fills | `/api/portfolio/trades?today=true` | `['trades', { today: true }]` |

New backend endpoints needed for Launchpad:
- `GET /api/risk/regime` — returns current market regime classification (analytical)
- `GET /api/market/opportunities` — returns ranked seller opportunity list (analytical)

These are analytical and should be clearly labeled as such in the Launchpad UI.

---

## Part XV: Deployment Architecture

### 15.1 Current Deployment

```
Frontend: Vercel (static SPA + serverless proxy at /api/kaggle/)
Backend: Kaggle Notebook (Python, exposed via Cloudflare tunnel)
```

### 15.2 How Backend Modularization Affects Deployment

It doesn't change deployment topology. The `kaggle_backend.py` file becomes a thin bootstrap:

```python
# kaggle_backend.py (reduced to ~20 lines)
import sys
sys.path.insert(0, './backend')

from app.create_app import create_app
import uvicorn

app = create_app()

if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=8000)
```

The `backend/` directory is uploaded alongside `kaggle_backend.py` to the Kaggle notebook. No change to tunnel setup.

### 15.3 Vercel Proxy Update

The Vercel serverless proxy at `api/kaggle/[[...path]].js` continues to work unchanged. It forwards requests to the tunnel URL. New route paths (`/api/session/connect`, `/api/market/chain`, etc.) are automatically proxied because the catch-all pattern handles any path.

### 15.4 Environment-Specific Behavior

```typescript
// Deployment mode detection (existing logic, formalized)
type DeploymentMode = 'vercel-proxy' | 'tunnel-direct' | 'local';

function detectDeploymentMode(backendUrl: string): DeploymentMode {
  if (backendUrl.startsWith('/')) return 'vercel-proxy';
  if (backendUrl.includes('trycloudflare.com') || 
      backendUrl.includes('ngrok')) return 'tunnel-direct';
  return 'local';
}

// Capabilities per mode
const CAPABILITIES: Record<DeploymentMode, { websocket: boolean; directAuth: boolean }> = {
  'vercel-proxy': { websocket: false, directAuth: false },
  'tunnel-direct': { websocket: true, directAuth: true },
  'local': { websocket: true, directAuth: true },
};
```

---

## Part XVI: Migration Checklists

### Phase 0 Checklist

```
□ Fix StrategyBuilder template bug (add onSetLegs prop)
□ Replace SPOT_PRICES module constant with useSpotPriceStore
□ Add _connectingPromise guard to WS client
□ Add greekSource field to OptionRow type and all chain producers
□ Verify PE theta uses pe_ltp (not ce_ltp)
□ Install react-router-dom, @tanstack/react-query, zustand
□ Run flexlayout-react spike (1 day max)
□ Create src/state/ directory with terminal and streaming store skeletons
□ Create src/services/api/ directory with query client setup
□ Create backend/app/ directory structure (empty modules)
□ Delete src/components/OptionChain.old
□ Move src/utils/breezeClient.ts to src/services/broker/diagnosticBreezeClient.ts
□ Add VITE_USE_NEW_SHELL feature flag
□ Document file classifications in ARCHITECTURE.md
```

### Phase 1A Checklist (Frontend Spine)

```
□ Create QueryClient with default stale times matching STALE_THRESHOLDS
□ Create useChainQuery() wrapping /api/market/chain
□ Create usePositionsQuery() wrapping /api/portfolio/positions
□ Create useOrdersQuery() wrapping /api/portfolio/orders
□ Create useTradesQuery() wrapping /api/portfolio/trades
□ Create useFundsQuery() wrapping /api/portfolio/funds
□ Create usePreviewMutation() wrapping /api/execution/preview
□ Create usePlaceOrderMutation() wrapping /api/orders
□ Create useCancelOrderMutation() wrapping /api/orders/{id}/cancel
□ Create eventBus singleton with tick batching
□ Refactor streaming manager to emit to eventBus instead of calling React setState
□ Create useTerminalStore with workspace, selections, keyboard mode
□ Create useStreamStore with WS status, tick overlay, spot prices
□ Migrate marketStore chain state to useChainQuery + useStreamStore overlay
□ Migrate executionStore preview state to usePreviewMutation
□ Migrate portfolioStore to usePositionsQuery, useOrdersQuery, etc.
□ Verify: no provider is the primary state container after migration
□ Verify: live updates flow through eventBus, not context invalidation
```

### Phase 1B Checklist (Backend Modularization)

```
□ Create backend/app/__init__.py
□ Create backend/app/create_app.py (extract from kaggle_backend.py)
□ Extract session routes to backend/app/api/routes/session.py
□ Extract market routes to backend/app/api/routes/market.py
□ Extract streaming routes/WS to backend/app/api/routes/stream.py
□ Extract order routes to backend/app/api/routes/orders.py
□ Extract portfolio routes to backend/app/api/routes/portfolio.py
□ Extract automation routes to backend/app/api/routes/automation.py
□ Extract review routes to backend/app/api/routes/reviews.py
□ Extract diagnostics routes to backend/app/api/routes/diagnostics.py
□ Extract Breeze client calls to backend/app/clients/breeze/*.py
□ Extract tick store to backend/app/services/streaming/tick_store.py
□ Extract automation manager to backend/app/services/automation/rule_service.py
□ Extract review manager to backend/app/services/review/journal_service.py
□ Create backend/app/api/routes/compat.py with all old route aliases
□ Create backend/app/storage/database.py with SQLite setup
□ Create backend/app/storage/migrations.py with schema from Part VII
□ Reduce kaggle_backend.py to bootstrap entrypoint
□ Verify: all existing frontend API calls still work via compat routes
□ Verify: all tests pass (if any exist)
```

### Phase 2 Checklist (Shell)

```
□ Create src/app/router/routes.tsx with full route tree
□ Create src/app/shell/GlobalRibbon.tsx
□ Create src/app/shell/LeftLauncher.tsx
□ Create src/app/shell/WorkspaceHeader.tsx
□ Create src/app/shell/BottomDock.tsx (new, not legacy)
□ Create src/app/shell/StatusBar.tsx
□ Integrate docking library (or CSS Grid fallback)
□ Implement keyboard mode state machine
□ Implement key binding registration system
□ Implement command palette (Ctrl+K)
□ Implement workspace navigation (G+M, G+S, etc.)
□ Implement layout save/restore via workspace_layouts table
□ Wire VITE_USE_NEW_SHELL=true to use new router
□ Create ui/panels/TerminalPanel.tsx
□ Create ui/grids/DataGrid.tsx
□ Create ui/ribbons/MetricRibbon.tsx
□ Create ui/inspectors/InspectorRail.tsx
□ Create ui/docks/BlotterDock.tsx
□ Create ui/badges/AuthorityBadge.tsx
□ Create ui/forms/ActionConfirmation.tsx
□ Verify: can navigate all workspace routes
□ Verify: bottom dock persists across workspace switches
□ Verify: keyboard mode indicator updates correctly
□ Verify: layout saves and restores across browser refresh
□ Remove VITE_USE_NEW_SHELL flag, delete legacy shell code
```

---

## Part XVII: Acceptance Criteria

The system is complete when all of the following are true:

1. **Every live surface shows freshness**: Every panel displaying live data shows when it was last updated and whether it is stale.

2. **Every derived metric shows authority**: Greeks, risk aggregates, opportunity scores, and adjustment suggestions are labeled as broker-confirmed, normalized, or analytical.

3. **Execution is OMS-grade**: A trader can stage legs, preview fees and margin, send a basket, track per-leg status, and handle partial failures — all without leaving the execution desk.

4. **Grouped positions exist on the backend**: The portfolio shows strategies as coherent units, not individual legs.

5. **The keyboard is sufficient**: A trader can navigate workspaces, search symbols, stage and send orders, and toggle panels without touching the mouse.

6. **The shell is persistent**: The bottom dock, ribbon, and launcher persist across workspace switches. Layouts survive browser refresh.

7. **Automation is auditable**: Every rule trigger, action execution, and callback is logged with timestamps and can be reviewed.

8. **The journal traces back to execution**: A journal case can show the original opportunity, the execution details, any adjustments made, and the final outcome.

9. **Diagnostics are always available**: Connection status, WS health, rate limit status, and backend health are visible in the Ops workspace at all times.

10. **Performance budgets are met**: Chain renders in < 100ms, tick updates paint in < 50ms, workspace switches complete in < 200ms.

11. **No provider serves as primary state container**: All server state flows through react-query, all live state through Zustand stores, all events through the event bus.

12. **The backend is modular**: No service file exceeds 500 lines. Route files contain only request handling and response formatting. Business logic lives in services.

---

## Part XVIII: What This Spec Does Not Cover

These are explicitly out of scope for the current build phase:

1. **Multi-broker support**: The system is Breeze-only. Abstraction for other brokers is not designed.
2. **Multi-user**: Single-user terminal. No user management, no shared state.
3. **Mobile/responsive**: Terminal-class density is the target. Mobile is not supported.
4. **Backtesting engine**: Historical data is available but no backtesting framework is specified.
5. **Options on individual stocks**: Only NIFTY and SENSEX are configured. Stock options require strike step discovery and different lot size logic.
6. **React 19 migration**: The spec assumes React 18. React 19 migration is a separate effort.
7. **Production database**: SQLite is the persistence layer. PostgreSQL migration is designed for but not implemented.
8. **CI/CD**: No pipeline is specified. Deployment remains manual (Vercel auto-deploy + Kaggle notebook).

---

*This is the final specification. Every type is defined. Every state machine is drawn. Every migration step is listed. Every performance budget is measurable. Every error recovery flow is specified. Build against this document.*
