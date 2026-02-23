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
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List, Callable
from collections import deque
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("BreezeEngine")
BACKEND_PORT = int(os.environ.get("BREEZE_PORT", "8000"))

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


# ═══════════════════════════════════════════════════════════════════════════════
# TickStore
# Thread-safe store updated by WebSocket on_ticks callback
# Versioned so frontend only gets payloads when data actually changes
# ═══════════════════════════════════════════════════════════════════════════════

class TickStore:
    def __init__(self):
        self._ticks   = {}
        self._lock    = threading.Lock()
        self._version = 0

    def update(self, key: str, data: dict) -> None:
        with self._lock:
            existing = self._ticks.get(key, {})
            existing.update(data)
            existing["_ts"] = time.time()
            self._ticks[key] = existing
            self._version += 1

    def get_all(self) -> dict:
        with self._lock:
            return {"ticks": dict(self._ticks), "version": self._version}

    def get_version(self) -> int:
        with self._lock:
            return self._version

    def clear(self) -> None:
        with self._lock:
            self._ticks.clear()
            self._version = 0

    def to_option_chain_delta(self) -> List[dict]:
        with self._lock:
            rows = []
            for key, tick in self._ticks.items():
                parts = key.split(":")
                if len(parts) < 3:
                    continue
                stock, strike_str, right = parts[0], parts[1], parts[2]
                try:
                    strike = int(float(strike_str))
                except Exception:
                    continue
                rows.append({
                    "stock_code":   stock,
                    "strike":       strike,
                    "right":        right,
                    "ltp":          tick.get("ltp", 0),
                    "oi":           tick.get("oi", 0),
                    "volume":       tick.get("volume", 0),
                    "iv":           tick.get("iv", 0),
                    "bid":          tick.get("bid", 0),
                    "ask":          tick.get("ask", 0),
                    "change_pct":   tick.get("change_pct", 0),
                    "last_updated": tick.get("_ts", 0),
                })
            return rows


# ═══════════════════════════════════════════════════════════════════════════════
# BreezeEngine
# Wraps the official breeze-connect SDK with:
#   - session management
#   - REST rate limiting
#   - WebSocket streaming + TickStore
#   - order management (place, cancel, modify, square-off)
#   - portfolio: positions, holdings, funds, orders, trades
# ═══════════════════════════════════════════════════════════════════════════════

