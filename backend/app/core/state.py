from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fastapi import HTTPException, Request


@dataclass
class BackendState:
    engine: Any
    auth_enabled: bool = False
    backend_auth_token: str = ""
    automation_webhook_secret: str = ""
    version: str = "7.0"


def get_backend_state(request: Request) -> BackendState:
    state = getattr(request.app.state, "backend_state", None)
    if state is None:
        raise HTTPException(status_code=500, detail="Backend state is not configured")
    return state


def iso_utc_now() -> str:
    return datetime.utcnow().isoformat() + "Z"
