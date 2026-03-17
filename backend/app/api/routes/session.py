from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from ...core.state import get_backend_state, iso_utc_now

router = APIRouter()


@router.get("/")
@router.get("/health")
async def health(request: Request) -> dict[str, Any]:
    backend = get_backend_state(request)
    engine = backend.engine
    return {
        "status": "online",
        "connected": engine.connected,
        "ws_running": engine.ws_running,
        "subscriptions": len(engine.subscribed),
        "tick_count": len(engine.tick_store.get_all()["ticks"]),
        "rest_calls_min": engine.rate_limiter.calls_last_minute,
        "queue_depth": engine.rate_limiter.queue_depth,
        "auth_enabled": backend.auth_enabled,
        "version": backend.version,
        "timestamp": iso_utc_now(),
    }


@router.get("/ping")
async def ping(request: Request) -> dict[str, str]:
    backend = get_backend_state(request)
    return {"status": "online", "version": backend.version, "ts": iso_utc_now()}


@router.post("/api/connect")
async def api_connect(request: Request):
    backend = get_backend_state(request)
    engine = backend.engine
    try:
        body = await request.json()
    except Exception:
        body = {}

    qp = request.query_params
    api_key = body.get("api_key") or qp.get("api_key")
    api_secret = body.get("api_secret") or qp.get("api_secret")
    session_token = (
        body.get("session_token")
        or qp.get("session_token")
        or body.get("apisession")
        or qp.get("apisession")
    )

    if not all([api_key, api_secret, session_token]):
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "Missing: api_key, api_secret, session_token"},
        )

    try:
        return await asyncio.get_event_loop().run_in_executor(
            None, engine.connect, api_key, api_secret, session_token
        )
    except Exception as exc:
        msg = str(exc)
        hint = (
            " -> Token stale - get a fresh ?apisession= today."
            if "null" in msg.lower()
            else " -> Check API Key/Secret."
            if "key" in msg.lower()
            else ""
        )
        return JSONResponse(status_code=200, content={"success": False, "error": msg + hint})


@router.post("/api/disconnect")
async def api_disconnect(request: Request) -> dict[str, Any]:
    backend = get_backend_state(request)
    await asyncio.get_event_loop().run_in_executor(None, backend.engine.disconnect)
    return {"success": True, "message": "Disconnected"}


@router.get("/api/ratelimit")
async def api_ratelimit(request: Request) -> dict[str, Any]:
    backend = get_backend_state(request)
    engine = backend.engine
    return {
        "calls_last_minute": engine.rate_limiter.calls_last_minute,
        "max_per_minute": 100,
        "min_interval_ms": getattr(type(engine.rate_limiter), "MIN_INTERVAL_MS", 0),
        "queue_depth": engine.rate_limiter.queue_depth,
    }