class BreezeEngine:
    def __init__(self):
        self.breeze       = None
        self.session_key  = ""
        self.api_key      = ""
        self.api_secret   = ""
        self.connected    = False
        self.ws_running   = False
        self.subscribed   = set()
        self.rate_limiter = RateLimiter()
        self.tick_store   = TickStore()
        self._ws_thread   = None
        self._ws_lock     = threading.Lock()
        log.info("[BreezeEngine] initialised")

    # ── Authentication ────────────────────────────────────────────────────────

    def connect(self, api_key: str, api_secret: str, session_token: str) -> dict:
        from breeze_connect import BreezeConnect
        self.api_key    = api_key
        self.api_secret = api_secret
        log.info(f"[Engine] connect — key:{api_key[:8]}... token:{session_token[:8]}...")
        b = BreezeConnect(api_key=api_key)
        # Official SDK handles /customerdetails with correct checksum internally
        b.generate_session(api_secret=api_secret, session_token=session_token)
        self.breeze      = b
        self.session_key = b.session_key
        self.connected   = True
        self.tick_store.clear()
        log.info(f"[Engine] connected — session:{self.session_key[:12]}...")

        user_info = {}
        try:
            det = b.get_customer_details()
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
        self.breeze = None
        self.session_key = ""
        self.connected = False
        self.subscribed.clear()
        self.tick_store.clear()
        log.info("[Engine] disconnected")

    # ── Checksum utility ──────────────────────────────────────────────────────

    @staticmethod
    def generate_checksum(timestamp: str, payload: dict, secret: str) -> str:
        """SHA256(timestamp + json.dumps(payload) + secret) — matches SDK exactly."""
        body_str = json.dumps(payload)
        return hashlib.sha256((timestamp + body_str + secret).encode("utf-8")).hexdigest()

    # ── Expiry utilities ──────────────────────────────────────────────────────

    @staticmethod
    def get_weekly_expiries(stock_code: str, count: int = 5) -> List[dict]:
        """
        NIFTY  → Tuesday  (weekday 1, 0=Mon … 6=Sun)
        SENSEX → Thursday (weekday 3)
        """
        is_sensex  = "SENSEX" in stock_code.upper() or "BSESEN" in stock_code.upper()
        target_day = 3 if is_sensex else 1   # Thu or Tue
        today      = datetime.now().date()
        results    = []
        for i in range(60):
            d = today + timedelta(days=i)
            if d.weekday() == target_day:
                # Skip today if market already closed (10:00 UTC ≈ 15:30 IST)
                if i == 0 and datetime.now(timezone.utc).hour >= 10:
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
    # Called ONCE per expiry change — NEVER in any loop

    def fetch_option_chain(
        self,
        stock_code: str,
        exchange_code: str,
        expiry_date: str,
        right: str = "Call",
        strike_price: str = "",
    ) -> List[dict]:
        if not self.connected:
            raise RuntimeError("Not connected")

        right_norm = "Call" if right.lower().startswith("c") else "Put"
        log.info(f"[REST] get_option_chain_quotes {stock_code} {expiry_date} {right_norm}")

        def _call():
            return self.breeze.get_option_chain_quotes(
                stock_code=stock_code,
                exchange_code=exchange_code,
                product_type="options",
                expiry_date=expiry_date,
                right=right_norm,
                strike_price=strike_price,
            )

        result = self.rate_limiter.enqueue(_call)
        rows   = result.get("Success") if isinstance(result, dict) else []

        # Seed TickStore with REST snapshot → UI loads instantly
        if rows:
            suffix = "CE" if right_norm == "Call" else "PE"
            for row in rows:
                try:
                    strike = str(int(float(
                        row.get("strike_price") or
                        row.get("strike-price") or 0
                    )))
                    key = f"{stock_code}:{strike}:{suffix}"
                    self.tick_store.update(key, {
                        "ltp":    float(row.get("ltp")             or row.get("last_traded_price")    or 0),
                        "oi":     float(row.get("open_interest")   or row.get("open-interest")        or 0),
                        "volume": float(row.get("total_quantity_traded") or row.get("total-quantity-traded") or 0),
                        "iv":     float(row.get("implied_volatility") or row.get("implied-volatility") or 0),
                        "bid":    float(row.get("best_bid_price")  or row.get("best-bid-price")       or 0),
                        "ask":    float(row.get("best_offer_price") or row.get("best-offer-price")    or 0),
                    })
                except Exception as exc:
                    log.debug(f"seed tick error: {exc}")

        return rows or []

    # ── REST: Single Quote ────────────────────────────────────────────────────

    def get_quote(
        self,
        stock_code: str,
        exchange_code: str,
        expiry_date: str,
        right: str,
        strike_price: str,
    ) -> dict:
        if not self.connected:
            raise RuntimeError("Not connected")

        def _call():
            return self.breeze.get_quotes(
                stock_code=stock_code,
                exchange_code=exchange_code,
                expiry_date=expiry_date,
                right=right,
                strike_price=strike_price,
                product_type="options",
            )

        return self.rate_limiter.enqueue(_call)

    # ── REST: Order Management ────────────────────────────────────────────────

    def place_order(self, leg: dict) -> dict:
        if not self.connected:
            raise RuntimeError("Not connected")

        right_norm = "Call" if (leg.get("right") or "call").lower().startswith("c") else "Put"

        def _call():
            return self.breeze.place_order(
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

        return self.rate_limiter.enqueue(_call)

    def place_strategy_order(self, legs: List[dict]) -> List[dict]:
        """Place multiple legs concurrently — RateLimiter serialises API calls."""
        if not self.connected:
            raise RuntimeError("Not connected")

        results      = []
        threads      = []
        results_lock = threading.Lock()

        def place_one(leg: dict, idx: int):
            try:
                r  = self.place_order(leg)
                ok = isinstance(r, dict) and r.get("Status") == 200
                oid = (r.get("Success") or {}).get("order_id", "") if ok else ""
                with results_lock:
                    results.append({
                        "leg_index": idx,
                        "success":   ok,
                        "order_id":  oid,
                        "error":     r.get("Error", "") if not ok else "",
                        "raw":       r,
                    })
            except Exception as exc:
                with results_lock:
                    results.append({"leg_index": idx, "success": False, "error": str(exc)})

        for i, leg in enumerate(legs):
            t = threading.Thread(target=place_one, args=(leg, i), daemon=True)
            threads.append(t)
            t.start()

        for t in threads:
            t.join(timeout=60)

        results.sort(key=lambda x: x["leg_index"])
        return results

    def square_off_position(self, leg: dict) -> dict:
        """Exit a position by placing the opposite action."""
        original = (leg.get("action") or "buy").lower()
        exit_leg = {**leg, "action": "sell" if original == "buy" else "buy",
                    "user_remark": "SquareOff_OptionsTerminal"}
        return self.place_order(exit_leg)

    def cancel_order(self, order_id: str, exchange_code: str = "NFO") -> dict:
        if not self.connected:
            raise RuntimeError("Not connected")

        def _call():
            return self.breeze.cancel_order(
                exchange_code=exchange_code,
                order_id=order_id,
            )

        return self.rate_limiter.enqueue(_call)

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

        def _call():
            return self.breeze.modify_order(
                exchange_code=exchange_code,
                order_id=order_id,
                quantity=quantity,
                price=price,
                stoploss=stoploss,
                validity=validity,
            )

        return self.rate_limiter.enqueue(_call)

    # ── REST: Books ───────────────────────────────────────────────────────────

    def get_order_book(self) -> dict:
        if not self.connected:
            raise RuntimeError("Not connected")
        now = datetime.now()
        return self.rate_limiter.enqueue(
            self.breeze.get_order_list,
            exchange_code="NFO",
            from_date=now.strftime("%Y-%m-%dT00:00:00.000Z"),
            to_date=now.strftime("%Y-%m-%dT23:59:59.000Z"),
        )

    def get_trade_book(self) -> dict:
        if not self.connected:
            raise RuntimeError("Not connected")
        now = datetime.now()
        return self.rate_limiter.enqueue(
            self.breeze.get_trade_list,
            exchange_code="NFO",
            from_date=now.strftime("%Y-%m-%dT00:00:00.000Z"),
            to_date=now.strftime("%Y-%m-%dT23:59:59.000Z"),
        )

    # ── REST: Portfolio ───────────────────────────────────────────────────────

    def get_positions(self) -> dict:
        if not self.connected:
            raise RuntimeError("Not connected")
        pos = self.rate_limiter.enqueue(self.breeze.get_portfolio_positions)
        hld = self.rate_limiter.enqueue(self.breeze.get_portfolio_holdings)
        return {
            "positions": pos.get("Success", []) if isinstance(pos, dict) else [],
            "holdings":  hld.get("Success", []) if isinstance(hld, dict) else [],
        }

    def get_funds(self) -> dict:
        if not self.connected:
            raise RuntimeError("Not connected")
        result = self.rate_limiter.enqueue(self.breeze.get_funds)
        return result.get("Success", {}) if isinstance(result, dict) else {}

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
        if not self.connected:
            raise RuntimeError("Not connected")

        def _call():
            kwargs: dict = dict(
                interval=interval,
                from_date=from_date,
                to_date=to_date,
                stock_code=stock_code,
                exchange_code=exchange_code,
            )
            if expiry_date:
                kwargs["expiry_date"]  = expiry_date
                kwargs["product_type"] = "options"
            if right:
                kwargs["right"] = right
            if strike_price:
                kwargs["strike_price"] = strike_price
            return self.breeze.get_historical_data_v2(**kwargs)

        result = self.rate_limiter.enqueue(_call)
        return result.get("Success", []) if isinstance(result, dict) else []

    # ── WebSocket ─────────────────────────────────────────────────────────────

    def _on_ticks(self, ticks) -> None:
        if not ticks:
            return
        if isinstance(ticks, dict):
            ticks = [ticks]
        for tick in ticks:
            try:
                stock     = (tick.get("stock_code") or tick.get("symbol") or "").upper()
                strike    = tick.get("strike_price") or tick.get("strike") or "0"
                right_raw = (tick.get("right") or tick.get("option_type") or "CE").upper()
                right     = "CE" if right_raw.startswith("C") else "PE"
                if not stock:
                    continue
                key = f"{stock}:{strike}:{right}"
                self.tick_store.update(key, {
                    "ltp":        float(tick.get("last_traded_price") or tick.get("ltp") or 0),
                    "oi":         float(tick.get("open_interest")     or tick.get("oi")  or 0),
                    "volume":     float(tick.get("total_quantity_traded") or tick.get("volume") or 0),
                    "iv":         float(tick.get("implied_volatility") or tick.get("iv") or 0),
                    "bid":        float(tick.get("best_bid_price")    or tick.get("bid_price") or 0),
                    "ask":        float(tick.get("best_offer_price")  or tick.get("ask_price") or 0),
                    "change_pct": float(tick.get("change_percent")    or tick.get("change_pct") or 0),
                    "feed_time":  str(tick.get("exchange_feed_time")  or ""),
                })
                log.debug(f"[WS tick] {key} ltp={tick.get('last_traded_price', 0)}")
            except Exception as exc:
                log.warning(f"[WS] parse error: {exc}")

    def start_websocket(self) -> None:
        if not self.connected:
            raise RuntimeError("Not connected")
        with self._ws_lock:
            if self._ws_thread and self._ws_thread.is_alive():
                log.info("[WS] already running")
                return

            def _run():
                try:
                    self.breeze.on_ticks = self._on_ticks
                    self.breeze.ws_connect()
                    self.ws_running = True
                    log.info("[WS] ws_connect() established")
                except Exception as exc:
                    log.error(f"[WS] ws_connect() failed: {exc}")
                    self.ws_running = False

            self._ws_thread = threading.Thread(target=_run, daemon=True, name="BreezeWS")
            self._ws_thread.start()
            # Wait up to 15s for WS to establish
            deadline = time.time() + 15
            while not self.ws_running and time.time() < deadline:
                time.sleep(0.5)

    def _stop_ws(self) -> None:
        if self.breeze and self.ws_running:
            try:
                self.breeze.ws_disconnect()
            except Exception:
                pass
        self.ws_running = False
        self.subscribed.clear()

    def subscribe_option_chain(
        self,
        stock_code: str,
        exchange_code: str,
        expiry_date: str,
        strikes: List[int],
        rights: List[str] = None,
    ) -> dict:
        if rights is None:
            rights = ["Call", "Put"]
        if not self.ws_running:
            self.start_websocket()
            time.sleep(2)

        count  = 0
        errors = []

        for strike in strikes:
            for right in rights:
                right_norm = "Call" if right.lower().startswith("c") else "Put"
                sub_key    = f"{stock_code}:{strike}:{right_norm[0]}E:{expiry_date}"
                if sub_key in self.subscribed:
                    continue
                try:
                    self.breeze.subscribe_feeds(
                        stock_code=stock_code,
                        exchange_code=exchange_code,
                        product_type="options",
                        expiry_date=expiry_date,
                        strike_price=str(strike),
                        right=right_norm,
                        get_exchange_quotes=True,
                        get_market_depth=False,
                    )
                    self.subscribed.add(sub_key)
                    count += 1
                    time.sleep(0.05)
                except Exception as exc:
                    errors.append(f"{sub_key}: {exc}")

        return {
            "subscribed":  count,
            "total_subs":  len(self.subscribed),
            "errors":      errors,
        }

    def unsubscribe_all(self) -> None:
        if not self.ws_running or not self.breeze:
            return
        for sub_key in list(self.subscribed):
            try:
                parts = sub_key.split(":")
                if len(parts) >= 4:
                    stock, strike, right_abbr, expiry = parts
                    right = "Call" if right_abbr.startswith("C") else "Put"
                    self.breeze.unsubscribe_feeds(
                        stock_code=stock,
                        exchange_code="NFO" if stock == "NIFTY" else "BFO",
                        product_type="options",
                        expiry_date=expiry,
                        strike_price=strike,
                        right=right,
                    )
            except Exception:
                pass
        self.subscribed.clear()
        log.info("[WS] all feeds unsubscribed")


# ── Singleton ──────────────────────────────────────────────────────────────────
engine = BreezeEngine()

# ── Backend auth token (protects public tunnels) ─────────────────────────────
# Anyone who knows the tunnel URL could otherwise place live orders.
# The frontend must send:  X-Terminal-Auth: <token>
#
# You can rotate by re-running the notebook cell.
BACKEND_AUTH_TOKEN = os.environ.get("TERMINAL_AUTH_TOKEN") or os.urandom(18).hex()


# ═══════════════════════════════════════════════════════════════════════════════
# FastAPI Application
# ═══════════════════════════════════════════════════════════════════════════════

app = FastAPI(title="ICICI Breeze Backend v7", version="7.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400,
)


def _is_authed(request: Request) -> bool:
    token = request.headers.get("x-terminal-auth") or request.headers.get("X-Terminal-Auth") or ""
    return token == BACKEND_AUTH_TOKEN


@app.middleware("http")
async def cors_everywhere(request: Request, call_next):
    # CORS preflight
    if request.method == "OPTIONS":
        return Response(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin":  "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Max-Age":       "86400",
            },
        )

    # Protect ALL /api/* endpoints with a shared-secret header.
    # (Tunnel URLs are public; without this, anyone can place real orders.)
    if request.url.path.startswith("/api/"):
        if not _is_authed(request):
            return JSONResponse(
                status_code=401,
                content={
                    "success": False,
                    "error": "Unauthorized. Missing/invalid X-Terminal-Auth header.",
                },
            )

    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    return response


