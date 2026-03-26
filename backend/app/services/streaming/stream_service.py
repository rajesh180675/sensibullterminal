from __future__ import annotations

import time
from typing import Any


class StreamService:
    def __init__(self, engine: Any, tick_store_facade: Any):
        self.engine = engine
        self.tick_store_facade = tick_store_facade

    def subscribe_option_chain(
        self,
        stock_code: str,
        exchange_code: str,
        expiry_date: str,
        strikes: list[int | float | str],
        rights: list[str],
    ):
        self.engine.unsubscribe_all()
        return self.engine.subscribe_option_chain(stock_code, exchange_code, expiry_date, strikes, rights)

    def build_heartbeat_payload(self):
        return {
            "type": "heartbeat",
            "ts": time.time(),
            "ws_live": self.engine.ws_running,
            "candle_streams": self.engine.candle_store.to_stream_payload(limit=2),
        }

    def build_tick_payload(self):
        return {
            "type": "tick_update",
            "version": self.tick_store_facade.get_all()["version"],
            "ticks": self.tick_store_facade.to_option_chain_delta(),
            "spot_prices": self.tick_store_facade.get_spot_prices(),
            "candle_streams": self.engine.candle_store.to_stream_payload(limit=2),
            "ts": time.time(),
            "ws_live": self.engine.ws_running,
        }

    def get_ticks_since(self, since_version: int):
        data = self.tick_store_facade.get_all()
        if data["version"] <= since_version:
            return {"changed": False, "version": data["version"]}
        return {
            "changed": True,
            "version": data["version"],
            "ticks": self.tick_store_facade.to_option_chain_delta(),
            "spot_prices": self.tick_store_facade.get_spot_prices(),
            "candle_streams": self.engine.candle_store.to_stream_payload(limit=2),
            "ws_live": self.engine.ws_running,
        }
