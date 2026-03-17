from __future__ import annotations

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.routes.automation import router as automation_router
from .api.routes.compat import router as compat_router
from .api.routes.diagnostics import router as diagnostics_router
from .api.routes.market import router as market_router
from .api.routes.orders import router as orders_router
from .api.routes.portfolio import router as portfolio_router
from .api.routes.reviews import router as reviews_router
from .api.routes.session import router as session_router
from .api.routes.stream import router as stream_router
from .core.settings import settings
from .core.state import BackendState


def _is_authed(request: Request, backend_state: BackendState) -> bool:
    if not backend_state.auth_enabled:
        return True
    token = request.headers.get("x-terminal-auth") or request.headers.get("X-Terminal-Auth") or ""
    return token == backend_state.backend_auth_token


def _is_webhook_authed(request: Request, backend_state: BackendState) -> bool:
    if not backend_state.automation_webhook_secret:
        return False
    token = (
        request.headers.get("x-automation-webhook-secret")
        or request.headers.get("X-Automation-Webhook-Secret")
        or request.query_params.get("secret")
        or ""
    )
    return token == backend_state.automation_webhook_secret


def create_app(
    backend_state: BackendState | None = None,
    *,
    include_routers: bool = True,
) -> FastAPI:
    state = backend_state or BackendState(engine=None, version="app")
    app = FastAPI(title=settings.app_name)
    app.state.backend_state = state

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
        allow_headers=["*"],
        expose_headers=["*"],
        max_age=86400,
    )

    @app.middleware("http")
    async def cors_everywhere(request: Request, call_next):
        backend = app.state.backend_state
        if request.method == "OPTIONS":
            return Response(
                status_code=200,
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Max-Age": "86400",
                },
            )

        if request.url.path.startswith("/api/automation/callbacks/webhook"):
            if not (_is_authed(request, backend) or _is_webhook_authed(request, backend)):
                return JSONResponse(
                    status_code=401,
                    content={"success": False, "error": "Unauthorized - missing automation webhook secret"},
                )
        elif request.url.path.startswith("/api/") and not _is_authed(request, backend):
            return JSONResponse(
                status_code=401,
                content={"success": False, "error": "Unauthorized - missing/invalid X-Terminal-Auth"},
            )

        response = await call_next(request)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        return response

    @app.options("/{path:path}")
    async def options_handler(path: str):
        _ = path
        return Response(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
                "Access-Control-Allow-Headers": "*",
            },
        )

    if include_routers:
        for router in (
            session_router,
            market_router,
            stream_router,
            orders_router,
            portfolio_router,
            automation_router,
            reviews_router,
            diagnostics_router,
            compat_router,
        ):
            app.include_router(router)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app
