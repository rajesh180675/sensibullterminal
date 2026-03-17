# Sensibull Terminal: Institutional Master Implementation Plan

## 1. Plan Status

This document is the execution plan for `docs/institutional-terminal-master-spec.md`.

It replaces the earlier high-level roadmap and is grounded in the repository state on March 17, 2026.

Current baseline confirmed in code:

- frontend entrypoint is `src/App.tsx`
- routing is a custom history hook in `src/app/useWorkspaceRoute.ts`
- shell composition lives in `src/app/shell/AppShell.tsx`
- domain orchestration is still the nested provider stack in `src/app/AppProviders.tsx`
- market, execution, portfolio, risk, automation, journal, and session logic live under `src/domains/*`
- broker access is funneled through `src/services/broker/brokerGatewayClient.ts`
- live transport is handled by `src/services/streaming/unifiedStreamingManager.ts`
- the backend is still primarily the 3308-line `kaggle_backend.py`

The goal is not a rewrite for style. The goal is to move this repo from a strong seller-focused prototype into a terminal platform with explicit authority boundaries, reusable workstation infrastructure, and maintainable service modules.

---

## 2. Implementation Decisions Locked Now

These decisions should be treated as plan-of-record unless an implementation spike proves a blocker.

### 2.1 Client Routing

Adopt `react-router-dom` and retire `src/app/useWorkspaceRoute.ts` after migration.

Reason:

- the current custom router is too limited for deep links, nested workspace state, loaders, and persisted URL state
- the spec explicitly requires richer route semantics and a true workspace model

### 2.2 Server State and Mutations

Adopt `@tanstack/react-query` for backend reads, writes, invalidation, loading states, and mutation recovery.

Reason:

- current providers mix server state, UI state, and cross-domain derivation
- the spec requires clear separation between authoritative backend state and terminal-local state

### 2.3 Terminal UI State

Create `src/state/*` stores backed by `zustand` for terminal-local state:

- workspace selection
- panel visibility
- symbol linking
- staged selections
- layout persistence metadata
- command palette state
- per-workspace filters and sort state

Reason:

- this is the cleanest path out of the current provider dependency chain
- the repo already wants domain intent without React tree orchestration as the primary runtime model

### 2.4 Stream Fan-Out

Introduce a typed event bus in `src/services/streaming/eventBus.ts` and route all live updates through it.

Reason:

- the spec requires stream-driven behavior without broad provider invalidation
- current `UnifiedStreamingManager` only handles transport fallback, not terminal-wide event distribution

### 2.5 Layout Engine

Adopt a proven docking layout library for the shell rather than building a custom dock manager first.

Plan-of-record choice:

- spike `flexlayout-react` first for dockable panels, tabs, splits, and layout serialization
- if the spike fails on React 19 or keyboard control requirements within one implementation day, fall back to a thin internal split-pane shell and defer full docking to a later phase

Reason:

- the spec requires dockable panels, saved layouts, split panes, stackable tabs, and bottom dock behavior
- that is too much infrastructure to reinvent before the product surfaces are upgraded

### 2.6 Backend Packaging

Keep one FastAPI process initially, but split code into a real package under `backend/app/` and reduce `kaggle_backend.py` to a bootstrap entrypoint.

Reason:

- this preserves deployment simplicity
- it resolves the current maintainability problem without forcing premature service decomposition

### 2.7 Truth Model

Every live surface and every API response must explicitly identify:

- `authority`: `broker` | `normalized` | `analytical`
- `source`: transport or computation origin
- `as_of`: freshness timestamp

Reason:

- the spec makes this a core invariant
- the current code mixes broker-confirmed and inferred data too freely

### 2.8 Persistence

Introduce a storage layer now and move automation, review, playbook, and layout persistence behind repository interfaces.

Initial backing store:

- SQLite via the Python standard library `sqlite3`

Reason:

