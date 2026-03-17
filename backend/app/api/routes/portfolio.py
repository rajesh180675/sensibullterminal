from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from ...core.state import get_backend_state

router = APIRouter()


@router.get("/api/orders")
async def api_order_book(request: Request):
    backend = get_backend_state(request)
    engine = backend.engine
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, engine.get_order_book)
        return {"success": True, "data": data.get("Success", []) if isinstance(data, dict) else []}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.get("/api/trades")
async def api_trade_book(request: Request):
    backend = get_backend_state(request)
    engine = backend.engine
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, engine.get_trade_book)
        return {"success": True, "data": data.get("Success", []) if isinstance(data, dict) else []}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.get("/api/positions")
async def api_positions(request: Request):
    backend = get_backend_state(request)
    engine = backend.engine
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, engine.get_positions)
        return {"success": True, "data": data}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.get("/api/funds")
async def api_funds(request: Request):
    backend = get_backend_state(request)
    engine = backend.engine
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, engine.get_funds)
        return {"success": True, "data": data}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})
