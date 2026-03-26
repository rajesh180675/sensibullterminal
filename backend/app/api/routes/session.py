from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from ...core.state import get_backend_state, require_connection_service

router = APIRouter()


@router.get("/")
@router.get("/health")
async def health(request: Request) -> dict[str, Any]:
    service = require_connection_service(request)
    return service.health()


@router.get("/ping")
async def ping(request: Request) -> dict[str, str]:
    service = require_connection_service(request)
    return service.ping()


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
        service = require_connection_service(request)
        return await asyncio.get_event_loop().run_in_executor(
            None, service.connect, api_key, api_secret, session_token
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
    service = require_connection_service(request)
    await asyncio.get_event_loop().run_in_executor(None, service.disconnect)
    return {"success": True, "message": "Disconnected"}


@router.get("/api/ratelimit")
async def api_ratelimit(request: Request) -> dict[str, Any]:
    service = require_connection_service(request)
    return service.ratelimit()
