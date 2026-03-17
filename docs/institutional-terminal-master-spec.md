# Sensibull Terminal: Institutional Master Architecture and Product Spec

## 1. Document Intent

### 1.1 Purpose

This document is the current best architectural and product synthesis of the Sensibull Terminal codebase as of March 17, 2026. It is intended to become the master spec for the next major evolution of the product:

- from a strong seller-focused prototype into a world-class professional derivatives workstation
- from a provider-composed frontend into an event-driven terminal platform
- from a monolithic Breeze integration layer into a clean broker-backed trading architecture
- from panel-first UI assembly into a Bloomberg-class high-density operating environment

This is not a greenfield fantasy spec. It is grounded in the code that exists today.

### 1.2 Method

This spec was derived by studying:

- app shell and routing
- workspace components
- domain stores and cross-store dependencies
- backend FastAPI routes and managers
- Breeze SDK call sites
- market transforms and normalization logic
- connection/session UX
- existing architecture, implementation, and seller PRD docs

Key files examined include:

- `src/App.tsx`
- `src/app/router.ts`
- `src/app/useWorkspaceRoute.ts`
- `src/app/shell/*`
- `src/app/workspaces/*`
- `src/components/OptionChain/*`
- `src/components/StrategyBuilder.tsx`
- `src/components/ConnectBrokerModal.tsx`
- `src/domains/session/sessionStore.tsx`
- `src/domains/market/marketStore.tsx`
- `src/domains/execution/executionStore.tsx`
- `src/domains/portfolio/portfolioStore.tsx`
- `src/domains/risk/riskStore.tsx`
- `src/domains/seller/sellerIntelligenceStore.tsx`
- `src/domains/journal/journalStore.tsx`
- `src/domains/automation/automationStore.tsx`
- `src/domains/adjustment/adjustmentStore.tsx`
- `src/domains/market/marketTransforms.ts`
- `src/services/broker/brokerGatewayClient.ts`
- `src/services/streaming/unifiedStreamingManager.ts`
- `src/utils/breezeClient.ts`
- `src/utils/kaggleClient.ts`
- `src/utils/breezeWs.ts`
- `kaggle_backend.py`
- `automation_normalization.py`

### 1.3 Companion Documents

- `docs/enhanced-terminal-architecture-spec.md`
- `docs/enhanced-terminal-implementation-plan.md`
- `docs/options-seller-terminal-spec.md`
- `docs/institutional-terminal-master-plan.md`

---

## 2. Executive Summary

The codebase already contains a meaningful professional options-selling terminal core:

- a modular option chain
- broker-backed preview and margin
- backend-native depth and candles
- live positions, orders, trades, and funds
- seller regime and opportunity generation
- repair suggestions
- automation workflows
- journaling and review

The terminal's main limitation is no longer feature absence. It is architectural shape.

Today the system is caught between two valid but conflicting states:

- Thesis: it has been decomposed into seller, market, execution, risk, journal, automation, and session domains
- Antithesis: those domains are still implemented largely as nested React providers on the frontend and a single large FastAPI file on the backend
- Synthesis: the next architecture should preserve the product intelligence already built while moving authority, orchestration, layout, and live state into explicit platform layers

The next target state should be:

- seller-first, not generic-broker-first
- backend-authoritative for live trading, risk, automation, and review state
- stream-driven and event-normalized
- windowed and keyboard-centric
- dense, fast, explainable, and operationally safe
- capable of feeling like a real terminal, not a marketing dashboard

---

## 3. Current-State System Map

## 3.1 Frontend Shell and Navigation

Current shape:

- `src/App.tsx` is now small and delegates to providers plus `AppShell`
- `src/app/useWorkspaceRoute.ts` implements a custom `window.history` router
- `src/app/router.ts` defines route metadata, grouping, labels, and submenu anchors
- `src/app/shell/AppShell.tsx` composes:
  - `WorkspaceNav`
  - `WorkspaceHeader`
  - `WorkspaceSubnav`
  - `CommandPalette`
  - `ConnectBrokerModal`

Strengths:

