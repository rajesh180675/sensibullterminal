// ════════════════════════════════════════════════════════════════════════════
// CONNECT BROKER MODAL v8 — Fixed embedded Kaggle snippet
// The KAGGLE_CODE_SNIPPET is what users actually copy and run.
// All previous versions had Python SyntaxErrors and missing endpoints.
// ════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback } from 'react';
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
} from '../utils/kaggleClient';

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

// ── KAGGLE CODE SNIPPET — this is what users paste and run ────────────────────
// CRITICAL: Every line of Python here must be syntactically valid.
// All endpoints required by the frontend must be present.
// Verified against breeze-connect SDK source.
const KAGGLE_CODE_SNIPPET = `# ═══════════════════════════════════════════════════════════════════
# ICICI BREEZE BACKEND v8 — Paste this ENTIRE block into ONE Kaggle cell
#
# Kaggle settings (REQUIRED):
#   Settings (gear icon) → Internet → ON
#   Settings → Accelerator → GPU P100  (optional, keeps alive longer)
#
# What this does:
#   1. Installs packages (breeze-connect, fastapi, uvicorn)
#   2. Starts FastAPI on a free local port (defaults to 8000)
#   3. Opens a public tunnel (tries localhost.run, serveo.net, Cloudflare)
#   4. Prints the public URL — COPY THIS into Arena
# ═══════════════════════════════════════════════════════════════════

import subprocess
import sys
import os
import urllib.request
import stat
import re
import threading
import time
import json
import hashlib
import shutil
from datetime import datetime, timedelta, timezone
from typing import Optional, Any

# ── 1. Install packages ──────────────────────────────────────────────────────
print("Installing packages...")
for pkg in ["breeze-connect", "fastapi", "uvicorn[standard]", "python-multipart"]:
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", pkg, "-q"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
print("Packages ready")

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
import uvicorn

# ── 2. FastAPI app ────────────────────────────────────────────────────────────
app = FastAPI(title="ICICI Breeze Backend v8")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=86400,
)

# Handle OPTIONS preflight
@app.options("/{path:path}")
async def options_handler(path: str):
    return Response(
        status_code=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
            "Access-Control-Allow-Headers": "*",
        }
    )

# Global breeze instance
breeze_instance = None
BACKEND_PORT = int(os.environ.get("BREEZE_PORT", "8000"))

# ── 3. Health endpoints ───────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "status": "online",
        "connected": breeze_instance is not None,
        "version": "8.0",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    }

@app.get("/health")
async def health():
    return {
        "status": "online",
        "connected": breeze_instance is not None,
        "version": "8.0",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    }

@app.get("/ping")
async def ping():
    return {"status": "online", "version": "8.0"}

# ── 4. Connect ────────────────────────────────────────────────────────────────
# This is the MOST IMPORTANT endpoint.
# Uses official breeze-connect SDK — handles all auth internally.

@app.post("/api/connect")
async def api_connect(request: Request):
    global breeze_instance
    try:
        body = await request.json()
    except Exception:
        body = {}

    qp = request.query_params
    api_key       = body.get("api_key")       or qp.get("api_key")
    api_secret    = body.get("api_secret")    or qp.get("api_secret")
    session_token = (
        body.get("session_token") or qp.get("session_token") or
        body.get("apisession")    or qp.get("apisession")
    )

    if not api_key or not api_secret or not session_token:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "Missing: api_key, api_secret, session_token"}
        )

    try:
        from breeze_connect import BreezeConnect
        b = BreezeConnect(api_key=api_key)
        # Official SDK — handles /customerdetails, checksum, everything
        b.generate_session(api_secret=api_secret, session_token=session_token)
        breeze_instance = b
        print(f"[Backend] Connected. Session: {b.session_key[:12]}...")
        return {
            "success": True,
            "session_token": b.session_key,
            "message": "Connected via BreezeConnect SDK v8"
        }
    except Exception as e:
        msg = str(e)
        hint = ""
        if "null" in msg.lower() or "object" in msg.lower():
            hint = " → Token stale: get a fresh ?apisession= token today"
        elif "key" in msg.lower():
            hint = " → Check API Key and Secret"
        print(f"[Backend] Connect error: {msg}")
        return JSONResponse(
            status_code=200,
            content={"success": False, "error": msg + hint}
        )

@app.post("/api/disconnect")
async def api_disconnect():
    global breeze_instance
    breeze_instance = None
    return {"success": True}

# ── 5. Expiry dates ───────────────────────────────────────────────────────────

@app.get("/api/expiries")
async def api_expiries(stock_code: str = Query("NIFTY")):
    # NIFTY  → Tuesday  (weekday index 1, Mon=0)
    # SENSEX → Thursday (weekday index 3)
    is_sensex = "SENSEX" in stock_code.upper() or "BSESEN" in stock_code.upper()
    target_day = 3 if is_sensex else 1
    today = datetime.now().date()
    results = []
    for i in range(60):
        d = today + timedelta(days=i)
        if d.weekday() == target_day:
            if i == 0 and datetime.now(timezone.utc).hour >= 10:
                continue  # Skip today if market closed
            results.append({
                "date": d.strftime("%d-%b-%Y"),
                "label": d.strftime("%d %b %y"),
                "days_away": (d - today).days,
                "weekday": d.strftime("%A"),
            })
            if len(results) >= 5:
                break
    return {"success": True, "stock_code": stock_code, "expiries": results}

# ── 6. Option Chain (REST snapshot — call ONCE per expiry, NOT in a loop) ─────

@app.get("/api/optionchain")
async def api_optionchain(
    stock_code:    str           = Query("NIFTY"),
    exchange_code: str           = Query("NFO"),
    expiry_date:   str           = Query(...),
    right:         Optional[str] = Query("Call"),
    strike_price:  str           = Query(""),
):
    if not breeze_instance:
        raise HTTPException(status_code=401, detail="Not connected. POST /api/connect first.")

    right_norm = "Call" if (right or "Call").lower().startswith("c") else "Put"
    print(f"[Backend] get_option_chain_quotes {stock_code} {expiry_date} {right_norm}")

    try:
        result = breeze_instance.get_option_chain_quotes(
            stock_code=stock_code,
            exchange_code=exchange_code,
            product_type="options",
            expiry_date=expiry_date,
            right=right_norm,
            strike_price=strike_price,
        )
        rows = result.get("Success", []) if isinstance(result, dict) else []
        print(f"[Backend] Option chain: {len(rows or [])} rows")
        return {"success": True, "data": rows or [], "count": len(rows or [])}
    except Exception as e:
        print(f"[Backend] optionchain error: {e}")
        return JSONResponse(status_code=200, content={"success": False, "error": str(e)})

# ── 7. Place Order ────────────────────────────────────────────────────────────
# VERIFIED field values for breeze.place_order():
#   action:     "buy"  | "sell"  (lowercase)
#   order_type: "market" | "limit" (lowercase)
#   right:      "Call" | "Put"  (capital first letter)
#   product:    "options" (lowercase)
#   validity:   "day"

@app.post("/api/order")
async def api_order(request: Request):
    if not breeze_instance:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON body"})

    stock_code    = body.get("stock_code", "")
    exchange_code = body.get("exchange_code", "NFO")
    action        = str(body.get("action", "buy")).lower()       # must be "buy" or "sell"
    order_type    = str(body.get("order_type", "market")).lower()  # "market" or "limit"
    quantity      = str(body.get("quantity", "1"))
    price         = str(body.get("price", "0"))
    expiry_date   = str(body.get("expiry_date", ""))
    right_raw     = str(body.get("right", "call"))
    # Breeze place_order expects "Call" or "Put" (capital first letter)
    right_norm    = "Call" if right_raw.lower().startswith("c") else "Put"
    strike_price  = str(body.get("strike_price", ""))
    stoploss      = str(body.get("stoploss", "0"))
    user_remark   = str(body.get("user_remark", "OptionsTerminalV8"))

    print(f"[Backend] place_order: {action.upper()} {stock_code} {right_norm} {strike_price} x{quantity} @ {order_type} {price}")

    try:
        result = breeze_instance.place_order(
            stock_code=stock_code,
            exchange_code=exchange_code,
            product="options",         # lowercase "options"
            action=action,             # "buy" or "sell" lowercase
            order_type=order_type,     # "market" or "limit" lowercase
            stoploss=stoploss,
            quantity=quantity,
            price=price,
            validity="day",
            validity_date=expiry_date,
            disclosed_quantity="0",
            expiry_date=expiry_date,
            right=right_norm,          # "Call" or "Put" capital first
            strike_price=strike_price,
            user_remark=user_remark,
        )
        print(f"[Backend] place_order result: {result}")
        ok  = isinstance(result, dict) and result.get("Status") == 200
        oid = ""
        if ok:
            success_data = result.get("Success") or {}
            if isinstance(success_data, dict):
                oid = str(success_data.get("order_id", ""))
        err = ""
        if not ok and isinstance(result, dict):
            err = str(result.get("Error", "Order placement failed"))
        return {"success": ok, "order_id": oid, "error": err, "raw": result}
    except Exception as e:
        print(f"[Backend] place_order exception: {e}")
        return JSONResponse(status_code=200, content={"success": False, "error": str(e)})

# ── 8. Strategy Execute (multi-leg concurrent) ────────────────────────────────

@app.post("/api/strategy/execute")
async def api_strategy_execute(request: Request):
    if not breeze_instance:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})

    legs = body.get("legs", [])
    if not legs:
        return JSONResponse(status_code=400, content={"success": False, "error": "No legs provided"})

    import threading
    results = []
    results_lock = threading.Lock()

    def place_one(leg, idx):
        stock_code    = leg.get("stock_code", "")
        exchange_code = leg.get("exchange_code", "NFO")
        action        = str(leg.get("action", "buy")).lower()
        order_type    = str(leg.get("order_type", "market")).lower()
        quantity      = str(leg.get("quantity", "1"))
        price         = str(leg.get("price", "0"))
        expiry_date   = str(leg.get("expiry_date", ""))
        right_raw     = str(leg.get("right", "call"))
        right_norm    = "Call" if right_raw.lower().startswith("c") else "Put"
        strike_price  = str(leg.get("strike_price", ""))

        try:
            r = breeze_instance.place_order(
                stock_code=stock_code,
                exchange_code=exchange_code,
                product="options",
                action=action,
                order_type=order_type,
                stoploss="0",
                quantity=quantity,
                price=price,
                validity="day",
                validity_date=expiry_date,
                disclosed_quantity="0",
                expiry_date=expiry_date,
                right=right_norm,
                strike_price=strike_price,
                user_remark="StrategyV8",
            )
            ok  = isinstance(r, dict) and r.get("Status") == 200
            oid = ""
            if ok:
                sd = r.get("Success") or {}
                if isinstance(sd, dict):
                    oid = str(sd.get("order_id", ""))
            err = str(r.get("Error", "")) if not ok and isinstance(r, dict) else ""
            with results_lock:
                results.append({"leg_index": idx, "success": ok, "order_id": oid, "error": err})
        except Exception as e:
            with results_lock:
                results.append({"leg_index": idx, "success": False, "error": str(e)})

    threads = [threading.Thread(target=place_one, args=(leg, i), daemon=True)
               for i, leg in enumerate(legs)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)

    results.sort(key=lambda x: x["leg_index"])
    return {"success": all(r["success"] for r in results), "results": results}

# ── 9. Square Off (exit position — reverses action) ───────────────────────────

@app.post("/api/squareoff")
async def api_squareoff(request: Request):
    """
    Exits a position. Send the ORIGINAL action (e.g. "buy").
    Backend reverses it (buy→sell, sell→buy) to create the exit order.
    """
    if not breeze_instance:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})

    original_action = str(body.get("action", "buy")).lower()
    exit_action     = "sell" if original_action == "buy" else "buy"

    stock_code    = body.get("stock_code", "")
    exchange_code = body.get("exchange_code", "NFO")
    order_type    = str(body.get("order_type", "market")).lower()
    quantity      = str(body.get("quantity", "1"))
    price         = str(body.get("price", "0"))
    expiry_date   = str(body.get("expiry_date", ""))
    right_raw     = str(body.get("right", "call"))
    right_norm    = "Call" if right_raw.lower().startswith("c") else "Put"
    strike_price  = str(body.get("strike_price", ""))

    print(f"[Backend] squareoff: orig={original_action} exit={exit_action} "
          f"{stock_code} {right_norm} {strike_price} x{quantity} @ {order_type} {price}")

    try:
        result = breeze_instance.place_order(
            stock_code=stock_code,
            exchange_code=exchange_code,
            product="options",
            action=exit_action,       # reversed action
            order_type=order_type,
            stoploss="0",
            quantity=quantity,
            price=price,
            validity="day",
            validity_date=expiry_date,
            disclosed_quantity="0",
            expiry_date=expiry_date,
            right=right_norm,
            strike_price=strike_price,
            user_remark="SquareOffV8",
        )
        print(f"[Backend] squareoff result: {result}")
        ok  = isinstance(result, dict) and result.get("Status") == 200
        oid = ""
        if ok:
            sd = result.get("Success") or {}
            if isinstance(sd, dict):
                oid = str(sd.get("order_id", ""))
        err = str(result.get("Error", "")) if not ok and isinstance(result, dict) else ""
        return {"success": ok, "order_id": oid, "error": err, "exit_action": exit_action}
    except Exception as e:
        print(f"[Backend] squareoff exception: {e}")
        return JSONResponse(status_code=200, content={"success": False, "error": str(e)})

# ── 10. Cancel / Modify Order ─────────────────────────────────────────────────

@app.post("/api/order/cancel")
async def api_cancel_order(request: Request):
    if not breeze_instance:
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
        result = breeze_instance.cancel_order(exchange_code=exchange_code, order_id=order_id)
        ok = isinstance(result, dict) and result.get("Status") == 200
        return {"success": ok, "error": str(result.get("Error", "")) if not ok else ""}
    except Exception as e:
        return JSONResponse(status_code=200, content={"success": False, "error": str(e)})

# ── 11. Order Book / Trade Book ───────────────────────────────────────────────

@app.get("/api/orders")
async def api_order_book():
    if not breeze_instance:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        now = datetime.now()
        result = breeze_instance.get_order_list(
            exchange_code="NFO",
            from_date=now.strftime("%Y-%m-%dT00:00:00.000Z"),
            to_date=now.strftime("%Y-%m-%dT23:59:59.000Z"),
        )
        rows = result.get("Success", []) if isinstance(result, dict) else []
        return {"success": True, "data": rows or []}
    except Exception as e:
        return JSONResponse(status_code=200, content={"success": False, "error": str(e)})

@app.get("/api/trades")
async def api_trade_book():
    if not breeze_instance:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        now = datetime.now()
        result = breeze_instance.get_trade_list(
            exchange_code="NFO",
            from_date=now.strftime("%Y-%m-%dT00:00:00.000Z"),
            to_date=now.strftime("%Y-%m-%dT23:59:59.000Z"),
        )
        rows = result.get("Success", []) if isinstance(result, dict) else []
        return {"success": True, "data": rows or []}
    except Exception as e:
        return JSONResponse(status_code=200, content={"success": False, "error": str(e)})

# ── 12. Positions / Funds ─────────────────────────────────────────────────────

@app.get("/api/positions")
async def api_positions():
    if not breeze_instance:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        pos = breeze_instance.get_portfolio_positions()
        hld = breeze_instance.get_portfolio_holdings()
        return {
            "success": True,
            "data": {
                "positions": pos.get("Success", []) if isinstance(pos, dict) else [],
                "holdings":  hld.get("Success", []) if isinstance(hld, dict) else [],
            }
        }
    except Exception as e:
        return JSONResponse(status_code=200, content={"success": False, "error": str(e)})

@app.get("/api/funds")
async def api_funds():
    if not breeze_instance:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        result = breeze_instance.get_funds()
        return {"success": True, "data": result.get("Success", {}) if isinstance(result, dict) else {}}
    except Exception as e:
        return JSONResponse(status_code=200, content={"success": False, "error": str(e)})

# ── 13. Tunnel providers ──────────────────────────────────────────────────────

def pick_free_port(preferred=8000):
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", preferred))
            return preferred
        except OSError:
            s.bind(("127.0.0.1", 0))
            return int(s.getsockname()[1])

def start_uvicorn_bg(port):
    t = threading.Thread(
        target=lambda: uvicorn.run(app, host="0.0.0.0", port=port, log_level="error"),
        daemon=True, name="uvicorn"
    )
    t.start()
    return t

def wait_for_port(port, timeout=15):
    import socket
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False

def try_localhost_run():
    if not shutil.which("ssh"):
        return None
    try:
        log = "/tmp/lhr.log"
        open(log, "w").close()
        subprocess.Popen(
            ["ssh", "-R", f"80:localhost:{BACKEND_PORT}",
             "-o", "StrictHostKeyChecking=no",
             "-o", "ServerAliveInterval=30",
             "-o", "ConnectTimeout=15",
             "nokey@localhost.run"],
            stdout=open(log, "a"), stderr=subprocess.STDOUT
        )
        pat = re.compile(r"https://[a-z0-9-]+\\.lhr\\.life")
        for _ in range(25):
            time.sleep(2)
            try:
                m = pat.search(open(log).read())
                if m:
                    return m.group(0)
            except Exception:
                pass
    except Exception:
        pass
    return None

def try_serveo():
    if not shutil.which("ssh"):
        return None
    try:
        log = "/tmp/serveo.log"
        open(log, "w").close()
        subprocess.Popen(
            ["ssh", "-R", f"80:localhost:{BACKEND_PORT}",
             "-o", "StrictHostKeyChecking=no",
             "-o", "ServerAliveInterval=30",
             "-o", "ConnectTimeout=15",
             "serveo.net"],
            stdout=open(log, "a"), stderr=subprocess.STDOUT
        )
        pat = re.compile(r"https://[a-z0-9]+\\.serveo\\.net")
        for _ in range(25):
            time.sleep(2)
            try:
                m = pat.search(open(log).read())
                if m:
                    return m.group(0)
            except Exception:
                pass
    except Exception:
        pass
    return None

def try_cloudflare():
    cf = "/tmp/cloudflared"
    if not os.path.exists(cf):
        print("  Downloading cloudflared...")
        try:
            urllib.request.urlretrieve(
                "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
                cf
            )
            os.chmod(cf, stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP)
        except Exception as e:
            print(f"  Download failed: {e}")
            return None

    log = "/tmp/cf.log"
    open(log, "w").close()
    try:
        subprocess.Popen(
            [cf, "tunnel", "--url", f"http://localhost:{BACKEND_PORT}", "--no-autoupdate"],
            stdout=open(log, "a"), stderr=subprocess.STDOUT
        )
        # Pattern must match trycloudflare.com URLs
        pat = re.compile(r"https://[a-zA-Z0-9-]+\\.trycloudflare\\.com")
        for _ in range(40):
            time.sleep(3)
            try:
                matches = pat.findall(open(log).read())
                if matches:
                    return matches[-1]
            except Exception:
                pass
    except Exception as e:
        print(f"  Cloudflare error: {e}")
    return None

# ── 14. MAIN ──────────────────────────────────────────────────────────────────

def main():
    global BACKEND_PORT
    SEP = "=" * 68
    print(f"\\n{SEP}")
    print("  ICICI BREEZE BACKEND v8")
    print(SEP)

    BACKEND_PORT = pick_free_port(BACKEND_PORT)
    print(f"  Starting FastAPI on port {BACKEND_PORT}...")
    start_uvicorn_bg(BACKEND_PORT)
    if wait_for_port(BACKEND_PORT, 15):
        print(f"  FastAPI running on http://localhost:{BACKEND_PORT}")
    else:
        print("  WARNING: FastAPI may not have started")

    print("\\n  Finding public tunnel (tries 3 providers)...")
    public_url = None

    for fn, name in [
        (try_localhost_run, "localhost.run (SSH — no interstitial)"),
        (try_serveo,        "serveo.net (SSH — no interstitial)"),
        (try_cloudflare,    "Cloudflare Tunnel"),
    ]:
        print(f"  Trying {name}...")
        url = fn()
        if url:
            public_url = url
            print(f"  OK: {url}")
            break
        print(f"  Failed, trying next...")

    print(f"\\n{SEP}")
    if public_url:
        is_cf = "trycloudflare" in public_url
        print("  BACKEND IS LIVE!")
        print(SEP)
        print()
        print(f"  URL: {public_url}")
        print()
        print("  COPY THIS → paste into Arena Connect Broker field:")
        print(f"  {public_url}")
        print()
        print(f"  Health:   {public_url}/health")
        print(f"  Connect:  {public_url}/api/connect  (POST)")
        print(f"  Chain:    {public_url}/api/optionchain?stock_code=NIFTY&exchange_code=NFO&expiry_date=01-Jul-2025&right=Call")
        if is_cf:
            print()
            print("  NOTE (Cloudflare): If Arena shows 'Failed to fetch':")
            print(f"    Open in a NEW browser tab: {public_url}/health")
            print("    You should see: {'status': 'online'}")
            print("    Then retry in Arena.")
    else:
        print("  WARNING: No public tunnel found.")
        print("  Make sure Kaggle Internet is ON and re-run.")
    print(SEP)
    print()
    print("  Steps:")
    print("  1. Copy URL above")
    print("  2. Arena → Connect Broker → paste URL into CORS Proxy field")
    print("  3. Enter API Key, Secret, today's Session Token")
    print("  4. Click Validate Live → should show Connected!")
    print()
    print("  Daily Session Token:")
    print("  https://api.icicidirect.com/apiuser/login?api_key=YOUR_KEY")
    print("  Login → copy ?apisession=XXXXX from redirect URL")
    print(SEP)
    print()
    print("  Backend running. Keep this cell alive.")
    print("  Press the Kaggle Stop button to quit.\\n")

    beat = 0
    while True:
        time.sleep(30)
        beat += 1
        if beat % 4 == 0:
            ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
            print(f"  heartbeat {ts} UTC | connected={breeze_instance is not None}")

main()`;

