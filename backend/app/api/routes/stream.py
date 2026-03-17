from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from ...core.state import get_backend_state

router = APIRouter()


@router.post("/api/ws/subscribe")
async def api_ws_subscribe(request: Request):
    backend = get_backend_state(request)
    engine = backend.engine
    if not engine.connected:
        raise HTTPException(status_code=401, detail="Not connected")
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})

    stock_code = body.get("stock_code", "NIFTY")
    exchange_code = body.get("exchange_code", "NFO")
    expiry_date = body.get("expiry_date", "")
    strikes = body.get("strikes", [])
    rights = body.get("rights", ["Call", "Put"])

    if not expiry_date or not strikes:
        return JSONResponse(status_code=400, content={"success": False, "error": "expiry_date and strikes required"})

    await asyncio.get_event_loop().run_in_executor(None, engine.unsubscribe_all)
    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None, engine.subscribe_option_chain, stock_code, exchange_code, expiry_date, strikes, rights
        )
        return {"success": True, **result}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.websocket("/ws/ticks")
async def ws_ticks(websocket: WebSocket):
    backend = websocket.app.state.backend_state
    engine = backend.engine
    await websocket.accept()
    last_version = -1
    heartbeat_counter = 0
    try:
        while True:
            await asyncio.sleep(0.5)
            current_version = engine.tick_store.get_version()
            heartbeat_counter += 1

            if current_version == last_version:
                if heartbeat_counter % 10 == 0:
                    await websocket.send_json({
                        "type": "heartbeat",
                        "ts": time.time(),
                        "ws_live": engine.ws_running,
                        "candle_streams": engine.candle_store.to_stream_payload(limit=2),
                    })
                continue

            last_version = current_version
            await websocket.send_json({
                "type": "tick_update",
                "version": current_version,
                "ticks": engine.tick_store.to_option_chain_delta(),
                "spot_prices": engine.tick_store.get_spot_prices(),
                "candle_streams": engine.candle_store.to_stream_payload(limit=2),
                "ts": time.time(),
                "ws_live": engine.ws_running,
            })
    except WebSocketDisconnect:
        return


@router.get("/api/ticks")
async def api_ticks(request: Request, since_version: int = 0):
    backend = get_backend_state(request)
    engine = backend.engine
    data = engine.tick_store.get_all()
    if data["version"] <= since_version:
        return {"changed": False, "version": data["version"]}
    return {
        "changed": True,
        "version": data["version"],
        "ticks": engine.tick_store.to_option_chain_delta(),
        "spot_prices": engine.tick_store.get_spot_prices(),
        "candle_streams": engine.candle_store.to_stream_payload(limit=2),
        "ws_live": engine.ws_running,
    }