- the repo already persists automation and review state
- file-backed state is no longer enough for auditability, layout persistence, and multi-session continuity
- `sqlite3` keeps the migration realistic without adding unnecessary backend complexity in the first pass

### 2.9 Grouped Strategy Identity

Promote grouped strategy identity to a backend-owned model.

Canonical entity:

- `GroupedPosition`

Reason:

- portfolio, risk, adjustment, review, and attribution all depend on coherent strategy grouping
- the spec explicitly calls out frontend grouping heuristics as insufficient for the next stage

---

## 3. Current Repo Starting Point

### 3.1 Frontend

The current app already proves several important assets:

- `src/app/shell/AppShell.tsx` gives a real route shell instead of a giant `App.tsx`
- `src/app/router.ts` already contains workspace metadata
- `src/components/OptionChain/*` is the strongest production-grade component family in the repo
- `src/domains/execution/executionStore.tsx` already merges local preview with backend preview and margin
- `src/domains/market/marketStore.tsx` already combines chain, depth, historical data, watchlists, and streaming
- `src/services/broker/brokerGatewayClient.ts` already centralizes most backend and broker access

The main constraints are equally clear:

- `src/app/AppProviders.tsx` is still the orchestration spine
- `src/app/useWorkspaceRoute.ts` is too thin for terminal-grade routing
- workspaces are still page-like compositions, not a docked workstation
- non-chain surfaces are less systematized than the option chain
- live state is still coupled to React context boundaries

### 3.2 Backend

`kaggle_backend.py` already proves the product has real operating depth:

- connection lifecycle
- option chain snapshot
- spot quotes
- historical candles
- market depth
- websocket tick transport
- preview, margin, and repair preview
- order placement, cancel, modify, and basket execution
- positions, funds, orders, and trades
- automation rules, callbacks, and evaluation
- review state persistence

The backend constraint is code shape, not feature absence:

- one file owns session, market, OMS, automation, review, transport, auth, and diagnostics
- route families reflect implementation convenience rather than business domains
- storage is not yet formalized

### 3.3 Legacy and Transitional Artifacts

These files should be explicitly classified during Phase 0:

- `src/components/OptionChain.old`
- `src/app/shell/BottomDock.tsx`
- `src/app/shell/RightDrawer.tsx`
- `src/components/TopBar.tsx`
- `src/components/Positions.tsx`
- browser-direct broker paths in `src/utils/breezeClient.ts`

The plan is not to delete everything immediately. The plan is to declare what remains strategic, what becomes compatibility-only, and what is retired.

---

## 4. Target Code Map

### 4.1 Frontend Target Shape

```text
src/
  app/
    router/
    shell/
    layouts/
    command/
  ui/
    panels/
    grids/
    ribbons/
    inspectors/
    docks/
    forms/
  domains/
    session/
    market/
    strategy/
    execution/
    portfolio/
    risk/
    seller/
    automation/
    review/
  services/
    api/
    broker/
    streaming/
    analytics/
    persistence/
  state/
    terminal/
    layout/
    selections/
    preferences/
    workspace/
  lib/
    formatting/
    math/
    time/
    ids/
```

### 4.2 Backend Target Shape

```text
backend/
  app/
    api/
      routes/
        session.py
        market.py
        stream.py
        execution.py
        orders.py
        portfolio.py
        risk.py
        automation.py
        reviews.py
        diagnostics.py
    core/
      settings.py
      auth.py
      logging.py
      rate_limit.py
    clients/
      breeze/
        session.py
        market.py
        execution.py
        portfolio.py
        streaming.py
    services/
      market/
      execution/
      portfolio/
      risk/
      automation/
      reviews/
      diagnostics/
      streaming/
    models/
    storage/
```

`kaggle_backend.py` should remain as the externally invoked entrypoint until the deployment scripts are updated, but its job should become:

- load settings
- create the FastAPI app
- start the server

---

## 5. Migration Rules

These rules govern implementation across all phases.