- route-oriented shell exists
- grouped navigation exists
- submenu anchors exist
- command palette exists
- the market screen now centers the option chain

Limits:

- custom router is intentionally light but has no route loaders, guards, persisted route state, or URL-param richness
- shell remains page-centric, not layout-engine-centric
- there is no dockable multi-panel window model yet
- desktop density is improved but still fundamentally static

## 3.2 Provider Graph

The app provider stack is:

- `NotificationProvider`
- `SessionProvider`
- `MarketProvider`
- `PortfolioProvider`
- `ExecutionProvider`
- `RiskProvider`
- `SellerIntelligenceProvider`
- `JournalProvider`
- `AdjustmentProvider`
- `AutomationProvider`

Observed implication:

- domain intent is strong
- dependency direction is not fully explicit
- cross-domain derivation still occurs synchronously through React provider reads

Current conceptual graph:

```text
Session -> Market -> Portfolio -> Execution -> Risk -> Seller -> Journal -> Adjustment -> Automation
```

This works for a prototype, but it is too coupled for a true terminal. Several later domains depend on snapshots from earlier domains that are themselves partly heuristic or frontend-derived.

## 3.3 Workspace Inventory

Current routeable workspaces:

- Market
- Strategy
- Execution
- Portfolio
- Risk
- Automation
- Journal
- Connections

Observed current role of each:

### Market

- best current desk
- contains overview, watchlist, option chain, candle board, depth ladder, seller ideas, staged order summary
- is the clearest proof-of-direction for the product

### Strategy

- combines regime, opportunity feed, playbooks, and strategy builder
- strong seller-first intent
- still reads more like a composed dashboard than a high-density multi-monitor strategy lab

### Execution

- staged strategy preview, fees, margin, blotter
- functionally useful, but not yet OMS-grade

### Portfolio

- positions, selected position, funds, orders, trades
- useful but still not a true portfolio cockpit

### Risk

- staged and portfolio-derived risk
- includes adjustment suggestions
- important, but still blends analytics, heuristics, and preview output in one plane

### Automation

- backend-integrated rules and callbacks
- operationally meaningful
- still closer to rule management than a full automation operating center

### Journal

- captures opportunity ideas and execution-sourced entries
- tracks lifecycle linkage and review metadata
- strong foundation for trader learning

### Connections

- valuable operational UX
- still doubles as a diagnostic bridge between browser-direct and backend-primary modes

## 3.4 Component Inventory

Key components:

- `OptionChain` is the strongest modular component family in the codebase
- `StrategyBuilder` remains core to trade construction
- `ConnectBrokerModal` is operationally rich and still unusually large
- legacy surfaces still exist:
  - `RightDrawer.tsx`
  - `BottomDock.tsx`
  - `OptionChain.old`
  - browser-direct Breeze path utilities

Interpretation:

- the repo contains both the live architectural path and earlier experimental/legacy artifacts
- the next spec must explicitly decide which artifacts are canonical and which are to be retired

---

## 4. Breeze SDK Capability Inventory Observed in the Codebase

The current backend uses the official Breeze Python SDK in `kaggle_backend.py`. The frontend also retains a browser-direct checksum path in `src/utils/breezeClient.ts`.

## 4.1 Observed Python SDK Calls

Observed directly in `kaggle_backend.py`:

| SDK Capability | Current Use |
| --- | --- |
| `BreezeConnect(...)` | backend session bootstrap |
| `generate_session(...)` | live broker connection |
| `get_customer_details()` | post-connect identity |
| `get_option_chain_quotes(...)` | option chain snapshot |
| `get_quotes(...)` | quote fetch and spot fallback |
| `place_order(...)` | order placement and strategy execution |
| `cancel_order(...)` | order cancellation |
| `modify_order(...)` | order modification |
| `get_order_list(...)` | order book |
| `get_trade_list(...)` | trade book |
| `get_portfolio_positions(...)` | positions |
| `get_portfolio_holdings(...)` | holdings |
| `get_funds(...)` | capital and margin |
| `margin_calculator(...)` | margin preview |
| `preview_order(...)` | fee and charge preview |
| `get_historical_data_v2(...)` | historical candles |
| `get_market_depth(...)` | depth snapshot |
| `ws_connect()` | backend WS lifecycle |
| `ws_disconnect()` | backend WS lifecycle |
| `subscribe_feeds(...)` | option chain streaming |
| `unsubscribe_feeds(...)` | option chain streaming teardown |

