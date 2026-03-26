# ═══════════════════════════════════════════════════════════════════════════════
# ICICI BREEZE BACKEND v7 — Production BreezeEngine
# Paste this ENTIRE file into ONE Kaggle notebook cell and run.
#
# Kaggle settings required:
#   Settings → Internet → ON   (mandatory)
#   Settings → Accelerator → GPU P100  (optional, keeps alive longer)
#
# RATE LIMIT PROTECTION:
#   RateLimiter: max 1 REST call per 600ms → safe under 100/min ICICI limit
#   WebSocket:   push-based ticks → ZERO REST calls for live prices
#   get_option_chain_quotes: called ONCE per expiry change, NEVER in loop
#
# ANTI-BAN RULES (enforced):
#   NO get_option_chain_quotes() in setInterval or while loop
#   NO get_quotes() in a polling loop
#   ALL live prices from WebSocket on_ticks callback ONLY
#   ALL REST calls serialized through RateLimiter queue
#
# TUNNEL PROVIDERS (tried in order, first success wins):
#   1. localhost.run  — SSH, no account, no interstitial ← best
#   2. serveo.net     — SSH, no account, no interstitial
#   3. Cloudflare     — binary download, no account, has browser interstitial
# ═══════════════════════════════════════════════════════════════════════════════

