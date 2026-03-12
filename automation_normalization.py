import re
import time
from typing import Any, Dict, List


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if isinstance(value, str):
            value = value.replace(",", "").strip()
        return float(value)
    except (TypeError, ValueError):
        return default


def first_present(payload: dict, keys: List[str]) -> Any:
    for key in keys:
        if key in payload and payload.get(key) not in (None, ""):
            return payload.get(key)
    return None


def symbol_aliases(symbol: str) -> set[str]:
    upper = str(symbol or "").upper()
    aliases = {upper}
    if upper == "NIFTY":
        aliases.update({"NIFTY50", "NIFTY 50"})
    if upper == "BSESEN":
        aliases.update({"SENSEX", "BSE SENSEX"})
    return aliases


def row_symbol(row: dict) -> str:
    value = first_present(row, [
        "stock_code",
        "stockCode",
        "stock",
        "symbol",
        "trading_symbol",
        "tradingsymbol",
        "underlying",
    ])
    return str(value or "").upper()


def match_symbol(row: dict, symbol: str) -> bool:
    normalized = row_symbol(row)
    if not normalized:
        return True
    return normalized in symbol_aliases(symbol)


def normalize_position_quantity(row: dict) -> float:
    direct = first_present(row, [
        "net_quantity",
        "net_qty",
        "netQuantity",
        "quantity",
        "open_quantity",
        "openQuantity",
    ])
    quantity = safe_float(direct)
    if quantity == 0:
        buy_qty = safe_float(first_present(row, ["buy_quantity", "buy_qty", "buyQuantity"]))
        sell_qty = safe_float(first_present(row, ["sell_quantity", "sell_qty", "sellQuantity"]))
        if buy_qty or sell_qty:
            quantity = buy_qty - sell_qty
    action = str(first_present(row, ["action", "transaction_type", "side"]) or "").lower()
    if quantity > 0 and action in {"sell", "short"} and not any(
        key in row for key in (
            "buy_quantity",
            "buy_qty",
            "sell_quantity",
            "sell_qty",
            "net_quantity",
            "net_qty",
            "netQuantity",
        )
    ):
        quantity *= -1
    return quantity


def normalize_position_mtm(row: dict, quantity: float) -> float:
    direct_fields = [
        "pnl",
        "mtm",
        "m2m",
        "mark_to_market",
        "markToMarket",
        "total_pnl",
        "totalPnl",
    ]
    for field in direct_fields:
        if field not in row:
            continue
        value = safe_float(row.get(field))
        if value != 0:
            return value

    booked = safe_float(first_present(row, [
        "booked_pnl",
        "realized_pnl",
        "realised_pnl",
        "realized_profit_loss",
        "realised_profit_loss",
    ]))
    unrealized = safe_float(first_present(row, [
        "unrealized_profit_loss",
        "unrealised_profit_loss",
        "unrealized_pnl",
        "unrealised_pnl",
    ]))
    if booked or unrealized:
        return booked + unrealized

    avg_price = safe_float(first_present(row, [
        "average_price",
        "avg_price",
        "averagePrice",
        "cost_price",
        "costPrice",
    ]))
    ltp = safe_float(first_present(row, [
        "ltp",
        "last_traded_price",
        "last_price",
        "market_price",
        "marketPrice",
        "close_price",
    ]))
    if quantity != 0 and (avg_price > 0 or ltp > 0):
        return (ltp - avg_price) * quantity
    return 0.0


def normalize_position_row(row: dict) -> dict:
    quantity = normalize_position_quantity(row)
    return {
        "symbol": row_symbol(row),
        "quantity": quantity,
        "mtm": normalize_position_mtm(row, quantity),
        "averagePrice": safe_float(first_present(row, ["average_price", "avg_price", "averagePrice", "cost_price"])),
        "ltp": safe_float(first_present(row, ["ltp", "last_traded_price", "last_price", "market_price"])),
        "raw": row,
    }


