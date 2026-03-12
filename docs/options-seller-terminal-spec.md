# Options Seller Terminal: Institutional Product Requirements Document

## 1. Document Control

### 1.1 Purpose

This document defines the product requirements for a professional options-selling terminal built on top of the existing Sensibull Terminal architecture. It is intended to guide product, engineering, design, analytics, and operations teams toward a coherent seller-first platform rather than a generic broker front end.

### 1.2 Scope

This PRD covers:

- product strategy
- target users and operating styles
- functional requirements
- data and analytics requirements
- risk and compliance controls
- automation requirements
- systems and integration requirements
- observability and operational readiness
- rollout sequencing

This PRD does not replace the platform architecture specification or implementation plan. It sits above them as the product contract for the seller-first trading experience.

Companion documents:

- `docs/enhanced-terminal-architecture-spec.md`
- `docs/enhanced-terminal-implementation-plan.md`

### 1.3 Product Thesis

The terminal should function as an institutional-grade decision support and execution environment for options sellers. The product should not merely expose broker APIs. It should continuously answer four trader questions:

1. Is premium selling attractive right now?
2. Which structure best fits the current regime and my current book?
3. What can go wrong, how quickly, and how do I defend it?
4. What should I do next if the market moves, volatility shifts, or time passes?

---

## 2. Product Vision

### 2.1 Vision Statement

Build the default operating system for discretionary and semi-systematic options sellers in index and liquid stock derivatives, with first-class support for idea generation, execution, live risk, adjustment, automation, and post-trade learning.

### 2.2 Product Goals

- Maximize seller-quality trade discovery, not raw data density.
- Help users avoid selling volatility in statistically poor or operationally unsafe conditions.
- Reduce time from market open to valid trade decision.
- Increase consistency of structure selection, sizing, and adjustment discipline.
- Surface risk before order placement and before loss events.
- Turn repeated discretionary selling workflows into semi-automated, auditable playbooks.

### 2.3 Non-Goals

- Becoming a generic all-asset broker terminal.
- Competing on charting breadth alone.
- Encouraging naked high-gamma risk without explicit user consent and protections.
- Providing opaque black-box trade signals without explainability.

---

## 3. Target Users

### 3.1 Primary User Segments

#### A. Intraday premium seller

Characteristics:

- actively trades intraday theta decay
- prefers index options
- relies on regime and flow context
- needs fast execution and fast exits

Needs:

- expiry-day tools
- intraday range detection
- gamma warnings
- rapid adjustment and flattening

#### B. Positional income seller

Characteristics:

- sells weekly or monthly premium
- focuses on probability, margin efficiency, and drawdown control
- prefers hedged structures over scalping

Needs:

- regime filters
- defined-risk alternatives
- margin-aware ranking
- automation for exits and rolls

#### C. Adjustment-driven discretionary trader

Characteristics:

- manages positions actively after entry
- views adjustment quality as the main source of edge
- often carries a live book across expiries

Needs:

- live risk cockpit
- one-click scenario analysis
- adjustment suggestions with payoff diffs
- portfolio-aware exposure controls

#### D. Semi-systematic seller

Characteristics:

- follows explicit rules or playbooks
- wants alerting and automation
- wants traceability across similar trades

Needs:

- strategy templates
- rule builder
- audit trails
- performance analytics by setup and regime

### 3.2 Secondary Users

- desk supervisors reviewing risk and compliance
- research users designing playbooks and ranking models
- operations users monitoring broker health, callbacks, and execution failures

---

## 4. User Problems

Options sellers consistently face the same failure points:

- selling in the wrong regime
- choosing structures with poor premium-to-risk ratio
- underestimating gamma, event, or gap risk
- overusing margin in correlated books
- adjusting too late or randomly
- lacking portfolio context when adding new positions
- lacking repeatable rules and post-trade feedback

The product must be designed to reduce those failure modes directly.

---

## 5. Core Product Principles

