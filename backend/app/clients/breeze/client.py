from __future__ import annotations

from typing import Any, Callable


class BreezeBrokerClient:
    def __init__(self, rate_limiter: Any):
        self.rate_limiter = rate_limiter
        self.sdk: Any = None

    def set_sdk(self, sdk: Any | None) -> None:
        self.sdk = sdk

    def require_sdk(self) -> Any:
        if self.sdk is None:
            raise RuntimeError("Breeze SDK client is not connected")
        return self.sdk

    def connect(self, api_key: str, api_secret: str, session_token: str):
        from breeze_connect import BreezeConnect

        sdk = BreezeConnect(api_key=api_key)
        sdk.generate_session(api_secret=api_secret, session_token=session_token)
        self.sdk = sdk
        return sdk

    def _enqueue(self, fn: Callable[[], Any]) -> Any:
        return self.rate_limiter.enqueue(fn)

    def get_customer_details(self):
        return self._enqueue(lambda: self.require_sdk().get_customer_details())

    def get_quotes(self, **kwargs):
        return self._enqueue(lambda: self.require_sdk().get_quotes(**kwargs))

    def get_option_chain_quotes(self, **kwargs):
        return self._enqueue(lambda: self.require_sdk().get_option_chain_quotes(**kwargs))

    def place_order(self, **kwargs):
        return self._enqueue(lambda: self.require_sdk().place_order(**kwargs))

    def cancel_order(self, **kwargs):
        return self._enqueue(lambda: self.require_sdk().cancel_order(**kwargs))

    def modify_order(self, **kwargs):
        return self._enqueue(lambda: self.require_sdk().modify_order(**kwargs))

    def get_order_list(self, **kwargs):
        return self._enqueue(lambda: self.require_sdk().get_order_list(**kwargs))

    def get_trade_list(self, **kwargs):
        return self._enqueue(lambda: self.require_sdk().get_trade_list(**kwargs))

    def get_portfolio_positions(self):
        return self._enqueue(lambda: self.require_sdk().get_portfolio_positions())

    def get_portfolio_holdings(self):
        return self._enqueue(lambda: self.require_sdk().get_portfolio_holdings())

    def get_funds(self):
        return self._enqueue(lambda: self.require_sdk().get_funds())

    def margin_calculator(self, positions: list[dict[str, Any]], exchange_code: str):
        return self._enqueue(lambda: self.require_sdk().margin_calculator(positions, exchange_code))

    def preview_order(self, **kwargs):
        return self._enqueue(lambda: self.require_sdk().preview_order(**kwargs))

    def get_historical_data_v2(self, **kwargs):
        return self._enqueue(lambda: self.require_sdk().get_historical_data_v2(**kwargs))

    def get_market_depth(self, **kwargs):
        return self._enqueue(lambda: self.require_sdk().get_market_depth(**kwargs))

    def set_on_ticks(self, callback: Callable[[Any], None]) -> None:
        self.require_sdk().on_ticks = callback

    def ws_connect(self) -> None:
        self.require_sdk().ws_connect()

    def ws_disconnect(self) -> None:
        self.require_sdk().ws_disconnect()

    def subscribe_feeds(self, **kwargs) -> Any:
        return self.require_sdk().subscribe_feeds(**kwargs)

    def unsubscribe_feeds(self, **kwargs) -> Any:
        return self.require_sdk().unsubscribe_feeds(**kwargs)
