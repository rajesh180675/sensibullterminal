from __future__ import annotations

from typing import Any


class MarketService:
    def __init__(self, engine: Any):
        self.engine = engine
        self.market_data = getattr(engine, "market_data_service", None)

    def get_expiries(self, stock_code: str, count: int = 5) -> list[str]:
        return self.engine.__class__.get_weekly_expiries(stock_code, count=count)

    def get_spot(self, stock_code: str, exchange_code: str) -> dict[str, Any]:
        if self.market_data is not None:
            return self.market_data.get_spot(stock_code, exchange_code)
        return {"success": False, "error": "Market data service is not configured"}

    def fetch_option_chain(
        self,
        stock_code: str,
        exchange_code: str,
        expiry_date: str,
        right: str,
        strike_price: str,
    ):
        if self.market_data is not None:
            return self.market_data.fetch_option_chain(stock_code, exchange_code, expiry_date, right, strike_price)
        raise RuntimeError("Market data service is not configured")

    def get_quote(self, *args):
        if self.market_data is not None:
            return self.market_data.get_quote(*args)
        raise RuntimeError("Market data service is not configured")

    def get_historical(self, *args):
        if self.market_data is not None:
            return self.market_data.get_historical(*args)
        raise RuntimeError("Market data service is not configured")

    def get_depth(self, *args):
        if self.market_data is not None:
            return self.market_data.get_market_depth(*args)
        raise RuntimeError("Market data service is not configured")