1. No big-bang rewrite.
2. Old routes stay alive behind compatibility adapters until frontend consumers are migrated.
3. New data models must carry authority and freshness metadata from day one.
4. All broker mutations must emit audit events.
5. Layout work must improve at least two workspaces before being considered stable.
6. Browser-direct mode remains supported only as an explicit diagnostic mode, never as the hidden primary architecture.
7. Large surface migrations should land as vertical slices, not half-finished skeleton screens.

---

## 6. Delivery Workstreams

### Workstream A: Platform Spine

Owns:

- routing
- query and mutation infrastructure
- terminal state
- stream event bus
- authority metadata

### Workstream B: Shell and Layout

Owns:

- top ribbon
- left launcher
- workspace header and submenu
- docked main grid
- bottom blotter dock
- keyboard model

### Workstream C: Market and Strategy Desks

Owns:

- launchpad
- market desk
- chain desk
- strategy lab
- seller intelligence presentation

### Workstream D: OMS, Portfolio, and Risk

Owns:

- execution desk
- grouped positions
- risk cockpit
- adjustment desk
- scenario surfaces

### Workstream E: Automation, Review, and Ops

Owns:

- automation center
- callback audit
- journal and review
- operations workspace
- health and diagnostics surfaces

### Workstream F: Backend Modularization

Owns:

- route family cleanup
- Breeze client extraction
- persistence layer
- diagnostics and audit plumbing

---

## 7. Phase Plan

### Phase 0: Freeze the Architecture and Prepare the Repo

### Objective

Turn the spec into an implementation baseline and remove ambiguity before feature migration starts.

### Concrete Tasks

- adopt this plan as the canonical implementation roadmap
- add the missing client dependencies:
  - `react-router-dom`
  - `@tanstack/react-query`
  - `zustand`
  - chosen docking library after the one-day spike
- create empty scaffolding for:
  - `src/state/*`
  - `src/services/api/*`
  - `backend/app/*`
- classify files as:
  - canonical
  - compatibility
  - retirement candidate
- define shared frontend and backend metadata for:
  - authority
  - source
  - freshness
  - audit event
- document the exact legacy retirement sequence

### Repo Areas Touched

- `package.json`
- `src/app/*`
- `src/state/*`
- `src/services/api/*`
- `backend/app/*`
- `kaggle_backend.py`

### Exit Criteria

- dependency direction is agreed
- directory skeleton exists
- no ambiguity remains about strategic versus legacy paths

---

### Phase 1: Build the Client Platform Spine

### Objective

Separate server state, terminal state, and live event propagation.

### Concrete Tasks

- introduce a shared API client layer in `src/services/api/`
- move backend reads and writes out of provider internals and into query/mutation hooks
- create terminal-local stores for:
  - active workspace
  - symbol links
  - panel state
  - staged selections
  - command palette state
  - layout metadata
- create a typed event bus and route tick, order, callback, and notification events through it
- refactor `src/services/streaming/unifiedStreamingManager.ts` so transport is distinct from event distribution
- standardize data wrappers so market, execution, portfolio, risk, automation, and review can all display freshness and authority

### Initial Migrations

- `src/domains/session/sessionStore.tsx`
- `src/domains/market/marketStore.tsx`
- `src/domains/execution/executionStore.tsx`
- `src/services/broker/brokerGatewayClient.ts`
- `src/services/streaming/unifiedStreamingManager.ts`

### Exit Criteria

- providers no longer serve as the primary orchestration mechanism
- live updates do not require broad React context invalidation
- new code can consume query data and terminal-local state independently

---

### Phase 2: Replace Page Shell with Terminal Shell

### Objective

Move from route-switched pages to a real workstation shell.

### Concrete Tasks

- replace `src/app/useWorkspaceRoute.ts` with React Router
- expand route families to include:
  - Launchpad
  - Market
  - Chain
  - Strategy
  - Execution
  - Portfolio
  - Risk
  - Automation
  - Review
  - Ops
