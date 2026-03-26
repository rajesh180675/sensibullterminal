from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from ...core.state import get_backend_state, require_market_service

router = APIRouter()


@router.get("/api/expiries")
async def api_expiries(
    request: Request,
    stock_code: str = Query("NIFTY"),
    exchange_code: str = Query("NFO"),
):
    _ = exchange_code
    return {
        "success": True,
        "stock_code": stock_code,
        "expiries": require_market_service(request).get_expiries(stock_code, count=5),
    }


@router.get("/api/spot")
async def api_spot(
    request: Request,
    stock_code: str = Query("NIFTY"),
    exchange_code: str = Query("NSE"),
):
    backend = get_backend_state(request)
    engine = backend.engine
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected - POST /api/connect first")

    spot_prices = engine.tick_store.get_spot_prices()
    cached = spot_prices.get(stock_code.upper())
    if cached and cached > 1000:
        return {"success": True, "spot": cached, "source": "ws_tick", "stock_code": stock_code, "exchange_code": exchange_code}

    try:
        return require_market_service(request).get_spot(stock_code, exchange_code)
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.get("/api/optionchain")
async def api_optionchain(
    request: Request,
    stock_code: str = Query("NIFTY"),
    exchange_code: str = Query("NFO"),
    expiry_date: str = Query(...),
    right: Optional[str] = Query("Call"),
    strike_price: str = Query(""),
):
    backend = get_backend_state(request)
    engine = backend.engine
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected - POST /api/connect first")

    try:
        data = await asyncio.get_event_loop().run_in_executor(
            None,
            require_market_service(request).fetch_option_chain,
            stock_code,
            exchange_code,
            expiry_date,
            right or "Call",
            strike_price,
        )
        return {"success": True, "data": data, "count": len(data)}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.get("/api/quote")
async def api_quote(
    request: Request,
    stock_code: str = Query(...),
    exchange_code: str = Query(...),
    expiry_date: str = Query(...),
    right: str = Query(...),
    strike_price: str = Query(...),
):
    backend = get_backend_state(request)
    engine = backend.engine
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        data = await asyncio.get_event_loop().run_in_executor(
            None, require_market_service(request).get_quote, stock_code, exchange_code, expiry_date, right, strike_price
        )
        return {"success": True, "data": data}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.get("/api/historical")
async def api_historical(
    request: Request,
    stock_code: str = Query(...),
    exchange_code: str = Query(...),
    interval: str = Query("1day"),
    from_date: str = Query(...),
    to_date: str = Query(...),
    expiry_date: str = Query(""),
    right: str = Query(""),
    strike_price: str = Query(""),
):
    backend = get_backend_state(request)
    engine = backend.engine
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        data = await asyncio.get_event_loop().run_in_executor(
            None,
            require_market_service(request).get_historical,
            stock_code,
            exchange_code,
            interval,
            from_date,
            to_date,
            expiry_date,
            right,
            strike_price,
        )
        return {"success": True, "data": data}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.get("/api/depth")
async def api_depth(
    request: Request,
    stock_code: str = Query(...),
    exchange_code: str = Query(...),
    expiry_date: str = Query(...),
    right: str = Query(...),
    strike_price: str = Query(...),
):
    backend = get_backend_state(request)
    engine = backend.engine
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        data = await asyncio.get_event_loop().run_in_executor(
            None,
            require_market_service(request).get_depth,
            stock_code,
            exchange_code,
            expiry_date,
            right,
            strike_price,
        )
        return {"success": True, "data": data}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})