@app.options("/{path:path}")
async def options_handler(path: str):
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin":  "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
            "Access-Control-Allow-Headers": "*",
        },
    )


# ── Health ─────────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "status":          "online",
        "connected":       engine.connected,
        "ws_running":      engine.ws_running,
        "subscriptions":   len(engine.subscribed),
        "tick_count":      len(engine.tick_store.get_all()["ticks"]),
        "rest_calls_min":  engine.rate_limiter.calls_last_minute,
        "queue_depth":     engine.rate_limiter.queue_depth,
        "version":         "7.0",
        "timestamp":       datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


@app.get("/health")
async def health():
    return {
        "status":          "online",
        "connected":       engine.connected,
        "ws_running":      engine.ws_running,
        "subscriptions":   len(engine.subscribed),
        "tick_count":      len(engine.tick_store.get_all()["ticks"]),
        "rest_calls_min":  engine.rate_limiter.calls_last_minute,
        "queue_depth":     engine.rate_limiter.queue_depth,
        "version":         "7.0",
        "timestamp":       datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


@app.get("/ping")
async def ping():
    return {"status": "online", "version": "7.0", "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}


# ── Connect / Disconnect ───────────────────────────────────────────────────────

@app.post("/api/connect")
async def api_connect(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}

    qp            = request.query_params
    api_key       = body.get("api_key")       or qp.get("api_key")
    api_secret    = body.get("api_secret")    or qp.get("api_secret")
    session_token = (
        body.get("session_token") or qp.get("session_token") or
        body.get("apisession")    or qp.get("apisession")
    )

    if not all([api_key, api_secret, session_token]):
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "Missing: api_key, api_secret, session_token"},
        )

    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, engine.connect, api_key, api_secret, session_token
        )
        return result
    except Exception as exc:
        msg  = str(exc)
        hint = (
            " → Token stale, get a fresh ?apisession= today."
            if "null" in msg.lower()
            else " → Check API Key/Secret."
            if "key" in msg.lower()
            else ""
        )
        return JSONResponse(
            status_code=200,
            content={"success": False, "error": msg + hint},
        )


