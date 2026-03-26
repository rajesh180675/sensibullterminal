from __future__ import annotations

import time
from typing import Any


class OrderService:
    def __init__(self, engine: Any):
        self.engine = engine
        self.workflow = getattr(engine, "execution_workflow", None)

    def preview(self, legs: list[dict[str, Any]]):
        if self.workflow is not None:
            return self.workflow.preview_strategy(legs)
        raise RuntimeError("Execution workflow is not configured")

    def margin(self, legs: list[dict[str, Any]]):
        if self.workflow is None:
            raise RuntimeError("Execution workflow is not configured")
        data = self.workflow.calculate_margin(legs)
        return {
            "estimatedPremium": 0.0,
            "estimatedFees": 0.0,
            "slippage": 0.0,
            "capitalAtRisk": 0.0,
            "marginRequired": data["margin_required"],
            "availableMargin": data["available_margin"],
            "spanMargin": data["span_margin"],
            "blockTradeMargin": data["block_trade_margin"],
            "orderMargin": data["order_margin"],
            "tradeMargin": data["trade_margin"],
            "chargesBreakdown": {},
            "notes": [],
            "updated_at": time.time(),
            "validation": data.get("validation"),
        }

    def repair_preview(self, current_legs, repair_legs, meta):
        if self.workflow is not None:
            return self.workflow.repair_preview(current_legs, repair_legs, meta)
        raise RuntimeError("Execution workflow is not configured")

    def place_order(self, payload):
        if self.workflow is None:
            raise RuntimeError("Execution workflow is not configured")
        results = self.workflow.place_strategy_order([payload])
        result = results[0] if results else {"success": False, "error": "No execution result returned"}
        return {"success": result["success"], "order_id": result.get("order_id", ""), "error": result.get("error", "")}

    def execute_strategy(self, legs):
        if self.workflow is None:
            raise RuntimeError("Execution workflow is not configured")
        results = self.workflow.place_strategy_order(legs)
        return {"success": all(result["success"] for result in results), "results": results}

    def square_off(self, payload):
        if self.workflow is None:
            raise RuntimeError("Execution workflow is not configured")
        result = self.workflow.square_off_position(payload)
        ok = isinstance(result, dict) and result.get("Status") == 200
        order_id = (result.get("Success") or {}).get("order_id", "") if ok else ""
        return {"success": ok, "order_id": order_id, "error": result.get("Error", "") if not ok else ""}

    def cancel_order(self, order_id: str, exchange_code: str):
        result = self.engine.cancel_order(order_id, exchange_code)
        ok = isinstance(result, dict) and result.get("Status") == 200
        return {"success": ok, "error": result.get("Error", "") if not ok else ""}

    def modify_order(
        self,
        order_id: str,
        exchange_code: str,
        quantity: str,
        price: str,
        stoploss: str,
        validity: str,
    ):
        result = self.engine.modify_order(order_id, exchange_code, quantity, price, stoploss, validity)
        ok = isinstance(result, dict) and result.get("Status") == 200
        return {"success": ok, "error": result.get("Error", "") if not ok else ""}
