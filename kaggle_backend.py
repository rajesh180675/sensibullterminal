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


# ═══════════════════════════════════════════════════════════════════════════════
# TickStore
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
                # Skip spot price pseudo-entries
                if right == "SPOT":
                    continue
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

    def get_spot_prices(self) -> Dict[str, float]:
        """Return dict of {stock_code: spot_price} captured from option tick underlying values."""
        with self._lock:
            result = {}
            for key, tick in self._ticks.items():
                parts = key.split(":")
                if len(parts) == 2 and parts[1] == "SPOT":
                    stock = parts[0]
                    ltp = tick.get("ltp", 0)
                    if ltp > 0:
                        result[stock] = ltp
            return result


# ═══════════════════════════════════════════════════════════════════════════════
# BreezeEngine
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
        self.breeze      = None
        self.session_key = ""
        self.connected   = False
        self.subscribed.clear()
        self.tick_store.clear()
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

        if rows:
            suffix = "CE" if right_norm == "Call" else "PE"
            for row in rows:
                try:
                    strike = str(int(float(
                        row.get("strike_price") or row.get("strike-price") or 0
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

    # ── REST: Orders ──────────────────────────────────────────────────────────

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
        if not self.connected:
            raise RuntimeError("Not connected")

        results      = []
        threads      = []
        results_lock = threading.Lock()

        def place_one(leg: dict, idx: int):
            try:
                r   = self.place_order(leg)
                ok  = isinstance(r, dict) and r.get("Status") == 200
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
        original = (leg.get("action") or "buy").lower()
        exit_leg = {**leg,
                    "action":      "sell" if original == "buy" else "buy",
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

    # ── REST: Books & Portfolio ───────────────────────────────────────────────

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

                # ── FIX: Capture underlying index spot price from option tick ──
                # Breeze includes the index value in each option feed tick under
                # several possible field names depending on SDK version.
                # This is the MOST RELIABLE live spot source — capture it.
                underlying = 0.0
                for field in ("index_close_price", "UnderlyingValue", "underlying_value",
                              "close_price", "index_price", "underlying_spot_price"):
                    v = tick.get(field)
                    if v:
                        try:
                            underlying = float(v)
                        except (ValueError, TypeError):
                            pass
                        if underlying > 0:
                            break
                if underlying > 1000:  # sanity: NIFTY > 1000, SENSEX > 10000
                    spot_key = f"{stock}:SPOT"
                    self.tick_store.update(spot_key, {
                        "ltp":      underlying,
                        "is_spot":  True,
                        "source":   "ws_tick",
                    })
                    log.debug(f"[WS spot] {stock} underlying={underlying}")

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

# ── Auth configuration ────────────────────────────────────────────────────────
# Auth is OPTIONAL. If TERMINAL_AUTH_TOKEN env var is set → enforced.
# Default (no env var) → open, tunnel URL is the only "secret".
BACKEND_AUTH_TOKEN = os.environ.get("TERMINAL_AUTH_TOKEN", "")
AUTH_ENABLED       = bool(BACKEND_AUTH_TOKEN)


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
    if not AUTH_ENABLED:
        return True
    token = (
        request.headers.get("x-terminal-auth") or
        request.headers.get("X-Terminal-Auth") or ""
    )
    return token == BACKEND_AUTH_TOKEN


@app.middleware("http")
async def cors_everywhere(request: Request, call_next):
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

    if request.url.path.startswith("/api/") and not _is_authed(request):
        return JSONResponse(
            status_code=401,
            content={"success": False, "error": "Unauthorized — missing/invalid X-Terminal-Auth"},
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
@app.get("/health")
async def health(request: Request):
    return {
        "status":         "online",
        "connected":      engine.connected,
        "ws_running":     engine.ws_running,
        "subscriptions":  len(engine.subscribed),
        "tick_count":     len(engine.tick_store.get_all()["ticks"]),
        "rest_calls_min": engine.rate_limiter.calls_last_minute,
        "queue_depth":    engine.rate_limiter.queue_depth,
        "auth_enabled":   AUTH_ENABLED,
        "version":        "7.0",
        "timestamp":      datetime.utcnow().isoformat() + "Z",
    }


@app.get("/ping")
async def ping():
    return {"status": "online", "version": "7.0", "ts": datetime.utcnow().isoformat() + "Z"}


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
            " → Token stale — get a fresh ?apisession= today."
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



# ── Live Spot Price ─────────────────────────────────────────────────────────────
# FIX: New endpoint to fetch the actual NIFTY/SENSEX index spot price directly
# from Breeze, bypassing the inaccurate put-call parity derivation in the frontend.
# NIFTY index: stock_code="NIFTY", exchange_code="NSE" (NSE cash market)
# SENSEX index: stock_code="SENSEX", exchange_code="BSE" (BSE cash market)

@app.get("/api/spot")
async def api_spot(
    stock_code:    str = Query("NIFTY"),
    exchange_code: str = Query("NSE"),
):
    """
    Fetch live index spot price directly from Breeze.
    For NIFTY: stock_code=NIFTY, exchange_code=NSE
    For SENSEX: stock_code=SENSEX, exchange_code=BSE

    Priority 1: Return cached value from WS tick (index_close_price field).
    Priority 2: Call get_quotes() as REST fallback (costs 1 rate-limiter slot).
    """
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected — POST /api/connect first")

    # Priority 1: Try tick store (populated from index_close_price in WS ticks)
    spot_prices = engine.tick_store.get_spot_prices()
    cached = spot_prices.get(stock_code.upper())
    if cached and cached > 1000:
        return {"success": True, "spot": cached, "source": "ws_tick",
                "stock_code": stock_code, "exchange_code": exchange_code}

    # Priority 2: REST call to Breeze get_quotes
    try:
        def _call():
            return engine.breeze.get_quotes(
                stock_code=stock_code,
                exchange_code=exchange_code,
                expiry_date="",
                right="",
                strike_price="",
            )
        result = engine.rate_limiter.enqueue(_call)
        rows = []
        if isinstance(result, dict):
            rows = result.get("Success", []) or []
        if isinstance(rows, dict):
            rows = [rows]
        for row in rows:
            ltp = 0.0
            for field in ("ltp", "last_traded_price", "close", "last_price", "LastPrice"):
                v = row.get(field)
                if v:
                    try:
                        ltp = float(v)
                    except (ValueError, TypeError):
                        pass
                    if ltp > 0:
                        break
            if ltp > 1000:
                # Cache it in tick store for next WS push
                engine.tick_store.update(f"{stock_code.upper()}:SPOT", {
                    "ltp": ltp, "is_spot": True, "source": "rest"
                })
                return {"success": True, "spot": ltp, "source": "rest_quote",
                        "stock_code": stock_code, "exchange_code": exchange_code}
        return {"success": False,
                "error": f"No spot price returned for {stock_code}/{exchange_code}. "
                         f"Raw Breeze response: {str(result)[:200]}"}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


# ── Option Chain ──────────────────────────────────────────────────────────────

@app.get("/api/optionchain")
async def api_optionchain(
    stock_code:    str           = Query("NIFTY"),
    exchange_code: str           = Query("NFO"),
    expiry_date:   str           = Query(...),
    right:         Optional[str] = Query("Call"),
    strike_price:  str           = Query(""),
):
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected — POST /api/connect first")

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


# ── WebSocket tick stream (frontend connects here) ────────────────────────────

@app.websocket("/ws/ticks")
async def ws_ticks(websocket: WebSocket):
    await websocket.accept()
    log.info(f"[WS] frontend connected: {websocket.client}")
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
                "type":        "tick_update",
                "version":     current_version,
                "ticks":       engine.tick_store.to_option_chain_delta(),
                "spot_prices": engine.tick_store.get_spot_prices(),
                "ts":          time.time(),
                "ws_live":     engine.ws_running,
            })
    except WebSocketDisconnect:
        log.info("[WS] frontend disconnected")
    except Exception as exc:
        log.warning(f"[WS] error: {exc}")


# ── Tick REST fallback ─────────────────────────────────────────────────────────

@app.get("/api/ticks")
async def api_ticks(since_version: int = Query(0)):
    data = engine.tick_store.get_all()
    if data["version"] <= since_version:
        return {"changed": False, "version": data["version"]}
    return {
        "changed":     True,
        "version":     data["version"],
        "ticks":       engine.tick_store.to_option_chain_delta(),
        "spot_prices": engine.tick_store.get_spot_prices(),
        "ws_live":     engine.ws_running,
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


# ── Books ──────────────────────────────────────────────────────────────────────

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


# ── Positions / Funds ──────────────────────────────────────────────────────────

@app.get("/api/positions")
async def api_positions():
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, engine.get_positions)
        return {"success": True, "data": data}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@app.get("/api/funds")
async def api_funds():
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, engine.get_funds)
        return {"success": True, "data": data}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


# ── Historical ─────────────────────────────────────────────────────────────────

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


# ── Rate limit / Checksum ──────────────────────────────────────────────────────

@app.get("/api/ratelimit")
async def api_ratelimit():
    return {
        "calls_last_minute": engine.rate_limiter.calls_last_minute,
        "max_per_minute":    100,
        "min_interval_ms":   RateLimiter.MIN_INTERVAL_MS,
        "queue_depth":       engine.rate_limiter.queue_depth,
    }


@app.post("/api/checksum")
async def api_checksum(request: Request):
    try:
        body      = await request.json()
        timestamp = body.get(
            "timestamp",
            datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z"),
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

def start_uvicorn_thread():
    t = threading.Thread(
        target=lambda: uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning"),
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
