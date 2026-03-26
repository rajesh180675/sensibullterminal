from __future__ import annotations

import os
import threading
import time
from collections import deque
from datetime import datetime
from typing import Any

from automation_normalization import (
    extract_rule_id_hint,
    first_present,
    is_icici_order_update_payload,
    match_symbol,
    normalize_broker_results,
    normalize_callback_payload,
    normalize_position_row,
    row_symbol,
    safe_float,
)

from ..streaming.tick_store import JsonStateStore, ValidationCaptureStore


def _safe_float(value: Any, default: float = 0.0) -> float:
    return safe_float(value, default)


class AutomationRuleManager:
    def __init__(self, engine: Any, path: str):
        self.engine = engine
        self.store = JsonStateStore(path, lambda: {"rules": [], "callbacks": []})
        self.webhook_capture_store = ValidationCaptureStore(
            os.environ.get("BREEZE_AUTOMATION_CAPTURE_FILE", "logs/automation_webhook_samples.jsonl")
        )
        self._lock = threading.Lock()
        self._callbacks: deque[dict[str, Any]] = deque(maxlen=200)
        self._state = self.store.load()
        for event in reversed(self._state.get("callbacks", [])[-50:]):
            self._callbacks.appendleft(event)
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="automation-rule-loop", daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        while not self._stop_event.wait(5.0):
            try:
                self.evaluate_active_rules()
            except Exception as exc:
                self.engine.log.warning(f"[Automation] background evaluation failed: {exc}")

    def close(self) -> None:
        self._stop_event.set()

    @staticmethod
    def _now_ts() -> float:
        return time.time()

    @staticmethod
    def _fmt_run(ts: float | None) -> str:
        if not ts:
            return "Never"
        return datetime.fromtimestamp(ts).strftime("%d %b %H:%M")

    def _persist_locked(self) -> None:
        self.store.save({"rules": self._state.get("rules", []), "callbacks": list(self._callbacks)})

    def _append_event_locked(self, event: dict[str, Any]) -> None:
        self._callbacks.appendleft(event)

    def _find_rule_locked(self, rule_id: str) -> dict[str, Any] | None:
        for rule in self._state.get("rules", []):
            if str(rule.get("id")) == rule_id:
                return rule
        return None

    @staticmethod
    def _normalise_status(status: str) -> str:
        return status if status in {"active", "paused", "draft"} else "draft"

    def _build_event(
        self,
        rule: dict[str, Any],
        event_type: str,
        status: str,
        message: str,
        broker_results: list[dict[str, Any]] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "id": f"automation-event-{int(self._now_ts() * 1000)}-{len(self._callbacks) + 1}",
            "ruleId": str(rule.get("id", "")),
            "ruleName": str(rule.get("name", "Automation rule")),
            "kind": str(rule.get("kind", "gtt")),
            "eventType": event_type,
            "status": status,
            "message": message,
            "timestamp": self._now_ts(),
            "brokerResults": broker_results or [],
            "meta": meta or {},
        }

    def list_rules(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(rule) for rule in self._state.get("rules", [])]

    def list_callbacks(self, limit: int = 25) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._callbacks)[: max(1, min(limit, len(self._callbacks) or 1))]

    def _sanitize_trigger_config(self, trigger_config: Any) -> dict[str, Any]:
        if not isinstance(trigger_config, dict):
            return {"type": "manual"}
        trigger_type = str(trigger_config.get("type") or "manual")
        config: dict[str, Any] = {"type": trigger_type}
        for key in (
            "referencePrice",
            "lowerPrice",
            "upperPrice",
            "thresholdPrice",
            "movePercent",
            "maxDrawdown",
            "profitTarget",
            "netQuantity",
        ):
            if key in trigger_config:
                config[key] = _safe_float(trigger_config.get(key))
        if "direction" in trigger_config:
            config["direction"] = str(trigger_config.get("direction") or "either")
        return config

    def _sanitize_action_config(self, action_config: Any) -> dict[str, Any]:
        if not isinstance(action_config, dict):
            return {"type": "notify"}
        config: dict[str, Any] = {"type": str(action_config.get("type") or "notify")}
        if "message" in action_config:
            config["message"] = str(action_config.get("message") or "")
        if isinstance(action_config.get("legs"), list):
            config["legs"] = action_config.get("legs")
        return config

    def _build_rule(self, payload: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
        now = self._now_ts()
        prior = existing or {}
        symbol = str(payload.get("symbol") or prior.get("symbol") or "NIFTY").upper()
        return {
            "id": str(payload.get("id") or prior.get("id") or f"rule-{int(now * 1000)}"),
            "name": str(payload.get("name") or prior.get("name") or "Automation rule"),
            "kind": str(payload.get("kind") or prior.get("kind") or "gtt"),
            "status": self._normalise_status(str(payload.get("status") or prior.get("status") or "draft")),
            "scope": str(payload.get("scope") or prior.get("scope") or "Strategy workspace"),
            "trigger": str(payload.get("trigger") or prior.get("trigger") or "Manual review required"),
            "action": str(payload.get("action") or prior.get("action") or "Notify operator"),
            "lastRun": str(payload.get("lastRun") or prior.get("lastRun") or "Never"),
            "nextRun": str(payload.get("nextRun") or prior.get("nextRun") or "Live"),
            "notes": str(payload.get("notes") or prior.get("notes") or ""),
            "symbol": symbol,
            "triggerConfig": self._sanitize_trigger_config(payload.get("triggerConfig", prior.get("triggerConfig"))),
            "actionConfig": self._sanitize_action_config(payload.get("actionConfig", prior.get("actionConfig"))),
            "runCount": int(payload.get("runCount") or prior.get("runCount") or 0),
            "updatedAt": now,
        }

    def create_rule(self, payload: dict[str, Any]) -> dict[str, Any]:
        rule = self._build_rule(payload)
        with self._lock:
            self._state.setdefault("rules", []).insert(0, rule)
            self._append_event_locked(self._build_event(rule, "created", "info", "Automation rule created."))
            self._persist_locked()
            return dict(rule)

    def update_rule(self, rule_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            rule = self._find_rule_locked(rule_id)
            if not rule:
                return None
            updated = self._build_rule(payload, rule)
            rule.clear()
            rule.update(updated)
            self._append_event_locked(self._build_event(rule, "updated", "info", "Automation rule updated."))
            self._persist_locked()
            return dict(rule)

    def delete_rule(self, rule_id: str) -> dict[str, Any] | None:
        with self._lock:
            rules = self._state.setdefault("rules", [])
            for index, rule in enumerate(rules):
                if str(rule.get("id")) != rule_id:
                    continue
                removed = rules.pop(index)
                tombstone = dict(removed)
                tombstone["status"] = "paused"
                self._append_event_locked(self._build_event(tombstone, "deleted", "info", "Automation rule deleted."))
                self._persist_locked()
                return dict(removed)
        return None

    def update_rule_status(self, rule_id: str, status: str) -> dict[str, Any] | None:
        with self._lock:
            rule = self._find_rule_locked(rule_id)
            if not rule:
                return None
            rule["status"] = self._normalise_status(status)
            rule["updatedAt"] = self._now_ts()
            rule["nextRun"] = "Live" if status == "active" else "Paused"
            self._append_event_locked(
                self._build_event(rule, "status_changed", "info", f"Rule status changed to {status}.", meta={"status": status})
            )
            self._persist_locked()
            return dict(rule)

    def receive_callback(self, payload: dict[str, Any], source: str = "manual") -> dict[str, Any]:
        normalized = normalize_callback_payload(payload, source, normalized_at=self._now_ts())
        if source == "webhook":
            self._capture_webhook_sample(payload, normalized)
        rule_id = str(normalized.get("ruleId") or "")
        with self._lock:
            rule = self._find_rule_locked(rule_id) or {
                "id": rule_id or "manual-callback",
                "name": str(normalized.get("ruleName") or payload.get("ruleName") or "Manual callback"),
                "kind": str(normalized.get("kind") or payload.get("kind") or "alert"),
            }
            event = self._build_event(
                rule,
                str(normalized.get("eventType") or ("webhook" if source == "webhook" else "manual")),
                str(normalized.get("status") or "info"),
                str(normalized.get("message") or "Manual automation callback received."),
                broker_results=normalized.get("brokerResults") or [],
                meta=normalized.get("meta") if isinstance(normalized.get("meta"), dict) else {"source": source, "payload": payload},
            )
            self._append_event_locked(event)
            self._persist_locked()
            return event

    def _capture_webhook_sample(self, payload: dict[str, Any], normalized: dict[str, Any]) -> None:
        record = {
            "capturedAt": self._now_ts(),
            "matchesIciciOrderUpdate": bool(is_icici_order_update_payload(payload)),
            "ruleId": str(normalized.get("ruleId") or ""),
            "eventType": str(normalized.get("eventType") or ""),
            "status": str(normalized.get("status") or ""),
            "payload": payload,
        }
        try:
            self.webhook_capture_store.append(record)
        except Exception as exc:
            self.engine.log.warning(f"[Automation] webhook capture failed: {exc}")

    def _fetch_spot(self, symbol: str) -> float:
        cached = self.engine.tick_store.get_spot_prices().get(symbol.upper())
        if cached and cached > 0:
            return cached
        if not self.engine.connected or self.engine.broker_client is None:
            return 0.0
        try:
            result = self.engine.broker_client.get_quotes(
                stock_code=symbol.upper(),
                exchange_code="NSE" if symbol.upper() == "NIFTY" else "BSE",
                expiry_date="",
                right="",
                strike_price="",
            )
            rows = result.get("Success", []) if isinstance(result, dict) else []
            if isinstance(rows, dict):
                rows = [rows]
            for row in rows:
                for field in ("ltp", "last_traded_price", "close", "last_price", "LastPrice"):
                    value = _safe_float(row.get(field))
                    if value > 0:
                        self.engine.tick_store.update(f"{symbol.upper()}:SPOT", {"ltp": value, "source": "rest"})
                        return value
        except Exception as exc:
            self.engine.log.warning(f"[Automation] spot fetch failed: {exc}")
        return 0.0

    def _fetch_position_metrics(self, symbol: str) -> dict[str, Any]:
        snapshot: dict[str, Any] = {
            "symbol": symbol.upper(),
            "mtm": 0.0,
            "netQuantity": 0.0,
            "positionsCount": 0,
            "matchedRows": [],
        }
        if not self.engine.connected:
            return snapshot
        try:
            positions_payload = self.engine.get_positions()
        except Exception as exc:
            self.engine.log.warning(f"[Automation] positions fetch failed: {exc}")
            return snapshot
        positions = positions_payload.get("positions", []) if isinstance(positions_payload, dict) else []
        for row in positions:
            if not isinstance(row, dict) or not match_symbol(row, symbol):
                continue
            normalized = normalize_position_row(row)
            snapshot["mtm"] += _safe_float(normalized.get("mtm"))
            snapshot["netQuantity"] += _safe_float(normalized.get("quantity"))
            snapshot["positionsCount"] += 1
            if len(snapshot["matchedRows"]) < 5:
                snapshot["matchedRows"].append({
                    "symbol": normalized.get("symbol"),
                    "quantity": normalized.get("quantity"),
                    "mtm": normalized.get("mtm"),
                    "averagePrice": normalized.get("averagePrice"),
                    "ltp": normalized.get("ltp"),
                })
        return snapshot

    def _trigger_status(self, rule: dict[str, Any]) -> tuple[bool, str, dict[str, Any]]:
        trigger = rule.get("triggerConfig") or {}
        trigger_type = str(trigger.get("type") or "manual")
        symbol = str(rule.get("symbol") or "NIFTY")
        if trigger_type == "manual":
            return False, "Manual rule pending operator action.", {}
        if trigger_type == "spot_range_break":
            spot = self._fetch_spot(symbol)
            lower_price = _safe_float(trigger.get("lowerPrice"))
            upper_price = _safe_float(trigger.get("upperPrice"))
            if spot <= 0:
                return False, "Spot price unavailable.", {"spot": spot}
            if lower_price > 0 and spot <= lower_price:
                return True, f"Spot {spot:.2f} broke below {lower_price:.2f}.", {"spot": spot, "threshold": lower_price, "direction": "down"}
            if upper_price > 0 and spot >= upper_price:
                return True, f"Spot {spot:.2f} broke above {upper_price:.2f}.", {"spot": spot, "threshold": upper_price, "direction": "up"}
            return False, f"Spot {spot:.2f} remains inside rule range.", {"spot": spot, "lowerPrice": lower_price, "upperPrice": upper_price}
        if trigger_type == "spot_cross_above":
            spot = self._fetch_spot(symbol)
            threshold = _safe_float(trigger.get("thresholdPrice"))
            if spot <= 0:
                return False, "Spot price unavailable.", {"spot": spot}
            return threshold > 0 and spot >= threshold, f"Spot {spot:.2f} vs cross-above level {threshold:.2f}.", {"spot": spot, "threshold": threshold, "direction": "up"}
        if trigger_type == "spot_cross_below":
            spot = self._fetch_spot(symbol)
            threshold = _safe_float(trigger.get("thresholdPrice"))
            if spot <= 0:
                return False, "Spot price unavailable.", {"spot": spot}
            return threshold > 0 and spot <= threshold, f"Spot {spot:.2f} vs cross-below level {threshold:.2f}.", {"spot": spot, "threshold": threshold, "direction": "down"}
        if trigger_type == "spot_pct_move":
            spot = self._fetch_spot(symbol)
            reference = _safe_float(trigger.get("referencePrice"))
            move_percent = abs(_safe_float(trigger.get("movePercent")))
            direction = str(trigger.get("direction") or "either").lower()
            if spot <= 0 or reference <= 0 or move_percent <= 0:
                return False, "Spot move reference unavailable.", {"spot": spot, "referencePrice": reference}
            pct_move = ((spot - reference) / reference) * 100
            hit = abs(pct_move) >= move_percent
            if direction == "up":
                hit = pct_move >= move_percent
            elif direction == "down":
                hit = pct_move <= -move_percent
            return hit, f"Spot move {pct_move:.2f}% vs threshold {move_percent:.2f}%.", {
                "spot": spot,
                "referencePrice": reference,
                "movePercent": move_percent,
                "actualMovePercent": pct_move,
                "direction": direction,
            }
        if trigger_type == "mtm_drawdown":
            metrics = self._fetch_position_metrics(symbol)
            threshold = _safe_float(trigger.get("maxDrawdown"))
            current = _safe_float(metrics.get("mtm"))
            return current <= threshold, f"Live MTM {current:.2f} vs drawdown threshold {threshold:.2f}.", {**metrics, "threshold": threshold}
        if trigger_type == "mtm_profit_target":
            metrics = self._fetch_position_metrics(symbol)
            threshold = _safe_float(trigger.get("profitTarget"))
            current = _safe_float(metrics.get("mtm"))
            return current >= threshold, f"Live MTM {current:.2f} vs profit target {threshold:.2f}.", {**metrics, "threshold": threshold}
        if trigger_type == "position_net_quantity_below":
            metrics = self._fetch_position_metrics(symbol)
            threshold = _safe_float(trigger.get("netQuantity"))
            current = _safe_float(metrics.get("netQuantity"))
            return current <= threshold, f"Live net quantity {current:.0f} vs floor {threshold:.0f}.", {**metrics, "threshold": threshold}
        if trigger_type == "position_net_quantity_above":
            metrics = self._fetch_position_metrics(symbol)
            threshold = _safe_float(trigger.get("netQuantity"))
            current = _safe_float(metrics.get("netQuantity"))
            return current >= threshold, f"Live net quantity {current:.0f} vs ceiling {threshold:.0f}.", {**metrics, "threshold": threshold}
        return False, f"Unsupported trigger type {trigger_type}.", {"triggerType": trigger_type}

    def _normalise_action_legs(self, rule: dict[str, Any]) -> list[dict[str, Any]]:
        action_config = rule.get("actionConfig") or {}
        legs = action_config.get("legs") or []
        normalised: list[dict[str, Any]] = []
        for leg in legs:
            order_type = str(leg.get("orderType") or "market").lower()
            symbol = str(leg.get("symbol") or rule.get("symbol") or "NIFTY").upper()
            exchange_code = str(leg.get("exchange_code") or ("NFO" if symbol == "NIFTY" else "BFO"))
            lots = max(1, int(_safe_float(leg.get("lots"), 1)))
            lot_size = 75 if symbol == "NIFTY" else 20
            normalised.append({
                "stock_code": str(leg.get("stock_code") or symbol),
                "exchange_code": exchange_code,
                "product": "options",
                "action": str(leg.get("action") or "BUY").lower(),
                "quantity": str(int(_safe_float(leg.get("quantity"), lots * lot_size))),
                "price": str(leg.get("limitPrice") or leg.get("price") or 0),
                "order_type": order_type,
                "expiry_date": str(leg.get("expiry") or leg.get("expiry_date") or ""),
                "right": "call" if str(leg.get("type") or leg.get("right") or "CE").upper().startswith("C") else "put",
                "strike_price": str(leg.get("strike") or leg.get("strike_price") or 0),
                "stoploss": str(leg.get("stoploss") or 0),
            })
        return normalised

    def _execute_locked(self, rule: dict[str, Any], trigger_meta: dict[str, Any]) -> dict[str, Any]:
        action_config = rule.get("actionConfig") or {}
        action_type = str(action_config.get("type") or "notify")
        if action_type == "notify":
            event = self._build_event(
                rule,
                "executed",
                "info",
                str(action_config.get("message") or rule.get("action") or "Automation notification triggered."),
                meta=trigger_meta,
            )
            self._append_event_locked(event)
            rule["runCount"] = int(rule.get("runCount") or 0) + 1
            rule["lastRun"] = self._fmt_run(self._now_ts())
            rule["status"] = "paused" if str(rule.get("kind")) == "alert" else rule.get("status", "active")
            rule["nextRun"] = "Paused" if rule["status"] == "paused" else "Live"
            return event
        if not self.engine.connected:
            event = self._build_event(rule, "failed", "error", "Broker session is not connected.", meta=trigger_meta)
            self._append_event_locked(event)
            rule["lastRun"] = self._fmt_run(self._now_ts())
            return event
        legs = self._normalise_action_legs(rule)
        if not legs:
            event = self._build_event(rule, "failed", "error", "No automation legs configured.", meta=trigger_meta)
            self._append_event_locked(event)
            rule["lastRun"] = self._fmt_run(self._now_ts())
            return event
        results = self.engine.place_strategy_order(legs)
        success = all(bool(item.get("success")) for item in results) if results else False
        event = self._build_event(
            rule,
            "executed" if success else "failed",
            "success" if success else "error",
            "Broker automation execution completed." if success else "Broker automation execution had failures.",
            broker_results=results,
            meta=trigger_meta,
        )
        self._append_event_locked(event)
        rule["runCount"] = int(rule.get("runCount") or 0) + 1
        rule["lastRun"] = self._fmt_run(self._now_ts())
        rule["status"] = "paused"
        rule["nextRun"] = "Paused after trigger"
        return event

    def evaluate_active_rules(self) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        with self._lock:
            for rule in self._state.get("rules", []):
                if str(rule.get("status")) != "active":
                    continue
                triggered, message, meta = self._trigger_status(rule)
                if not triggered:
                    continue
                trigger_event = self._build_event(rule, "triggered", "warning", message, meta=meta)
                self._append_event_locked(trigger_event)
                events.append(trigger_event)
                events.append(self._execute_locked(rule, meta))
                rule["updatedAt"] = self._now_ts()
            if events:
                self._persist_locked()
        return events
