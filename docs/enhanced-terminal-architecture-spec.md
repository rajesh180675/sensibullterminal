# Sensibull Terminal: Target Architecture and Product Spec

## Scope

This document is a current-state audit plus a target-state architecture for turning the existing codebase into a production-grade Breeze-powered options trading terminal.

Goals:

- Use the official Breeze Connect capability set end to end.
- Replace transport-specific UI logic with a broker platform architecture.
- Upgrade the product from a single-screen demo terminal into a full trading workspace.
- Make the UI high-density, fast, elegant, and operationally safe.
- Define a practical rollout sequence from the current codebase.

Companion implementation plan:

- `docs/enhanced-terminal-implementation-plan.md`

Primary external sources used for endpoint inventory and transport assumptions:

- Official Breeze API docs: https://api.icicidirect.com/breezeapi/documents/index.html
- Official Breeze Python SDK repo: https://github.com/Idirect-Tech/Breeze-Python-SDK

Key official constraints carried into this spec:

- Breeze REST is rate-limited to 100 calls per minute.
- Live market data and candle streaming are available via streaming channels and should be preferred over polling.
- The Python SDK exposes materially more capability than the current frontend uses today.

---

## 1. Current-State Audit

### 1.1 Repo shape

The current app is a Vite + React 19 + TypeScript single-page frontend with one serverless proxy route.

Main areas:

- `src/App.tsx`
- `src/components/OptionChain/*`
- `src/components/StrategyBuilder.tsx`
- `src/components/Positions.tsx`
- `src/components/ConnectBrokerModal.tsx`
- `src/utils/breezeClient.ts`
- `src/utils/kaggleClient.ts`
- `src/utils/breezeWs.ts`
- `api/kaggle/[[...path]].js`

### 1.2 What is already strong

The current codebase already contains a useful product seed, not just a shell:

- `OptionChain` is the most modular feature. It has sorting, flash updates, OI bars, OI signals, stale detection, export, ATM scroll, keyboard support, and an error boundary.
- `Positions` already includes useful real trading actions: square off, order book, trade book, funds, pagination, search, tab state preservation, batch cancel, and trade entry.
- `ConnectBrokerModal` has working operational knowledge around Breeze session setup, backend health checks, and tunnel/proxy troubleshooting.
- `App` already handles live snapshot fetch, WS subscribe, REST fallback polling, spot refinement, and symbol-expiry switching.
- `api/kaggle/[[...path]].js` is a practical proxy layer for Vercel deployments and tunnel-backed Python services.

### 1.3 Structural problems in the current code

#### App-level orchestration is too centralized

`src/App.tsx` currently owns:

- session lifecycle
- tab routing
- symbol and expiry state
- chain fetch orchestration
- spot price logic
- websocket bootstrap
- REST fallback polling
- positions refresh
- order execution flow
- live indices
- demo mode

This makes `App` the de facto domain store, transport coordinator, and page controller all at once.

Impact:

- hard to scale features without coupling regressions
- difficult to test business flows independently
- broker transport decisions leak into UI state
- symbol/expiry/session logic will become unmaintainable once more modules are added

#### The transport model is split but not abstracted

There are effectively two broker paths:

- browser-direct checksum path in `src/utils/breezeClient.ts`
- Python backend path in `src/utils/kaggleClient.ts`

There is also a wrapper hook in `src/hooks/useBreeze.ts`, but it is not used by the main app. So the codebase has the beginnings of an abstraction, but the real UI still talks to transport-specific clients directly.

Impact:

- duplicate concepts across clients
- inconsistent capabilities by screen
- no single broker capability registry
- impossible to evolve into multi-broker or multi-account without a rewrite

#### Feature modules are uneven

- `OptionChain` is modular and reusable.
- `Positions.tsx` is a very large multipurpose surface.
- `ConnectBrokerModal.tsx` is extremely large and embeds an entire backend code snippet.
- `StrategyBuilder.tsx` is product-useful but not hardened.

Impact:

- UI complexity is concentrated in a few oversized files
- state boundaries are unclear
- business rules are mixed with rendering

### 1.4 Operational and toolchain findings

Baseline verification from the current workspace:

- `npm run build` succeeds.
- `npx tsc --noEmit` fails heavily.

The TypeScript failures expose real engineering debt:

- Storybook and testing dependencies are referenced but not installed.
- test files are included in the main TS program without a test runner config
- several unused imports/variables are present
- `src/components/StrategyBuilder.tsx` contains a real defect: template insertion calls `setLegs(...)`, but no `setLegs` state setter exists in that component

That means the app can ship a production bundle while still carrying latent runtime defects because Vite build is not enforcing type correctness.

### 1.5 Current feature coverage vs Breeze

Current code effectively covers:

- connect / session generation through Python backend
- customer validation in browser-direct mode
- option chain snapshot
- expiry fetch via backend helper
- spot fetch via backend helper
- order placement
- square off
- cancel order
- positions
- funds
- order book
- trade book
- historical fetch helper
- websocket subscribe
- websocket tick streaming
- REST tick fallback

Large parts of the official SDK surface are not yet integrated into product flows.

---

## 2. Breeze Capability Inventory and Product Mapping

The official Breeze SDK/docs expose a much larger product surface than the current app uses. The target terminal should map every important endpoint to a first-class workflow.

### 2.1 Session and identity

Official capability:

- `generate_session`
- `get_customer_details`

Target usage:

- connection center
- account verification
- profile snapshot
- broker capability discovery
- session health and expiry monitor
- midnight IST session rollover warning

### 2.2 Market data

Official capability:

- `get_quotes`
- `get_market_depth`
- `get_option_chain_quotes`
- `get_historical_data`
- `get_historical_data_v2`
- streaming market feeds
- candle stream
- subscribe/unsubscribe feed flows

Target usage:

- quote board
- option chain
- market depth ladder
- charting
- replay and intraday scrollback
- volatility surface
- watchlists
- breadth and market internals
- live strategy monitor

### 2.3 Portfolio and balances

Official capability:

- `get_portfolio_positions`
- `get_portfolio_holdings`
- `get_demat_holdings`
- `get_funds`

Target usage:

- portfolio cockpit
- capital and margin panel
- holdings and FNO split
- realized/unrealized PnL
- account allocation views

### 2.4 Order lifecycle

Official capability:

- `place_order`
- `modify_order`
- `cancel_order`
- `square_off`
- `get_order_list`
- `get_order_detail`
- `get_trade_list`
- `get_trade_detail`

Target usage:

- advanced order ticket
- batch and basket execution
- ladder trade panel
- blotter
- fill diagnostics
- order drilldown
- post-trade audit timeline

### 2.5 Pre-trade calculation and validation

Official capability:

- `preview_order`
- `limit_calculator`
- `margin_calculator`

Target usage:

- pre-submit margin check
- premium/slippage estimation
- freeze quantity guidance
- best-limit suggestion
- order safety rail

### 2.6 GTT and automation

Official capability:

- single-leg GTT place/modify/cancel/list/detail
- three-leg GTT place/modify/cancel/list/detail

Target usage:

- stop-loss automation
- target and bracket logic
- conditional spread entries
- iron condor auto-exit
- overnight automation center

### 2.7 One-click and strategy stream capability

Official capability exposed in official SDK docs/repo:

- OneClick FNO data
- OneClick equity data
- order notifications
- customer demand
- strategy stream
- fund utility helpers such as `set_funds`
- security lookup utilities such as `get_names`

Target usage:

- strategy marketplace shelf
- guided strategy launchpad
- broker-side strategy event stream
- live demand and notification ribbon
- trade assistant workflows

---

## 3. Product Vision

The target product is not "better option chain UI". It is a broker-native options workstation with six integrated workspaces:

1. Market Workspace
2. Strategy Workspace
3. Execution Workspace
4. Risk Workspace
5. Portfolio Workspace
6. Automation Workspace

The terminal should feel like a lightweight professional desk:

- dense but readable
- keyboard-first
- streaming-first
- operationally transparent
- low-latency
- safe for live trading

---

## 4. Target Product Modules

### 4.1 Connection Center

Replace the current modal-only broker flow with a dedicated system panel.

Must include:

- account selection
- session status
- token age and expiry countdown
- backend health
- websocket health
- exchange capability flags
- tunnel/proxy health
- reconnect / rotate session actions
- audit log of last broker calls

### 4.2 Market Workspace

Core tabs:

- Watchlists
- Option Chain
- Ladder / Market Depth
- Charts
- Market Breadth

Key features:

- unified quote board using `get_quotes`
- depth ladder using `get_market_depth`
- chain with streaming deltas
- historical chart with interval switching using `get_historical_data_v2`
- candle replay and session markers
- custom watchlists
- spread watchlist
- custom alerts

### 4.3 Strategy Workspace

This is the future home of the current `StrategyBuilder`.

Key features:

- drag/add legs from chain, watchlist, or templates
- live greeks by leg and net
- payoff curve
- scenario matrix across spot / IV / time
- strategy templates
- smart strategy suggestions based on OI, IV, skew, and expected move
- compare multiple strategies side by side
- strategy notes and saved drafts
- broker-ready basket staging

### 4.4 Execution Workspace

A full order workstation, not just buttons.

Key features:

- advanced ticket with buy/sell, market/limit, freeze check, margin impact
- preview order before submit
- modify order inline
- cancel, replace, market-protect workflows
- bracket-style presets
- bulk order staging
- one-click strategy execution
- order notification stream
- execution quality metrics

### 4.5 Risk Workspace

This becomes the main operational differentiator.

Key features:

- position heatmap
- greek exposure by account / symbol / expiry / strategy
- margin utilization and free collateral
- max pain, support/resistance, PCR, IV percentile
- short gamma and short vega warnings
- expiry day risk board
- concentration limits
- per-position and portfolio stop rules
- scenario shocks

### 4.6 Portfolio Workspace

Use all account and trade lifecycle data:

- positions
- holdings
- demat holdings
- funds
- orders
- trades
- order detail
- trade detail

Key features:

- FNO + holdings split
- realized vs unrealized PnL
- intraday ledger
- order timeline
- partial exit flows
- trade journal
- export center

### 4.7 Automation Workspace

This is where GTT and strategy automation become first-class product modules.

Key features:

- single-leg GTT manager
- multi-leg GTT manager
- trigger builder
- expiry roll recipes
- stop-loss and target automation
- event-driven notifications
- strategy stream panel

---

## 5. Target UI and Visual System

### 5.1 Product design direction

The terminal should look modern and premium, but not generic fintech dark mode.

Recommended visual language:

- Typeface: IBM Plex Sans for UI + JetBrains Mono for market data
- Base palette: graphite, slate, deep ink
- Accent system:
  - blue-cyan for primary interaction
  - emerald for bullish/profit
  - amber for warnings/attention
  - vermilion for bearish/risk
- Background: layered gradients plus subtle grid/panel texture, not flat black
- Motion: staggered panel reveal, streaming pulse, row flash, panel docking transitions

### 5.2 Layout system

Desktop:

- top macro bar for connection, session, market regime, search, command palette
- left rail for workspaces
- center canvas for active workstation
- right sidecar for ticket, details, alerts, or notes
- bottom dock for blotter, console, notifications, and logs

Mobile:

- condensed route tabs
- bottom action tray
- collapsible ticket
- card-based positions and orders
- sticky spot / expiry / account bar

### 5.3 Key UX principles

- streaming data is visually calm, not noisy
- every destructive action has a preview and confirmation tier
- every live order shows exact downstream status
- every broker error becomes a human-readable diagnostic
- power users get keyboard shortcuts, command palette, presets, and quick actions

### 5.4 Design modules

Build a consistent internal design system:

- `AppShell`
- `WorkspaceTabs`
- `Panel`
- `MetricCard`
- `StatusBadge`
- `LiveDot`
- `EntityTable`
- `Dock`
- `Drawer`
- `CommandPalette`
- `NotificationCenter`
- `Ticket`
- `RiskMeter`

---

## 6. Target Technical Architecture

### 6.1 Frontend architecture

Recommended stack evolution:

- React 19
- TypeScript strict
- React Router for workspace routing
- TanStack Query for REST caching and request state
- Zustand for client-side workspace/session/UI state
- schema validation with Zod
- Recharts can remain initially, but move charting to a higher-capability library if intraday charting becomes central

Frontend layers:

1. `app/`
   - shell, routes, providers
2. `domains/`
   - market
   - execution
   - portfolio
   - risk
   - automation
   - session
3. `services/`
   - broker gateway client
   - websocket client
   - analytics engine bridge
4. `components/`
   - reusable UI building blocks
5. `stores/`
   - workspace stores
   - session store
   - blotter store
6. `lib/`
   - formatting
   - math
   - schema
   - event helpers

### 6.2 Backend architecture

The Python backend using the official Breeze SDK should become the primary production transport.

Do not keep browser-direct Breeze as a first-class live trading mode.

Recommended services:

1. `breeze-gateway`
   - official Breeze SDK wrapper
   - session generation
   - request signing handled by SDK
   - REST adapter endpoints
2. `stream-hub`
   - subscription manager
   - quote fanout
   - candle stream fanout
   - reconnect logic
3. `analytics-engine`
   - greeks, payoff, IV analytics, scenario engine
4. `execution-engine`
   - preview, validate, place, modify, cancel, square off, batch execution
5. `automation-engine`
   - GTT workflows
   - alerts
   - scheduled tasks
6. `audit-and-notify`
   - order notifications
   - action journal
   - user alerts

### 6.3 Infrastructure contracts

The frontend should talk to one canonical backend API, not directly to Breeze and not to multiple transport-specific helper shapes.

Canonical backend API groups:

- `/api/session/*`
- `/api/account/*`
- `/api/market/*`
- `/api/options/*`
- `/api/orders/*`
- `/api/trades/*`
- `/api/positions/*`
- `/api/funds/*`
- `/api/holdings/*`
- `/api/risk/*`
- `/api/automation/*`
- `/ws/market`
- `/ws/orders`
- `/ws/alerts`

### 6.4 Data flow model

#### Bootstrap flow

1. connect broker
2. generate session
3. fetch customer details
4. fetch account capabilities
5. fetch default market snapshot
6. start market/order/alert streams
7. hydrate portfolio, funds, orders, trades
8. persist workspace state

#### Option chain flow

1. select symbol and expiry
2. fetch chain snapshot
3. fetch quotes/depth for focal contracts
4. subscribe chain stream
5. derive analytics in frontend or analytics service
6. send user actions to ticket store

#### Execution flow

1. build order or basket
2. preview order
3. margin calculator
4. limit calculator
5. confirm submit
6. place order
7. listen on order notification stream
8. refresh affected entities
9. log audit trail

---

## 7. Domain Model

The codebase should move toward normalized domain entities.

Core entities:

- `BrokerAccount`
- `BrokerSession`
- `CustomerProfile`
- `Instrument`
- `Quote`
- `MarketDepth`
- `HistoricalSeries`
- `OptionContract`
- `OptionChainSnapshot`
- `OptionChainDelta`
- `StrategyDraft`
- `StrategyTemplate`
- `OrderIntent`
- `OrderPreview`
- `Order`
- `OrderDetail`
- `Trade`
- `TradeDetail`
- `Position`
- `Holding`
- `DematHolding`
- `FundsSnapshot`
- `MarginEstimate`
- `GttRule`
- `AlertRule`
- `WorkspaceLayout`

---

## 8. Endpoint Usage Matrix

The product should intentionally map every official endpoint to visible value.