- Seller-first: every major workflow begins with premium-selling context.
- Explainability first: every recommendation must show why it exists.
- Risk visible before action: margin, Greeks, break-evens, and stress must be shown before order placement.
- Portfolio-aware by default: new trade ideas must consider the current book.
- Adjustment-native: managing and repairing positions is as important as entry.
- Stream-first: live trading state should be driven by live feeds, not stale polling.
- Automation with supervision: users should be able to automate discipline while retaining guardrails and auditability.

---

## 6. Primary User Jobs

The platform must help the trader:

- determine whether premium selling is attractive now
- identify the best structure for the current regime
- compare multiple seller setups quickly
- understand expected credit, fees, margin, and tail risk before entry
- stage and execute multi-leg trades safely
- monitor live book risk and portfolio concentration
- receive timely adjustment suggestions
- automate exits, alerts, rolls, and risk controls
- learn which setups actually work for their style

---

## 7. Product Scope

### 7.1 In Scope

- seller idea generation
- market regime detection
- strike intelligence
- strategy construction and comparison
- broker-backed execution preview and margin
- live risk and portfolio monitoring
- adjustment suggestions
- automation and GTT workflows
- journaling and playbook analytics

### 7.2 Out of Scope for Initial Product

- cross-broker OMS abstraction beyond Breeze-compatible workflows
- institutional DMA or co-located low-latency routing
- full quant research notebook environment
- unsupported derivatives venues

---

## 8. Market Regime Engine

### 8.1 Objective

Determine whether premium selling has edge, which style of selling is appropriate, and what risks dominate the current environment.

### 8.2 Inputs

- live spot and futures prices
- intraday range and ATR
- realized volatility
- implied volatility and IV percentile
- IV-HV spread
- VIX or equivalent vol index context
- option chain OI and volume structure
- put-call ratio and its trend
- breadth and sector participation
- event calendar
- gap context
- time to expiry
- rolling session statistics

### 8.3 Outputs

- regime classification
- seller suitability score
- regime confidence score
- preferred structures
- restricted structures
- key warnings

### 8.4 Example Regime Labels

- range-bound
- trend-up
- trend-down
- volatile expansion
- post-event vol crush
- pre-event uncertainty
- expiry pinning
- short-covering risk
- panic downside

### 8.5 Requirements

- Regime must update live as inputs change.
- Regime transitions must be visible in the UI and recorded in the trade journal context.
- Each regime label must expose the supporting metrics behind it.
- The engine must be able to suppress poor seller setups when volatility compensation is inadequate.

---

## 9. Seller Idea Engine

### 9.1 Objective

Continuously generate seller-oriented opportunities, ranked by quality and fitness for the current market and portfolio state.

### 9.2 Supported Strategy Families

- short strangle
- short straddle
- iron condor
- iron fly
- bull put spread
- bear call spread
- jade lizard
- ratio spread
- broken-wing butterfly
- calendar and diagonal around event or skew dislocations
- covered call overlay
- cash-secured put
- futures-hedged short premium structures
- expiry-day neutral and directional premium sells

### 9.3 Idea Card Requirements

Each idea must show:

- strategy family
- suggested strikes
- rationale
- regime fit
- expected net credit
- broker-estimated fees
- required margin
- max profit
- max loss or undefined-risk warning
- break-even zone
- probability-oriented metrics
- theta efficiency
- vega and gamma exposure
- liquidity score
- slippage estimate
- event risk note
- invalidation condition
- adjustment plan
- recommended size band

### 9.4 Ranking Modes

- highest theta per margin
- highest regime fit
- highest defined-risk quality
- highest premium richness
- lowest tail-risk
- portfolio diversification benefit
- best expiry-day opportunities

### 9.5 Suppression Rules

The engine must suppress or heavily de-rank ideas when:

- premium is too low for the risk assumed
- bid-ask spreads are poor
- event risk is near and unpriced
- gamma risk is excessive relative to time left
- the current portfolio already has the same directional or vega exposure
- margin use breaches user constraints

---

## 10. Discovery Modes

The product must support multiple seller operating modes:

- conservative income
- aggressive theta
- hedged-only
- defined-risk-only
- intraday expiry scalping
- event-aware
- portfolio overlay
- adjustment mode

Each mode should affect:

- strategy families shown
- ranking weights
- strike selection defaults
- safety restrictions
- default exits and automation presets

---

## 11. Strike Intelligence

### 11.1 Objective

Help the trader choose short and hedge strikes with data-backed context rather than intuition alone.

### 11.2 Required Metrics by Strike

- bid, ask, and spread
- volume and OI
- OI change
- IV
- Greeks
- premium decay rate
- distance from spot
- expected move distance
- probability OTM
- support or resistance context
- skew relationship
- liquidity score

### 11.3 Seller Guidance Labels

- premium rich
- premium thin
- crowded short strike
- dangerous gamma pocket
- low-liquidity trap
- favorable hedge wing
- skew opportunity
- adjustment-friendly zone

---

## 12. Strategy Builder

### 12.1 Objective

Allow users to construct, compare, modify, and repair premium-selling structures quickly.

### 12.2 Functional Requirements

- one-click structure templates
- delta-based strike autofill
- standard-deviation strike selection
- support or resistance anchored strike suggestions
- configurable wing widths
- strategy comparison view
- margin-aware strike nudging
- credit threshold enforcement
- payoff chart
- scenario analysis by spot, time, and IV
- clone and repair existing positions

### 12.3 Required Templates

- safe short strangle
- wide iron condor
- tight iron fly
- directional credit spread
- defined-risk expiry seller
- event crush calendar
- broken-wing repair
- one-side roll and re-center

---

## 13. Execution Desk

### 13.1 Objective

Stage and place seller structures with maximum pre-trade transparency and minimum operational friction.

### 13.2 Requirements

- multi-leg order staging
- basket and leg-by-leg execution flows
- broker-native preview
- broker-native margin preview
- normalized broker fee model
- slippage estimate
- rejection reason display
- partial-fill handling
- execution audit trail
- hedge-first execution option
- minimum net credit guardrail
- panic hedge and panic flatten actions

### 13.3 Seller-Specific Controls

- naked risk confirmation
- defined-risk alternative suggestion
- expiry-day gamma warning
- illiquid strike block
- event proximity warning
- max margin threshold block

---

## 14. Live Risk Console

### 14.1 Strategy-Level Risk

The user must see, for each strategy:

- live PnL
- net credit or debit
- max profit
- max loss
- live break-even
- distance to break-even
- delta, gamma, theta, vega
- margin used
- margin available
- payoff graph
- spot shock scenarios
- IV shock scenarios
- time decay scenarios

### 14.2 Portfolio-Level Risk

The user must see:

- aggregate delta, gamma, theta, vega
- total premium sold
- expiry concentration
- symbol concentration
- directional skew
- downside and upside tail buckets
- margin concentration
- account drawdown state
- stress-loss projections
- event risk concentration

### 14.3 Alerts

- short strike proximity
- MTM drawdown
- margin compression
- gamma acceleration
- volatility expansion
- event approach
- liquidity deterioration
- concentration breach

---

## 15. Adjustment Engine

### 15.1 Objective

Continuously propose action paths for open premium-selling positions as conditions evolve.

### 15.2 Trigger Conditions

- spot approaches short strike
- one side gets challenged
- enough credit has already decayed
- DTE becomes too low for the current structure
- IV regime shifts
- portfolio concentration worsens
- margin usage increases sharply
- regime no longer supports the structure

### 15.3 Suggested Adjustments

- roll threatened side
- convert naked risk into defined risk
- add hedge wing
- close profitable side
- re-center a condor
- convert to iron fly
- add futures hedge
- reduce lots
- close full position

### 15.4 Output Requirements

Every adjustment suggestion must show:

- why it is recommended
- new payoff shape
- new break-evens
- new margin impact
- incremental credit or debit
- risk reduced
- new risks introduced
- ideal scenario for using it

---

## 16. Automation and GTT

### 16.1 Objective