- evolve `src/app/router.ts` into a real router module with nested sections and deep-linkable state
- rebuild `src/app/shell/AppShell.tsx` around:
  - global top ribbon
  - left launcher
  - workspace header
  - dockable main grid
  - persistent bottom dock
- restore `BottomDock` as a formalized blotter, alerts, callbacks, diagnostics, and notes dock
- wire keyboard commands for:
  - command palette
  - workspace navigation
  - symbol search
  - staged execution
  - inspector toggles

### Repo Areas Touched

- `src/App.tsx`
- `src/app/router.ts`
- `src/app/shell/*`
- `src/app/workspaces/*`
- new `src/app/layouts/*`
- new `src/state/layout/*`

### Exit Criteria

- layouts are saved and restorable
- routing supports deep links into symbols and desks
- the shell feels like one terminal, not a set of separate pages

---

### Phase 3: Modularize the Backend Without Breaking Behavior

### Objective

Restructure the backend into domain modules while preserving existing capability.

### Concrete Tasks

- create `backend/app/create_app.py` and move app construction there
- extract route modules by business domain
- extract Breeze access into `backend/app/clients/breeze/*`
- move rate limiter, auth checks, logging, tick store, candle store, automation manager, and review manager into `backend/app/core` and `backend/app/services`
- create repository interfaces for:
  - automation rules
  - automation events
  - review state
  - playbooks
  - workspace layouts
- keep old endpoints operational through thin adapters while new route families are introduced

### Initial Route Families

- `/api/session/*`
- `/api/market/*`
- `/api/stream/*`
- `/api/execution/*`
- `/api/orders/*`
- `/api/portfolio/*`
- `/api/risk/*`
- `/api/automation/*`
- `/api/reviews/*`
- `/api/diagnostics/*`

### Exit Criteria

- `kaggle_backend.py` is no longer the place where product logic lives
- service boundaries exist even though deployment is still single-process
- old routes still work during migration

---

### Phase 4: Market, Chain, and Launchpad Desks

### Objective

Turn the current market workspace into a family of real desks instead of one dense page.

### Concrete Tasks

- split current `MarketWorkspace` into:
  - Launchpad workspace
  - Market workspace
  - Chain workspace
- preserve and elevate `src/components/OptionChain/*` as the center of the Chain desk
- add linked symbols, watchlist groups, breadth strip, strike intelligence, skew panels, and event markers on candles
- move market-derived calculations that need authority or replay into backend services where appropriate
- create reusable workstation primitives for:
  - panel shells
  - metric ribbons
  - data strips
  - inspectors
  - dense grids

### Repo Areas Touched

- `src/app/workspaces/MarketWorkspace.tsx`
- new `src/app/workspaces/LaunchpadWorkspace.tsx`
- new `src/app/workspaces/ChainWorkspace.tsx`
- `src/components/OptionChain/*`
- `src/domains/market/*`
- `backend/app/services/market/*`

### Exit Criteria

- Launchpad answers the morning trader workflow
- Market handles live situational awareness
- Chain is a dedicated chain intelligence desk

---

### Phase 5: Strategy Lab and Execution Desk

### Objective

Make the seller idea lifecycle explicit from detection through sending.

### Concrete Tasks

- rebuild Strategy into a compare-and-stage lab with:
  - opportunity leaderboard
  - compare basket
  - scenario view
  - playbook linkage
  - strategy explanation block
- refactor execution state from implicit UI behavior into an explicit state machine:
  - staged
  - previewing
  - ready
  - sending
  - partial
  - sent
  - failed
- move preview, margin, repair preview, and basket routing behind explicit execution services
- add rejection drilldown, cancel/replace behavior, slippage guardrails, and leg-level status
- make all execution surfaces declare whether a metric is broker-confirmed or analytical

### Repo Areas Touched

