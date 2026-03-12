# Next Session Handoff

Last updated: 2026-03-12

Latest completed commit before this handoff file:
- `450c2c9` `Add backend repair preview and review sync`

## Current state

The seller-first terminal now has:
- backend-native market depth and candle integration
- broker-backed preview and margin flows
- normalized broker fee handling in execution and risk
- automation/GTT backend with persistence, trigger evaluation, callback ingestion, and rule CRUD
- seller intelligence, opportunity feed, automation presets, and playbook-aware suppression
- journal/review workspace with backend-backed review-state sync
- live adjustment engine with broker-confirmed repair preview deltas
- lifecycle-aware journal reconciliation against positions, orders, and trades

## What remains next

### 1. Backend route and contract tests

Add direct backend tests for:
- `POST /api/repair-preview`
- `GET /api/reviews/state`
- `PUT /api/reviews/state`
- `GET /api/positions` normalized position fields

Minimum assertions:
- repair preview returns incremental premium and fee data for repair legs
- current vs resulting margin is present and internally consistent
- ranking payload includes `score`, `creditEfficiency`, `marginRelief`, and `thesisPreservation`
- review state round-trips entries and playbook reviews without field loss
- normalized positions expose realized/unrealized PnL and broker greeks keys when present

### 2. Validate live ICICI position payload variants

The position parser is stronger now, but still needs broader live validation.

Next step:
- capture more real Breeze `get_portfolio_positions` payload shapes
- compare actual ICICI fields for:
  - realized PnL
  - unrealized/open PnL
  - delta/gamma/theta/vega if exposed
  - order/trade linkage fields
- trim fallback branches once real payloads prove which fields are actually used

Target files:
- [automation_normalization.py](/home/rajesh_l_mehta/sensibullterminal/automation_normalization.py)
- [src/domains/market/marketTransforms.ts](/home/rajesh_l_mehta/sensibullterminal/src/domains/market/marketTransforms.ts)

### 3. Adjustment engine ranking depth

Current ranking uses:
- credit efficiency
- margin relief
- thesis preservation

Next upgrade:
- include liquidity and slippage penalty
- include time-to-expiry penalty on gamma-heavy repairs
- include playbook/regime fit in repair ranking
- include realized repair history from the journal so ranking can learn from prior outcomes

Target file:
- [src/domains/adjustment/adjustmentStore.tsx](/home/rajesh_l_mehta/sensibullterminal/src/domains/adjustment/adjustmentStore.tsx)

### 4. Seller playbook persistence

Journal review state is backend-persisted now, but playbooks themselves are still generated in frontend code.

Next step:
- add backend APIs for seller playbooks
- support create/update/delete playbook flows
- persist custom user playbooks across devices
- connect seller idea generation to persisted playbooks instead of static defaults only

Target files:
- [src/domains/seller/sellerIntelligenceStore.tsx](/home/rajesh_l_mehta/sensibullterminal/src/domains/seller/sellerIntelligenceStore.tsx)
- [kaggle_backend.py](/home/rajesh_l_mehta/sensibullterminal/kaggle_backend.py)

### 5. Journal outcome attribution hardening

Current journal lifecycle is materially better, but close-out attribution is still inferred from linked orders/trades and current positions.

Next step:
- detect explicit open-to-close trade lifecycle groups
- store realized close-out attribution per leg and per structure
- separate entry fills, repair fills, and final exit fills
- show adjustment effectiveness based on realized post-repair outcomes, not only state drift

Target files:
- [src/domains/journal/journalStore.tsx](/home/rajesh_l_mehta/sensibullterminal/src/domains/journal/journalStore.tsx)
- [src/app/workspaces/JournalWorkspace.tsx](/home/rajesh_l_mehta/sensibullterminal/src/app/workspaces/JournalWorkspace.tsx)

### 6. Regression tests on frontend stores

Add store-level tests for:
- grouped Breeze position normalization
- journal reconciliation and lifecycle events
- review-state backend sync merge behavior
- adjustment suggestion generation for:
  - short strangle/straddle
  - iron condor
  - calendar
  - broken wing
  - ratio repair
  - expiry-day de-gamma

## Suggested next implementation order

1. Backend route tests for repair preview and review-state APIs
2. Live ICICI position payload capture and normalization tightening
3. Journal close-out attribution improvements
4. Seller playbook backend persistence
5. Adjustment ranking enhancements using realized review history

## Workspace notes

Runtime artifacts remain intentionally untracked:
- `logs/`
- `__pycache__/`
- `scripts/__pycache__/`
- `tests/__pycache__/`

If a future session starts from this file, begin by checking:
- current `main` HEAD
- whether any new real ICICI payload samples were captured under `logs/`
- whether backend tests for repair preview and review-state already exist