@app.post("/api/disconnect")
async def api_disconnect():
    await asyncio.get_event_loop().run_in_executor(None, engine.disconnect)
    return {"success": True, "message": "Disconnected"}


# ── Expiry dates ───────────────────────────────────────────────────────────────

@app.get("/api/expiries")
async def api_expiries(
    stock_code:    str = Query("NIFTY"),
    exchange_code: str = Query("NFO"),
):
    expiries = BreezeEngine.get_weekly_expiries(stock_code, count=5)
    return {"success": True, "stock_code": stock_code, "expiries": expiries}


# ── Option Chain (REST snapshot — called ONCE per expiry) ──────────────────────

@app.get("/api/optionchain")
async def api_optionchain(
    stock_code:    str           = Query("NIFTY"),
    exchange_code: str           = Query("NFO"),
    expiry_date:   str           = Query(...),
    right:         Optional[str] = Query("Call"),
    strike_price:  str           = Query(""),
):
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected. POST /api/connect first.")

    right_norm = "Call" if (right or "Call").lower().startswith("c") else "Put"
    try:
        data = await asyncio.get_event_loop().run_in_executor(
            None,
            engine.fetch_option_chain,
            stock_code, exchange_code, expiry_date, right_norm, strike_price,
        )
        return {"success": True, "data": data, "count": len(data)}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


