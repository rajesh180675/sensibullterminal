from __future__ import annotations

import asyncio

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from ...core.state import get_backend_state

router = APIRouter()


@router.get("/api/automation/rules")
async def api_automation_rules(request: Request):
    backend = get_backend_state(request)
    return {"success": True, "rules": backend.engine.automation_rules.list_rules()}


@router.post("/api/automation/rules")
async def api_automation_create_rule(request: Request):
    backend = get_backend_state(request)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})
    try:
        rule = await asyncio.get_event_loop().run_in_executor(None, backend.engine.automation_rules.create_rule, body)
        return {"success": True, "rule": rule}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.put("/api/automation/rules/{rule_id}")
async def api_automation_update_rule(rule_id: str, request: Request):
    backend = get_backend_state(request)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})
    rule = await asyncio.get_event_loop().run_in_executor(None, backend.engine.automation_rules.update_rule, rule_id, body)
    if not rule:
        return JSONResponse(status_code=404, content={"success": False, "error": "Rule not found"})
    return {"success": True, "rule": rule}


@router.delete("/api/automation/rules/{rule_id}")
async def api_automation_delete_rule(rule_id: str, request: Request):
    backend = get_backend_state(request)
    rule = await asyncio.get_event_loop().run_in_executor(None, backend.engine.automation_rules.delete_rule, rule_id)
    if not rule:
        return JSONResponse(status_code=404, content={"success": False, "error": "Rule not found"})
    return {"success": True, "rule": rule}


@router.post("/api/automation/rules/{rule_id}/status")
async def api_automation_update_rule_status(rule_id: str, request: Request):
    backend = get_backend_state(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    status = str(body.get("status") or "")
    if status not in {"active", "paused", "draft"}:
        return JSONResponse(status_code=400, content={"success": False, "error": "status must be active, paused, or draft"})
    rule = await asyncio.get_event_loop().run_in_executor(None, backend.engine.automation_rules.update_rule_status, rule_id, status)
    if not rule:
        return JSONResponse(status_code=404, content={"success": False, "error": "Rule not found"})
    return {"success": True, "rule": rule}


@router.post("/api/automation/evaluate")
async def api_automation_evaluate(request: Request):
    backend = get_backend_state(request)
    try:
        events = await asyncio.get_event_loop().run_in_executor(None, backend.engine.automation_rules.evaluate_active_rules)
        return {"success": True, "events": events, "count": len(events)}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.get("/api/automation/callbacks")
async def api_automation_callbacks(request: Request, limit: int = Query(25)):
    backend = get_backend_state(request)
    return {"success": True, "events": backend.engine.automation_rules.list_callbacks(limit=limit)}


@router.post("/api/automation/callbacks")
async def api_automation_receive_callback(request: Request):
    backend = get_backend_state(request)
    try:
        body = await request.json()
    except Exception:
        try:
            body = dict(await request.form())
        except Exception:
            return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})
    try:
        event = await asyncio.get_event_loop().run_in_executor(None, backend.engine.automation_rules.receive_callback, body)
        return {"success": True, "event": event}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})


@router.post("/api/automation/callbacks/webhook")
async def api_automation_receive_webhook(request: Request):
    backend = get_backend_state(request)
    try:
        body = await request.json()
    except Exception:
        try:
            body = dict(await request.form())
        except Exception:
            return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})
    try:
        event = await asyncio.get_event_loop().run_in_executor(None, backend.engine.automation_rules.receive_callback, body, "webhook")
        return {"success": True, "event": event}
    except Exception as exc:
        return JSONResponse(status_code=200, content={"success": False, "error": str(exc)})