- `src/app/workspaces/StrategyWorkspace.tsx`
- `src/components/StrategyBuilder.tsx`
- `src/app/workspaces/ExecutionWorkspace.tsx`
- `src/domains/seller/sellerIntelligenceStore.tsx`
- `src/domains/execution/executionStore.tsx`
- `backend/app/services/execution/*`
- `backend/app/api/routes/execution.py`
- `backend/app/api/routes/orders.py`

### Exit Criteria

- strategy comparison is explainable and portfolio-aware
- execution can operate as a true OMS desk rather than a preview form

---

### Phase 6: Portfolio, Risk, and Adjustment Authority

### Objective

Make grouped book state and repair logic authoritative, inspectable, and consistent across desks.

### Concrete Tasks

- introduce backend-owned `GroupedPosition` contracts
- normalize grouped strategy identity using positions, orders, and trades rather than frontend heuristics
- rebuild Portfolio around:
  - live grouped positions
  - holdings
  - capital
  - lifecycle explorer
  - concentration views
- rebuild Risk around:
  - live Greek aggregates
  - stress matrix
  - margin ladder
  - broker-confirmed versus analytical labels
- elevate adjustment logic into a dedicated desk or risk subdesk with before/after payoff and repair preview deltas

### Repo Areas Touched

- `src/domains/portfolio/portfolioStore.tsx`
- `src/domains/risk/riskStore.tsx`
- `src/domains/adjustment/adjustmentStore.tsx`
- `src/app/workspaces/PortfolioWorkspace.tsx`
- `src/app/workspaces/RiskWorkspace.tsx`
- `backend/app/services/portfolio/*`
- `backend/app/services/risk/*`

### Exit Criteria

- grouped positions are backend-authoritative
- risk and repair views share one canonical book model
- every surface clearly labels analytical versus broker-confirmed values

---

### Phase 7: Automation, Review, and Operations Center

### Objective

Close the loop from opportunity to rule to execution to callback to review.

### Concrete Tasks

- rebuild Automation as a control center with:
  - rule grid
  - trigger timeline
  - action builder
  - callback stream
  - execution audit
  - dry-run panel
- rebuild Journal as Review with:
  - journal cases
  - lifecycle timeline
  - playbook compliance
  - mistake clusters
  - regime and structure analytics
  - adjustment effectiveness analytics
- add Operations workspace for:
  - backend health
  - websocket health
  - rate limits
  - auth mode
  - diagnostic logs
- persist layouts, playbooks, automation events, and review artifacts through the new storage layer

### Repo Areas Touched

- `src/app/workspaces/AutomationWorkspace.tsx`
- `src/app/workspaces/JournalWorkspace.tsx`
- new `src/app/workspaces/OpsWorkspace.tsx`
- `src/domains/automation/automationStore.tsx`
- `src/domains/journal/journalStore.tsx`
- `backend/app/services/automation/*`
- `backend/app/services/reviews/*`
- `backend/app/services/diagnostics/*`

### Exit Criteria

- a trader can trace a setup from idea to automation to callback to review
- operational diagnostics are always visible during live trading

---

### Phase 8: Hardening, Performance, and Rollout Safety

### Objective

Make the new architecture safe to operate and safe to keep extending.

### Concrete Tasks

- virtualize all large grids
- profile chain updates and multi-panel rerender behavior
- add route and service tests for all new route families
- add client tests for:
  - layout persistence
  - keyboard flows
  - staged execution state machine
  - grouped position derivation
  - automation timeline behavior
- add audit event coverage for every live mutation
- add failure-mode handling for:
  - stream degradation
  - backend disconnect
  - preview failures
  - callback auth failures
  - persistence write failures

### Exit Criteria

- live workflows are observable
- the terminal remains fast under load
- the migration can continue without regressions becoming invisible

---

## 8. API Migration Matrix

The backend migration should use compatibility adapters, not a one-shot route break.