# ── Single Quote ───────────────────────────────────────────────────────────────

@app.get("/api/quote")
async def api_quote(
    stock_code:    str = Query(...),
    exchange_code: str = Query(...),
    expiry_date:   str = Query(...),
    right:         str = Query(...),
    strike_price:  str = Query(...),
):
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        data = await asyncio.get_event_loop().run_in_executor(
            None, engine.get_quote,
            stock_code, exchange_code, expiry_date, right, strike_price,
        )
        return {"success": True, "data": data}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


# ── WebSocket subscription ─────────────────────────────────────────────────────

@app.post("/api/ws/subscribe")
async def api_ws_subscribe(request: Request):
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})

    stock_code    = body.get("stock_code", "NIFTY")
    exchange_code = body.get("exchange_code", "NFO")
    expiry_date   = body.get("expiry_date", "")
    strikes       = body.get("strikes", [])
    rights        = body.get("rights", ["Call", "Put"])

    if not expiry_date or not strikes:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "expiry_date and strikes required"},
        )

    await asyncio.get_event_loop().run_in_executor(None, engine.unsubscribe_all)
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            engine.subscribe_option_chain,
            stock_code, exchange_code, expiry_date, strikes, rights,
        )
        return {"success": True, **result}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


# ── WebSocket streaming (frontend connects here) ───────────────────────────────

