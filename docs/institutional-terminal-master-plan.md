# Sensibull Terminal: Institutional Master Implementation Plan

## 1. Purpose

This plan translates `docs/institutional-terminal-master-spec.md` into an execution roadmap that is realistic for the existing codebase.

This is not a greenfield roadmap. It assumes the current app, current backend, current seller intelligence, and current Breeze integration remain the starting point.

---

## 2. Program Goals

The program should deliver:

- a professional seller terminal shell
- explicit backend-authoritative trading domains
- a consistent OMS, risk, automation, and review lifecycle
- Bloomberg-class workspace density and interaction patterns
- a system that can scale without turning every new feature into another provider coupling layer

---

## 3. Guiding Delivery Principles

- Preserve product logic that already works.
- Replace ambiguity with explicit authority boundaries.
- Build infrastructure that improves every workspace, not one-off screens.
- Treat execution safety and operational diagnostics as first-class deliverables.
- Do not hide fallback behavior. Label it.
- Prefer module extraction over cosmetic rewrites.

---

## 4. Current Starting Constraints

What already exists:

- route shell
- strong `OptionChain`
- seller intelligence
- execution preview and margin
- backend automation and review persistence
- repair preview endpoint
- journal linkage

What constrains the next phase:

- nested provider graph
- custom minimal router
- one large backend file
- mixed broker truth and analytical inference
- non-uniform workspace UI patterns
- legacy artifacts still present

---

## 5. Delivery Workstreams

### Workstream A: Terminal Shell and Layout System

Owns:

- routing upgrade
- saved layouts
- docking/window model
- submenu and command model
- reusable workstation components

### Workstream B: Data and State Spine

Owns:

- query/mutation architecture
- event bus
- stream normalization
- source/freshness metadata
- UI state segregation

### Workstream C: Backend Refactor and Contracts

Owns:

- `kaggle_backend.py` modularization
- route contract cleanup
- broker client packaging
- diagnostics and observability

### Workstream D: Market and Chain Desk

Owns:

- market workspace
- dedicated chain workspace
- watchlists
- breadth
- strike intelligence

### Workstream E: Strategy and Seller Intelligence

Owns:

- opportunity feed evolution
- playbooks
- scenario lab
- comparison tools

### Workstream F: Execution and OMS

Owns:

- ticket model
- broker preview surfaces
- blotter
- order lifecycle controls
- repair staging

### Workstream G: Portfolio and Risk

Owns:

- grouped positions
- position lifecycle
- risk cockpit
- scenario engine
- adjustment desk

### Workstream H: Automation and Review

Owns:

- automation center
- callback audit
- journal lifecycle
- review analytics
- playbook review

---

## 6. Phase Plan

## Phase 0: Architecture Freeze and Cleanup

### Objective

Stabilize the architectural baseline before deeper UI and service changes.

### Deliverables

- adopt the master spec and plan as the repo source of truth
- classify canonical vs legacy files
- define target module map

### Tasks

- mark canonical frontend paths:
  - `src/app/*`
  - `src/domains/*`
  - `src/services/*`
  - `src/components/OptionChain/*`
- mark retirement candidates:
  - `src/components/OptionChain.old`
  - unused shell artifacts if superseded
  - any remaining browser-direct-only pathways not meant for production
- write ADRs for:
  - state architecture
  - routing approach
  - layout engine approach
  - backend modularization approach

### Exit Criteria

- clear canonical architecture map
- no ambiguity about which code paths are strategic

---

## Phase 1: State Spine Refactor

### Objective

Separate server state, stream state, and UI state.

### Deliverables

- dedicated terminal state layer
- query/mutation contract layer
- event bus for live updates

### Tasks

- introduce a `state/` layer for:
  - layout state
  - selections
  - panel visibility
  - workspace preferences
- move backend fetch/mutation responsibility behind a formal API service layer
- create stream fan-out service so live ticks are not coupled to provider rerender shape
- label all domain data with:
  - source
  - freshness timestamp
  - authority tier

### Current File Impacts

- `src/app/AppProviders.tsx`
- `src/domains/*`
- `src/services/broker/brokerGatewayClient.ts`
- `src/services/streaming/unifiedStreamingManager.ts`