import subprocess
import sys
import os
import urllib.request
import stat
import socket
import re
import threading
import time
import json
import asyncio
import queue
import hashlib
import shutil
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Callable
from collections import deque
import logging
from backend.app.clients.breeze import BreezeBrokerClient
from backend.app.create_app import create_app
from backend.app.core.state import BackendState
from backend.app.services.automation.manager import AutomationRuleManager
from backend.app.services.market.market_data_service import MarketDataService
from backend.app.services.orders.execution_workflow import ExecutionWorkflow
from backend.app.services.review.review_state_manager import SellerReviewManager
from backend.app.services.streaming.realtime_manager import RealtimeManager
from backend.app.services.streaming.tick_store import CandleStore, TickStore, ValidationCaptureStore
try:
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
except ModuleNotFoundError:
    def safe_float(value: Any, default: float = 0.0) -> float:
        try:
            if isinstance(value, str):
                value = value.replace(",", "").strip()
            return float(value)
        except (TypeError, ValueError):
            return default

    def first_present(payload: dict, keys: List[str]) -> Any:
        for key in keys:
            if key in payload and payload.get(key) not in (None, ""):
                return payload.get(key)
        return None

    def _symbol_aliases_local(symbol: str) -> set[str]:
        upper = str(symbol or "").upper()
        aliases = {upper}
        if upper == "NIFTY":
            aliases.update({"NIFTY50", "NIFTY 50"})
        if upper == "BSESEN":
            aliases.update({"SENSEX", "BSE SENSEX"})
        return aliases

    def row_symbol(row: dict) -> str:
        value = first_present(row, [
            "stock_code",
            "stockCode",
            "stock",
            "symbol",
            "trading_symbol",
            "tradingsymbol",
            "underlying",
        ])
        return str(value or "").upper()

    def match_symbol(row: dict, symbol: str) -> bool:
        normalized = row_symbol(row)
        if not normalized:
            return True
        return normalized in _symbol_aliases_local(symbol)

    def _normalize_position_quantity_local(row: dict) -> float:
        direct = first_present(row, [
            "net_quantity",
            "net_qty",
            "netQuantity",
            "quantity",
            "open_quantity",
            "openQuantity",
        ])
        quantity = safe_float(direct)
        if quantity == 0:
            buy_qty = safe_float(first_present(row, ["buy_quantity", "buy_qty", "buyQuantity"]))
            sell_qty = safe_float(first_present(row, ["sell_quantity", "sell_qty", "sellQuantity"]))
            if buy_qty or sell_qty:
                quantity = buy_qty - sell_qty
        action = str(first_present(row, ["action", "transaction_type", "side"]) or "").lower()
        if quantity > 0 and action in {"sell", "short"} and not any(
            key in row for key in (
                "buy_quantity",
                "buy_qty",
                "sell_quantity",
                "sell_qty",
                "net_quantity",
                "net_qty",
                "netQuantity",
            )
        ):
            quantity *= -1
        return quantity

    def _normalize_position_mtm_local(row: dict, quantity: float) -> float:
        for field in ("pnl", "mtm", "m2m", "mark_to_market", "markToMarket", "total_pnl", "totalPnl"):
            if field not in row:
                continue
            value = safe_float(row.get(field))
            if value != 0:
                return value
        booked = safe_float(first_present(row, [
            "booked_pnl",
            "realized_pnl",
            "realised_pnl",
            "realized_profit_loss",
            "realised_profit_loss",
        ]))
        unrealized = safe_float(first_present(row, [
            "unrealized_profit_loss",
            "unrealised_profit_loss",
            "unrealized_pnl",
            "unrealised_pnl",
            "open_profit_loss",
            "open_mtm",
        ]))
        if booked or unrealized:
            return booked + unrealized
        avg_price = safe_float(first_present(row, [
            "average_price",
            "avg_price",
            "averagePrice",
            "cost_price",
            "costPrice",
        ]))
        ltp = safe_float(first_present(row, [
            "ltp",
            "last_traded_price",
            "last_price",
            "market_price",
            "marketPrice",
            "close_price",
        ]))
        if quantity != 0 and (avg_price > 0 or ltp > 0):
            return (ltp - avg_price) * quantity
        return 0.0

    def normalize_position_row(row: dict) -> dict:
        quantity = _normalize_position_quantity_local(row)
        realized = safe_float(first_present(row, [
            "booked_pnl",
            "realized_pnl",
            "realised_pnl",
            "realized_profit_loss",
            "realised_profit_loss",
        ]))
        unrealized = safe_float(first_present(row, [
            "unrealized_profit_loss",
            "unrealised_profit_loss",
            "unrealized_pnl",
            "unrealised_pnl",
            "open_profit_loss",
            "open_mtm",
        ]))
        return {
            "symbol": row_symbol(row),
            "quantity": quantity,
            "mtm": _normalize_position_mtm_local(row, quantity),
            "averagePrice": safe_float(first_present(row, ["average_price", "avg_price", "averagePrice", "cost_price"])),
            "ltp": safe_float(first_present(row, ["ltp", "last_traded_price", "last_price", "market_price"])),
            "realizedPnl": realized,
            "unrealizedPnl": unrealized,
            "brokerGreeks": {
                "delta": safe_float(first_present(row, ["delta", "option_delta", "greek_delta"])),
                "gamma": safe_float(first_present(row, ["gamma", "option_gamma", "greek_gamma"])),
                "theta": safe_float(first_present(row, ["theta", "option_theta", "greek_theta"])),
                "vega": safe_float(first_present(row, ["vega", "option_vega", "greek_vega"])),
            },
            "raw": row,
        }

    def extract_rule_id_hint(payload: dict) -> str:
        candidates = [
            payload.get("ruleId"),
            payload.get("rule_id"),
            payload.get("strategy_id"),
            payload.get("strategyId"),
            payload.get("client_order_id"),
            payload.get("clientOrderId"),
            payload.get("correlation_id"),
            payload.get("correlationId"),
            payload.get("tag"),
            payload.get("user_remark"),
            payload.get("userRemark"),
        ]
        for value in candidates:
            text = str(value or "")
            match = re.search(r"(rule-[A-Za-z0-9_-]+)", text)
            if match:
                return match.group(1)
            if text.startswith("rule-"):
                return text
        return ""

    def normalize_broker_results(payload: dict) -> List[dict]:
        rows = payload.get("brokerResults") or payload.get("broker_results") or payload.get("orders") or payload.get("legs") or payload.get("trades")
        if isinstance(rows, dict):
            rows = [rows]
        if not isinstance(rows, list):
            if first_present(payload, ["order_id", "orderId", "exchange_order_id", "exchangeOrderId"]):
                rows = [payload]
            else:
                return []
        results: List[dict] = []
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            raw_status = str(first_present(row, ["status", "order_status", "orderStatus", "execution_status", "executionStatus"]) or "").lower()
            success = raw_status in {"success", "ok", "complete", "completed", "executed", "filled", "traded"}
            if not raw_status:
                success = not bool(first_present(row, ["error", "error_message", "reason", "reject_reason"]))
            results.append({
                "leg_index": int(safe_float(first_present(row, ["leg_index", "legIndex"]) or index)),
                "success": success,
                "order_id": str(first_present(row, ["order_id", "orderId", "exchange_order_id", "exchangeOrderId"]) or ""),
                "error": str(first_present(row, ["error", "error_message", "errorMessage", "reason", "reject_reason"]) or ""),
            })
        return results

    def is_icici_order_update_payload(payload: dict) -> bool:
        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        if not isinstance(data, dict):
            return False
        return (
            isinstance(data.get("orders"), list)
            and any(key in data for key in ("order_status", "status_message", "strategy_id", "strategy_name", "stock_code"))
        )

    def normalize_callback_payload(payload: dict, source: str, normalized_at: float | None = None) -> Dict[str, Any]:
        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        if is_icici_order_update_payload(payload):
            broker_status_raw = str(data.get("order_status") or "").lower()
            if broker_status_raw in {"rejected", "failed", "cancelled", "canceled", "error"}:
                status = "error"
                event_type = "failed"
            elif broker_status_raw in {"complete", "completed", "executed", "filled", "traded"}:
                status = "success"
                event_type = "executed"
            else:
                status = "info"
                event_type = "webhook" if source == "webhook" else "manual"
            message = str(data.get("status_message") or "")
            if not message:
                message = f"Broker callback status: {broker_status_raw}." if broker_status_raw else "Broker webhook received."
            return {
                "ruleId": extract_rule_id_hint(data),
                "ruleName": str(data.get("strategy_name") or ""),
                "kind": str(data.get("kind") or "alert"),
                "eventType": event_type,
                "status": status,
                "message": message,
                "brokerResults": normalize_broker_results({"orders": data.get("orders") or []}),
                "meta": {
                    "source": source,
                    "brokerStatus": broker_status_raw,
                    "normalizedAt": normalized_at if normalized_at is not None else time.time(),
                    "payload": payload,
                    "normalizer": "embedded_icici_order_update",
                },
            }

        event_type = str(first_present(data, ["callback_type", "callbackType", "event", "event_type", "eventType", "status"]) or ("webhook" if source == "webhook" else "manual")).lower()
        status = str(first_present(data, ["status", "execution_status", "executionStatus", "order_status", "orderStatus"]) or "info").lower()
        if status not in {"success", "warning", "error", "info"}:
            if status in {"complete", "completed", "executed", "filled", "traded"}:
                status = "success"
            elif status in {"rejected", "failed", "cancelled", "canceled", "error"}:
                status = "error"
            else:
                status = "info"
        return {
            "ruleId": extract_rule_id_hint(data),
            "ruleName": str(first_present(data, ["ruleName", "rule_name", "strategy_name", "name"]) or ""),
            "kind": str(first_present(data, ["kind", "rule_kind", "ruleKind"]) or "alert"),
            "eventType": event_type,
            "status": status,
            "message": str(first_present(data, ["message", "status_message", "remarks", "reason"]) or "Automation callback received."),
            "brokerResults": normalize_broker_results(data),
            "meta": {
                "source": source,
                "normalizedAt": normalized_at if normalized_at is not None else time.time(),
                "payload": payload,
                "normalizer": "embedded_generic_callback",
            },
        }

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("BreezeEngine")