Allow sellers to automate discipline without removing control and traceability.

### 16.2 Supported Rule Types

- entry alert
- auto-stage order
- MTM stop loss
- MTM profit booking
- underlying breach exit
- time-based exit
- expiry-day forced reduction
- roll suggestion trigger
- margin-defense trigger
- IV spike defense

### 16.3 Trigger Inputs

- spot level
- spot cross
- percentage move
- option premium
- strategy MTM
- portfolio MTM
- Greeks
- margin usage
- DTE
- live position quantity
- callback status

### 16.4 Workflow Requirements

- create, edit, activate, pause, and delete rules
- manual rule evaluation
- background evaluation loop
- one-shot or recurring mode
- cooldowns and rate limits
- callback ingestion
- audit trail
- manual override

---

## 17. Opportunity Feed

### 17.1 Objective

Provide a ranked stream of seller opportunities and warnings so the trader does not have to assemble context manually.

### 17.2 Feed Sections

- best theta-per-margin now
- best defined-risk sellers now
- post-gap premium overpricing
- event-aware no-trade warnings
- expiry-day opportunities
- existing positions needing adjustment
- portfolio hedge ideas
- avoid-these setups

### 17.3 Feed Card Standard

Every card must answer:

- what is the setup
- why now
- how much credit
- what is the risk
- what invalidates it
- how to exit
- how to adjust

---

## 18. Playbooks

### 18.1 Objective

Turn repeated seller behavior into explicit, reusable operating frameworks.

### 18.2 Playbook Components

- market preconditions
- allowed structures
- strike selection rules
- size rules
- margin rules
- stop and target rules
- adjustment sequence
- no-trade conditions

### 18.3 Product Behavior

The platform should:

- suggest playbook matches
- warn when a setup violates a saved playbook
- evaluate post-trade performance by playbook

---

## 19. Journal and Review

### 19.1 Objective

Help users identify which seller setups, regimes, and adjustments actually produce durable edge.

### 19.2 Captured Context

- trade rationale
- regime at entry
- volatility state
- structure chosen
- size chosen
- margin used
- execution quality
- adjustments made
- automation involvement
- outcome
- mistake tags

### 19.3 Analytics

- PnL by strategy family
- PnL by regime
- win rate by DTE bucket
- theta capture efficiency
- adjustment effectiveness
- average drawdown before exit
- credit capture before close
- playbook compliance
- tail-loss clustering

---

## 20. Safety and Guardrails

### 20.1 Hard Controls

- naked-selling confirmation
- max margin utilization
- max per-symbol concentration
- max per-expiry concentration
- circuit breaker after drawdown threshold
- duplicate trade detection
- illiquid strike suppression
- event-day restrictions

### 20.2 Soft Controls

- low-premium warning
- poor regime warning
- reduce-size suggestion
- defined-risk alternative suggestion
- playbook mismatch warning

---

## 21. Data Requirements

### 21.1 Broker and Market Data

- quotes
- option chain
- market depth
- historical candles
- live candle stream
- positions
- holdings
- funds
- orders
- trades
- order status callbacks

### 21.2 Derived Analytics

- IV percentile
- realized volatility
- expected move
- skew
- premium richness
- theta efficiency
- gamma danger score
- margin efficiency
- seller suitability score

### 21.3 Persistence Requirements

- saved strategies
- rules and automation state
- callback audit history
- journal entries
- playbooks
- user preferences
- diagnostics and normalization captures

---

## 22. Functional Requirements by Workspace

### 22.1 Market Workspace

- watchlists
- broker-native quotes and depth
- option chain
- historical and live candles
- regime panel
- expected move and IV context

### 22.2 Strategy Workspace

- seller templates
- strike intelligence
- scenario analysis
- strategy comparison
- journal-ready rationale capture

### 22.3 Execution Workspace

- order staging
- preview
- margin
- normalized fees
- execution status
- failure diagnostics

### 22.4 Portfolio Workspace

- open positions
- holdings
- orders and trades
- portfolio Greeks
- margin and funds
- concentration analytics

