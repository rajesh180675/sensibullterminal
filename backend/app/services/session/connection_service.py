from __future__ import annotations

from datetime import datetime
from typing import Any


class ConnectionService:
    def __init__(self, engine: Any, *, auth_enabled: bool = False, version: str = "7.0"):
        self.engine = engine
        self.auth_enabled = auth_enabled
        self.version = version

    def health(self) -> dict[str, Any]:
        return {
            "status": "online",
            "connected": self.engine.connected,
            "ws_running": self.engine.ws_running,
            "subscriptions": len(self.engine.subscribed),
            "tick_count": len(self.engine.tick_store.get_all()["ticks"]),
            "rest_calls_min": self.engine.rate_limiter.calls_last_minute,
            "queue_depth": self.engine.rate_limiter.queue_depth,
            "auth_enabled": self.auth_enabled,
            "version": self.version,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    def ping(self) -> dict[str, str]:
        return {"status": "online", "version": self.version, "ts": datetime.utcnow().isoformat() + "Z"}

    def connect(self, api_key: str, api_secret: str, session_token: str):
        return self.engine.connect(api_key, api_secret, session_token)

    def disconnect(self) -> None:
        self.engine.disconnect()

    def ratelimit(self) -> dict[str, Any]:
        return {
            "calls_last_minute": self.engine.rate_limiter.calls_last_minute,
            "max_per_minute": 100,
            "min_interval_ms": getattr(type(self.engine.rate_limiter), "MIN_INTERVAL_MS", 0),
            "queue_depth": self.engine.rate_limiter.queue_depth,
        }
