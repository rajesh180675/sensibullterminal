from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from ...core.state import get_backend_state, require_stream_service

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

    try:
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            require_stream_service(request).subscribe_option_chain,
            stock_code,
            exchange_code,
            expiry_date,
            strikes,
            rights,
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
    service = websocket.app.state.backend_state.stream_service
    if service is None:
        await websocket.close(code=1011)
        return
    heartbeat_counter = 0
    try:
        while True:
            await asyncio.sleep(0.5)
            current_version = engine.tick_store.get_version()
            heartbeat_counter += 1

            if current_version == last_version:
                if heartbeat_counter % 10 == 0:
                    await websocket.send_json(service.build_heartbeat_payload())
                continue

            last_version = current_version
            await websocket.send_json(service.build_tick_payload())
    except WebSocketDisconnect:
        return


@router.get("/api/ticks")
async def api_ticks(request: Request, since_version: int = 0):
    return require_stream_service(request).get_ticks_since(since_version)