## 4.2 Browser-Direct Breeze Path

Observed in `src/utils/breezeClient.ts`:

- checksum generation
- customerdetails validation
- direct order placement path
- proxy handling for CORS workaround modes

This path is useful diagnostically and as fallback knowledge, but it is not the correct long-term primary architecture for a serious terminal.

## 4.3 Product Mapping of Current Breeze Usage

### Live Today

- connection and session bootstrap
- chain snapshot
- spot fetch
- market depth
- historical data
- tick streaming
- order placement
- order modification
- order cancel
- positions
- holdings
- funds
- order book
- trade book
- margin preview
- preview order charge estimation

### Still Partly Heuristic or Frontend-Derived

- grouped strategy identity from broker positions
- some position Greeks and PnL normalization
- adjustment ranking
- regime engine
- opportunity generation
- some risk aggregation
- journal lifecycle linkage

This distinction matters. The next architecture should clearly separate:

- broker-confirmed truth
- normalized backend truth
- analytical inference
- UI projection

---

## 5. Dialectical Analysis: Contradictions and Synthesis

This section is deliberate. The right architecture must not ignore the codebase's internal contradictions. It must resolve them.

## 5.1 Domain Decomposition vs Provider Coupling

### Thesis

The codebase correctly moved away from `App.tsx` monolith logic into domain stores.

### Antithesis

Those domains are still tightly coupled through nested React providers and synchronous cross-store derivation.

### Synthesis

Move to a two-layer client architecture:

- server state, streaming state, and mutations handled by authoritative services and query/mutation infrastructure
- UI/workspace state handled by dedicated terminal state stores

Target:

- React Router for route model
- query/mutation layer for backend data and writes
- dedicated terminal state layer for layouts, selection, command palette, staged strategy, filters, and view state
- event bus for stream fan-out and cross-workspace notifications

## 5.2 Backend Authority vs Frontend Heuristics

### Thesis

The backend already owns broker access, preview, margin, automation persistence, and streaming.

### Antithesis

Substantial live intelligence still remains on the client:

- regime building
- opportunity generation
- some risk aggregation
- adjustment generation
- journal reconciliation

### Synthesis

Adopt a three-tier truth model:

- Tier 1: broker truth
- Tier 2: backend normalized truth
- Tier 3: analytical projections

Any live-trading decision surface must declare its tier.

Examples:

- positions, orders, trades, funds, margin, callbacks: backend-authoritative
- strategy opportunity ranking: analytical
- adjustment ranking: analytical but hydrated with broker preview deltas
- playbook compliance: analytical with backend persistence

## 5.3 Seller-First Product vs Generic Workspace Assembly

### Thesis

The seller intelligence and opportunity engine prove the product is not a generic broker UI.

### Antithesis

Several workspaces still behave like isolated panels around data objects rather than a seller operating system.

### Synthesis

The terminal should be re-centered around seller workflows:

- detect
- compare
- stage
- preview
- execute
- defend
- automate
- review

Routes and menus should reflect workflows, not just entities.

## 5.4 Stream-First Ambition vs Fallback-Heavy Reality

### Thesis

The architecture rightly prefers backend WS feeds and candle merging.

### Antithesis

Relative Vercel proxy usage prevents direct WebSocket use and forces polling fallback in some deployments.

### Synthesis

Separate deployment modes formally:

- Terminal Cloud mode: edge gateway plus durable websocket relay
- Tunnel dev mode: direct backend URL and native websocket
- Diagnostic browser-direct mode: explicit non-primary mode

Do not let deployment compromise silently reshape the architecture.

## 5.5 Modular Option Chain vs Uneven Surface Quality

### Thesis

`OptionChain` is highly modular and production-minded.

### Antithesis

Other surfaces remain less formal:

- workspaces embed dense bespoke JSX
- terminal tables outside the chain are not equally systematized
- no shared grid or inspector framework exists

### Synthesis

Introduce a workstation design system:

- terminal panel
- data grid
- blotter grid
- metric card
- inspector rail
- window tabs
- command bar
- ribbon / strip components
- action groups

The option chain should not be the only industrial-strength surface.

## 5.6 Monolithic Backend Speed vs Long-Term Maintainability

### Thesis

`kaggle_backend.py` allowed very rapid product iteration and feature accumulation.

### Antithesis

It now contains:

- broker session management
- market data
- OMS
- preview and margin normalization
- automation persistence and evaluation
- review persistence
- auth
- websocket transport
- tunnel helper logic

### Synthesis

Keep one process initially, but split into clear modules:

- `core/`
- `clients/breeze/`
- `services/market/`
- `services/execution/`
- `services/risk/`
- `services/automation/`
- `services/reviews/`
- `services/streaming/`
- `api/routes/`

This preserves deployment simplicity while restoring architectural clarity.

---

## 6. Target Product Vision

The product should become the operating system for professional options sellers in Indian index and liquid stock derivatives.

The terminal must continuously answer:

1. What is the regime?
2. What seller structures are valid now?
3. How does the current book constrain new trades?
4. What is the safest executable version of the idea?
5. What repair is best if the thesis degrades?
6. What should be automated?
7. What did the trader actually learn from the outcome?

The terminal must feel:

- dense but legible
- keyboard-first
- fast under live updates
- explainable
- operationally safe
- multi-workspace and persistent

---

## 7. Target Macro Architecture

## 7.1 Architectural Planes

The target terminal should be structured into explicit planes.

### A. Presentation Plane

Owns:

- shell
- layout manager
- menus and submenus
- workspace windows
- grids and inspectors
- command palette
- keyboard shortcuts

### B. Workspace State Plane

Owns:

- active workspace
- selected symbol, expiry, strategy draft, focused position, active idea
- panel visibility
- persisted layouts
- per-workspace filters and sort state

### C. Trading Domain Plane

Owns:

- market
- strategy
- execution
- portfolio
- risk
- automation
- review

### D. Broker Gateway Plane

Owns:

- session lifecycle
- auth
- capability discovery
- transport abstraction
- query/mutation contracts

### E. Market Data Plane

Owns:

- instrument registry
- quote normalization
- chain normalization
- tick bus
- candle aggregation
- depth snapshots
- market internals

### F. Execution and OMS Plane

Owns:

- staged order model
- broker previews
- margin previews
- routing
- order state machine
- fill state
- retry and recovery policy

### G. Risk and Intelligence Plane

Owns:

- regime engine
- seller scoring
- opportunity ranking
- portfolio-aware suppression
- adjustment recommendations
- scenario and stress engine

### H. Automation and Review Plane

Owns:

- rule lifecycle
- trigger evaluation
- callback normalization
- audit log
- playbook review persistence
- trader journal analytics

## 7.2 Target Client Architecture

Recommended client structure:

```text
src/
  app/
    shell/
    layouts/
    router/
    command/
  ui/
    panels/
    grids/
    forms/
    inspectors/
    overlays/
  domains/
    session/
    instruments/
    market/
    strategy/
    execution/
    orders/
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
  lib/
    formatting/
    math/
    time/
    ids/
```

## 7.3 Target Backend Architecture

Recommended backend structure:

```text
backend/
  app/
    api/
      routes/
        session.py
        market.py
        streaming.py
        execution.py
        portfolio.py
        risk.py
        automation.py
        reviews.py
        diagnostics.py
    core/
      settings.py
      auth.py
      rate_limit.py
      logging.py
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
      risk/
      automation/
      review/
      diagnostics/
    models/
    storage/
```

Deployment can remain single-process FastAPI initially, but the code should be structured as if it can later split.

---

## 8. Bloomberg-Class Terminal UX Specification

This section defines the target UI interaction model. The goal is not to copy Bloomberg branding. The goal is to match the qualities of a serious professional terminal:

- density
- speed
- consistency
- keyboard power
- multi-window control
- constant contextual awareness

