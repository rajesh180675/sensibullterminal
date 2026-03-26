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
    sqlite_connection: Any = None
    layout_service: Any = None
    audit_log: Any = None
    rule_service: Any = None
    journal_service: Any = None
    tick_store_facade: Any = None
    connection_service: Any = None
    market_service: Any = None
    order_service: Any = None
    portfolio_service: Any = None
    stream_service: Any = None


def get_backend_state(request: Request) -> BackendState:
    state = getattr(request.app.state, "backend_state", None)
    if state is None:
        raise HTTPException(status_code=500, detail="Backend state is not configured")
    return state


def require_layout_service(request: Request):
    state = get_backend_state(request)
    if state.layout_service is None:
        raise HTTPException(status_code=500, detail="Layout service is not configured")
    return state.layout_service


def require_rule_service(request: Request):
    state = get_backend_state(request)
    if state.rule_service is None:
        raise HTTPException(status_code=500, detail="Rule service is not configured")
    return state.rule_service


def require_journal_service(request: Request):
    state = get_backend_state(request)
    if state.journal_service is None:
        raise HTTPException(status_code=500, detail="Journal service is not configured")
    return state.journal_service


def require_audit_log(request: Request):
    state = get_backend_state(request)
    if state.audit_log is None:
        raise HTTPException(status_code=500, detail="Audit log repository is not configured")
    return state.audit_log


def require_connection_service(request: Request):
    state = get_backend_state(request)
    if state.connection_service is None:
        raise HTTPException(status_code=500, detail="Connection service is not configured")
    return state.connection_service


def require_market_service(request: Request):
    state = get_backend_state(request)
    if state.market_service is None:
        raise HTTPException(status_code=500, detail="Market service is not configured")
    return state.market_service


def require_order_service(request: Request):
    state = get_backend_state(request)
    if state.order_service is None:
        raise HTTPException(status_code=500, detail="Order service is not configured")
    return state.order_service


def require_portfolio_service(request: Request):
    state = get_backend_state(request)
    if state.portfolio_service is None:
        raise HTTPException(status_code=500, detail="Portfolio service is not configured")
    return state.portfolio_service


def require_stream_service(request: Request):
    state = get_backend_state(request)
    if state.stream_service is None:
        raise HTTPException(status_code=500, detail="Stream service is not configured")
    return state.stream_service


def iso_utc_now() -> str:
    return datetime.utcnow().isoformat() + "Z"
