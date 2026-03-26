from __future__ import annotations

from typing import Any


class MarketService:
    def __init__(self, engine: Any):
        self.engine = engine

    def get_expiries(self, stock_code: str, count: int = 5) -> list[str]:
        return self.engine.__class__.get_weekly_expiries(stock_code, count=count)

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

        def _call():
            return self.engine.breeze.get_quotes(
                stock_code=stock_code,
                exchange_code=exchange_code,
                expiry_date="",
                right="",
                strike_price="",
            )

        result = self.engine.rate_limiter.enqueue(_call)
        rows = result.get("Success", []) if isinstance(result, dict) else []
        if isinstance(rows, dict):
            rows = [rows]
        for row in rows:
            for field in ("ltp", "last_traded_price", "close", "last_price", "LastPrice"):
                try:
                    ltp = float(row.get(field) or 0)
                except (TypeError, ValueError):
                    ltp = 0.0
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

    def fetch_option_chain(
        self,
        stock_code: str,
        exchange_code: str,
        expiry_date: str,
        right: str,
        strike_price: str,
    ):
        right_norm = "Call" if (right or "Call").lower().startswith("c") else "Put"
        return self.engine.fetch_option_chain(stock_code, exchange_code, expiry_date, right_norm, strike_price)

    def get_quote(self, *args):
        return self.engine.get_quote(*args)

    def get_historical(self, *args):
        return self.engine.get_historical(*args)

    def get_depth(self, *args):
        return self.engine.get_market_depth(*args)