## 8.1 Global Shell

The shell should have five layers:

### Layer 1: Global Top Ribbon

Contains:

- workspace tabs
- account/session badge
- market status badge
- latency/stream badge
- global search
- command input
- alert center
- date/time and session phase

### Layer 2: Left Launcher

Contains grouped launchers:

- Launchpad
- Market
- Chain
- Strategy
- Execution
- Portfolio
- Risk
- Automation
- Journal
- Ops

This launcher should support:

- mouse
- keyboard indexing
- pinned favorites
- recents

### Layer 3: Workspace Header and Submenu

Each workspace should expose:

- title
- active symbol / strategy / account
- workspace-specific actions
- submenu or tab strip

### Layer 4: Main Window Grid

This is the core.

Requirements:

- dockable panels
- split panes
- resizable windows
- stackable tabs within panels
- saved layouts per workspace
- resettable defaults
- per-layout symbol linking

### Layer 5: Persistent Bottom Dock

Contains:

- blotter
- notifications
- event log
- callbacks
- diagnostics
- chat/notes

The earlier `BottomDock` idea should return in a formalized way.

## 8.2 Menu and Submenu Model

Recommended primary menu:

- `MKT` Market
- `CHN` Chain
- `STG` Strategy
- `EXE` Execution
- `PFO` Portfolio
- `RSK` Risk
- `AUTO` Automation
- `REV` Review
- `OPS` Operations

Recommended submenu examples:

### Market

- Overview
- Watchlists
- Depth
- Charts
- Breadth
- Tape

### Chain

- Primary Chain
- Skew Surface
- OI Map
- Vol Surface
- Strike Intelligence

### Strategy

- Opportunity Feed
- Builder
- Scenario Lab
- Playbooks
- Compare

### Execution

- Ticket
- Basket
- Blotter
- Order Book
- Trade Book

### Portfolio

- Positions
- Holdings
- Capital
- Concentration
- Attribution

### Risk

- Live Risk
- Scenarios
- Adjustment Desk
- Margin
- Alerts

### Automation

- Rules
- Triggers
- Callbacks
- Audit
- Schedules

### Review

- Journal
- Playbooks
- Outcome Analytics
- Mistake Clusters

### Operations

- Connections
- Backend Health
- Stream Health
- Diagnostics
- Logs

## 8.3 Workspace Layout Requirements

Each workspace should ship with:

- default layout
- compact layout
- dual-monitor layout
- analyst layout
- trader layout

Layouts should be saveable per user and optionally per symbol group.

## 8.4 Keyboard Model

The terminal should become keyboard-native.

Required capabilities:

- global command palette
- workspace switching
- symbol switching
- chain focus and strike navigation
- idea staging
- staged-ticket submit
- panic flatten shortcut
- open order book / trades / positions
- add note / journal entry
- toggle layout regions
- quick action shortcuts from active row

Suggested examples:

- `Ctrl+K`: command palette
- `/`: symbol search
- `G M`: go to Market
- `G S`: go to Strategy
- `G E`: go to Execution
- `Alt+1..9`: activate saved layouts
- `Shift+Enter`: stage active idea
- `Ctrl+Enter`: send staged order after confirmation
- `Esc`: collapse active inspector / cancel modal

## 8.5 Visual System

The UI should feel like a terminal, not a consumer finance app.

Direction:

- dark graphite and slate base
- amber for active command/focus
- emerald for positive state
- red for risk / sell / loss
- cyan for data-linked / streaming / analytical overlays

Rules:

- do not use oversized cards as the default interaction primitive
- favor dense tables, ribbons, ladders, strips, and inspectors
- typography must optimize scan speed
- visual hierarchy should come from spacing, grouping, and color semantics rather than giant boxes

---

## 9. Canonical Workspace Specifications

## 9.1 Launchpad Workspace

New workspace to add.

Purpose:

- morning launch surface
- highlights active regimes, top opportunities, risk warnings, pending automation, recent fills, and watchlist movers

Panels:

- market overview strip
- seller regime board
- best opportunity leaderboard
- book stress summary
- active alerts and callbacks
- today's journal agenda