### 22.5 Risk Workspace

- broker-backed margin and charge summary
- live stress and drawdown view
- short strike monitoring
- risk events and warnings

### 22.6 Automation Workspace

- rule CRUD
- trigger evaluation
- callback history
- execution logs
- rule diagnostics

---

## 23. Explainability Requirements

Any recommendation, score, or suppression must be explainable. The user must be able to inspect:

- inputs used
- ranking factors
- rule thresholds
- reasons for suppression
- broker source versus model-derived source
- freshness of every major data point

---

## 24. Operational Requirements

### 24.1 Reliability

- degrade gracefully during stream outages
- preserve critical account and execution state
- detect stale sessions
- show freshness and health status globally

### 24.2 Auditability

- all previews, margins, orders, callbacks, and automation actions must be timestamped and attributable
- all automatic actions must record the rule, condition, and broker outcome that caused them

### 24.3 Security

- broker credentials must never be exposed in plain UI state
- shared-secret and webhook validation must be supported
- operational logs must exclude sensitive credentials

---

## 25. Non-Functional Requirements

### 25.1 Performance

- critical live panels should update with sub-second perceived responsiveness
- option chain and risk panels must remain usable under high tick frequency
- the system should favor incremental updates over full recomputation where possible

### 25.2 Availability

- backend workflows must continue to function through intermittent frontend reconnects
- automation and callback ingestion should not depend on the user keeping the UI open

### 25.3 Maintainability

- broker normalization logic must be isolated and testable
- domain stores must own business state rather than page components
- new seller workflows must reuse the canonical strategy object

---

## 26. Canonical Strategy Object

All modules should operate on a shared strategy model that includes:

- strategy id
- strategy family
- symbol
- expiry
- legs
- quantity
- entry rationale
- regime context
- preview and margin
- fee summary
- live Greeks
- live PnL
- risk thresholds
- automation rules
- journal metadata

This object is the contract linking idea generation, execution, risk, automation, and review.

---

## 27. Metrics and Success Criteria

### 27.1 Product Metrics

- time to first actionable seller idea
- percentage of ideas converted to staged orders
- percentage of orders with broker preview before placement
- average adjustment response time
- percentage of active positions with automation attached
- reduction in bad-regime seller entries

### 27.2 Trading Quality Metrics

- average theta per margin
- realized fee and slippage control
- drawdown containment
- tail-loss frequency
- playbook adherence
- realized versus expected setup quality

### 27.3 Platform Metrics

- callback ingestion success rate
- broker preview success rate
- margin fetch success rate
- stream freshness
- rule evaluation latency

---

## 28. Rollout Priorities

### Phase A: Seller Intelligence Core

- regime engine
- opportunity feed
- strike intelligence
- seller scorecard

### Phase B: Execution and Risk Hardening

- strategy builder v2
- execution preview and margin
- fee normalization
- live risk cockpit
- adjustment engine

### Phase C: Automation and Learning

- GTT and automation workflows
- playbooks
- journal and review analytics
- callback hardening

### Phase D: Advanced Seller Edge

- portfolio overlay ideas
- skew and relative-value workflows
- advanced expiry and event modules
- model-assisted ranking refinements

---

## 29. Open Questions

- Which seller metrics should be authoritative from broker payloads versus locally derived models?
- How much automation should be allowed to place live orders without explicit confirmation for each action?
- What callback formats are contractually guaranteed by the final deployment path?
- Which strategy families should be restricted by account segment, experience level, or margin status?
- Should the product optimize for index sellers first and keep stock options as a second wave?

---

## 30. Acceptance Standard

This PRD should be considered satisfied only when the product can:

- identify seller-appropriate market regimes
- generate ranked, explainable seller ideas
- stage and preview broker-backed seller structures
- show live strategy and portfolio risk
- suggest and support adjustments
- automate guarded seller workflows
- capture and analyze outcomes for continuous improvement

At that point, the terminal is no longer a broker-connected demo. It becomes a seller operating platform.
