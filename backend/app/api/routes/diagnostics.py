from __future__ import annotations

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from ...core.state import get_backend_state

router = APIRouter()


@router.get("/api/diagnostics/execution-validation")
async def api_execution_validation(request: Request, limit: int = Query(10)):
    backend = get_backend_state(request)
    return {
        "success": True,
        "capture_file": backend.engine.validation_capture.path,
        "records": backend.engine.validation_capture.recent(limit),
    }


@router.post("/api/checksum")
async def api_checksum(request: Request):
    backend = get_backend_state(request)
    try:
        body = await request.json()
    except Exception as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})
    timestamp = body.get("timestamp")
    if not timestamp:
        from datetime import datetime

        timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    checksum = backend.engine.__class__.generate_checksum(timestamp, body.get("payload", {}), body.get("secret", ""))
    return {"checksum": checksum, "timestamp": timestamp}
