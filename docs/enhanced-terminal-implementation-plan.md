# Sensibull Terminal: Implementation Plan

## Purpose

This document translates the target architecture and product spec into an implementation sequence that can be executed from the current repository state.

Companion spec:

- `docs/enhanced-terminal-architecture-spec.md`

This plan is intentionally opinionated:

- stabilize the current base before expansion
- standardize around a single backend contract
- build routed workspaces instead of adding more tabs to `App.tsx`
- prioritize live trading safety, reliability, and observability over cosmetic breadth

---

## 1. Current Starting Point

The repository is not starting from zero. It already has:

- a functioning Vite React frontend
- a strong `OptionChain` module
- a usable but oversized `Positions` module
- a backend proxy route for Vercel
- a Python-backend integration path for Breeze
- websocket and REST fallback live data logic

But before major feature work, it also has real engineering debt:

- `npx tsc --noEmit` is failing
- test/storybook files are compiled without matching dependencies/config
- `StrategyBuilder.tsx` contains a template insertion defect
- broker integration logic is fragmented across UI components and utility layers

So the correct order is:

1. platform integrity
2. architecture refactor
3. capability expansion
4. UX differentiation

---

## 2. Delivery Principles

### 2.1 Product principles

- Stream first, poll only as fallback.
- Every live order flow must be previewable, traceable, and reversible where possible.
- Every panel must show freshness and connection state.
- Risk must be visible before action, not after.

### 2.2 Engineering principles

- The frontend talks to one canonical backend API.
- React components should not decide transport mode.
- Business logic belongs in domain services/stores, not in page components.
- Type safety and CI quality gates are mandatory.
- New modules must follow the modular pattern of `OptionChain`, not the monolith pattern of `App.tsx` or `Positions.tsx`.

---

## 3. Workstreams

Implementation should be run as parallel workstreams with explicit ownership.

### Workstream A: Platform Integrity

- fix TS compile issues
- split app/test/storybook TS configs
- add linting and CI gates
- fix current runtime defects
- establish coding standards for new modules

### Workstream B: Broker Platform Layer

- canonical backend API contract
- session store
- broker gateway client
- websocket manager
- capability registry

### Workstream C: Frontend App Shell

- route-based workspace shell
- left rail / top bar / dock / command palette
- workspace state model
- notification center

### Workstream D: Market and Strategy

- market workspace
- charts
- option chain evolution
- strategy builder v2
- analytics

### Workstream E: Execution and Portfolio

- advanced ticket
- blotter
- portfolio cockpit
- order/trade detail
- square-off workflows

### Workstream F: Risk and Automation

- margin/risk dashboards
- GTT center
- alert rules
- automation workflows

---

## 4. Phase Plan

## Phase 0: Stabilize the Existing Repo

### Objective

Make the current codebase safe to build on.

### Deliverables

- strict app typecheck passes
- tests and storybook are isolated from app build config
- current runtime defects are fixed
- baseline CI pipeline exists

### Required tasks

#### Tooling and config

- create separate TS configs:
  - `tsconfig.app.json`
  - `tsconfig.test.json`
  - `tsconfig.storybook.json`
- update root `tsconfig.json` to stop compiling unsupported test/storybook surfaces into app builds
- install missing test/storybook dependencies or remove references until intentionally reintroduced
- add `eslint`
- add formatting script
- add CI commands:
  - `npm run build`
  - `npx tsc -p tsconfig.app.json --noEmit`
  - tests when harness is installed

#### Code fixes

- fix `StrategyBuilder.tsx` template insertion bug
- remove unused imports and dead refs surfaced by TS
- either wire `useBreeze` into the app properly or delete it and consolidate
- validate `VirtualOptionChain` strategy and decide if it is production path or experimental path

### Exit criteria

- app typecheck passes
- no known runtime defect in current live order/strategy flows
- build and typecheck are both green locally and in CI

---

## Phase 1: Introduce a Canonical Broker Platform Layer

### Objective

Remove transport logic from page components and establish a stable contract for all Breeze capabilities.

### Deliverables

- `brokerGatewayClient`
- `sessionStore`
- `marketStore`
- `executionStore`
- `portfolioStore`
- unified websocket manager

### Target folder structure

```text
src/
  app/
  domains/
    session/
    market/
    execution/
    portfolio/
    risk/
    automation/
  services/
    broker/
    streaming/
    analytics/
  stores/
  components/
  lib/
```

### Required tasks

#### Session domain

- move connection state out of `App.tsx`
- create broker session model:
  - account
  - connected state
  - session expiry
  - capability flags
  - backend health
  - stream health
- create session bootstrap actions

#### Broker client

- create one frontend-facing client with grouped methods:
  - `session.*`
  - `account.*`
  - `market.*`
  - `orders.*`
  - `trades.*`
  - `positions.*`
  - `funds.*`
  - `risk.*`
  - `automation.*`
- move direct usage of `kaggleClient` and `breezeClient` behind this client
- mark browser-direct Breeze mode as diagnostic/fallback, not primary production mode

#### Streaming