| Current Route | Target Route |
| --- | --- |
| `/api/connect` | `/api/session/connect` |
| `/api/disconnect` | `/api/session/disconnect` |
| `/api/expiries` | `/api/market/expiries` |
| `/api/spot` | `/api/market/spot` |
| `/api/optionchain` | `/api/market/chain` |
| `/api/quote` | `/api/market/quote` |
| `/api/historical` | `/api/market/candles` |
| `/api/depth` | `/api/market/depth` |
| `/api/ws/subscribe` | `/api/stream/subscribe` |
| `/ws/ticks` | `/ws/stream` |
| `/api/ticks` | `/api/stream/poll` |
| `/api/preview` | `/api/execution/preview` |
| `/api/margin` | `/api/execution/margin` |
| `/api/repair-preview` | `/api/execution/repair-preview` |
| `/api/order` | `/api/orders` |
| `/api/order/cancel` | `/api/orders/{id}/cancel` |
| `/api/order/modify` | `/api/orders/{id}` |
| `/api/strategy/execute` | `/api/orders/basket` |
| `/api/squareoff` | `/api/orders/squareoff` |
| `/api/orders` | `/api/portfolio/orders` |
| `/api/trades` | `/api/portfolio/trades` |
| `/api/positions` | `/api/portfolio/positions` |
| `/api/funds` | `/api/portfolio/funds` |
| `/api/automation/rules` | `/api/automation/rules` |
| `/api/automation/evaluate` | `/api/automation/evaluate` |
| `/api/automation/callbacks` | `/api/automation/events` |
| `/api/automation/callbacks/webhook` | `/api/automation/events/webhook` |
| `/api/reviews/state` | `/api/reviews/journal` |
| `/api/diagnostics/execution-validation` | `/api/diagnostics/execution-validation` |
| `/api/ratelimit` | `/api/diagnostics/rate-limit` |
| `/api/checksum` | `/api/session/checksum` |

---

## 9. Program Acceptance Gates

The program should only be considered successful when all of the following are true:

1. The shell supports saved multi-panel layouts, deep links, keyboard workflows, and a persistent bottom dock.
2. Market, Chain, Strategy, Execution, Portfolio, Risk, Automation, Review, and Ops all use a shared workstation language.
3. Broker truth, normalized truth, and analytical truth are visibly distinct on all live desks.
4. Execution, repair, automation, and review flows emit auditable events.
5. Grouped positions, lifecycle attribution, and close-out analytics are backend-authoritative.
6. Diagnostics for streams, auth, rate limits, and callbacks are always available.
7. The terminal remains responsive under live updates and large datasets.

---

## 10. Immediate Build Order

If execution starts now, use this sequence:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6
8. Phase 7
9. Phase 8

This order is deliberate:

- the platform spine and shell changes multiply every later workspace
- backend modularization should begin early enough to stop further monolith growth
- market, chain, strategy, and execution are the most visible and highest-value trading desks
- portfolio, risk, automation, review, and ops depend on the same canonical contracts

---

## 11. First PR Sequence

To keep the rollout pragmatic, the first implementation tranche should be split into these pull requests:

1. `platform-foundation`
   - dependency additions
   - React Router skeleton
   - Query client setup
   - Zustand terminal state skeleton
   - streaming event bus skeleton
2. `shell-layout-v1`
   - top ribbon
   - left launcher
   - bottom dock
   - saved layout persistence
   - route migration from custom history hook
3. `backend-app-structure`
   - `backend/app` package
   - route modules
   - Breeze client extraction
   - compatibility adapters in `kaggle_backend.py`
4. `market-chain-launchpad`
   - launchpad workspace
   - chain workspace
   - market desk split
   - shared workstation primitives
5. `strategy-execution-oms`
   - strategy compare flow
   - explicit execution state machine
   - order and repair drilldowns
6. `portfolio-risk-adjustment`
   - backend grouped positions
   - portfolio and risk rebuild
   - adjustment desk
7. `automation-review-ops`
   - storage-backed automation and review
   - operations workspace
   - audit and diagnostics surfaces
8. `hardening`
   - performance profiling
   - regression tests
   - rollout safety checks

This is the implementation plan to build against.
