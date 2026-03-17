from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from ...core.state import get_backend_state

router = APIRouter()


@router.post("/api/preview")
async def api_preview(request: Request):
    backend = get_backend_state(request)
    engine = backend.engine
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})
    legs = body.get("legs", [])
    if not legs:
        return {"success": True, "data": engine.preview_strategy([])}
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, engine.preview_strategy, legs)
        return {"success": True, "data": data}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.post("/api/margin")
async def api_margin(request: Request):
    backend = get_backend_state(request)
    engine = backend.engine
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})
    legs = body.get("legs", [])
    if not legs:
        return {"success": True, "data": engine.calculate_margin([])}
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, engine.calculate_margin, legs)
        return {
            "success": True,
            "data": {
                "estimatedPremium": 0.0,
                "estimatedFees": 0.0,
                "slippage": 0.0,
                "capitalAtRisk": 0.0,
                "marginRequired": data["margin_required"],
                "availableMargin": data["available_margin"],
                "spanMargin": data["span_margin"],
                "blockTradeMargin": data["block_trade_margin"],
                "orderMargin": data["order_margin"],
                "tradeMargin": data["trade_margin"],
                "chargesBreakdown": {},
                "notes": [],
                "updated_at": time.time(),
                "validation": data.get("validation"),
            },
        }
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.post("/api/repair-preview")
async def api_repair_preview(request: Request):
    backend = get_backend_state(request)
    engine = backend.engine
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})
    try:
        data = await asyncio.get_event_loop().run_in_executor(
            None,
            engine.repair_preview,
            body.get("current_legs", []),
            body.get("repair_legs", []),
            body.get("meta", {}),
        )
        return {"success": True, "data": data}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.post("/api/order")
async def api_order(request: Request):
    backend = get_backend_state(request)
    engine = backend.engine
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})
    try:
        results = await asyncio.get_event_loop().run_in_executor(None, engine.place_strategy_order, [body])
        result = results[0]
        return {"success": result["success"], "order_id": result.get("order_id", ""), "error": result.get("error", "")}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.post("/api/strategy/execute")
async def api_strategy_execute(request: Request):
    backend = get_backend_state(request)
    engine = backend.engine
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
        results = await asyncio.get_event_loop().run_in_executor(None, engine.place_strategy_order, legs)
        return {"success": all(result["success"] for result in results), "results": results}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.post("/api/squareoff")
async def api_squareoff(request: Request):
    backend = get_backend_state(request)
    engine = backend.engine
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})
    try:
        result = await asyncio.get_event_loop().run_in_executor(None, engine.square_off_position, body)
        ok = isinstance(result, dict) and result.get("Status") == 200
        oid = (result.get("Success") or {}).get("order_id", "") if ok else ""
        return {"success": ok, "order_id": oid, "error": result.get("Error", "") if not ok else ""}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.post("/api/order/cancel")
async def api_cancel_order(request: Request):
    backend = get_backend_state(request)
    engine = backend.engine
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})
    order_id = body.get("order_id", "")
    exchange_code = body.get("exchange_code", "NFO")
    if not order_id:
        return JSONResponse(status_code=400, content={"success": False, "error": "order_id required"})
    try:
        result = await asyncio.get_event_loop().run_in_executor(None, engine.cancel_order, order_id, exchange_code)
        ok = isinstance(result, dict) and result.get("Status") == 200
        return {"success": ok, "error": result.get("Error", "") if not ok else ""}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.patch("/api/order/modify")
async def api_modify_order(request: Request):
    backend = get_backend_state(request)
    engine = backend.engine
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
