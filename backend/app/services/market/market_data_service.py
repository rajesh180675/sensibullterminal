from __future__ import annotations

import time
from typing import Any, List


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class MarketDataService:
    def __init__(self, engine: Any):
        self.engine = engine

    def fetch_option_chain(
        self,
        stock_code: str,
        exchange_code: str,
        expiry_date: str,
        right: str = "Call",
        strike_price: str = "",
    ) -> List[dict[str, Any]]:
        if not self.engine.connected:
            raise RuntimeError("Not connected")

        right_norm = "Call" if right.lower().startswith("c") else "Put"
        self.engine.log.info(f"[REST] get_option_chain_quotes {stock_code} {expiry_date} {right_norm}")

        result = self.engine.broker_client.get_option_chain_quotes(
            stock_code=stock_code,
            exchange_code=exchange_code,
            product_type="options",
            expiry_date=expiry_date,
            right=right_norm,
            strike_price=strike_price,
        )
        rows = result.get("Success") if isinstance(result, dict) else []

        if rows:
            suffix = "CE" if right_norm == "Call" else "PE"
            for row in rows:
                try:
                    strike = str(int(float(row.get("strike_price") or row.get("strike-price") or 0)))
                    key = f"{stock_code}:{strike}:{suffix}"
                    self.engine.tick_store.update(
                        key,
                        {
                            "ltp": float(row.get("ltp") or row.get("last_traded_price") or 0),
                            "oi": float(row.get("open_interest") or row.get("open-interest") or 0),
                            "volume": float(row.get("total_quantity_traded") or row.get("total-quantity-traded") or 0),
                            "iv": float(row.get("implied_volatility") or row.get("implied-volatility") or 0),
                            "bid": float(row.get("best_bid_price") or row.get("best-bid-price") or 0),
                            "ask": float(row.get("best_offer_price") or row.get("best-offer-price") or 0),
                        },
                    )
                except Exception as exc:
                    self.engine.log.debug(f"seed tick error: {exc}")

        return rows or []

    def get_quote(
        self,
        stock_code: str,
        exchange_code: str,
        expiry_date: str,
        right: str,
        strike_price: str,
    ) -> dict[str, Any]:
        if not self.engine.connected:
            raise RuntimeError("Not connected")

        return self.engine.broker_client.get_quotes(
            stock_code=stock_code,
            exchange_code=exchange_code,
            expiry_date=expiry_date,
            right=right,
            strike_price=strike_price,
            product_type="options",
        )

    def get_spot(self, stock_code: str, exchange_code: str) -> dict[str, Any]:
        spot_prices = self.engine.tick_store.get_spot_prices()
        cached = spot_prices.get(stock_code.upper())
        if cached and cached > 1000:
            return {
                "success": True,
                "spot": cached,
                "source": "ws_tick",
                "stock_code": stock_code,
                "exchange_code": exchange_code,
            }

        try:
            result = self.engine.broker_client.get_quotes(
                stock_code=stock_code,
                exchange_code=exchange_code,
                expiry_date="",
                right="",
                strike_price="",
            )
        except Exception as exc:
            return {"success": False, "error": str(exc)}

        rows = result.get("Success", []) if isinstance(result, dict) else []
        if isinstance(rows, dict):
            rows = [rows]
        for row in rows:
            for field in ("ltp", "last_traded_price", "close", "last_price", "LastPrice"):
                ltp = _safe_float(row.get(field))
                if ltp > 1000:
                    self.engine.tick_store.update(
                        f"{stock_code.upper()}:SPOT",
                        {"ltp": ltp, "is_spot": True, "source": "rest"},
                    )
                    return {
                        "success": True,
                        "spot": ltp,
                        "source": "rest_quote",
                        "stock_code": stock_code,
                        "exchange_code": exchange_code,
                    }
        return {
            "success": False,
            "error": f"No spot price returned for {stock_code}/{exchange_code}. Raw Breeze response: {str(result)[:200]}",
        }

    def get_historical(
        self,
        stock_code: str,
        exchange_code: str,
        interval: str,
        from_date: str,
        to_date: str,
        expiry_date: str = "",
        right: str = "",
        strike_price: str = "",
    ) -> List[dict[str, Any]]:
        if not self.engine.connected:
            raise RuntimeError("Not connected")

        kwargs: dict[str, Any] = {
            "interval": interval,
            "from_date": from_date,
            "to_date": to_date,
            "stock_code": stock_code,
            "exchange_code": exchange_code,
        }
        if expiry_date:
            kwargs["expiry_date"] = expiry_date
            kwargs["product_type"] = "options"
        if right:
            kwargs["right"] = right
        if strike_price:
            kwargs["strike_price"] = strike_price

        result = self.engine.broker_client.get_historical_data_v2(**kwargs)
        candles = result.get("Success", []) if isinstance(result, dict) else []
        if candles and not expiry_date:
            self.engine.candle_store.seed(stock_code.upper(), interval, candles)
        return candles

    def get_market_depth(
        self,
        stock_code: str,
        exchange_code: str,
        expiry_date: str,
        right: str,
        strike_price: str,
    ) -> dict[str, Any]:
        if not self.engine.connected:
            raise RuntimeError("Not connected")

        right_norm = "Call" if right.lower().startswith("c") else "Put"
        result = self.engine.broker_client.get_market_depth(
            stock_code=stock_code,
            exchange_code=exchange_code,
            product_type="options",
            expiry_date=expiry_date,
            right=right_norm,
            strike_price=strike_price,
        )
        rows = result.get("Success") if isinstance(result, dict) else []
        if isinstance(rows, dict):
            rows = [rows]
        if not rows:
            return {
                "bids": [],
                "asks": [],
                "spread": 0,
                "imbalance": 0,
                "updated_at": time.time(),
                "instrument_label": f"{stock_code} {expiry_date} {strike_price} {right_norm}",
                "contract_key": f"{stock_code}:{strike_price}:{'CE' if right_norm == 'Call' else 'PE'}",
            }

        row = rows[0]
        bids: List[dict[str, Any]] = []
        asks: List[dict[str, Any]] = []
        for level in range(1, 6):
            bid_price = _safe_float(row.get(f"best_bid_price_{level}") or row.get(f"buy_price_{level}") or row.get(f"BidPrice{level}"))
            bid_qty = _safe_float(row.get(f"best_bid_quantity_{level}") or row.get(f"buy_quantity_{level}") or row.get(f"BidQty{level}"))
            ask_price = _safe_float(row.get(f"best_offer_price_{level}") or row.get(f"sell_price_{level}") or row.get(f"AskPrice{level}"))
            ask_qty = _safe_float(row.get(f"best_offer_quantity_{level}") or row.get(f"sell_quantity_{level}") or row.get(f"AskQty{level}"))
            if bid_price > 0:
                bids.append({"price": bid_price, "quantity": bid_qty, "orders": 1})
            if ask_price > 0:
                asks.append({"price": ask_price, "quantity": ask_qty, "orders": 1})

        total_bid = sum(level["quantity"] for level in bids)
        total_ask = sum(level["quantity"] for level in asks)
        spread = max(0.0, asks[0]["price"] - bids[0]["price"]) if bids and asks else 0.0
        imbalance = ((total_bid - total_ask) / (total_bid + total_ask)) if (total_bid + total_ask) else 0.0
        return {
            "bids": bids,
            "asks": asks,
            "spread": spread,
            "imbalance": imbalance,
            "updated_at": time.time(),
            "instrument_label": f"{stock_code} {expiry_date} {strike_price} {right_norm}",
            "contract_key": f"{stock_code}:{strike_price}:{'CE' if right_norm == 'Call' else 'PE'}",
        }
