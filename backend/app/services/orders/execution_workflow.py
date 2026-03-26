from __future__ import annotations

import threading
import time
from typing import Any, Dict, List, Optional


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class ExecutionWorkflow:
    def __init__(self, engine: Any):
        self.engine = engine

    def normalise_execution_leg(self, leg: dict[str, Any]) -> dict[str, str]:
        right_norm = "call" if str(leg.get("right") or "call").lower().startswith("c") else "put"
        order_type = str(leg.get("order_type") or "market").lower()
        return {
            "stock_code": str(leg.get("stock_code", "")),
            "exchange_code": str(leg.get("exchange_code", "NFO")),
            "product": str(leg.get("product", "options")),
            "action": str(leg.get("action", "buy")).lower(),
            "order_type": order_type,
            "price": str(leg.get("price", "0") if order_type == "limit" else leg.get("price", "0")),
            "quantity": str(leg.get("quantity", "0")),
            "expiry_date": str(leg.get("expiry_date", "")),
            "right": right_norm,
            "strike_price": str(leg.get("strike_price", "0")),
            "stoploss": str(leg.get("stoploss", "0")),
        }

    def extract_success_payload(self, result: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(result, dict):
            return {}
        payload = result.get("Success", result.get("success", {}))
        if isinstance(payload, list):
            return payload[0] if payload and isinstance(payload[0], dict) else {}
        return payload if isinstance(payload, dict) else {}

    def collect_field_names(self, payload: Any) -> List[str]:
        if isinstance(payload, dict):
            return sorted(str(key) for key in payload.keys())
        if isinstance(payload, list) and payload and isinstance(payload[0], dict):
            return sorted(str(key) for key in payload[0].keys())
        return []

    def record_execution_validation(self, kind: str, legs: List[dict[str, Any]], raw_response: Any, payload: Any) -> dict[str, Any]:
        captured_at = time.time()
        record = {
            "kind": kind,
            "captured_at": captured_at,
            "leg_count": len(legs),
            "request_legs": legs,
            "raw_top_level_fields": self.collect_field_names(raw_response),
            "success_fields": self.collect_field_names(payload),
            "raw_response": raw_response,
            "success_payload": payload,
        }
        try:
            self.engine.validation_capture.append(record)
        except Exception as exc:
            self.engine.log.warning(f"[ExecutionWorkflow] validation capture failed: {exc}")
        return {
            "kind": kind,
            "captured_at": captured_at,
            "leg_count": len(legs),
            "rawTopLevelFields": record["raw_top_level_fields"],
            "successFields": record["success_fields"],
            "captureFile": self.engine.validation_capture.path,
        }

    def build_margin_position(self, leg: dict[str, Any]) -> dict[str, str]:
        normalised = self.normalise_execution_leg(leg)
        return {
            "strike_price": normalised["strike_price"],
            "quantity": normalised["quantity"],
            "right": "Call" if normalised["right"] == "call" else "Put",
            "product": normalised["product"],
            "action": normalised["action"].capitalize(),
            "price": normalised["price"],
            "stock_code": normalised["stock_code"],
            "expiry_date": normalised["expiry_date"],
            "fresh_order_type": normalised["order_type"].capitalize(),
            "cover_order_flow": "N",
            "cover_limit_rate": "",
            "cover_sltp_price": "",
            "fresh_limit_rate": normalised["price"],
            "open_quantity": normalised["quantity"],
        }

    def sum_known_charge_fields(self, payload: dict[str, Any]) -> tuple[float, float, Dict[str, float], Dict[str, Any]]:
        exchange_turnover = _safe_float(payload.get("exchange_turnover_charge") or payload.get("exchange_turnover_charges"))
        sebi_charges = _safe_float(payload.get("sebi_charges"))
        gst = _safe_float(payload.get("gst"))
        stt = _safe_float(payload.get("stt"))
        stamp_duty = _safe_float(payload.get("stamp_duty"))
        transaction_charges = _safe_float(payload.get("transaction_charges"))
        ipft = _safe_float(payload.get("ipft"))
        other_charges = _safe_float(payload.get("other_charges"))
        total_tax = _safe_float(payload.get("total_tax"))

        component_charges = {
            "exchangeTurnoverCharges": exchange_turnover,
            "sebiCharges": sebi_charges,
            "gst": gst,
            "stt": stt,
            "stampDuty": stamp_duty,
            "transactionCharges": transaction_charges,
            "ipft": ipft,
            "otherCharges": other_charges,
            "totalTax": total_tax,
        }
        component_charges = {key: value for key, value in component_charges.items() if value > 0}

        turnover_and_sebi = _safe_float(payload.get("total_turnover_and_sebi_charges"))
        if turnover_and_sebi <= 0:
            turnover_and_sebi = exchange_turnover + sebi_charges + transaction_charges + ipft

        taxes_and_duties = total_tax
        if taxes_and_duties <= 0:
            taxes_and_duties = gst + stt + stamp_duty

        broker_other_charges = _safe_float(payload.get("total_other_charges"))
        if broker_other_charges <= 0:
            broker_other_charges = turnover_and_sebi + taxes_and_duties + other_charges

        brokerage = _safe_float(payload.get("brokerage"))
        total_fees = _safe_float(payload.get("total_brokerage") or payload.get("total_charges") or payload.get("charges"))
        if total_fees <= 0:
            total_fees = brokerage + broker_other_charges

        charges = {
            "brokerage": brokerage,
            "brokerReportedTurnoverAndSebiCharges": turnover_and_sebi,
            "brokerReportedOtherCharges": broker_other_charges,
            "taxesAndDuties": taxes_and_duties,
            "totalFees": total_fees,
            **component_charges,
        }
        charges = {key: value for key, value in charges.items() if value > 0}

        charge_summary = {
            "brokerage": brokerage,
            "brokerReportedOtherCharges": broker_other_charges,
            "brokerReportedTurnoverAndSebiCharges": turnover_and_sebi,
            "taxesAndDuties": taxes_and_duties,
            "totalFees": total_fees,
            "componentCharges": component_charges,
            "calculationMode": "broker_rollup"
            if _safe_float(payload.get("total_other_charges")) > 0 or _safe_float(payload.get("total_brokerage")) > 0
            else "component_fallback",
        }
        return brokerage, total_fees, charges, charge_summary

    def calculate_margin(self, legs: List[dict[str, Any]]) -> dict[str, Any]:
        if not self.engine.connected:
            raise RuntimeError("Not connected")
        if not legs:
            return {
                "margin_required": 0.0,
                "available_margin": 0.0,
                "span_margin": 0.0,
                "block_trade_margin": 0.0,
                "order_margin": 0.0,
                "trade_margin": 0.0,
                "raw": {},
                "validation": {
                    "kind": "margin",
                    "captured_at": time.time(),
                    "leg_count": 0,
                    "rawTopLevelFields": [],
                    "successFields": [],
                    "captureFile": self.engine.validation_capture.path,
                },
            }

        positions = [self.build_margin_position(leg) for leg in legs]
        exchange_code = str(legs[0].get("exchange_code", "NFO"))
        result = self.engine.broker_client.margin_calculator(positions, exchange_code)
        payload = self.extract_success_payload(result)
        validation = self.record_execution_validation("margin", legs, result, payload)
        funds = self.engine.get_funds()

        order_margin = _safe_float(payload.get("order_margin") or payload.get("orderMargin") or payload.get("total_order_margin"))
        trade_margin = _safe_float(payload.get("trade_margin") or payload.get("tradeMargin") or payload.get("total_trade_margin"))
        span_margin = _safe_float(payload.get("span_margin") or payload.get("spanMargin"))
        block_trade_margin = _safe_float(
            payload.get("block_trade_margin")
            or payload.get("blockTradeMargin")
            or payload.get("non_span_margin_required")
            or payload.get("block_margin")
        )
        if span_margin <= 0:
            span_margin = _safe_float(payload.get("span_margin_required"))
        margin_required = max(
            order_margin,
            trade_margin,
            span_margin + block_trade_margin,
            _safe_float(payload.get("total_margin") or payload.get("margin_required")),
        )

        return {
            "margin_required": margin_required,
            "available_margin": _safe_float(funds.get("available_margin")),
            "span_margin": span_margin,
            "block_trade_margin": block_trade_margin,
            "order_margin": order_margin,
            "trade_margin": trade_margin,
            "raw": payload,
            "validation": validation,
        }

    def preview_strategy(self, legs: List[dict[str, Any]]) -> dict[str, Any]:
        if not self.engine.connected:
            raise RuntimeError("Not connected")
        if not legs:
            now = time.time()
            return {
                "estimatedPremium": 0.0,
                "estimatedFees": 0.0,
                "slippage": 0.0,
                "capitalAtRisk": 0.0,
                "marginRequired": 0.0,
                "availableMargin": _safe_float(self.engine.get_funds().get("available_margin")),
                "spanMargin": 0.0,
                "blockTradeMargin": 0.0,
                "orderMargin": 0.0,
                "tradeMargin": 0.0,
                "totalBrokerage": 0.0,
                "chargesBreakdown": {},
                "notes": [],
                "updated_at": now,
                "validation": {
                    "kind": "preview",
                    "captured_at": now,
                    "leg_count": 0,
                    "captureFile": self.engine.validation_capture.path,
                    "previewLegs": [],
                    "margin": {
                        "kind": "margin",
                        "captured_at": now,
                        "leg_count": 0,
                        "rawTopLevelFields": [],
                        "successFields": [],
                        "captureFile": self.engine.validation_capture.path,
                    },
                },
            }

        preview_rows: List[dict[str, Any]] = []
        validation_rows: List[dict[str, Any]] = []
        total_brokerage = 0.0
        total_charges = 0.0
        charges_breakdown: Dict[str, float] = {}
        aggregated_charge_summary: Dict[str, Any] = {
            "brokerage": 0.0,
            "brokerReportedOtherCharges": 0.0,
            "brokerReportedTurnoverAndSebiCharges": 0.0,
            "taxesAndDuties": 0.0,
            "totalFees": 0.0,
            "componentCharges": {},
            "calculationMode": "component_fallback",
        }
        notes: List[str] = []
        estimated_premium = 0.0
        capital_at_risk = 0.0
        slippage = 0.0

        for leg in legs:
            normalised = self.normalise_execution_leg(leg)
            price = _safe_float(normalised["price"])
            quantity = _safe_float(normalised["quantity"])
            preview_price = "0" if normalised["order_type"] == "market" else normalised["price"]
            estimated_premium += price * quantity * (1 if normalised["action"] == "sell" else -1)
            capital_at_risk += abs(price * quantity)
            slippage += abs(price * quantity) * 0.0006

            response = self.engine.broker_client.preview_order(
                stock_code=normalised["stock_code"],
                exchange_code=normalised["exchange_code"],
                product=normalised["product"],
                order_type=normalised["order_type"],
                price=preview_price,
                action=normalised["action"],
                quantity=normalised["quantity"],
                expiry_date=normalised["expiry_date"],
                right=normalised["right"],
                strike_price=normalised["strike_price"],
                specialflag="N",
                stoploss=normalised["stoploss"],
                order_rate_fresh="",
            )
            payload = self.extract_success_payload(response)
            validation_rows.append(self.record_execution_validation("preview", [normalised], response, payload))
            brokerage, total, charges, charge_summary = self.sum_known_charge_fields(payload)
            total_brokerage += brokerage
            total_charges += total
            for key, value in charges.items():
                charges_breakdown[key] = charges_breakdown.get(key, 0.0) + value
            aggregated_charge_summary["brokerage"] += _safe_float(charge_summary.get("brokerage"))
            aggregated_charge_summary["brokerReportedOtherCharges"] += _safe_float(charge_summary.get("brokerReportedOtherCharges"))
            aggregated_charge_summary["brokerReportedTurnoverAndSebiCharges"] += _safe_float(charge_summary.get("brokerReportedTurnoverAndSebiCharges"))
            aggregated_charge_summary["taxesAndDuties"] += _safe_float(charge_summary.get("taxesAndDuties"))
            aggregated_charge_summary["totalFees"] += _safe_float(charge_summary.get("totalFees"))
            if charge_summary.get("calculationMode") == "broker_rollup":
                aggregated_charge_summary["calculationMode"] = "broker_rollup"
            component_bucket = aggregated_charge_summary["componentCharges"]
            for key, value in charge_summary.get("componentCharges", {}).items():
                component_bucket[key] = component_bucket.get(key, 0.0) + _safe_float(value)
            error = ""
            if isinstance(response, dict):
                error = str(response.get("Error") or response.get("error") or "")
            if error:
                notes.append(error)
            preview_rows.append(payload)

        margin = self.calculate_margin(legs)
        margin_required = max(margin["margin_required"], capital_at_risk + total_charges)

        return {
            "estimatedPremium": estimated_premium,
            "estimatedFees": total_charges,
            "slippage": slippage,
            "capitalAtRisk": capital_at_risk + total_charges,
            "marginRequired": margin_required,
            "availableMargin": margin["available_margin"],
            "spanMargin": margin["span_margin"],
            "blockTradeMargin": margin["block_trade_margin"],
            "orderMargin": margin["order_margin"],
            "tradeMargin": margin["trade_margin"],
            "totalBrokerage": total_brokerage,
            "chargesBreakdown": charges_breakdown,
            "chargeSummary": aggregated_charge_summary,
            "notes": notes,
            "updated_at": time.time(),
            "legs": preview_rows,
            "validation": {
                "kind": "preview",
                "captured_at": time.time(),
                "leg_count": len(legs),
                "captureFile": self.engine.validation_capture.path,
                "previewLegs": validation_rows,
                "margin": margin.get("validation", {}),
            },
        }

    @staticmethod
    def inventory_key(leg: dict[str, Any]) -> tuple[str, str, str, str, str]:
        right = "call" if str(leg.get("right") or "").lower().startswith("c") else "put"
        return (
            str(leg.get("stock_code", "")),
            str(leg.get("exchange_code", "NFO")),
            str(leg.get("expiry_date", "")),
            right,
            str(leg.get("strike_price", "")),
        )

    def apply_repair_legs(self, current_legs: List[dict[str, Any]], repair_legs: List[dict[str, Any]]) -> List[dict[str, Any]]:
        buckets: Dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
        for source in current_legs:
            leg = self.normalise_execution_leg(source)
            key = self.inventory_key(leg)
            quantity = _safe_float(leg.get("quantity"))
            signed = quantity if leg.get("action") == "buy" else -quantity
            if key not in buckets:
                buckets[key] = dict(leg)
                buckets[key]["_net_quantity"] = signed
            else:
                buckets[key]["_net_quantity"] += signed

        for source in repair_legs:
            leg = self.normalise_execution_leg(source)
            key = self.inventory_key(leg)
            quantity = _safe_float(leg.get("quantity"))
            signed = quantity if leg.get("action") == "buy" else -quantity
            if key not in buckets:
                buckets[key] = dict(leg)
                buckets[key]["_net_quantity"] = signed
            else:
                buckets[key]["_net_quantity"] += signed

        result: List[dict[str, Any]] = []
        for leg in buckets.values():
            net_quantity = _safe_float(leg.pop("_net_quantity", 0))
            if abs(net_quantity) < 0.5:
                continue
            rebuilt = dict(leg)
            rebuilt["action"] = "buy" if net_quantity > 0 else "sell"
            rebuilt["quantity"] = str(int(abs(net_quantity)))
            result.append(rebuilt)
        return result

    def repair_preview(self, current_legs: List[dict[str, Any]], repair_legs: List[dict[str, Any]], meta: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        if not self.engine.connected:
            raise RuntimeError("Not connected")
        current_normalized = [self.normalise_execution_leg(leg) for leg in current_legs]
        repair_normalized = [self.normalise_execution_leg(leg) for leg in repair_legs]
        resulting_legs = self.apply_repair_legs(current_normalized, repair_normalized)
        incremental = self.preview_strategy(repair_normalized) if repair_normalized else self.preview_strategy([])
        current_margin = self.calculate_margin(current_normalized) if current_normalized else self.calculate_margin([])
        resulting_margin = self.calculate_margin(resulting_legs) if resulting_legs else self.calculate_margin([])
        repair_type = str((meta or {}).get("repair_type") or "repair")
        strategy_family = str((meta or {}).get("strategy_family") or "custom")
        thesis_preservation = 0.56
        if repair_type in {"roll_tested_side", "roll_spread_wider", "recenter_structure"}:
            thesis_preservation = 0.86
        elif repair_type in {"add_wings", "reduce_winning_side"}:
            thesis_preservation = 0.72
        elif repair_type in {"close_tested_side"}:
            thesis_preservation = 0.58
        elif repair_type == "flatten_all":
            thesis_preservation = 0.2
        if strategy_family in {"calendar", "broken_wing", "ratio_repair", "expiry_day"}:
            thesis_preservation = min(0.95, thesis_preservation + 0.05)

        margin_relief = max(0.0, current_margin["margin_required"] - resulting_margin["margin_required"])
        denominator = max(abs(incremental.get("estimatedFees", 0.0)) + abs(incremental.get("marginRequired", 0.0)) * 0.01, 1.0)
        credit_efficiency = abs(incremental.get("estimatedPremium", 0.0)) / denominator
        ranking = {
            "creditEfficiency": round(credit_efficiency, 4),
            "marginRelief": round(margin_relief, 2),
            "thesisPreservation": round(thesis_preservation, 4),
            "score": round(
                min(100.0, credit_efficiency * 18.0 + (margin_relief / max(current_margin["margin_required"], 1.0)) * 40.0 + thesis_preservation * 35.0),
                2,
            ),
        }
        notes = list(incremental.get("notes", []))
        notes.append("Repair preview is incremental: premium and fees reflect repair legs, margin delta compares live book before and after the repair.")
        return {
            "incrementalPreview": incremental,
            "currentMargin": current_margin,
            "resultingMargin": resulting_margin,
            "resultingLegs": resulting_legs,
            "ranking": ranking,
            "notes": notes,
            "updated_at": time.time(),
        }

    def place_strategy_order(self, legs: List[dict[str, Any]]) -> List[dict[str, Any]]:
        if not self.engine.connected:
            raise RuntimeError("Not connected")

        results: List[dict[str, Any]] = []
        threads: List[threading.Thread] = []
        results_lock = threading.Lock()

        def place_one(leg: dict[str, Any], idx: int) -> None:
            try:
                result = self.engine.place_order(leg)
                ok = isinstance(result, dict) and result.get("Status") == 200
                order_id = (result.get("Success") or {}).get("order_id", "") if ok else ""
                with results_lock:
                    results.append({
                        "leg_index": idx,
                        "success": ok,
                        "order_id": order_id,
                        "error": result.get("Error", "") if not ok else "",
                        "raw": result,
                    })
            except Exception as exc:
                with results_lock:
                    results.append({"leg_index": idx, "success": False, "error": str(exc)})

        for idx, leg in enumerate(legs):
            thread = threading.Thread(target=place_one, args=(leg, idx), daemon=True)
            threads.append(thread)
            thread.start()

        for thread in threads:
            thread.join(timeout=60)

        results.sort(key=lambda item: item["leg_index"])
        return results

    def square_off_position(self, leg: dict[str, Any]) -> dict[str, Any]:
        original = (leg.get("action") or "buy").lower()
        exit_leg = {
            **leg,
            "action": "sell" if original == "buy" else "buy",
            "user_remark": "SquareOff_OptionsTerminal",
        }
        return self.engine.place_order(exit_leg)