## 9.2 Market Workspace

Purpose:

- live market situational awareness

Panels:

- watchlists
- index and sector strip
- option chain focus
- depth ladder
- intraday chart
- tape / recent market events
- session stats
- seller context strip

Enhancements beyond current code:

- linked symbols
- watchlist grouping
- event markers on candles
- session segmentation
- breadth panel
- market internals

## 9.3 Chain Workspace

Purpose:

- fully dedicated option chain intelligence surface

Panels:

- primary chain grid
- synthetic forward / parity strip
- max pain / OI walls
- skew slope
- strike intelligence inspector
- IV rank / percentile
- term structure mini-panels

This workspace should elevate the existing `OptionChain` module into a full chain desk.

## 9.4 Strategy Workspace

Purpose:

- compare, construct, and stage seller strategies

Panels:

- opportunity leaderboard
- builder
- playbooks
- compare table
- scenario graph
- strategy notes

Needs:

- strategy compare basket
- side-by-side payoff and Greek comparison
- strategy explanation block
- size suggestions tied to book state

## 9.5 Execution Workspace

Purpose:

- become a real OMS surface

Panels:

- staged ticket
- credit and fee preview
- margin preview
- slippage guardrail
- multi-leg send controls
- live blotter
- rejections and recovery

Required behavior:

- explicit state machine from staged -> previewed -> sending -> partial -> sent -> failed
- broker response drilldown
- leg-level and basket-level execution strategies
- broker-confirmed repair previews surfaced inline

## 9.6 Portfolio Workspace

Purpose:

- book-wide position and capital management

Panels:

- live positions grid
- grouped strategies
- funds and utilization
- holdings
- orders
- trades
- lifecycle explorer
- symbol and expiry concentration

Needs:

- grouped strategy identity as first-class backend model
- better close-out attribution
- realized/unrealized decomposition

## 9.7 Risk Workspace

Purpose:

- make risk the terminal's central nervous system

Panels:

- live Greek aggregates
- stress matrix
- margin ladder
- risk alerts
- adjustment recommendation board
- book concentration map

Needs:

- true scenario engine
- broker-confirmed vs analytical labelling
- stress surfaces by symbol, expiry, and book

## 9.8 Adjustment Workspace or Risk Subdesk

Purpose:

- dedicated repair operating desk

Panels:

- stressed positions list
- repair suggestion queue
- before/after payoff
- repair credit and margin delta
- thesis preservation score
- one-click stage repair

Current adjustment logic is meaningful enough that it deserves its own subdesk, not just a section inside Risk.

## 9.9 Automation Workspace

Purpose:

- rule authoring and live control center

Panels:

- rule grid
- trigger builder
- action builder
- callback stream
- execution audit
- dry-run/simulation panel

Needs:

- timeline of trigger evaluations
- idempotency and cooldown visibility
- one-shot vs recurring semantics
- linkage to journal and playbooks

## 9.10 Journal and Review Workspace

Purpose:

- trader learning loop

Panels:

- entry list
- review form
- lifecycle timeline
- playbook compliance
- mistake tags
- regime and structure analytics
- adjustment effectiveness analytics

Needs:

- actual close-out attribution
- multi-device persistence
- deeper analytics beyond count-based summaries

## 9.11 Operations Workspace

Purpose:

- keep live trading operationally safe

Panels:

- session health
- backend health
- websocket health
- rate limit panel
- auth mode and secret status
- callback auth status
- diagnostics log viewer

---

## 10. Target State and Data Model Principles

## 10.1 Canonical Entities

The platform should standardize on these first-class entities:

- `AccountSession`
- `Instrument`
- `OptionContract`
- `QuoteSnapshot`
- `DepthSnapshot`
- `CandleSeries`
- `StrategyDraft`
- `StrategyTemplate`
- `ExecutionPreview`
- `RepairPreview`
- `LiveOrder`
- `LiveTrade`
- `GroupedPosition`
- `PortfolioSnapshot`
- `RiskSnapshot`
- `ScenarioRun`
- `SellerOpportunity`
- `AdjustmentSuggestion`
- `AutomationRule`
- `AutomationEvent`
- `JournalCase`
- `Playbook`
- `WorkspaceLayout`