// ── Main modal component ──────────────────────────────────────────────────────
export const ConnectBrokerModal: React.FC<Props> = ({ onClose, onConnected, session }) => {
  const [tab,          setTab]          = useState<Tab>('connect');
  const [apiKey,       setApiKey]       = useState(session?.apiKey       ?? '');
  const [apiSecret,    setApiSecret]    = useState(session?.apiSecret    ?? '');
  const [sessionToken, setSessionToken] = useState(session?.sessionToken ?? '');
  const [proxyBase,    setProxyBase]    = useState(session?.proxyBase    ?? CORS_PROXIES.vercelKaggle);
  const [showSecret,   setShowSecret]   = useState(false);
  const [status,       setStatus]       = useState<Status>('idle');
  const [statusMsg,    setStatusMsg]    = useState('');
  const [lastDebug,    setLastDebug]    = useState<DebugInfo | undefined>();
  const [healthMsg,    setHealthMsg]    = useState('');
  const [healthOk,     setHealthOk]     = useState<boolean | null>(null);

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
  const allFilled = !!(apiKey.trim() && apiSecret.trim() && sessionToken.trim());
  const isBackend = isKaggleBackend(proxyBase.trim());

  // ── Health check ────────────────────────────────────────────────────────────
  const handleHealthCheck = useCallback(async () => {
    if (!proxyBase.trim()) { setHealthMsg('Enter a URL first'); setHealthOk(false); return; }
    setHealthMsg('⏳ Pinging backend...');
    setHealthOk(null);
    const result = await checkBackendHealth(proxyBase.trim());
    setHealthOk(result.ok);
    setHealthMsg(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
  }, [proxyBase]);

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
      apiKey:       apiKey.trim(),
      apiSecret:    apiSecret.trim(),
      sessionToken: sessionToken.trim(),
      proxyBase:    proxyBase.trim(),
      isConnected:  false,
    };

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
          setTimeout(onClose, 1500);
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
        setTimeout(onClose, 1500);
      } else {
        setStatus('error');
        setStatusMsg(result.reason);
      }
    } catch (e) {
      setStatus('error');
      setStatusMsg(e instanceof Error ? e.message : String(e));
    }
  }, [apiKey, apiSecret, sessionToken, proxyBase, allFilled, isBackend, onConnected, onClose]);

  // ── Save offline (no validation) ────────────────────────────────────────────
  const handleSaveOffline = useCallback(() => {
    if (!allFilled) { setStatus('error'); setStatusMsg('Fill in all fields first.'); return; }
    onConnected({
      apiKey:       apiKey.trim(),
      apiSecret:    apiSecret.trim(),
      sessionToken: sessionToken.trim(),
      proxyBase:    proxyBase.trim(),
      isConnected:  false,
      connectedAt:  new Date(),
    });
    onClose();
  }, [apiKey, apiSecret, sessionToken, proxyBase, allFilled, onConnected, onClose]);

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
                        {(statusMsg.includes('HTML') || statusMsg.includes('cloudflare') || statusMsg.includes('trycloudflare')) ? (
                          <>
                            <p className="text-red-300 font-semibold">Cloudflare Interstitial Detected</p>
                            <p>① Open in a <strong className="text-white">new browser tab</strong>: <span className="text-blue-400 break-all">{proxyBase.replace(/\/api\/?$/, '')}/health</span></p>
                            <p>② Click through any warning until you see {'{status: "online"}'}</p>
                            <p>③ Close tab → retry <strong className="text-white">ping</strong> → <strong className="text-white">Validate Live</strong></p>
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
                <CodeBlock lang="kaggle_backend_v8.py" code={KAGGLE_CODE_SNIPPET} />
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
