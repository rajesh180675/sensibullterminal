from __future__ import annotations

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from ...core.state import get_backend_state, require_audit_log

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


@router.get("/api/diagnostics/audit-log")
async def api_audit_log(request: Request, limit: int = Query(25)):
    audit_log = require_audit_log(request)
    return {"success": True, "records": audit_log.list_recent(limit)}

@router.get("/api/diagnostics/rate-limits")
async def api_rate_limits(request: Request):
    backend = get_backend_state(request)
    engine = backend.engine
    
    # Safely get rate limiter stats
    calls_last_minute = getattr(engine.rate_limiter, "calls_last_minute", 0)
    queue_depth = getattr(engine.rate_limiter, "queue_depth", 0)
    min_interval = getattr(type(engine.rate_limiter), "MIN_INTERVAL_MS", 0)
    
    return {
        "success": True,
        "rate_limits": {
            "calls_last_minute": calls_last_minute,
            "limit_per_minute": getattr(type(engine.rate_limiter), "MAX_CALLS_PER_MINUTE", 60), # assuming 60 or similar
            "queue_depth": queue_depth,
            "min_interval_ms": min_interval,
            "status": "healthy" if calls_last_minute < 50 else "warning" if calls_last_minute < 60 else "critical"
        }
    }