### Exit Criteria

- provider graph no longer acts as the primary orchestration engine
- stream updates do not require broad provider invalidation

---

## Phase 2: Router and Layout Engine

### Objective

Replace the static page shell with a terminal-grade layout system.

### Deliverables

- richer routing
- saved layouts
- dockable/resizable window model
- persistent bottom dock

### Tasks

- upgrade routing model to support:
  - nested workspace routes
  - URL-persisted state
  - deep links to symbols, strategies, positions, and rules
- implement layout engine with:
  - split panes
  - tabbed panel stacks
  - saved workspace layouts
  - per-layout symbol links
- formalize the shell:
  - top ribbon
  - left launcher
  - workspace header
  - bottom blotter dock
  - right inspector rail where appropriate

### Current File Impacts

- `src/app/router.ts`
- `src/app/useWorkspaceRoute.ts`
- `src/app/shell/*`

### Exit Criteria

- users can save and restore workspace layouts
- the app feels like a terminal shell, not a page switcher

---

## Phase 3: Workstation Design System

### Objective

Create reusable terminal-grade UI primitives.

### Deliverables

- panel system
- dense table/grid system
- inspector system
- metric strip system
- terminal action bars

### Tasks

- define reusable components for:
  - terminal panel
  - section header
  - metric ribbon
  - data ladder
  - blotter grid
  - drilldown inspector
  - dock tabs
- convert existing workspace bespoke blocks into reusable patterns

### Exit Criteria

- workspaces no longer need large custom JSX blocks for every surface
- visual density and interaction patterns become consistent

---

## Phase 4: Market and Chain Desk Rebuild

### Objective

Promote market and chain into dedicated professional desks.

### Deliverables

- Market workspace v2
- new Chain workspace
- watchlist groups
- breadth and strike intelligence surfaces

### Tasks

- split market awareness from pure chain analysis
- reuse and extend `OptionChain`
- add:
  - linked watchlists
  - breadth strip
  - skew strip
  - OI wall inspector
  - strike intelligence panel
  - dedicated quote/depth/candle synchronization

### Current File Impacts

- `src/app/workspaces/MarketWorkspace.tsx`
- new `src/app/workspaces/ChainWorkspace.tsx`
- `src/components/OptionChain/*`
- `src/domains/market/*`

### Exit Criteria

- option chain, depth, and strike intelligence operate as a dedicated desk
- Market and Chain have distinct, coherent roles

---

## Phase 5: Strategy Lab and Seller Intelligence V2

### Objective

Turn seller intelligence into a true decision engine.

### Deliverables

- compare mode
- opportunity ranking modes
- playbook-aware scenario lab
- structured idea lifecycle

### Tasks

- expand opportunity families
- add compare basket
- add scenario simulation
- enrich scoring with:
  - premium richness
  - expected move
  - liquidity
  - skew
  - event-aware penalties
- move parts of seller analytics to backend where appropriate

### Current File Impacts

- `src/domains/seller/sellerIntelligenceStore.tsx`
- `src/app/workspaces/StrategyWorkspace.tsx`
- `src/components/StrategyBuilder.tsx`

### Exit Criteria

- seller idea generation feels ranked, explainable, and desk-grade

---

## Phase 6: Execution Desk and OMS Upgrade

### Objective

Make execution a real operating desk.

### Deliverables

- staged ticket state machine
- order basket controls
- live blotter dock
- recovery and rejection workflows

### Tasks

- formalize execution state transitions
- standardize preview and repair preview presentation
- add:
  - order policy controls
  - slippage guardrails
  - basket send options
  - partial-fill handling
  - cancel/replace workflows
- move direct fetches to formal execution API service layer

### Current File Impacts

- `src/domains/execution/executionStore.tsx`
- `src/app/workspaces/ExecutionWorkspace.tsx`
- `kaggle_backend.py` or backend execution service modules

### Exit Criteria

- execution desk can be used as a primary OMS surface

---

## Phase 7: Portfolio, Risk, and Adjustment Desk

### Objective

Make grouped positions, risk, and repair logic authoritative and inspectable.

### Deliverables

- grouped strategy model
- risk cockpit v2
- dedicated adjustment desk
- scenario engine

