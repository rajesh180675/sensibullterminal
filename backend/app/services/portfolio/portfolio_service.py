from __future__ import annotations

from typing import Any
from .position_grouper import PositionGrouper


class PortfolioService:
    def __init__(self, engine: Any):
        self.engine = engine
        self.position_grouper = PositionGrouper(engine)

    def get_orders(self):
        data = self.engine.get_order_book()
        return data.get("Success", []) if isinstance(data, dict) else []

    def get_trades(self):
        data = self.engine.get_trade_book()
        return data.get("Success", []) if isinstance(data, dict) else []

    def get_positions(self):
        raw_data = self.engine.get_positions()
        broker_positions = raw_data.get("Success", []) if isinstance(raw_data, dict) else []
        # Match broker positions against active strategy groups
        grouped_data = self.position_grouper.group_broker_positions(broker_positions)
        return {
            "success": True,
            "raw": broker_positions,
            "grouped": grouped_data
        }

    def get_funds(self):
        return self.engine.get_funds()
