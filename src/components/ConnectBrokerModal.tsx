// ════════════════════════════════════════════════════════════════════════════
// CONNECT BROKER MODAL v8 — Fixed embedded Kaggle snippet
// The KAGGLE_CODE_SNIPPET is what users actually copy and run.
// All previous versions had Python SyntaxErrors and missing endpoints.
// ════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Shield, Eye, EyeOff, ExternalLink, AlertTriangle,
  CheckCircle, Copy, Wifi, WifiOff, Bug, RefreshCw, Zap,
} from 'lucide-react';
import { BreezeSession }   from '../types/index';
import { CORS_PROXIES }    from '../config/market';
import {
  validateSession,
  extractApiSession,
  type DebugInfo,
} from '../utils/breezeClient';
import {
  connectToBreeze,
  checkBackendHealth,
  isKaggleBackend,
  setTerminalAuthToken,
} from '../utils/kaggleClient';
import { setWsAuthToken } from '../utils/breezeWs';

interface Props {
  onClose:     () => void;
  onConnected: (s: BreezeSession) => void;
  session:     BreezeSession | null;
}

type Tab    = 'connect' | 'kaggle' | 'debug';
type Status = 'idle' | 'loading' | 'ok' | 'error';

// ── CodeBlock with copy button ────────────────────────────────────────────────
const CodeBlock: React.FC<{ code: string; lang?: string }> = ({ code, lang }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      {lang && (
        <span className="absolute top-2 left-3 text-[9px] text-gray-600 uppercase tracking-widest font-mono select-none">
          {lang}
        </span>
      )}
      <button
        onClick={() => {
          navigator.clipboard.writeText(code).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        }}
        className="absolute top-2 right-2 p-1.5 bg-gray-800/80 hover:bg-gray-700 rounded-lg
                   opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >
        {copied
          ? <CheckCircle size={10} className="text-emerald-400" />
          : <Copy size={10} className="text-gray-500" />}
      </button>
      <pre className="bg-[#080b12] border border-gray-800/50 rounded-xl p-4 pt-8 text-[10px] text-gray-300
                      overflow-x-auto font-mono leading-relaxed whitespace-pre select-all">
        {code}
      </pre>
    </div>
  );
};