@app.websocket("/ws/ticks")
async def ws_ticks(websocket: WebSocket):
    await websocket.accept()
    log.info(f"[WS endpoint] frontend connected: {websocket.client}")
    last_version      = -1
    heartbeat_counter = 0
    try:
        while True:
            await asyncio.sleep(0.5)
            current_version = engine.tick_store.get_version()
            heartbeat_counter += 1

            if current_version == last_version:
                if heartbeat_counter % 10 == 0:
                    await websocket.send_json({
                        "type":    "heartbeat",
                        "ts":      time.time(),
                        "ws_live": engine.ws_running,
                    })
                continue

            last_version = current_version
            await websocket.send_json({
                "type":    "tick_update",
                "version": current_version,
                "ticks":   engine.tick_store.to_option_chain_delta(),
                "ts":      time.time(),
                "ws_live": engine.ws_running,
            })
    except WebSocketDisconnect:
        log.info("[WS endpoint] frontend disconnected")
    except Exception as exc:
        log.warning(f"[WS endpoint] error: {exc}")


# ── Tick REST fallback ─────────────────────────────────────────────────────────

@app.get("/api/ticks")
async def api_ticks(since_version: int = Query(0)):
    data = engine.tick_store.get_all()
    if data["version"] <= since_version:
        return {"changed": False, "version": data["version"]}
    return {
        "changed": True,
        "version": data["version"],
        "ticks":   engine.tick_store.to_option_chain_delta(),
        "ws_live": engine.ws_running,
    }


# ── Orders ─────────────────────────────────────────────────────────────────────

@app.post("/api/order")
async def api_order(request: Request):
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})
    try:
        results = await asyncio.get_event_loop().run_in_executor(
            None, engine.place_strategy_order, [body]
        )
        r = results[0]
        return {
            "success":  r["success"],
            "order_id": r.get("order_id", ""),
            "error":    r.get("error", ""),
        }
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@app.post("/api/strategy/execute")
async def api_strategy_execute(request: Request):
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})

    legs = body.get("legs", [])
    if not legs:
        return JSONResponse(status_code=400, content={"success": False, "error": "No legs provided"})

    try:
        results = await asyncio.get_event_loop().run_in_executor(
            None, engine.place_strategy_order, legs
        )
        return {"success": all(r["success"] for r in results), "results": results}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


# ── Square Off ─────────────────────────────────────────────────────────────────

@app.post("/api/squareoff")
async def api_squareoff(request: Request):
    """
    Square off (exit) a position.
    Send the same body as /api/order — backend reverses the action automatically.
    """
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, engine.square_off_position, body
        )
        ok  = isinstance(result, dict) and result.get("Status") == 200
        oid = (result.get("Success") or {}).get("order_id", "") if ok else ""
        return {
            "success":  ok,
            "order_id": oid,
            "error":    result.get("Error", "") if not ok else "",
        }
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


# ── Cancel / Modify ────────────────────────────────────────────────────────────

@app.post("/api/order/cancel")
async def api_cancel_order(request: Request):
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})

    order_id      = body.get("order_id", "")
    exchange_code = body.get("exchange_code", "NFO")
    if not order_id:
        return JSONResponse(status_code=400, content={"success": False, "error": "order_id required"})

    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, engine.cancel_order, order_id, exchange_code
        )
        ok = isinstance(result, dict) and result.get("Status") == 200
        return {"success": ok, "error": result.get("Error", "") if not ok else ""}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@app.patch("/api/order/modify")
async def api_modify_order(request: Request):
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            engine.modify_order,
            body.get("order_id", ""),
            body.get("exchange_code", "NFO"),
            str(body.get("quantity", "0")),
            str(body.get("price", "0")),
            str(body.get("stoploss", "0")),
            body.get("validity", "day"),
        )
        ok = isinstance(result, dict) and result.get("Status") == 200
        return {"success": ok, "error": result.get("Error", "") if not ok else ""}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


# ── Order Book / Trade Book ────────────────────────────────────────────────────

@app.get("/api/orders")
async def api_order_book():
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, engine.get_order_book)
        return {"success": True, "data": data.get("Success", []) if isinstance(data, dict) else []}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@app.get("/api/trades")
async def api_trade_book():
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, engine.get_trade_book)
        return {"success": True, "data": data.get("Success", []) if isinstance(data, dict) else []}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


# ── Positions / Holdings ───────────────────────────────────────────────────────

