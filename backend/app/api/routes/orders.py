from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from ...core.state import get_backend_state, require_order_service

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
        return {"success": True, "data": require_order_service(request).preview([])}
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, require_order_service(request).preview, legs)
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
        return {"success": True, "data": require_order_service(request).margin([])}
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, require_order_service(request).margin, legs)
        return {"success": True, "data": data}
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
            require_order_service(request).repair_preview,
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
        result = await asyncio.get_event_loop().run_in_executor(None, require_order_service(request).place_order, body)
        return result
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
        result = await asyncio.get_event_loop().run_in_executor(None, require_order_service(request).execute_strategy, legs)
        return result
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
        result = await asyncio.get_event_loop().run_in_executor(None, require_order_service(request).square_off, body)
        return result
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
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            require_order_service(request).cancel_order,
            order_id,
            exchange_code,
        )
        return result
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
            require_order_service(request).modify_order,
            body.get("order_id", ""),
            body.get("exchange_code", "NFO"),
            str(body.get("quantity", "0")),
            str(body.get("price", "0")),
            str(body.get("stoploss", "0")),
            body.get("validity", "day"),
        )
        return result
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})
