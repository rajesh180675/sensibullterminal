from __future__ import annotations

import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ...core.state import require_journal_service

router = APIRouter()


@router.get("/api/reviews/state")
async def api_review_state(request: Request):
    service = require_journal_service(request)
    return {"success": True, "data": service.get_state()}


@router.put("/api/reviews/state")
async def api_review_state_replace(request: Request):
    service = require_journal_service(request)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})
    try:
        data = await asyncio.get_event_loop().run_in_executor(None, service.replace_state, body)
        return {"success": True, "data": data}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})