@app.get("/api/positions")
async def api_positions():
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, engine.get_positions)
        return {"success": True, "data": data}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


# ── Funds ──────────────────────────────────────────────────────────────────────

@app.get("/api/funds")
async def api_funds():
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, engine.get_funds)
        return {"success": True, "data": data}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


# ── Historical Data ────────────────────────────────────────────────────────────

@app.get("/api/historical")
async def api_historical(
    stock_code:    str = Query(...),
    exchange_code: str = Query(...),
    interval:      str = Query("1day"),
    from_date:     str = Query(...),
    to_date:       str = Query(...),
    expiry_date:   str = Query(""),
    right:         str = Query(""),
    strike_price:  str = Query(""),
):
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        data = await asyncio.get_event_loop().run_in_executor(
            None,
            engine.get_historical,
            stock_code, exchange_code, interval, from_date, to_date,
            expiry_date, right, strike_price,
        )
        return {"success": True, "data": data}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


# ── Rate limit status ──────────────────────────────────────────────────────────

@app.get("/api/ratelimit")
async def api_ratelimit():
    return {
        "calls_last_minute": engine.rate_limiter.calls_last_minute,
        "max_per_minute":    100,
        "min_interval_ms":   RateLimiter.MIN_INTERVAL_MS,
        "queue_depth":       engine.rate_limiter.queue_depth,
    }


# ── Checksum verify ────────────────────────────────────────────────────────────

@app.post("/api/checksum")
async def api_checksum(request: Request):
    try:
        body      = await request.json()
        timestamp = body.get(
            "timestamp",
            datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        )
        checksum  = BreezeEngine.generate_checksum(
            timestamp,
            body.get("payload", {}),
            body.get("secret", ""),
        )
        return {"checksum": checksum, "timestamp": timestamp}
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})


# ═══════════════════════════════════════════════════════════════════════════════
# Tunnel Providers
# ═══════════════════════════════════════════════════════════════════════════════

def pick_free_port(preferred: int = 8000) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            s.bind(("127.0.0.1", 0))
            return int(s.getsockname()[1])


def start_uvicorn_thread(port: int):
    t = threading.Thread(
        target=lambda: uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning"),
        daemon=True,
        name="uvicorn",
    )
    t.start()
    return t