### Tasks

- promote grouped positions into a clearer backend contract
- improve live PnL and broker Greeks normalization
- create:
  - stress matrix
  - concentration view
  - margin ladder
  - repair queue
  - before/after scenario comparison
- separate:
  - broker-confirmed values
  - analytical scenario values

### Current File Impacts

- `src/domains/portfolio/*`
- `src/domains/risk/*`
- `src/domains/adjustment/*`
- `src/app/workspaces/PortfolioWorkspace.tsx`
- `src/app/workspaces/RiskWorkspace.tsx`
- backend position normalization paths

### Exit Criteria

- position, risk, and repair views share one coherent grouped-book model

---

## Phase 8: Automation Center and Review System V2

### Objective

Complete the discipline loop from idea to execution to review.

### Deliverables

- automation control center
- callback audit timeline
- richer review analytics
- linked playbook performance

### Tasks

- strengthen automation authoring UX
- add dry-run mode and trigger timeline
- add callback inspection
- deepen review analytics:
  - outcome attribution
  - adjustment effectiveness
  - regime x structure performance
  - mistake cluster trends
- persist editable playbooks in backend if cross-device authoring is required

### Current File Impacts

- `src/domains/automation/*`
- `src/domains/journal/*`
- `src/app/workspaces/AutomationWorkspace.tsx`
- `src/app/workspaces/JournalWorkspace.tsx`
- backend automation and review services

### Exit Criteria

- trader can trace a setup from idea -> rule -> execution -> callback -> review

---

## Phase 9: Backend Modularization

### Objective

Split the monolithic backend into maintainable modules without losing current behavior.

### Deliverables

- routed backend package structure
- extracted Breeze client wrappers
- separated automation, review, market, and execution services

### Tasks

- extract:
  - auth middleware
  - rate limiter
  - tick store
  - candle store
  - execution preview logic
  - automation manager
  - review manager
  - position normalization
- preserve route contracts while restructuring internals
- add unit coverage around extracted services

### Exit Criteria

- `kaggle_backend.py` no longer serves as the sole service module

---

## Phase 10: Hardening, Performance, and Ops

### Objective

Make the terminal operationally credible under sustained use.

### Deliverables

- route and service tests
- performance profiling
- observability
- failure-mode handling

### Tasks

- add route-level backend tests for:
  - preview
  - margin
  - repair preview
  - automation rules
  - callbacks
  - review state
- add client tests for:
  - terminal state
  - layout persistence
  - opportunity ranking
  - adjustment hydration
- add metrics and audit streams
- profile large-grid rendering and stream update behavior

### Exit Criteria

- terminal is safe to iterate on without regressions
- live workflows are observable in production

---

## 7. Recommended Immediate Build Order

If only one sequence can be executed next, use this order:

1. Phase 1: State spine refactor
2. Phase 2: Router and layout engine
3. Phase 3: Workstation design system
4. Phase 4: Market and Chain desk rebuild
5. Phase 6: Execution desk and OMS upgrade
6. Phase 7: Portfolio, Risk, and Adjustment desk
7. Phase 8: Automation and Review V2
8. Phase 9: Backend modularization
9. Phase 10: Hardening and ops

Reason:

- shell and state architecture improvements multiply the value of every later workspace
- market, chain, and execution are the highest-traffic desks
- backend modularization should happen after the target service boundaries are proven by the new client architecture

---

## 8. Definition of Done for the Program

The master plan should be considered fulfilled only when:

- the terminal supports saved high-density workstation layouts
- market, chain, strategy, execution, portfolio, risk, automation, and review all use a consistent design system
- backend-authoritative broker workflows are clearly distinguished from analytical projections
- grouped positions and lifecycle attribution are reliable
- repair workflows are fast and previewed
- automation and callbacks are operationally auditable
- the product feels like a terminal rather than a collection of screens

---

## 9. Immediate Next Tasks

If work resumes in the next session, start here:

1. Decide the client state stack and routing/layout direction formally.
2. Implement the terminal state spine and layout engine skeleton.
3. Reintroduce a proper bottom blotter dock and multi-panel workspace persistence.
4. Split Market and Chain into separate but linked desks.