- unify market data streaming lifecycle
- unify subscription registry
- support:
  - quote subscriptions
  - option chain subscriptions
  - order notifications
  - alerts

### Exit criteria

- `App.tsx` no longer owns broker orchestration details
- components no longer branch on transport mode
- connection center can report health/capability status from one source of truth

---

## Phase 2: Build the App Shell and Workspace Routing

### Objective

Replace tab-driven top-level navigation with a proper workspace shell.

### Deliverables

- route-based shell
- left navigation rail
- top macro bar
- right utility drawer
- bottom dock for blotter/logs/notifications

### Proposed routes

- `/market`
- `/strategy`
- `/execution`
- `/portfolio`
- `/risk`
- `/automation`
- `/settings/connections`

### Required tasks

- add router
- move top-level tabs out of `TopBar`
- create shell layout primitives:
  - `AppShell`
  - `WorkspaceNav`
  - `WorkspaceHeader`
  - `RightDrawer`
  - `BottomDock`
- add global notification center
- add command palette

### Exit criteria

- current three-tab app becomes routed workspace shell
- legacy top-level tab state is removed from `App.tsx`

---

## Phase 3: Market Workspace v1

### Objective

Turn the current market UI into a full market workspace, not just an option chain page.

### Deliverables

- watchlist board
- option chain v2
- spot and quote board
- market depth drawer
- chart panel with historical v2 data

### Breeze capabilities to integrate

- `get_quotes`
- `get_market_depth`
- `get_option_chain_quotes`
- `get_historical_data_v2`
- feed subscriptions
- candle stream if available through backend

### Required tasks

#### Watchlists

- create watchlist entity model
- search instruments using backend lookup support
- pin contracts and spreads
- live quote updates

#### Option chain evolution

- preserve existing `OptionChain` strengths
- add expiry compare mode
- add skew/volatility surface overlays
- add strike pinning
- add selected-contract side panel

#### Charting

- historical candles
- interval switch
- day/session markers
- ATM overlay
- strategy overlay hook points

### Exit criteria

- market workspace can support discovery, analysis, and trade staging from one route

---

## Phase 4: Strategy Workspace v2

### Objective

Replace the current builder with a proper strategy design surface.

### Deliverables

- multi-panel strategy builder
- scenario engine
- saved drafts
- template catalog
- strategy compare mode

### Required tasks

- split current `StrategyBuilder.tsx` into:
  - leg editor
  - template gallery
  - payoff chart
  - greek dashboard
  - scenario table
  - execution staging panel
- add scenario dimensions:
  - spot move
  - IV change
  - time decay
- allow import from:
  - option chain
  - positions
  - templates

### Exit criteria

- strategy building becomes a first-class workspace, not a side effect of chain interactions

---

## Phase 5: Execution Workspace

### Objective

Build a professional execution surface around the official order lifecycle.

### Deliverables

- advanced order ticket
- order preview
- margin and limit suggestion
- amend/cancel/replace workflows
- basket execution
- live execution notifications

### Breeze capabilities to integrate

- `place_order`
- `modify_order`
- `cancel_order`
- `square_off`
- `preview_order`
- `limit_calculator`
- `margin_calculator`
- order notifications / stream

### Required tasks

- build `OrderIntent` and `OrderPreview` models
- add pre-submit validation
- add order preview panel
- add inline modify flow from blotter
- add cancel-replace shortcuts
- add batch strategy execution

### Exit criteria

- the app can stage, preview, execute, amend, and track live orders safely

---

## Phase 6: Portfolio Workspace v2

### Objective

Refactor `Positions.tsx` into a portfolio cockpit with normalized submodules.

### Deliverables

- positions board
- holdings board
- demat holdings board
- funds panel
- order blotter
- trade blotter
- order detail drawer
- trade detail drawer

### Breeze capabilities to integrate

- `get_portfolio_positions`
- `get_portfolio_holdings`
- `get_demat_holdings`
- `get_funds`
- `get_order_list`
- `get_order_detail`
- `get_trade_list`
- `get_trade_detail`

### Required tasks

- split `Positions.tsx` into domain modules
- normalize order/trade/position entities
- add drilldown drawers for detail endpoints
- add realized/unrealized analytics
- keep existing square-off and batch-cancel strengths

### Exit criteria

- portfolio becomes a proper data workspace instead of one giant component

---

## Phase 7: Risk Workspace

### Objective

Make risk a first-class product differentiator.

### Deliverables

- aggregate exposure dashboard
- greek heatmap
- expiry concentration table
- margin pressure board
- scenario stress testing
- alert engine

### Required tasks

- aggregate net greeks by:
  - account
  - symbol
  - expiry
  - strategy
- build margin pressure components from funds + margin calculators
- build expiry risk board from positions + chain + time-to-expiry
- add rule engine for warnings:
  - high short gamma
  - concentrated short premium
  - low free margin
  - expiry-day exposure concentration

### Exit criteria

- user can understand current and projected risk before placing new trades

---

## Phase 8: Automation Workspace

### Objective

Use GTT and event workflows to extend the terminal beyond manual trading.

### Deliverables

- single-leg GTT center
- multi-leg GTT center
- alert rules
- trigger history
- automation playbooks

