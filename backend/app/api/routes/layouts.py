from __future__ import annotations

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from ...core.state import require_layout_service

router = APIRouter()


@router.get("/api/layouts")
async def api_list_layouts(request: Request, workspace_id: str | None = Query(None)):
    service = require_layout_service(request)
    return {"success": True, "data": service.list_layouts(workspace_id)}


@router.get("/api/layouts/{layout_id}")
async def api_get_layout(layout_id: str, request: Request):
    service = require_layout_service(request)
    layout = service.get_layout(layout_id)
    if layout is None:
        return JSONResponse(status_code=404, content={"success": False, "error": "Layout not found"})
    return {"success": True, "data": layout}


@router.put("/api/layouts/{layout_id}")
async def api_save_layout(layout_id: str, request: Request):
    service = require_layout_service(request)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"success": False, "error": "Invalid JSON"})

    workspace_id = str(body.get("workspace_id") or body.get("workspaceId") or "").strip()
    name = str(body.get("name") or "").strip()
    panels = body.get("panels")
    if not workspace_id or not name or not isinstance(panels, (dict, list)):
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "workspace_id, name, and panels are required"},
        )

    layout = service.save_layout(
        layout_id=layout_id,
        workspace_id=workspace_id,
        name=name,
        panels=panels,
        is_default=bool(body.get("is_default", body.get("isDefault", False))),
    )
    return {"success": True, "data": layout}


@router.delete("/api/layouts/{layout_id}")
async def api_delete_layout(layout_id: str, request: Request):
    service = require_layout_service(request)
    deleted = service.delete_layout(layout_id)
    if not deleted:
        return JSONResponse(status_code=404, content={"success": False, "error": "Layout not found"})
    return {"success": True}