def extract_rule_id_hint(payload: dict) -> str:
    candidates = [
        payload.get("ruleId"),
        payload.get("rule_id"),
        payload.get("strategy_id"),
        payload.get("strategyId"),
        payload.get("client_order_id"),
        payload.get("clientOrderId"),
        payload.get("correlation_id"),
        payload.get("correlationId"),
        payload.get("tag"),
        payload.get("user_remark"),
        payload.get("userRemark"),
    ]
    for value in candidates:
        text = str(value or "")
        match = re.search(r"(rule-[A-Za-z0-9_-]+)", text)
        if match:
            return match.group(1)
        if text.startswith("rule-"):
            return text
    return ""


def normalize_broker_results(payload: dict) -> List[dict]:
    rows = payload.get("brokerResults") or payload.get("broker_results") or payload.get("orders") or payload.get("legs") or payload.get("trades")
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list):
        if first_present(payload, ["order_id", "orderId", "exchange_order_id", "exchangeOrderId"]):
            rows = [payload]
        else:
            return []

    results: List[dict] = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        raw_status = str(first_present(row, ["status", "order_status", "orderStatus", "execution_status", "executionStatus"]) or "").lower()
        success = raw_status in {"success", "ok", "complete", "completed", "executed", "filled", "traded"}
        if not raw_status:
            success = not bool(first_present(row, ["error", "error_message", "reason", "reject_reason"]))
        results.append({
            "leg_index": int(safe_float(first_present(row, ["leg_index", "legIndex"]) or index)),
            "success": success,
            "order_id": str(first_present(row, ["order_id", "orderId", "exchange_order_id", "exchangeOrderId"]) or ""),
            "error": str(first_present(row, ["error", "error_message", "errorMessage", "reason", "reject_reason"]) or ""),
        })
    return results


def normalize_callback_payload(payload: dict, source: str, normalized_at: float | None = None) -> Dict[str, Any]:
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    event_type_raw = str(first_present(data, [
        "eventType",
        "event_type",
        "callback_type",
        "callbackType",
        "update_type",
        "updateType",
        "event",
    ]) or ("webhook" if source == "webhook" else "manual")).lower()
    broker_status_raw = str(first_present(data, [
        "status",
        "order_status",
        "orderStatus",
        "execution_status",
        "executionStatus",
        "trade_status",
        "tradeStatus",
    ]) or "").lower()

    if any(token in event_type_raw for token in ("reject", "fail", "cancel", "error")) or broker_status_raw in {"rejected", "failed", "cancelled", "canceled", "error"}:
        status = "error"
        event_type = "failed"
    elif any(token in event_type_raw for token in ("trigger", "alert")):
        status = "warning"
        event_type = "triggered"
    elif any(token in event_type_raw for token in ("fill", "trade", "exec", "complete")) or broker_status_raw in {"success", "ok", "complete", "completed", "executed", "filled", "traded"}:
        status = "success"
        event_type = "executed"
    else:
        status = "info"
        event_type = "webhook" if source == "webhook" else "manual"

    message = str(first_present(data, [
        "message",
        "status_message",
        "statusMessage",
        "reason",
        "remarks",
        "remark",
        "error_message",
        "errorMessage",
    ]) or "")
    if not message:
        if broker_status_raw:
            message = f"Broker callback status: {broker_status_raw}."
        elif source == "webhook":
            message = "Broker webhook received."
        else:
            message = "Manual automation callback received."

    symbol = str(first_present(data, ["stock_code", "stockCode", "symbol", "underlying"]) or "").upper()
    meta = {
        "source": source,
        "brokerStatus": broker_status_raw,
        "eventTypeRaw": event_type_raw,
        "normalizedAt": normalized_at if normalized_at is not None else time.time(),
        "payload": payload,
    }
    if symbol:
        meta["symbol"] = symbol

    return {
        "ruleId": extract_rule_id_hint(data),
        "ruleName": str(first_present(data, ["ruleName", "rule_name", "strategy_name", "strategyName"]) or ""),
        "kind": str(first_present(data, ["kind", "ruleKind", "rule_kind"]) or "alert"),
        "eventType": event_type,
        "status": status,
        "message": message,
        "brokerResults": normalize_broker_results(data),
        "meta": meta,
    }