### Breeze capabilities to integrate

- single-leg GTT APIs
- three-leg GTT APIs
- order notifications
- strategy stream and related utility surfaces if exposed by backend

### Required tasks

- build automation domain models
- create create/edit/cancel GTT flows
- connect strategy builder outputs to trigger creation
- add notification history and trigger result logs

### Exit criteria

- the app supports rule-based execution and exits without custom manual monitoring

---

## 5. Backend Plan

The backend should evolve from a tunnel-backed helper into a stable service contract.

### Stage 1: Canonicalize the existing Python backend

- extract current Kaggle code into a real backend repo or backend package
- keep Vercel proxy support
- formalize route contracts
- add response schemas

### Stage 2: Add grouped endpoints

Suggested endpoint families:

- `/api/session/*`
- `/api/account/*`
- `/api/market/*`
- `/api/options/*`
- `/api/orders/*`
- `/api/trades/*`
- `/api/positions/*`
- `/api/holdings/*`
- `/api/funds/*`
- `/api/risk/*`
- `/api/automation/*`

### Stage 3: Streaming separation

- `/ws/market`
- `/ws/orders`
- `/ws/alerts`

### Stage 4: Observability

- structured logs
- API timing
- stream lag metrics
- error classification
- session audit trail

---

## 6. Data Contracts to Introduce

Recommended schemas:

- `CustomerProfileSchema`
- `BrokerSessionSchema`
- `QuoteSchema`
- `MarketDepthSchema`
- `OptionChainSnapshotSchema`
- `OptionChainDeltaSchema`
- `HistoricalCandleSchema`
- `OrderSchema`
- `OrderDetailSchema`
- `TradeSchema`
- `TradeDetailSchema`
- `PositionSchema`
- `HoldingSchema`
- `FundsSchema`
- `MarginEstimateSchema`
- `OrderPreviewSchema`
- `GttRuleSchema`

All frontend API responses should be schema-validated at the boundary.

---

## 7. Test Strategy

### 7.1 Unit tests

- math utilities
- risk calculations
- schema parsing
- store reducers/actions
- order preview validation

### 7.2 Component tests

- option chain interactions
- ticket submission flows
- portfolio tables
- risk alerts
- automation rule forms

### 7.3 Integration tests

- connect broker
- fetch market snapshot
- place order
- modify order
- cancel order
- square off
- GTT creation

### 7.4 End-to-end smoke tests

- login/session bootstrap
- chain to ticket to order flow
- positions to square-off flow
- funds refresh
- order/trade drilldown

---

## 8. Recommended Milestones

### Milestone 1: Repo hardening

- typecheck green
- CI added
- current defects fixed

### Milestone 2: Platform layer

- unified broker client
- session and market stores
- `App.tsx` reduced significantly

### Milestone 3: Shell and routing

- routed workspaces live
- command palette and notification center added

### Milestone 4: Market + execution core

- market workspace v1
- advanced order ticket
- order preview / margin / limit workflows

### Milestone 5: Portfolio and risk

- portfolio workspace v2
- risk workspace v1

### Milestone 6: Automation

- GTT center
- alerts
- automation history

---

## 9. Suggested Engineering Sequence by File

### First refactor targets

- `src/App.tsx`
- `src/components/Positions.tsx`
- `src/components/ConnectBrokerModal.tsx`
- `src/components/StrategyBuilder.tsx`
- `src/utils/kaggleClient.ts`
- `src/utils/breezeWs.ts`

### Suggested extraction order

1. `session` store and broker client
2. market store and stream manager
3. app shell and router
4. portfolio submodules from `Positions.tsx`
5. connection center from `ConnectBrokerModal.tsx`
6. strategy builder decomposition
7. risk and automation modules

---

## 10. Risks and Mitigations

### Risk: architecture expansion without cleanup

Mitigation:

- no major feature work before Phase 0 is complete

### Risk: dual transport complexity

Mitigation:

- one canonical backend API
- browser-direct path only as fallback or diagnostics

### Risk: live order safety regressions

Mitigation:

- preview-first order flows
- action audit trail
- explicit paper/live mode separation

### Risk: websocket instability through proxies

Mitigation:

- direct backend websocket route where possible
- health and stale indicators
- controlled REST fallback

### Risk: oversized React components returning

Mitigation:

- enforce module boundaries
- push business logic into stores/services
- cap file size through review discipline

---

## 11. Immediate Next Tasks

If execution starts now, the highest-value next tasks are:

1. fix the TS/build integrity gap
2. fix `StrategyBuilder` template defect
3. create app/test/storybook TS config split
4. create a unified broker gateway client
5. extract session and market state out of `App.tsx`
6. introduce routing and workspace shell

---

## 12. Definition of Success

The implementation is successful when the terminal can:

- connect cleanly through a stable Breeze backend
- stream live market data reliably
- analyze options with professional-grade chain and strategy tools
- preview, place, amend, and cancel live orders safely
- present portfolio and risk views clearly
- automate exits and trigger-based workflows
- remain maintainable as the product grows

That is the path from the current promising prototype to a best-in-class Breeze trading workstation.
