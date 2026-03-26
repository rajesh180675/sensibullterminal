from __future__ import annotations

from typing import Any


class PortfolioService:
    def __init__(self, engine: Any):
        self.engine = engine

    def get_orders(self):
        data = self.engine.get_order_book()
        return data.get("Success", []) if isinstance(data, dict) else []

    def get_trades(self):
        data = self.engine.get_trade_book()
        return data.get("Success", []) if isinstance(data, dict) else []

    def get_positions(self):
        return self.engine.get_positions()

    def get_funds(self):
        return self.engine.get_funds()