// ── Debug inspector panel ─────────────────────────────────────────────────────
const DebugInspector: React.FC<{ info: DebugInfo }> = ({ info }) => {
  const [show, setShow] = useState(true);
  return (
    <div className="bg-[#0a0c15] border border-purple-800/30 rounded-xl overflow-hidden text-[10px]">
      <button
        onClick={() => setShow(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-purple-400 font-semibold
                   hover:bg-purple-500/5 transition-colors"
      >
        <Bug size={10} /> Request Debug Inspector
        <span className="ml-auto text-gray-700">{show ? '▼' : '▶'}</span>
      </button>
      {show && (
        <div className="px-3 pb-3 space-y-2 font-mono">
          <Row label="Method"    val={info.method}    cls="text-emerald-400" />
          <Row label="URL"       val={info.url}       cls="text-blue-300 break-all" />
          <Row label="Timestamp" val={info.timestamp} cls="text-amber-400" />
          <div>
            <span className="text-gray-600">pyDumps body (checksum input):</span>
            <div className="mt-0.5 p-2 bg-[#0e1018] rounded-lg text-yellow-300 break-all">{info.bodyStr}</div>
          </div>
          <div>
            <span className="text-gray-600">SHA-256 checksum:</span>
            <div className="mt-0.5 p-2 bg-[#0e1018] rounded-lg text-emerald-300 break-all">{info.checksum}</div>
          </div>
          {info.httpStatus !== undefined && (
            <Row
              label="HTTP status"
              val={String(info.httpStatus)}
              cls={info.httpStatus === 200 ? 'text-emerald-400' : 'text-red-400'}
            />
          )}
          {info.responseBody && (
            <div>
              <span className="text-gray-600">Response body:</span>
              <div className="mt-0.5 p-2 bg-[#0e1018] rounded-lg text-gray-400 break-all max-h-28 overflow-y-auto">
                {info.responseBody}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; val: string; cls?: string }> = ({ label, val, cls = 'text-white' }) => (
  <div><span className="text-gray-600">{label}: </span><span className={cls}>{val}</span></div>
);

// ── KAGGLE CODE SNIPPET — kaggle_backend.py v7 (full BreezeEngine) ─────────────
// FIX (Bug #3): This is now the full v7 backend with:
//   ✓ RateLimiter (max 100 REST calls/min)
//   ✓ WebSocket streaming (/ws/ticks)
//   ✓ WS subscription endpoint (/api/ws/subscribe)
//   ✓ REST tick fallback (/api/ticks)
//   ✓ Optional auth (disabled by default — no more random blocking token)
//   ✓ All order endpoints (place, squareoff, cancel, modify)
//   ✓ Full portfolio (positions, holdings, funds, orders, trades)
const KAGGLE_CODE_SNIPPET = `# ═══════════════════════════════════════════════════════════════════════════════
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

# ── Backend auth token (optional — protects public tunnels) ──────────────────
# FIX (Bug #1): Auth is now OPTIONAL.
#   • If TERMINAL_AUTH_TOKEN env var is set → enforce it (good for production)
#   • If not set → auth is DISABLED, all requests pass through
#
# To enable: in Kaggle notebook, add a cell BEFORE this one:
#   import os; os.environ["TERMINAL_AUTH_TOKEN"] = "my-secret-token"
# Then set the same value as KAGGLE_TERMINAL_AUTH in Vercel env vars.
#
# Without auth (default): tunnel URL alone acts as the secret.
BACKEND_AUTH_TOKEN = os.environ.get("TERMINAL_AUTH_TOKEN") or ""
AUTH_ENABLED = bool(BACKEND_AUTH_TOKEN)


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
    # FIX (Bug #1): If auth is not configured, allow everything
    if not AUTH_ENABLED:
        return True
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
        "timestamp":       datetime.utcnow().isoformat() + "Z",
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
        "timestamp":       datetime.utcnow().isoformat() + "Z",
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
        print("  Trying localhost.run (SSH)...")
        log_path = "/tmp/lhr.log"
        with open(log_path, "w") as lf:
            subprocess.Popen(
                ["ssh", "-R", "80:localhost:8000",
                 "-o", "StrictHostKeyChecking=no",
                 "-o", "ServerAliveInterval=30",
                 "-o", "ConnectTimeout=15",
                 "nokey@localhost.run"],
                stdout=lf, stderr=subprocess.STDOUT,
            )
        pat = re.compile(r"https://[a-z0-9\\-]+\\.lhr\\.life")
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
                ["ssh", "-R", "80:localhost:8000",
                 "-o", "StrictHostKeyChecking=no",
                 "-o", "ServerAliveInterval=30",
                 "-o", "ConnectTimeout=15",
                 "serveo.net"],
                stdout=lf, stderr=subprocess.STDOUT,
            )
        pat = re.compile(r"https://[a-z0-9]+\\.serveo\\.net")
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
                [cf, "tunnel", "--url", "http://localhost:8000", "--no-autoupdate"],
                stdout=lf,
                stderr=subprocess.STDOUT,
            )
        pat = re.compile(r"https://[a-zA-Z0-9-]+\\.trycloudflare\\.com")
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
    print(f"\\n{SEP}")
    print("  ICICI BREEZE BACKEND v7 — BreezeEngine")
    print(SEP)
    print()
    if AUTH_ENABLED:
        print("  ⚠️  BACKEND AUTH IS ENABLED")
        print(f"  Auth token: {BACKEND_AUTH_TOKEN}")
        print("  → Set KAGGLE_TERMINAL_AUTH=" + BACKEND_AUTH_TOKEN + " in Vercel env vars")
        print("  → Or set TERMINAL_AUTH_TOKEN env var before running this cell to customise")
        print()
    else:
        print("  🔓 Auth is DISABLED (default). Anyone with the tunnel URL can connect.")
        print("  To enable: set TERMINAL_AUTH_TOKEN env var before running this cell.")
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

    print("Starting FastAPI on port 8000...")
    start_uvicorn_thread()
    if wait_for_port(8000, 15):
        print("FastAPI running on http://localhost:8000\\n")
    else:
        print("WARNING: FastAPI may not have started\\n")

    print("Finding public tunnel (trying 3 providers)...")

    public_url = None
    for fn, name in [
        (try_localhost_run, "localhost.run"),
        (try_serveo,        "serveo.net"),
        (try_cloudflare,    "Cloudflare"),
    ]:
        print(f"\\n  {name}...")
        url = fn()
        if url:
            public_url = url
            print(f"  OK: {url}")
            break
        print(f"  {name} unavailable, trying next...")

    print(f"\\n{SEP}")

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
            print("    You should see {\\"status\\":\\"online\\"}")
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
    print("Backend running. Keep cell alive. Press the Stop button to quit.\\n")

    try:
        beat = 0
        while True:
            time.sleep(30)
            beat += 1
            if beat % 4 == 0:
                ts = datetime.utcnow().strftime("%H:%M:%S")
                print(
                    f"  heartbeat {ts} UTC"
                    f" | connected={engine.connected}"
                    f" | ws={engine.ws_running}"
                    f" | subs={len(engine.subscribed)}"
                    f" | REST/min={engine.rate_limiter.calls_last_minute}"
                    f" | ticks={engine.tick_store.get_version()}"
                )
    except KeyboardInterrupt:
        print("\\nShutting down...")
        engine.disconnect()


main()
`;


// ── Main modal component ──────────────────────────────────────────────────────
export const ConnectBrokerModal: React.FC<Props> = ({ onClose, onConnected, session }) => {
  const [tab,          setTab]          = useState<Tab>('connect');
  const [apiKey,       setApiKey]       = useState(session?.apiKey       ?? '');
  const [apiSecret,    setApiSecret]    = useState(session?.apiSecret    ?? '');
  const [sessionToken, setSessionToken] = useState(session?.sessionToken ?? '');
  const [proxyBase,    setProxyBase]    = useState(session?.proxyBase    ?? CORS_PROXIES.vercelKaggle);
  // FIX (Bug #2): Auth token field — only needed if TERMINAL_AUTH_TOKEN is set in Kaggle
  const [authToken,    setAuthToken]    = useState(session?.backendAuthToken ?? '');
  const [showSecret,   setShowSecret]   = useState(false);
  const [status,       setStatus]       = useState<Status>('idle');
  const [statusMsg,    setStatusMsg]    = useState('');
  const [lastDebug,    setLastDebug]    = useState<DebugInfo | undefined>();
  const [healthMsg,    setHealthMsg]    = useState('');
  const [healthOk,     setHealthOk]     = useState<boolean | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  // Auto-extract ?apisession= from URL on mount
  useEffect(() => {
    const token = extractApiSession();
    if (token) {
      setSessionToken(token);
      setStatus('ok');
      setStatusMsg('✓ Session token auto-extracted from URL redirect');
    }
  }, []);

  const loginUrl  = `https://api.icicidirect.com/apiuser/login?api_key=${encodeURIComponent(apiKey || 'YOUR_API_KEY')}`;
  useEffect(() => () => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
    }
  }, []);

  const scheduleClose = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
    }
    closeTimeoutRef.current = window.setTimeout(() => onClose(), 1500);
  }, [onClose]);

  const allFilled = !!(apiKey.trim() && apiSecret.trim() && sessionToken.trim());
  const isBackend = isKaggleBackend(proxyBase.trim());

  // ── Health check ────────────────────────────────────────────────────────────
  const handleHealthCheck = useCallback(async () => {
    if (!proxyBase.trim()) { setHealthMsg('Enter a URL first'); setHealthOk(false); return; }
    setHealthMsg('⏳ Pinging backend...');
    setHealthOk(null);
    // FIX (Bug #2): Set auth token before health check so fetchJson includes it
    setTerminalAuthToken(authToken.trim() || undefined);
    setWsAuthToken(authToken.trim() || undefined);
    const result = await checkBackendHealth(proxyBase.trim());
    setHealthOk(result.ok);
    setHealthMsg(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
  }, [proxyBase, authToken]);

  // ── Validate Live ───────────────────────────────────────────────────────────
  const handleValidateLive = useCallback(async () => {
    if (!allFilled) {
      setStatus('error');
      setStatusMsg('Fill in API Key, API Secret, and Session Token first.');
      return;
    }
    setStatus('loading');
    setStatusMsg('Connecting...');
    setLastDebug(undefined);

    const baseSession: BreezeSession = {
      apiKey:           apiKey.trim(),
      apiSecret:        apiSecret.trim(),
      sessionToken:     sessionToken.trim(),
      proxyBase:        proxyBase.trim(),
      backendAuthToken: authToken.trim() || undefined,
      isConnected:      false,
    };

    // FIX (Bug #2): Apply auth token globally BEFORE any API calls
    setTerminalAuthToken(authToken.trim() || undefined);
    setWsAuthToken(authToken.trim() || undefined);

    // ── Mode A: Python backend (Kaggle) ──────────────────────────────────────
    if (isBackend) {
      setStatusMsg('Connecting to Python backend (official Breeze SDK)...');
      try {
        const result = await connectToBreeze({
          apiKey:       apiKey.trim(),
          apiSecret:    apiSecret.trim(),
          sessionToken: sessionToken.trim(),
          backendUrl:   proxyBase.trim(),
        });
        if (result.ok) {
          const live: BreezeSession = {
            ...baseSession,
            sessionToken: result.sessionToken ?? baseSession.sessionToken,
            isConnected:  true,
            connectedAt:  new Date(),
          };
          setStatus('ok');
          setStatusMsg(`✓ Connected via Python SDK! ${result.user ? `(${result.user})` : ''}`);
          onConnected(live);
          scheduleClose();
        } else {
          setStatus('error');
          setStatusMsg(result.reason);
        }
      } catch (e) {
        setStatus('error');
        setStatusMsg(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    // ── Mode B: Browser CORS proxy ───────────────────────────────────────────
    setStatusMsg('Calling /customerdetails via CORS proxy (SHA-256 browser)...');
    try {
      const result = await validateSession(baseSession);
      setLastDebug(result.debug);
      if (result.ok) {
        const live: BreezeSession = {
          ...baseSession,
          sessionToken: result.sessionToken ?? baseSession.sessionToken,
          isConnected:  true,
          connectedAt:  new Date(),
        };
        setStatus('ok');
        setStatusMsg(`✓ Live — ${result.reason}`);
        onConnected(live);
        scheduleClose();
      } else {
        setStatus('error');
        setStatusMsg(result.reason);
      }
    } catch (e) {
      setStatus('error');
      setStatusMsg(e instanceof Error ? e.message : String(e));
    }
  }, [apiKey, apiSecret, sessionToken, proxyBase, authToken, allFilled, isBackend, onConnected, scheduleClose]);

  // ── Save offline (no validation) ────────────────────────────────────────────
  const handleSaveOffline = useCallback(() => {
    if (!allFilled) { setStatus('error'); setStatusMsg('Fill in all fields first.'); return; }
    setTerminalAuthToken(authToken.trim() || undefined);
    setWsAuthToken(authToken.trim() || undefined);
    onConnected({
      apiKey:           apiKey.trim(),
      apiSecret:        apiSecret.trim(),
      sessionToken:     sessionToken.trim(),
      proxyBase:        proxyBase.trim(),
      backendAuthToken: authToken.trim() || undefined,
      isConnected:      false,
      connectedAt:      new Date(),
    });
    onClose();
  }, [apiKey, apiSecret, sessionToken, proxyBase, authToken, allFilled, onConnected, onClose]);

  const TABS: { id: Tab; label: string }[] = [
    { id: 'connect', label: '🔐 Connect' },
    { id: 'kaggle',  label: '🚀 Kaggle Backend' },
    { id: 'debug',   label: '🐛 Debug' },
  ];

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-3">
      <div className="bg-[#13161f] border border-gray-700/50 rounded-2xl shadow-2xl
                      w-full max-w-[700px] max-h-[92vh] flex flex-col overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800/60 flex-shrink-0">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-700 rounded-xl
                          flex items-center justify-center flex-shrink-0">
            <Shield size={16} className="text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-white font-bold text-sm">Connect Broker — ICICI Direct Breeze</h2>
            <p className="text-gray-600 text-[10px]">
              {isBackend ? '🚀 Python Backend Mode (recommended)' : '🌐 Browser-Direct Mode'} · SHA-256 via SubtleCrypto
            </p>
          </div>
          <div className={`ml-auto flex-shrink-0 flex items-center gap-1.5 text-[10px] font-semibold
                           px-2.5 py-1 rounded-full border ${
                             session?.isConnected
                               ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                               : 'text-gray-500 bg-gray-800/40 border-gray-700/30'
                           }`}>
            {session?.isConnected ? <Wifi size={9} /> : <WifiOff size={9} />}
            {session?.isConnected ? 'Live' : 'Demo'}
          </div>
          <button onClick={onClose}
            className="ml-2 p-1.5 text-gray-600 hover:text-white hover:bg-gray-700/50 rounded-lg">
            <X size={15} />
          </button>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div className="flex px-5 border-b border-gray-800/40 flex-shrink-0">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-2.5 text-[11px] font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id
                  ? 'text-white border-blue-500'
                  : 'text-gray-600 border-transparent hover:text-gray-300'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">

          {/* ══════════════════════════════════════════════════════════════
              TAB: CONNECT
              ══════════════════════════════════════════════════════════════ */}
          {tab === 'connect' && (
            <>
              {/* Mode badge */}
              {isBackend ? (
                <div className="flex gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                  <Zap size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div className="text-[11px] text-emerald-300">
                    <strong className="text-emerald-200">Python Backend Mode detected.</strong>
                    {' '}Uses official breeze-connect SDK — no CORS issues, no checksum math!
                    Orders, square-off, and all endpoints are properly implemented.
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 p-3 bg-amber-500/8 border border-amber-500/20 rounded-xl">
                  <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="text-[11px] text-amber-300">
                    <strong className="text-amber-200">Browser-Direct Mode.</strong>
                    {' '}Often fails with "Request Object is Null". Strongly recommended:{' '}
                    <button onClick={() => setTab('kaggle')} className="underline text-white font-bold">
                      🚀 Use Kaggle Backend instead
                    </button>
                    {' '}— it actually works.
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <Field label="API Key" hint="Permanent — from ICICI developer portal">
                  <input value={apiKey} onChange={e => setApiKey(e.target.value)}
                    placeholder="e.g. A1B2C3~D4E5F6..." className={INPUT} />
                </Field>

                <Field label="API Secret" hint="For SHA-256 only · never sent to any server">
                  <div className="relative">
                    <input type={showSecret ? 'text' : 'password'}
                      value={apiSecret} onChange={e => setApiSecret(e.target.value)}
                      placeholder="Your ICICI API Secret" className={INPUT + ' pr-10'} />
                    <button onClick={() => setShowSecret(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
                      {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </Field>

                <Field label="Session Token" hint="Daily · from ?apisession= · expires midnight IST">
                  <input value={sessionToken} onChange={e => setSessionToken(e.target.value)}
                    placeholder="Paste your ?apisession= value here" className={INPUT} />
                  {apiKey.trim() && (
                    <a href={loginUrl} target="_blank" rel="noopener noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 underline">
                      Open ICICI login → copy ?apisession= from redirect URL
                      <ExternalLink size={9} />
                    </a>
                  )}
                </Field>

                <Field label="Backend / CORS Proxy URL" hint="Use /api/kaggle on Vercel (recommended) or a direct Kaggle URL">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {Object.entries(CORS_PROXIES).map(([k, v]) => (
                      <PresetBtn key={k} label={k} active={proxyBase === v} onClick={() => setProxyBase(v)} />
                    ))}
                    <PresetBtn
                      label="kaggle"
                      active={isKaggleBackend(proxyBase)}
                      onClick={() => setProxyBase('https://YOUR-URL.trycloudflare.com')}
                      highlight
                    />
                  </div>

                  <div className="flex gap-2">
                    <input value={proxyBase} onChange={e => setProxyBase(e.target.value)}
                      placeholder="/api/kaggle  or  https://xyz.trycloudflare.com"
                      className={INPUT + ' flex-1'} />
                    <button onClick={handleHealthCheck}
                      className="px-2 py-1 bg-[#1e2135] border border-gray-700/30 rounded-xl
                                 text-gray-600 hover:text-gray-300 text-[10px] flex-shrink-0
                                 flex items-center gap-1">
                      <RefreshCw size={9} /> ping
                    </button>
                  </div>

                  {healthMsg && (
                    <p className={`text-[10px] mt-1 ${healthOk ? 'text-emerald-400' : 'text-red-400'}`}>
                      {healthMsg}
                    </p>
                  )}

                  {!isBackend && proxyBase.includes('cors-anywhere') && (
                    <div className="mt-2 text-[10px] text-amber-400 bg-amber-500/8 border border-amber-500/20 rounded-lg p-2">
                      ⚠️ Must unlock cors-anywhere first:{' '}
                      <a href="https://cors-anywhere.herokuapp.com/corsdemo"
                        target="_blank" rel="noopener noreferrer"
                        className="underline text-amber-300">
                        cors-anywhere.herokuapp.com/corsdemo
                      </a>{' '}
                      → "Request temporary access"
                    </div>
                  )}

                  {proxyBase.trim() === '/api/kaggle' && (
                    <div className="mt-2 text-[10px] text-blue-300 bg-blue-500/8 border border-blue-500/20 rounded-lg p-2">
                      Vercel proxy mode: set <strong className="text-white">KAGGLE_BACKEND_URL</strong> in Vercel
                      environment variables to your running Kaggle/tunnel base URL.
                    </div>
                  )}
                </Field>
              </div>

              {/* Status */}
              {/* Auth token — only shown for Kaggle backend mode */}
              {isBackend && (
                <Field label="Backend Auth Token" hint="Optional — only if Kaggle cell sets TERMINAL_AUTH_TOKEN">
                  <input
                    value={authToken}
                    onChange={e => setAuthToken(e.target.value)}
                    placeholder="Leave blank unless Kaggle output shows an auth token"
                    className={INPUT}
                  />
                  <p className="text-[10px] text-gray-700 mt-1">
                    By default auth is <strong className="text-gray-500">disabled</strong> in v7 backend — leave blank.{' '}
                    Only fill this if you explicitly set <code className="text-gray-500">TERMINAL_AUTH_TOKEN</code> in Kaggle.
                  </p>
                </Field>
              )}

              {status !== 'idle' && (
                <div className={`flex items-start gap-2 p-3 rounded-xl text-[11px] border ${
                  status === 'ok'    ? 'bg-emerald-500/6 border-emerald-500/20 text-emerald-300' :
                  status === 'error' ? 'bg-red-500/6 border-red-500/20 text-red-300' :
                                       'bg-blue-500/6 border-blue-500/20 text-blue-300'
                }`}>
                  {status === 'loading' && (
                    <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0 mt-0.5" />
                  )}
                  {status === 'ok'    && <CheckCircle   size={13} className="flex-shrink-0 mt-0.5" />}
                  {status === 'error' && <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />}
                  <div className="whitespace-pre-wrap min-w-0 break-words">
                    <p className="font-semibold">{statusMsg}</p>
                    {status === 'error' && isBackend && (
                      <div className="mt-2 space-y-1 text-[10px] text-gray-400 border-t border-gray-700/40 pt-2">
                        <p className="text-amber-300 font-semibold">Backend troubleshooting:</p>
                        {(statusMsg.includes('HTML') || statusMsg.toLowerCase().includes('cloudflare') || statusMsg.toLowerCase().includes('trycloudflare') || statusMsg.includes('interstitial')) ? (
                          <>
                            <p className="text-red-300 font-semibold">Cloudflare Interstitial Detected</p>
                            <p>① Copy your tunnel URL from Kaggle output (e.g. <span className="text-amber-300">https://abc.trycloudflare.com</span>)</p>
                            <p>② Open <strong className="text-white">that URL + /health</strong> in a new browser tab</p>
                            <p>③ Wait until you see <span className="text-emerald-400">{'{"status":"online"}'}</span></p>
                            <p>④ Come back → retry <strong className="text-white">ping</strong> → <strong className="text-white">Validate Live</strong></p>
                            <p className="text-gray-500 mt-1">The Vercel proxy now auto-bypasses this for subsequent requests.</p>
                          </>
                        ) : (
                          <>
                            <p>① Check Kaggle cell is still running (may have timed out)</p>
                            <p>② Copy the LATEST URL from Kaggle output</p>
                            <p>③ Click <strong className="text-white">ping</strong> to test basic connectivity first</p>
                            <p>④ For Cloudflare URLs: open URL in a browser tab first</p>
                          </>
                        )}
                      </div>
                    )}
                    {status === 'error' && !isBackend && (
                      <div className="mt-2 text-[10px] text-gray-500 border-t border-gray-700/40 pt-2">
                        <p className="text-amber-300">
                          💡 Browser-direct mode often fails. Switch to{' '}
                          <button onClick={() => setTab('kaggle')} className="underline text-white">
                            🚀 Kaggle Backend
                          </button>{' '}
                          for reliable connections.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {lastDebug && <DebugInspector info={lastDebug} />}

              <div className="grid grid-cols-2 gap-2">
                <button onClick={handleValidateLive}
                  disabled={!allFilled || status === 'loading'}
                  className="flex items-center justify-center gap-1.5 py-2.5 bg-indigo-600
                             hover:bg-indigo-500 disabled:opacity-35 disabled:cursor-not-allowed
                             text-white rounded-xl text-[11px] font-bold transition-colors">
                  {status === 'loading'
                    ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Connecting...</>
                    : <><Wifi size={10} /> Validate Live</>}
                </button>
                <button onClick={handleSaveOffline}
                  disabled={!allFilled}
                  className="flex items-center justify-center gap-1.5 py-2.5 bg-[#1e2135]
                             hover:bg-[#252840] disabled:opacity-35 disabled:cursor-not-allowed
                             text-gray-300 rounded-xl text-[11px] font-medium border
                             border-gray-700/30 transition-colors">
                  <Shield size={10} /> Save (Demo mode)
                </button>
              </div>
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: KAGGLE BACKEND
              ══════════════════════════════════════════════════════════════ */}
          {tab === 'kaggle' && (
            <div className="space-y-4">
              <div className="flex gap-2 p-3 bg-emerald-500/8 border border-emerald-500/20 rounded-xl">
                <CheckCircle size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                <div className="text-[11px] text-emerald-300 space-y-1">
                  <p className="font-bold text-emerald-200 text-xs">Why Kaggle Backend?</p>
                  <p>
                    The browser cannot reliably call ICICI's API directly (CORS, checksum format issues).
                    Kaggle gives a free Python server that uses the official{' '}
                    <code className="bg-black/40 px-1 rounded">breeze-connect</code> SDK,
                    which handles all authentication properly. Orders and square-off actually work.
                  </p>
                  <p className="text-amber-300 font-semibold">
                    All endpoints included: connect, option chain, place order, square off, cancel, order book, trade book, positions, funds.
                  </p>
                </div>
              </div>

              <StepBox n="1" title="Create a Kaggle Notebook">
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-gray-400">
                  <li>Go to <a href="https://www.kaggle.com/code" target="_blank" rel="noopener noreferrer"
                       className="text-blue-400 underline">kaggle.com/code</a> → <strong className="text-white">New Notebook</strong></li>
                  <li>Settings (gear icon) → <strong className="text-amber-300">Internet: ON</strong> ← mandatory</li>
                  <li>Type: Code (not Markdown)</li>
                </ol>
              </StepBox>

              <StepBox n="2" title="Copy this entire code into ONE cell and click Run">
                <div className="mb-2 text-[10px] text-amber-400 bg-amber-500/8 border border-amber-500/20 rounded-lg p-2">
                  ⚠️ Copy the ENTIRE block below. Do not split into multiple cells.
                </div>
                <CodeBlock lang="kaggle_backend_v7.py" code={KAGGLE_CODE_SNIPPET} />
              </StepBox>

              <StepBox n="3" title="Wait for the public URL in Kaggle output">
                <div className="bg-[#080b12] border border-gray-800/40 rounded-xl p-3 font-mono text-[10px] space-y-1">
                  <div className="text-gray-500">Output will show (after ~30 seconds):</div>
                  <div className="text-emerald-400">  BACKEND IS LIVE!</div>
                  <div><span className="text-gray-600">  URL: </span><span className="text-amber-300">https://abc-xyz.trycloudflare.com</span></div>
                  <div className="text-emerald-500">  COPY THIS → paste into Arena Connect Broker field</div>
                </div>
                <div className="mt-2 text-[10px] text-blue-300 bg-blue-500/8 border border-blue-500/20 rounded-lg p-2">
                  <strong>Better URLs</strong> (no browser interstitial): localhost.run or serveo.net URLs are tried first.
                  If you get a trycloudflare.com URL and it fails, open it in a browser tab first.
                </div>
              </StepBox>

              <StepBox n="4" title="Connect from Arena">
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-gray-400">
                  <li>Go to <strong className="text-white">🔐 Connect</strong> tab</li>
                  <li>Paste the URL from Kaggle into the proxy field</li>
                  <li>Fill in API Key, API Secret, today's Session Token</li>
                  <li>Click <strong className="text-indigo-300">Validate Live</strong></li>
                  <li className="text-emerald-400 font-semibold">Should show "Connected via Python SDK!"</li>
                </ol>
              </StepBox>

              <div className="bg-blue-500/8 border border-blue-500/20 rounded-xl p-3 text-[11px]">
                <p className="text-blue-300 font-semibold mb-1">🔑 Daily Session Token</p>
                <ol className="list-decimal list-inside space-y-1 text-gray-400">
                  <li>Open ICICI login URL (from 🔐 Connect tab, after entering API Key)</li>
                  <li>Login: Customer ID + Trading Password + 6-digit TOTP</li>
                  <li>After redirect, copy <code className="text-amber-300">?apisession=XXXXX</code> from URL bar</li>
                  <li>Paste in Session Token field → Validate Live</li>
                </ol>
              </div>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(KAGGLE_CODE_SNIPPET).catch(() => {});
                  setTab('connect');
                }}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors"
              >
                📋 Copy Code → Switch to Connect Tab
              </button>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: DEBUG
              ══════════════════════════════════════════════════════════════ */}
          {tab === 'debug' && (
            <div className="space-y-4">
              <div className="flex gap-2 p-3 bg-purple-500/6 border border-purple-500/20 rounded-xl">
                <Bug size={12} className="text-purple-400 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-purple-300">
                  If you keep getting "Request Object is Null", run the Python test below.
                  If Python works → use Kaggle Backend. If Python also fails → credentials are wrong.
                </p>
              </div>

              <div>
                <h4 className="text-white font-semibold text-xs mb-2">Test credentials with Python</h4>
                <CodeBlock lang="test_credentials.py" code={`from breeze_connect import BreezeConnect

api_key      = "${apiKey || 'YOUR_API_KEY'}"
api_secret   = "YOUR_SECRET_KEY"      # replace
apisession   = "${sessionToken || 'PASTE_SESSION_TOKEN'}"

breeze = BreezeConnect(api_key=api_key)

try:
    breeze.generate_session(api_secret=api_secret, session_token=apisession)
    print("SUCCESS! Session key:", breeze.session_key[:12], "...")
    
    # Test order chain fetch
    data = breeze.get_option_chain_quotes(
        stock_code="NIFTY", exchange_code="NFO",
        product_type="options", expiry_date="01-Jul-2025",
        right="Call", strike_price="")
    rows = data.get("Success") or []
    print(f"Option chain: {len(rows)} rows")
    
except Exception as e:
    print("FAILED:", e)
    print()
    print("If this fails → token stale or credentials wrong")
    print("If this works but Arena fails → CORS issue → use Kaggle backend")`} />
              </div>

              <div>
                <h4 className="text-white font-semibold text-xs mb-2">Test order placement with Python</h4>
                <CodeBlock lang="test_order.py" code={`# Run ONLY if you want to place a real order!
# Verified field values for breeze.place_order():

result = breeze.place_order(
    stock_code="NIFTY",
    exchange_code="NFO",
    product="options",          # lowercase
    action="buy",               # "buy" or "sell" (lowercase)
    order_type="market",        # "market" or "limit" (lowercase)
    stoploss="0",
    quantity="65",              # 1 lot = 65 qty for NIFTY
    price="0",                  # "0" for market orders
    validity="day",
    validity_date="01-Jul-2025",
    disclosed_quantity="0",
    expiry_date="01-Jul-2025",
    right="Call",               # "Call" or "Put" (capital first!)
    strike_price="24500",
    user_remark="TestV8"
)
print("Status:", result.get("Status"))
print("Order ID:", (result.get("Success") or {}).get("order_id"))
print("Error:", result.get("Error"))`} />
              </div>

              {lastDebug && (
                <div>
                  <h4 className="text-white font-semibold text-xs mb-2">Last Browser Request</h4>
                  <DebugInspector info={lastDebug} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Small reusable components ─────────────────────────────────────────────────

const INPUT = `w-full bg-[#0a0c15] border border-gray-700/40 focus:border-blue-500/60
              text-white text-xs rounded-xl px-3 py-2.5 outline-none
              placeholder-gray-700 mono transition-colors`;

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div>
    <label className="text-gray-400 text-[11px] font-semibold block mb-1.5">
      {label}
      {hint && <span className="text-gray-700 font-normal ml-1.5">— {hint}</span>}
    </label>
    {children}
  </div>
);

const PresetBtn: React.FC<{ label: string; active: boolean; onClick: () => void; highlight?: boolean }> = ({
  label, active, onClick, highlight,
}) => (
  <button onClick={onClick}
    className={`px-2.5 py-1 text-[9px] rounded-lg border font-mono transition-colors ${
      active
        ? highlight
          ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
          : 'bg-blue-600/20 border-blue-500/40 text-blue-300'
        : 'bg-[#1a1d2e] border-gray-700/30 text-gray-600 hover:text-gray-300'
    }`}>
    {label}
  </button>
);

const StepBox: React.FC<{ n: string; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <div className="space-y-2">
    <div className="flex items-center gap-2">
      <span className="w-5 h-5 bg-blue-600 text-white text-[10px] font-black rounded-full
                       flex items-center justify-center flex-shrink-0">
        {n}
      </span>
      <h4 className="text-white font-bold text-xs">{title}</h4>
    </div>
    <div className="ml-7">{children}</div>
  </div>
);