| Official capability | Current repo | Target product usage |
| --- | --- | --- |
| `generate_session` | partial | connection center, session bootstrap |
| `get_customer_details` | partial | account identity, health, entitlement |
| `get_quotes` | unused | watchlists, spot board, instrument panel |
| `get_market_depth` | unused | depth ladder, microstructure panel |
| `get_option_chain_quotes` | used | option chain, scanner, strategy attach |
| `get_historical_data` | helper only | fallback charting, archive access |
| `get_historical_data_v2` | unused | primary charting and replay |
| `get_portfolio_positions` | used | live positions, risk workspace |
| `get_portfolio_holdings` | partial | portfolio workspace |
| `get_demat_holdings` | unused | holdings ledger |
| `get_funds` | used | funds workspace, margin monitor |
| `place_order` | used | ticket, basket execution |
| `modify_order` | unused | amend order workflows |
| `cancel_order` | used | blotter cancel, batch cancel |
| `square_off` | used | exits and automation |
| `get_order_list` | used | order book |
| `get_order_detail` | unused | order drilldown and audit |
| `get_trade_list` | used | trade book |
| `get_trade_detail` | unused | execution diagnostics |
| `preview_order` | unused | pre-submit validation |
| `limit_calculator` | unused | suggested price and slip control |
| `margin_calculator` | unused | pre-trade and post-trade margin impact |
| single-leg GTT APIs | unused | automation center |
| three-leg GTT APIs | unused | multi-leg exits and entries |
| market feed subscribe/unsubscribe | partial | watchlist, chain, quote board |
| live tick websocket | partial | market workspace |
| candle stream | unused | live charts and replay |
| one-click strategy streams | unused | guided strategy launchpad |
| order notifications | unused in product | execution workspace alerts |
| `get_names` | unused | instrument lookup / search |
| `set_funds` | unused | sandbox or managed capital overlay |

---

## 9. Recommended Refactor Plan for This Repo

### Phase 0: Stabilize the current base

This phase is mandatory before major feature expansion.

- fix `StrategyBuilder` template insertion bug
- split test and storybook TS configs from app TS config
- install or remove missing test/storybook dependencies
- enforce `tsc --noEmit` in CI
- add linting and formatting
- remove dead or duplicate integration paths
- decide whether `useBreeze` becomes the real abstraction or is deleted

### Phase 1: Introduce a real broker platform layer

- create `domains/session`, `domains/market`, `domains/execution`, `domains/portfolio`
- create a single `brokerGatewayClient`
- move all transport branching out of React components
- treat Python backend as primary production path
- downgrade browser-direct path to diagnostics / fallback-only tooling

### Phase 2: Convert the app into routed workspaces

Suggested routes:

- `/market`
- `/strategy`
- `/execution`
- `/portfolio`
- `/risk`
- `/automation`
- `/settings/connections`

### Phase 3: Expand API usage

Add first:

- quotes
- market depth
- modify order
- order detail
- trade detail
- preview order
- margin calculator
- limit calculator
- historical v2

Then add:

- demat holdings
- GTT center
- order notification stream
- candle stream

### Phase 4: Build the differentiated risk product

- risk dashboard
- exposure ladder
- expiry board
- scenario matrix
- IV regime engine
- automated warnings

### Phase 5: Build automation and premium workflows

- GTT workflow builder
- conditional strategy entries
- strategy repair suggestions
- saved playbooks
- alerts and notifications

---

## 10. UX Spec by Workspace

### 10.1 Market workspace

Panels:

- top ribbon: account, symbol, regime, connection
- center: option chain or chart
- right side: order ticket and contract details
- bottom: streaming tape, alerts, logs

Interactions:

- command palette for symbol jump
- strike search
- keyboard buy/sell
- pin contract
- compare expiries
- switch between chain, skew, and OI profile

### 10.2 Strategy workspace

Panels:

- left: templates, saved drafts, legs
- center: payoff, scenario, greek grids
- right: margin impact, order preview, notes

Interactions:

- add from chain
- import from positions
- smart repair suggestions
- save, duplicate, compare, execute

### 10.3 Execution workspace

Panels:

- order ticket
- basket staging
- live order notifications
- blotter
- amend queue

Interactions:

- preview
- margin impact
- limit suggestion
- modify in place
- cancel/replace

### 10.4 Portfolio workspace

Panels:

- positions
- holdings
- demat holdings
- funds
- orders
- trades
- notes/journal

Interactions:

- load to builder
- partial square off
- convert to automation rule
- inspect execution detail

### 10.5 Risk workspace

Panels:

- aggregate risk cards
- greek exposure map
- expiry concentration table
- margin pressure gauge
- scenario matrix
- alerts

### 10.6 Automation workspace

Panels:

- GTT rules
- strategy triggers
- alert rules
- action history

---

## 11. Non-Functional Requirements

### 11.1 Safety

- never store API secret in browser local storage
- session secrets stay backend-side whenever possible
- use signed backend sessions for frontend access
- add explicit live-trading and paper-trading mode separation
- add action audit log for every order action

### 11.2 Performance

Targets:

- first useful render under 2.5s
- workspace route switch under 200ms
- chain update to paint under 150ms
- quote stream drop recovery under 3s

### 11.3 Reliability

- heartbeat and reconnect strategy for all streams
- stale-data indicators per panel
- graceful degradation from stream to snapshot
- exchange- and endpoint-level capability flags

### 11.4 Observability

- API call metrics
- stream gap metrics
- order submit latency
- error taxonomy
- per-endpoint success rate

---

## 12. High-Value New Ideas Beyond the Current App

These are not cosmetic additions. They materially improve trader outcomes.

- Expiry control tower with theta decay, PCR shift, max pain drift, and short-gamma concentration.
- Strategy repair engine that suggests roll, hedge, or condor conversion based on current position shape.
- IV regime board using historical v2 plus live chain to show percentile, skew, and term structure.
- Execution quality panel showing planned vs actual price, slippage, and fill speed.
- Event-led dashboard combining order notifications, triggers, GTT actions, and risk breaches.
- Playbooks such as "expiry short premium", "gap-up hedge", "post-breakout call spread" with one-click staging.
- Replay mode that rehydrates historical candles plus chain snapshots to study missed setups.
- Workspace presets for scalper, intraday premium seller, swing options trader, and portfolio hedger.

---

## 13. What to Keep, What to Replace

### Keep

- the `OptionChain` component architecture pattern
- the current proxy concept
- keyboard-first trading interactions
- export and stale-data affordances
- positions trade and square-off workflows as product seeds

### Replace or redesign

- `App.tsx` as orchestration center
- browser-direct mode as a primary live path
- giant monolithic `Positions.tsx`
- giant monolithic `ConnectBrokerModal.tsx`
- embedded backend code snippet as the long-term operational model
- build pipeline that does not typecheck

---

## 14. Recommended Immediate Next Build Order

If this repo is the starting point, the highest-value sequence is:

1. Fix current build integrity and latent runtime issues.
2. Extract broker/session/market stores and a single backend client.
3. Convert the current top-level tabs into routed workspaces.
4. Add quotes, market depth, modify order, preview order, margin calculator, and historical v2.
5. Build the new execution ticket and risk workspace.
6. Add GTT automation center and order notification stream.
7. Add advanced research features after the live trading core is stable.

---

## 15. Bottom Line

This codebase is a strong prototype with one notably mature module (`OptionChain`) and two oversized but valuable product surfaces (`Positions`, `ConnectBrokerModal`).

The best-in-class path is not to keep layering features onto the current `App.tsx` orchestration model. The correct move is to turn the product into a routed, domain-driven trading workspace backed by a canonical Python Breeze gateway that exposes the full SDK surface in a stable, stream-first way.

That architecture will let the terminal use the full Breeze platform:

- quotes
- market depth
- option chain
- historical and live candles
- orders and amendments
- trade detail
- funds and holdings
- preview and margin calculation
- GTT automation
- notifications and strategy streams

while keeping the UI faster, safer, and easier to operate than the current single-screen flow.