# ── Install dependencies ────────────────────────────────────────────────────────
print("Installing packages...")
PKGS = ["breeze-connect", "fastapi", "uvicorn[standard]", "websockets", "python-multipart"]
for pkg in PKGS:
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", pkg, "-q"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
print("Packages ready")

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
import uvicorn


# ═══════════════════════════════════════════════════════════════════════════════
# RateLimiter
# Token-bucket: max 100 REST calls/min = 1 per 600ms
# All Breeze REST calls must go through enqueue()
# ═══════════════════════════════════════════════════════════════════════════════

class RateLimiter:
    MIN_INTERVAL_MS = 600
    MAX_QUEUE_SIZE  = 50

    def __init__(self):
        self._queue      = queue.Queue(maxsize=self.MAX_QUEUE_SIZE)
        self._last_call  = 0.0
        self._call_times = deque(maxlen=100)
        self._worker     = threading.Thread(target=self._process, daemon=True)
        self._worker.start()
        log.info("[RateLimiter] started — 1 call per 600ms max")

    def enqueue(self, fn: Callable, *args, **kwargs) -> Any:
        result_box = {"result": None, "error": None}
        done = threading.Event()

        def task():
            try:
                result_box["result"] = fn(*args, **kwargs)
            except Exception as exc:
                result_box["error"] = exc
            finally:
                done.set()

        try:
            self._queue.put_nowait(task)
        except queue.Full:
            try:
                self._queue.get_nowait()
            except queue.Empty:
                pass
            self._queue.put_nowait(task)

        done.wait(timeout=45)
        if result_box["error"]:
            raise result_box["error"]
        return result_box["result"]

    def _process(self):
        while True:
            try:
                task = self._queue.get(timeout=1)
            except queue.Empty:
                continue
            now = time.monotonic()
            elapsed_ms = (now - self._last_call) * 1000
            if elapsed_ms < self.MIN_INTERVAL_MS:
                time.sleep((self.MIN_INTERVAL_MS - elapsed_ms) / 1000)
            self._last_call = time.monotonic()
            self._call_times.append(time.time())
            task()

    @property
    def calls_last_minute(self) -> int:
        cutoff = time.time() - 60
        return sum(1 for t in self._call_times if t > cutoff)

    @property
    def queue_depth(self) -> int:
        return self._queue.qsize()


