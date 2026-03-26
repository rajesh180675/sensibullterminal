from __future__ import annotations

import threading
import time
from typing import Any, Iterable


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class RealtimeManager:
    def __init__(self, engine: Any):
        self.engine = engine

    def on_ticks(self, ticks: dict[str, Any] | Iterable[dict[str, Any]] | None) -> None:
        if not ticks:
            return
        rows = [ticks] if isinstance(ticks, dict) else list(ticks)
        for tick in rows:
            try:
                stock = (tick.get("stock_code") or tick.get("symbol") or "").upper()
                strike = tick.get("strike_price") or tick.get("strike") or "0"
                right_raw = (tick.get("right") or tick.get("option_type") or "CE").upper()
                right = "CE" if right_raw.startswith("C") else "PE"
                if not stock:
                    continue
                key = f"{stock}:{strike}:{right}"
                self.engine.tick_store.update(
                    key,
                    {
                        "ltp": float(tick.get("last_traded_price") or tick.get("ltp") or 0),
                        "oi": float(tick.get("open_interest") or tick.get("oi") or 0),
                        "volume": float(tick.get("total_quantity_traded") or tick.get("volume") or 0),
                        "iv": float(tick.get("implied_volatility") or tick.get("iv") or 0),
                        "bid": float(tick.get("best_bid_price") or tick.get("bid_price") or 0),
                        "ask": float(tick.get("best_offer_price") or tick.get("ask_price") or 0),
                        "change_pct": float(tick.get("change_percent") or tick.get("change_pct") or 0),
                        "feed_time": str(tick.get("exchange_feed_time") or ""),
                    },
                )
                self.engine.log.debug(f"[WS tick] {key} ltp={tick.get('last_traded_price', 0)}")

                underlying = 0.0
                for field in (
                    "index_close_price",
                    "UnderlyingValue",
                    "underlying_value",
                    "close_price",
                    "index_price",
                    "underlying_spot_price",
                ):
                    value = tick.get(field)
                    if value:
                        underlying = _safe_float(value)
                        if underlying > 0:
                            break
                if underlying > 1000:
                    self.engine.tick_store.update(
                        f"{stock}:SPOT",
                        {
                            "ltp": underlying,
                            "is_spot": True,
                            "source": "ws_tick",
                        },
                    )
                    self.engine.candle_store.update(
                        stock,
                        underlying,
                        _safe_float(tick.get("total_quantity_traded") or tick.get("volume")),
                    )
                    self.engine.log.debug(f"[WS spot] {stock} underlying={underlying}")
            except Exception as exc:
                self.engine.log.warning(f"[WS] parse error: {exc}")

    def start_websocket(self) -> None:
        if not self.engine.connected:
            raise RuntimeError("Not connected")
        with self.engine._ws_lock:
            if self.engine._ws_thread and self.engine._ws_thread.is_alive():
                self.engine.log.info("[WS] already running")
                return

            def _run() -> None:
                try:
                    self.engine.broker_client.set_on_ticks(self.on_ticks)
                    self.engine.broker_client.ws_connect()
                    self.engine.ws_running = True
                    self.engine.log.info("[WS] ws_connect() established")
                except Exception as exc:
                    self.engine.log.error(f"[WS] ws_connect() failed: {exc}")
                    self.engine.ws_running = False

            self.engine._ws_thread = threading.Thread(target=_run, daemon=True, name="BreezeWS")
            self.engine._ws_thread.start()
            deadline = time.time() + 15
            while not self.engine.ws_running and time.time() < deadline:
                time.sleep(0.5)

    def stop_websocket(self) -> None:
        if self.engine.broker_client and self.engine.ws_running:
            try:
                self.engine.broker_client.ws_disconnect()
            except Exception:
                pass
        self.engine.ws_running = False
        self.engine.subscribed.clear()

    def subscribe_option_chain(
        self,
        stock_code: str,
        exchange_code: str,
        expiry_date: str,
        strikes: list[int | float | str],
        rights: list[str] | None = None,
    ) -> dict[str, Any]:
        rights = rights or ["Call", "Put"]
        if not self.engine.ws_running:
            self.start_websocket()
            time.sleep(2)

        count = 0
        errors: list[str] = []
        for strike in strikes:
            for right in rights:
                right_norm = "Call" if right.lower().startswith("c") else "Put"
                sub_key = f"{stock_code}:{strike}:{right_norm[0]}E:{expiry_date}"
                if sub_key in self.engine.subscribed:
                    continue
                try:
                    self.engine.broker_client.subscribe_feeds(
                        stock_code=stock_code,
                        exchange_code=exchange_code,
                        product_type="options",
                        expiry_date=expiry_date,
                        strike_price=str(strike),
                        right=right_norm,
                        get_exchange_quotes=True,
                        get_market_depth=True,
                    )
                    self.engine.subscribed.add(sub_key)
                    count += 1
                    time.sleep(0.05)
                except Exception as exc:
                    errors.append(f"{sub_key}: {exc}")

        return {"subscribed": count, "total_subs": len(self.engine.subscribed), "errors": errors}

    def unsubscribe_all(self) -> None:
        if not self.engine.ws_running or not self.engine.broker_client:
            return
        for sub_key in list(self.engine.subscribed):
            try:
                parts = sub_key.split(":")
                if len(parts) >= 4:
                    stock, strike, right_abbr, expiry = parts
                    right = "Call" if right_abbr.startswith("C") else "Put"
                    self.engine.broker_client.unsubscribe_feeds(
                        stock_code=stock,
                        exchange_code="NFO" if stock == "NIFTY" else "BFO",
                        product_type="options",
                        expiry_date=expiry,
                        strike_price=strike,
                        right=right,
                    )
            except Exception:
                pass
        self.engine.subscribed.clear()
        self.engine.log.info("[WS] all feeds unsubscribed")