def wait_for_port(port: int, timeout: int = 15) -> bool:
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
        print("  Trying localhost.run (SSH)...")
        log_path = "/tmp/lhr.log"
        with open(log_path, "w") as lf:
            subprocess.Popen(
                ["ssh", "-R", f"80:localhost:{BACKEND_PORT}",
                 "-o", "StrictHostKeyChecking=no",
                 "-o", "ServerAliveInterval=30",
                 "-o", "ConnectTimeout=15",
                 "nokey@localhost.run"],
                stdout=lf, stderr=subprocess.STDOUT,
            )
        pat = re.compile(r"https://[a-z0-9\-]+\.lhr\.life")
        deadline = time.time() + 40
        while time.time() < deadline:
            time.sleep(2)
            try:
                with open(log_path) as f:
                    m = pat.search(f.read())
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
        print("  Trying serveo.net (SSH)...")
        log_path = "/tmp/serveo.log"
        with open(log_path, "w") as lf:
            subprocess.Popen(
                ["ssh", "-R", f"80:localhost:{BACKEND_PORT}",
                 "-o", "StrictHostKeyChecking=no",
                 "-o", "ServerAliveInterval=30",
                 "-o", "ConnectTimeout=15",
                 "serveo.net"],
                stdout=lf, stderr=subprocess.STDOUT,
            )
        pat = re.compile(r"https://[a-z0-9]+\.serveo\.net")
        deadline = time.time() + 40
        while time.time() < deadline:
            time.sleep(2)
            try:
                with open(log_path) as f:
                    m = pat.search(f.read())
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
            print("  cloudflared downloaded")
        except Exception as exc:
            print(f"  cloudflared download failed: {exc}")
            return None

    log_path = "/tmp/cf.log"
    # Clear log before starting
    open(log_path, "w").close()

    try:
        with open(log_path, "a") as lf:
            subprocess.Popen(
                [cf, "tunnel", "--url", f"http://localhost:{BACKEND_PORT}", "--no-autoupdate"],
                stdout=lf,
                stderr=subprocess.STDOUT,
            )
        pat = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
        deadline = time.time() + 90
        while time.time() < deadline:
            time.sleep(3)
            try:
                with open(log_path) as f:
                    urls = pat.findall(f.read())
                    if urls:
                        return urls[-1]
            except Exception:
                pass
    except Exception as exc:
        print(f"  Cloudflare error: {exc}")

    return None


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN — start FastAPI + tunnel
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    global BACKEND_PORT
    SEP = "=" * 68

    print(f"\n{SEP}")
    print("  ICICI BREEZE BACKEND v7 — BreezeEngine")
    print(SEP)
    print()
    print("  Endpoints:")
    print("    POST  /api/connect          authenticate (generate_session)")
    print("    GET   /api/expiries         weekly expiry dates")
    print("    GET   /api/optionchain      snapshot — call ONCE per expiry")
    print("    POST  /api/ws/subscribe     subscribe Breeze WS feeds")
    print("    WS    /ws/ticks             live tick stream to frontend")
    print("    POST  /api/strategy/execute multi-leg concurrent order")
    print("    POST  /api/squareoff        exit / square-off a position")
    print("    POST  /api/order/cancel     cancel pending order")
    print("    PATCH /api/order/modify     modify order price/qty")
    print("    GET   /api/orders           order book (today)")
    print("    GET   /api/trades           trade book (today)")
    print("    GET   /api/positions        portfolio positions + holdings")
    print("    GET   /api/funds            available margin / funds")
    print("    GET   /api/historical       OHLCV candle data")
    print("    GET   /api/ratelimit        rate limiter status")
    print("    POST  /api/checksum         checksum verification utility")
    print("    GET   /health  /ping  /     health check")
    print()

    BACKEND_PORT = pick_free_port(BACKEND_PORT)
    print(f"Starting FastAPI on port {BACKEND_PORT}...")
    start_uvicorn_thread(BACKEND_PORT)
    if wait_for_port(BACKEND_PORT, 15):
        print(f"FastAPI running on http://localhost:{BACKEND_PORT}\n")
    else:
        print("WARNING: FastAPI may not have started\n")

    print("Finding public tunnel (trying 3 providers)...")

    public_url = None
    for fn, name in [
        (try_localhost_run, "localhost.run"),
        (try_serveo,        "serveo.net"),
        (try_cloudflare,    "Cloudflare"),
    ]:
        print(f"\n  {name}...")
        url = fn()
        if url:
            public_url = url
            print(f"  OK: {url}")
            break
        print(f"  {name} unavailable, trying next...")

    print(f"\n{SEP}")

    if public_url:
        is_cf = "trycloudflare" in public_url
        print("  BACKEND IS LIVE!")
        print(SEP)
        print()
        print(f"  Public URL:  {public_url}")
        print()
        print("  " + "-" * 64)
        print("  COPY THIS URL into Arena app Connect Broker field:")
        print(f"  {public_url}")
        print("  " + "-" * 64)
        print()
        print(f"  Health:    {public_url}/health")
        print(f"  WebSocket: {public_url.replace('https', 'wss')}/ws/ticks")
        print(f"  Connect:   {public_url}/api/connect   (POST)")
        print(f"  Chain:     {public_url}/api/optionchain?stock_code=NIFTY&exchange_code=NFO&expiry_date=01-Jul-2025&right=Call")

        if is_cf:
            print()
            print("  NOTE (Cloudflare only): If Arena shows 'Failed to fetch':")
            print(f"    Open in a browser tab: {public_url}/health")
            print("    You should see {\"status\":\"online\"}")
            print("    Then retry in Arena.")
    else:
        print("  WARNING: No public tunnel found.")
        print("  Make sure Kaggle Internet is ON and re-run this cell.")

    print(SEP)
    print()
    print("Steps:")
    print("  1. Copy URL above")
    print("  2. Arena app -> Connect Broker -> paste URL")
    print("  3. Enter API Key, API Secret, today's Session Token")
    print("  4. Click Validate Live -> Connected via BreezeEngine v7!")
    print()
    print("Daily Session Token:")
    print("  https://api.icicidirect.com/apiuser/login?api_key=YOUR_KEY")
    print("  Login -> copy ?apisession=XXXXX from redirect URL")
    print(SEP)
    print()
    print("Backend running. Keep cell alive. Press the Stop button to quit.\n")

    try:
        beat = 0
        while True:
            time.sleep(30)
            beat += 1
            if beat % 4 == 0:
                ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
                print(
                    f"  heartbeat {ts} UTC"
                    f" | connected={engine.connected}"
                    f" | ws={engine.ws_running}"
                    f" | subs={len(engine.subscribed)}"
                    f" | REST/min={engine.rate_limiter.calls_last_minute}"
                    f" | ticks={engine.tick_store.get_version()}"
                )
    except KeyboardInterrupt:
        print("\nShutting down...")
        engine.disconnect()


main()