def _safe_float(value, default=0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


# ═══════════════════════════════════════════════════════════════════════════════
# BreezeEngine
# ═══════════════════════════════════════════════════════════════════════════════

class BreezeEngine:
    def __init__(self):
        self.log          = log
        self.breeze       = None
        self.broker_client = None
        self.session_key  = ""
        self.api_key      = ""
        self.api_secret   = ""
        self.connected    = False
        self.ws_running   = False
        self.subscribed   = set()
        self.rate_limiter = RateLimiter()
        self.broker_client = BreezeBrokerClient(self.rate_limiter)
        self.tick_store   = TickStore()
        self.candle_store = CandleStore()
        self.validation_capture = ValidationCaptureStore(
            os.environ.get(
                "BREEZE_VALIDATION_CAPTURE_FILE",
                os.path.join(os.getcwd(), "logs", "breeze_execution_validation.jsonl"),
            )
        )
        self.automation_rules = AutomationRuleManager(
            self,
            os.environ.get(
                "BREEZE_AUTOMATION_RULE_FILE",
                os.path.join(os.getcwd(), "logs", "automation_rules.json"),
            ),
        )
        self.seller_reviews = SellerReviewManager(
            os.environ.get(
                "BREEZE_SELLER_REVIEW_FILE",
                os.path.join(os.getcwd(), "logs", "seller_reviews.json"),
            ),
        )
        self.market_data_service = MarketDataService(self)
        self.execution_workflow = ExecutionWorkflow(self)
        self.realtime_manager = RealtimeManager(self)
        self._ws_thread   = None
        self._ws_lock     = threading.Lock()
        log.info("[BreezeEngine] initialised")

    # ── Authentication ────────────────────────────────────────────────────────

    def connect(self, api_key: str, api_secret: str, session_token: str) -> dict:
        self.api_key    = api_key
        self.api_secret = api_secret
        log.info(f"[Engine] connect — key:{api_key[:8]}... token:{session_token[:8]}...")
        b = self.broker_client.connect(api_key=api_key, api_secret=api_secret, session_token=session_token)
        self.breeze      = b
        self.session_key = b.session_key
        self.connected   = True
        self.tick_store.clear()
        self.candle_store.clear()
        log.info(f"[Engine] connected — session:{self.session_key[:12]}...")

        user_info = {}
        try:
            det = self.broker_client.get_customer_details()
            if isinstance(det, dict) and det.get("Success"):
                s = det["Success"]
                user_info = {
                    "name":  s.get("name", ""),
                    "email": s.get("email", ""),
                }
        except Exception as exc:
            log.warning(f"[Engine] get_customer_details: {exc}")

        return {
            "success":       True,
            "session_token": self.session_key,
            "message":       "Connected via BreezeEngine v7",
            **user_info,
        }

    def disconnect(self) -> None:
        self._stop_ws()
        self.breeze      = None
        if self.broker_client:
            self.broker_client.set_sdk(None)
        self.session_key = ""
        self.connected   = False
        self.subscribed.clear()
        self.tick_store.clear()
        self.candle_store.clear()
        log.info("[Engine] disconnected")

    # ── Checksum ──────────────────────────────────────────────────────────────

    @staticmethod
    def generate_checksum(timestamp: str, payload: dict, secret: str) -> str:
        body_str = json.dumps(payload)
        return hashlib.sha256((timestamp + body_str + secret).encode("utf-8")).hexdigest()

    # ── Expiry utilities ──────────────────────────────────────────────────────

    @staticmethod
    def get_weekly_expiries(stock_code: str, count: int = 5) -> List[dict]:
        is_sensex  = "SENSEX" in stock_code.upper() or "BSESEN" in stock_code.upper()
        target_day = 3 if is_sensex else 1
        today      = datetime.now().date()
        results    = []
        for i in range(60):
            d = today + timedelta(days=i)
            if d.weekday() == target_day:
                if i == 0 and datetime.utcnow().hour >= 10:
                    continue
                results.append({
                    "date":      d.strftime("%d-%b-%Y"),
                    "label":     d.strftime("%d %b %y"),
                    "days_away": (d - today).days,
                    "weekday":   d.strftime("%A"),
                    "timestamp": d.isoformat(),
                })
                if len(results) >= count:
                    break
        return results

    # ── REST: Option Chain ────────────────────────────────────────────────────

    def fetch_option_chain(
        self,
        stock_code: str,
        exchange_code: str,
        expiry_date: str,
        right: str = "Call",
        strike_price: str = "",
    ) -> List[dict]:
        return self.market_data_service.fetch_option_chain(stock_code, exchange_code, expiry_date, right, strike_price)

    # ── REST: Single Quote ────────────────────────────────────────────────────

    def get_quote(
        self,
        stock_code: str,
        exchange_code: str,
        expiry_date: str,
        right: str,
        strike_price: str,
    ) -> dict:
        return self.market_data_service.get_quote(stock_code, exchange_code, expiry_date, right, strike_price)

    # ── REST: Orders ──────────────────────────────────────────────────────────

    def place_order(self, leg: dict) -> dict:
        if not self.connected:
            raise RuntimeError("Not connected")

        right_norm = "Call" if (leg.get("right") or "call").lower().startswith("c") else "Put"

        return self.broker_client.place_order(
            stock_code=leg["stock_code"],
            exchange_code=leg.get("exchange_code", "NFO"),
            product=leg.get("product", "options"),
            action=leg.get("action", "buy").lower(),
            order_type=leg.get("order_type", "market"),
            stoploss=str(leg.get("stoploss", "0")),
            quantity=str(leg["quantity"]),
            price=str(leg.get("price", "0")),
            validity="day",
            validity_date=leg["expiry_date"],
            disclosed_quantity="0",
            expiry_date=leg["expiry_date"],
            right=right_norm,
            strike_price=str(leg["strike_price"]),
            user_remark=leg.get("user_remark", "OptionsTerminalV7"),
        )

    def place_strategy_order(self, legs: List[dict]) -> List[dict]:
        return self.execution_workflow.place_strategy_order(legs)

    def square_off_position(self, leg: dict) -> dict:
        return self.execution_workflow.square_off_position(leg)

    def cancel_order(self, order_id: str, exchange_code: str = "NFO") -> dict:
        if not self.connected:
            raise RuntimeError("Not connected")

        return self.broker_client.cancel_order(exchange_code=exchange_code, order_id=order_id)

    def modify_order(
        self,
        order_id: str,
        exchange_code: str,
        quantity: str,
        price: str,
        stoploss: str = "0",
        validity: str = "day",
    ) -> dict:
        if not self.connected:
            raise RuntimeError("Not connected")

        return self.broker_client.modify_order(
            exchange_code=exchange_code,
            order_id=order_id,
            quantity=quantity,
            price=price,
            stoploss=stoploss,
            validity=validity,
        )

    # ── REST: Books & Portfolio ───────────────────────────────────────────────

    def get_order_book(self) -> dict:
        if not self.connected:
            raise RuntimeError("Not connected")
        now = datetime.now()
        return self.broker_client.get_order_list(
            exchange_code="NFO",
            from_date=now.strftime("%Y-%m-%dT00:00:00.000Z"),
            to_date=now.strftime("%Y-%m-%dT23:59:59.000Z"),
        )

    def get_trade_book(self) -> dict:
        if not self.connected:
            raise RuntimeError("Not connected")
        now = datetime.now()
        return self.broker_client.get_trade_list(
            exchange_code="NFO",
            from_date=now.strftime("%Y-%m-%dT00:00:00.000Z"),
            to_date=now.strftime("%Y-%m-%dT23:59:59.000Z"),
        )

    def get_positions(self) -> dict:
        if not self.connected:
            raise RuntimeError("Not connected")
        pos = self.broker_client.get_portfolio_positions()
        hld = self.broker_client.get_portfolio_holdings()
        rows = pos.get("Success", []) if isinstance(pos, dict) else []
        return {
            "positions": rows,
            "normalized_positions": [self._normalise_position_snapshot(row) for row in rows if isinstance(row, dict)],
            "holdings":  hld.get("Success", []) if isinstance(hld, dict) else [],
        }

    def _normalise_position_snapshot(self, row: dict) -> dict:
        normalized = self._normalise_position_row(row)
        average_price = _safe_float(normalized.get("averagePrice"))
        ltp = _safe_float(normalized.get("ltp"))
        quantity = _safe_float(normalized.get("quantity"))
        realized = _safe_float(normalized.get("realizedPnl"))
        unrealized = _safe_float(normalized.get("unrealizedPnl"))
        if unrealized == 0 and quantity and (average_price or ltp):
            unrealized = (ltp - average_price) * quantity
        return {
            **row,
            "normalized_symbol": normalized.get("symbol"),
            "normalized_quantity": quantity,
            "normalized_mtm": _safe_float(normalized.get("mtm")),
            "normalized_average_price": average_price,
            "normalized_ltp": ltp,
            "normalized_realized_pnl": realized,
            "normalized_unrealized_pnl": unrealized,
            "broker_greeks": normalized.get("brokerGreeks", {}),
        }

    def get_funds(self) -> dict:
        if not self.connected:
            raise RuntimeError("Not connected")
        result = self.broker_client.get_funds()
        return result.get("Success", {}) if isinstance(result, dict) else {}

    def _normalise_execution_leg(self, leg: dict) -> dict:
        return self.execution_workflow.normalise_execution_leg(leg)

    def _extract_success_payload(self, result: dict) -> dict:
        return self.execution_workflow.extract_success_payload(result)

    def _collect_field_names(self, payload: Any) -> List[str]:
        return self.execution_workflow.collect_field_names(payload)

    def _record_execution_validation(self, kind: str, legs: List[dict], raw_response: Any, payload: Any) -> dict:
        return self.execution_workflow.record_execution_validation(kind, legs, raw_response, payload)

    def _build_margin_position(self, leg: dict) -> dict:
        return self.execution_workflow.build_margin_position(leg)

    def _sum_known_charge_fields(self, payload: dict) -> tuple[float, float, Dict[str, float], Dict[str, Any]]:
        return self.execution_workflow.sum_known_charge_fields(payload)

    def calculate_margin(self, legs: List[dict]) -> dict:
        return self.execution_workflow.calculate_margin(legs)

    def preview_strategy(self, legs: List[dict]) -> dict:
        return self.execution_workflow.preview_strategy(legs)

    @staticmethod
    def _inventory_key(leg: dict) -> tuple:
        return self.execution_workflow.inventory_key(leg)

    def _apply_repair_legs(self, current_legs: List[dict], repair_legs: List[dict]) -> List[dict]:
        return self.execution_workflow.apply_repair_legs(current_legs, repair_legs)

    def repair_preview(self, current_legs: List[dict], repair_legs: List[dict], meta: Optional[dict] = None) -> dict:
        return self.execution_workflow.repair_preview(current_legs, repair_legs, meta)

    # ── REST: Historical OHLCV ────────────────────────────────────────────────

    def get_historical(
        self,
        stock_code: str,
        exchange_code: str,
        interval: str,
        from_date: str,
        to_date: str,
        expiry_date: str = "",
        right: str = "",
        strike_price: str = "",
    ) -> List[dict]:
        return self.market_data_service.get_historical(stock_code, exchange_code, interval, from_date, to_date, expiry_date, right, strike_price)

    def get_market_depth(
        self,
        stock_code: str,
        exchange_code: str,
        expiry_date: str,
        right: str,
        strike_price: str,
    ) -> dict:
        return self.market_data_service.get_market_depth(stock_code, exchange_code, expiry_date, right, strike_price)

    # ── WebSocket ─────────────────────────────────────────────────────────────

    def _on_ticks(self, ticks) -> None:
        self.realtime_manager.on_ticks(ticks)

    def start_websocket(self) -> None:
        self.realtime_manager.start_websocket()

    def _stop_ws(self) -> None:
        self.realtime_manager.stop_websocket()

    def subscribe_option_chain(
        self,
        stock_code: str,
        exchange_code: str,
        expiry_date: str,
        strikes: List[int],
        rights: List[str] = None,
    ) -> dict:
        return self.realtime_manager.subscribe_option_chain(stock_code, exchange_code, expiry_date, strikes, rights)

    def unsubscribe_all(self) -> None:
        self.realtime_manager.unsubscribe_all()


# ── Singleton ──────────────────────────────────────────────────────────────────
engine = BreezeEngine()

# ── Auth configuration ────────────────────────────────────────────────────────
# Auth is OPTIONAL. If TERMINAL_AUTH_TOKEN env var is set → enforced.
# Default (no env var) → open, tunnel URL is the only "secret".
BACKEND_AUTH_TOKEN = os.environ.get("TERMINAL_AUTH_TOKEN", "")
AUTH_ENABLED       = bool(BACKEND_AUTH_TOKEN)
AUTOMATION_WEBHOOK_SECRET = os.environ.get("BREEZE_AUTOMATION_WEBHOOK_SECRET", "")


# ═══════════════════════════════════════════════════════════════════════════════
# FastAPI Application
# ═══════════════════════════════════════════════════════════════════════════════

app = create_app(
    BackendState(
        engine=engine,
        auth_enabled=AUTH_ENABLED,
        backend_auth_token=BACKEND_AUTH_TOKEN,
        automation_webhook_secret=AUTOMATION_WEBHOOK_SECRET,
        version="7.0",
    ),
    include_routers=True,
)

runtime_app = app


# ═══════════════════════════════════════════════════════════════════════════════
# Tunnel Providers
# ═══════════════════════════════════════════════════════════════════════════════

def start_uvicorn_thread():
    t = threading.Thread(
        target=lambda: uvicorn.run(runtime_app, host="0.0.0.0", port=8000, log_level="warning"),
        daemon=True,
        name="uvicorn",
    )
    t.start()
    return t


def wait_for_port(port: int = 8000, timeout: int = 15) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False


def try_localhost_run() -> Optional[str]:
    if not shutil.which("ssh"):
        return None
    try:
        log_path = "/tmp/lhr.log"
        open(log_path, "w").close()
        subprocess.Popen(
            ["ssh", "-R", "80:localhost:8000",
             "-o", "StrictHostKeyChecking=no",
             "-o", "ServerAliveInterval=30",
             "-o", "ConnectTimeout=15",
             "nokey@localhost.run"],
            stdout=open(log_path, "a"), stderr=subprocess.STDOUT,
        )
        pat      = re.compile(r"https://[a-z0-9\-]+\.lhr\.life")
        deadline = time.time() + 40
        while time.time() < deadline:
            time.sleep(2)
            try:
                m = pat.search(open(log_path).read())
                if m:
                    return m.group(0)
            except Exception:
                pass
    except Exception:
        pass
    return None


def try_serveo() -> Optional[str]:
    if not shutil.which("ssh"):
        return None
    try:
        log_path = "/tmp/serveo.log"
        open(log_path, "w").close()
        subprocess.Popen(
            ["ssh", "-R", "80:localhost:8000",
             "-o", "StrictHostKeyChecking=no",
             "-o", "ServerAliveInterval=30",
             "-o", "ConnectTimeout=15",
             "serveo.net"],
            stdout=open(log_path, "a"), stderr=subprocess.STDOUT,
        )
        pat      = re.compile(r"https://[a-z0-9]+\.serveo\.net")
        deadline = time.time() + 40
        while time.time() < deadline:
            time.sleep(2)
            try:
                m = pat.search(open(log_path).read())
                if m:
                    return m.group(0)
            except Exception:
                pass
    except Exception:
        pass
    return None


def try_cloudflare() -> Optional[str]:
    cf = "/tmp/cloudflared"
    if not os.path.exists(cf):
        try:
            print("  Downloading cloudflared...")
            urllib.request.urlretrieve(
                "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
                cf,
            )
            os.chmod(cf, stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP)
            print("  cloudflared ready")
        except Exception as exc:
            print(f"  cloudflared download failed: {exc}")
            return None

    log_path = "/tmp/cf.log"
    open(log_path, "w").close()
    try:
        subprocess.Popen(
            [cf, "tunnel", "--url", "http://localhost:8000", "--no-autoupdate"],
            stdout=open(log_path, "a"), stderr=subprocess.STDOUT,
        )
        pat      = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
        deadline = time.time() + 90
        while time.time() < deadline:
            time.sleep(3)
            try:
                urls = pat.findall(open(log_path).read())
                if urls:
                    return urls[-1]
            except Exception:
                pass
    except Exception as exc:
        print(f"  Cloudflare error: {exc}")
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    # FIX: SEP defined at the top of main() so all print() calls below can use it
    SEP = "=" * 68

    print(f"\n{SEP}")
    print("  ICICI BREEZE BACKEND v7 — BreezeEngine")
    print(SEP)
    print()

    if AUTH_ENABLED:
        print("  ⚠️  AUTH ENABLED — X-Terminal-Auth header required")
        print(f"  Token: {BACKEND_AUTH_TOKEN}")
        print()
    else:
        print("  🔓 Auth DISABLED (default) — set TERMINAL_AUTH_TOKEN env var to enable")
        print()

    print("  Endpoints:")
    print("    POST  /api/connect          authenticate (generate_session)")
    print("    GET   /api/expiries         weekly expiry dates")
    print("    GET   /api/optionchain      snapshot — call ONCE per expiry")
    print("    POST  /api/ws/subscribe     subscribe Breeze WS feeds")
    print("    WS    /ws/ticks             live tick stream to frontend")
    print("    POST  /api/strategy/execute multi-leg concurrent order")
    print("    POST  /api/preview          broker-native preview aggregation")
    print("    POST  /api/margin           broker-native margin aggregation")
    print("    GET   /api/diagnostics/execution-validation recent preview/margin captures")
    print("    POST  /api/squareoff        exit / square-off a position")
    print("    POST  /api/order/cancel     cancel pending order")
    print("    PATCH /api/order/modify     modify order price/qty")
    print("    GET   /api/orders           order book (today)")
    print("    GET   /api/trades           trade book (today)")
    print("    GET   /api/positions        portfolio positions + holdings")
    print("    GET   /api/funds            available margin / funds")
    print("    GET   /api/historical       OHLCV candle data")
    print("    GET   /api/ratelimit        rate limiter status")
    print("    GET   /health  /ping  /     health check")
    print()

    print("Starting FastAPI on port 8000...")
    start_uvicorn_thread()
    if wait_for_port(8000, 15):
        print("FastAPI running ✓\n")
    else:
        print("WARNING: FastAPI may not have started — check for port conflicts\n")

    print("Finding public tunnel (3 providers tried in order)...\n")
    public_url = None

    for fn, name in [
        (try_localhost_run, "localhost.run (SSH — no interstitial)"),
        (try_serveo,        "serveo.net    (SSH — no interstitial)"),
        (try_cloudflare,    "Cloudflare    (has browser interstitial)"),
    ]:
        print(f"  Trying {name}...")
        url = fn()
        if url:
            public_url = url
            print(f"  ✓ {url}\n")
            break
        print("  ✗ unavailable, trying next...\n")

    print(SEP)

    if public_url:
        is_cf = "trycloudflare" in public_url
        print("  ✅  BACKEND IS LIVE!")
        print(SEP)
        print()
        print(f"  URL ▶  {public_url}")
        print()
        print("  ─" * 34)
        print("  COPY THIS → paste into Arena → Connect Broker field")
        print(f"  {public_url}")
        print("  ─" * 34)
        print()
        print(f"  Health:    {public_url}/health")
        print(f"  WS Ticks:  {public_url.replace('https', 'wss')}/ws/ticks")
        print(f"  Connect:   {public_url}/api/connect  (POST)")

        if is_cf:
            print()
            print("  ⚠️  Cloudflare URL — if Arena shows 'Failed to fetch':")
            print(f"       1. Open in a NEW browser tab:  {public_url}/health")
            print('       2. Wait for {\"status\":\"online\"}')
            print("       3. Close tab → retry in Arena")
    else:
        print("  ❌  No public tunnel found.")
        print("      Make sure Kaggle Internet is ON (Settings → Internet → ON)")
        print("      Then re-run this cell.")

    print()
    print(SEP)
    print()
    print("  Steps:")
    print("  1. Copy URL above")
    print("  2. Arena → Connect Broker → paste URL")
    print("  3. Enter API Key, API Secret, today's Session Token")
    print("  4. Click Validate Live → should show 'Connected via BreezeEngine v7'")
    print()
    print("  Daily Session Token:")
    print("    https://api.icicidirect.com/apiuser/login?api_key=YOUR_KEY")
    print("    Login → copy ?apisession=XXXXX from the redirect URL")
    print()
    print(SEP)
    print()
    print("  Backend running. Keep this cell alive.")
    print("  Press the Kaggle ■ Stop button to quit.\n")

    try:
        beat = 0
        while True:
            time.sleep(30)
            beat += 1
            if beat % 2 == 0:   # heartbeat every 60s
                ts = datetime.utcnow().strftime("%H:%M:%S")
                print(
                    f"  [{ts} UTC]"
                    f"  connected={engine.connected}"
                    f"  ws={engine.ws_running}"
                    f"  subs={len(engine.subscribed)}"
                    f"  REST/min={engine.rate_limiter.calls_last_minute}"
                    f"  ticks={engine.tick_store.get_version()}"
                )
    except KeyboardInterrupt:
        print("\nShutting down...")
        engine.disconnect()


main()
