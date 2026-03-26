# Sensibull Terminal: Master Architecture & Completion Plan

**Version:** 1.0 (Consolidated)
**Status:** Implementation in Final Hardening Phase
**Purpose:** This document serves as the definitive architecture specification and final gap analysis for the Sensibull Options Seller Terminal. It combines previous iterative plans (`updatedplan.md`, `updateplan1.md`), resolves contradictions, and maps directly to the current state of the codebase, charting the exact path to production.

---

## 1. Executive Summary & Current State

The Sensibull Terminal is designed as an institutional-grade decision support and execution environment for options sellers. It sits above the ICICI Breeze API, functioning as a professional seller-first platform rather than a generic broker front end.

### 1.1 Implementation Status: Highly Advanced
A thorough codebase audit confirms that the majority of the planned architecture is **FULLY IMPLEMENTED**:
- **Modular Frontend:** React 19 + Vite + Tailwind 4, utilizing a provider tree, Zustand for UI state, and TanStack Query for server state.
- **Backend Services:** FastAPI monolith fully modularized into `session`, `market`, `orders`, `portfolio`, `stream`, `automation`, `review`, and `layout` services.
- **7 Core Workspaces:** Launchpad, Market, Strategy, Execution, Portfolio, Risk, and Ops workspaces are built with complex 2-column and 3-column layouts.
- **Analytical Intelligence:** Black-Scholes Greeks, 120-point payoff curves, regime detection (analytical/heuristic), and adjustment engines are fully functional.
- **Real-Time Streaming:** WebSocket-based tick bus, stream authority gating, and 500ms broadcast loop are active.

---

## 2. Core Architectural Pillars

### 2.1 The Three-Tier Truth System
All data in the terminal carries provenance metadata to ensure traders know the reliability of their views:
1. **Broker Tier:** Direct source of truth (e.g., Breeze API).
2. **Normalized Tier:** Standardized data structures.
3. **Analytical Tier:** Derived intelligence (e.g., computed Greeks, simulated payoffs).

*Implementation detail:* Every data payload implements the `AuthorityMeta` interface:
```typescript
interface AuthorityMeta {
  authority: 'broker' | 'normalized' | 'analytical';
  source: string;
  asOf: number;          // Unix timestamp ms
  stale: boolean;        // Date.now() - asOf > STALE_THRESHOLD
}
```

### 2.2 State Architecture (The 3 Layers)
1. **Server State (Layer 1):** Managed by `@tanstack/react-query`. Caches portfolio, active orders, funds, and execution status.
2. **Live State (Layer 2):** Managed by a custom `TickBus` with `useSyncExternalStore`. Handles real-time spot prices, option ticks, and stream health. Bypass React lifecycle for high-frequency updates.
3. **Terminal State (Layer 3):** Managed by `Zustand`. Handles workspace layouts, keyboard modes, staged drafts, and UI preferences.

### 2.3 Execution Safety & State Machine
Basket execution logic ensures atomic-like behavior over sequential broker API calls:
- **Basket States:** `staged` → `previewing` → `ready` → `sending` → `partial_fill` → `all_filled` (or `partial_failure`).
- **Orphan Handling:** If a multi-leg strategy fails mid-execution, the system halts, enters `partial_failure`, and surfaces an **Orphan Resolution Modal** offering manual intervention (Retry, Square Off, Accept Partial). The system *never* auto-reverses.

---

## 3. Final Hardening & Completion Plan (Phase 9)

While the structural foundations are complete, several critical stabilization tasks from the original specs must be finalized before production readiness.

### Task 1: WebSocket Stabilization & Backpressure
- **Double-Connect Guard:** Ensure `BreezeWsClient` handles React StrictMode gracefully.
- **Heartbeat Timeout:** Implement a 45-second heartbeat monitor to detect silent connection drops and force reconnections.
- **Subscription Diffing:** Enhance `SubscriptionManager` to intelligently diff strikes/expiries when the user navigates, staying within the 100-channel Breeze limit.

### Task 2: Spot Price Consolidation
- **Issue:** Spot prices currently exist in multiple mutable refs and module variables (`SPOT_PRICES`, `currentSpot.current`).
- **Action:** Enforce strict adherence to the `useSpotPriceStore` (Zustand) and `TickBus`. Backend responses must serve as the authoritative spot, verified against the 15% sanity clamp rule.

### Task 3: Strategy Grouping Reconciliation
- **Issue:** Grouped strategy identity relies heavily on frontend heuristics.
- **Action:** Finalize `PositionGrouper` on the backend to match live `broker_positions` against known `strategy_groups` via `contract_key`. Auto-close strategies when all leg lots reach 0, and emit `close_journal_entry` triggers.

### Task 4: Keyboard Navigation & Design System
- **Keyboard Engine:** Implement the global sequence dispatcher for `g l` (Launchpad), `g m` (Market), `Ctrl+K` (Command Palette), and `Shift+B/S` (Chain buy/sell).
- **Visual Primitives:** Standardize `FreshnessIndicator`, `MetricStrip`, and `TruthPill` components across all 7 workspaces to adhere to the strict 200ms animation limit and border-radius maximums.

### Task 5: Testing & Observability Deployment
- **Tests:** Finalize the suite for `math/greeks.ts`, `maxPain`, and `payoff` utilities. Verify execution state machine transitions.
- **Dockerization:** Package the backend with a `Dockerfile` and `docker-compose.yml` mapped to `/data` volumes for SQLite persistence to graduate from the Kaggle runner to a robust VPC deployment (e.g., Render, Railway, AWS).
- **Rate Limit Telemetry:** Expose real-time Breeze rate limit consumption to the `OpsWorkspace` via the diagnostics endpoint.

---

## 4. Deployment Topology

1. **Frontend:** Deployed to Vercel (React 19, Vite, Tailwind).
2. **Proxy:** Vercel serverless function (`/api/kaggle/*`) routes to backend, bypassing Cloudflare interstitials.
3. **Backend:** Python FastAPI running locally or on a dedicated VPS via Docker (moving away from ephemeral Kaggle notebooks), managing SQLite `terminal.db` and the real-time Breeze WebSocket connection.

---
*End of Master Architecture Specification*