## 10.2 Required Invariants

- Every live surface must show freshness and source.
- Every derived metric must declare whether it is broker-confirmed or analytical.
- Every execution preview must include timestamp and response provenance.
- Every grouped position must retain links to order IDs and trade IDs.
- Every automation event must be auditable and replayable.
- Every journal case must preserve origin:
  - opportunity
  - execution
  - manual

---

## 11. Backend API Target Contract

The existing endpoints are useful, but the terminal should converge on grouped route families:

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

Examples:

- `/api/market/chain`
- `/api/market/depth`
- `/api/market/candles`
- `/api/execution/preview`
- `/api/execution/repair-preview`
- `/api/orders/basket`
- `/api/orders/{id}`
- `/api/portfolio/positions`
- `/api/portfolio/strategies`
- `/api/risk/scenario`
- `/api/automation/rules`
- `/api/automation/events`
- `/api/reviews/journal`

The route contract should reflect business domains, not backend implementation convenience.

---

## 12. Non-Functional Requirements

## 12.1 Performance

- option chain updates should feel real-time at desk speeds
- layout switches should be instant
- large grids must virtualize rows
- heavy computations should be memoized or moved to workers/backend
- stream fan-out must avoid unnecessary React tree invalidation

## 12.2 Reliability

- all broker mutations must be idempotency-aware where possible
- every critical action must emit an audit event
- reconnection and degraded mode must be explicit
- backend write failures must never silently lose review or automation state

## 12.3 Safety

- explicit action confirmation for destructive live actions
- clear preview/live mode labelling
- margin headroom warnings
- event-risk warnings
- rate-limit monitoring
- callback authentication

## 12.4 Observability

- backend route metrics
- stream health metrics
- preview/margin normalization diagnostics
- automation evaluation diagnostics
- execution and callback audit logs

---

## 13. Acceptance Criteria for the New Architecture

The architecture should only be considered successful when:

- the terminal can be operated as a coherent seller workstation without moving between inconsistent UI paradigms
- the market, strategy, execution, risk, automation, and review surfaces share the same canonical data language
- broker truth, normalized truth, and analytical truth are clearly separated
- the shell supports saved layouts and multi-panel workflows
- execution and repair flows are OMS-grade rather than form-grade
- the terminal remains fast under live updates
- operational diagnostics are always available

---

## 14. What the Codebase Already Proves

This is important because the next phase should build forward, not restart.

The existing codebase already proves:

- seller intelligence is a viable differentiator
- broker-backed preview and margin can be normalized
- automation workflows can be meaningfully integrated
- journaling can be tied to live execution and position state
- market depth and candle flows can be backend-native
- the option chain can support professional interaction patterns

The right move is not rewrite-for-style. The right move is architectural consolidation and UI elevation.

---

## 15. Open Design Decisions

The following decisions should be made explicitly before the next large build phase:

1. Client state stack
   - keep provider-first
   - or move to dedicated terminal state plus query/mutation architecture
2. Router
   - keep custom history router
   - or move to a formal route system with richer URL state
3. Layout engine
   - build custom docked layout manager
   - or adopt a proven docking layout library
4. Backend packaging
   - keep single file for speed
   - or immediately split into structured modules
5. Strategy identity
   - keep frontend grouping heuristics
   - or promote grouped strategy identity into backend contracts
6. Review persistence
   - remain file-backed
   - or adopt a persistent database-backed model

These are not minor implementation details. They determine whether the next version becomes a true terminal or a larger dashboard.

---

## 16. Final Synthesis

The codebase is no longer at the "build initial features" stage. It is at the "choose the governing architecture" stage.

The correct synthesis is:

- retain the seller-first intelligence already built
- elevate the UI into a real terminal shell with docked layouts and keyboard-first workflows
- move live authority to explicit backend services
- normalize broker truth rigorously
- treat strategy, execution, risk, automation, and review as one lifecycle

That target is ambitious but realistic because the hard part already exists: the product logic is there. The remaining work is to give it a stronger operating model.
