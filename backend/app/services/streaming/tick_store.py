from __future__ import annotations

import json
import os
import threading
import time
from collections import deque
from datetime import datetime
from typing import Any, Callable


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _bucket_epoch(ts: float, interval: str) -> int:
    dt = datetime.fromtimestamp(ts)
    if interval == "1minute":
        return int(dt.replace(second=0, microsecond=0).timestamp())
    if interval == "5minute":
        minute = dt.minute - (dt.minute % 5)
        return int(dt.replace(minute=minute, second=0, microsecond=0).timestamp())
    if interval == "30minute":
        minute = dt.minute - (dt.minute % 30)
        return int(dt.replace(minute=minute, second=0, microsecond=0).timestamp())
    return int(dt.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())


class TickStore:
    def __init__(self):
        self._ticks: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._version = 0

    def update(self, key: str, data: dict[str, Any]) -> None:
        with self._lock:
            existing = self._ticks.get(key, {})
            existing.update(data)
            existing["_ts"] = time.time()
            self._ticks[key] = existing
            self._version += 1

    def get_all(self) -> dict[str, Any]:
        with self._lock:
            return {"ticks": dict(self._ticks), "version": self._version}

    def get_version(self) -> int:
        with self._lock:
            return self._version

    def clear(self) -> None:
        with self._lock:
            self._ticks.clear()
            self._version = 0

    def to_option_chain_delta(self) -> list[dict[str, Any]]:
        with self._lock:
            rows: list[dict[str, Any]] = []
            for key, tick in self._ticks.items():
                parts = key.split(":")
                if len(parts) < 3:
                    continue
                stock, strike_str, right = parts[0], parts[1], parts[2]
                if right == "SPOT":
                    continue
                try:
                    strike = int(float(strike_str))
                except Exception:
                    continue
                rows.append({
                    "stock_code": stock,
                    "strike": strike,
                    "right": right,
                    "ltp": tick.get("ltp", 0),
                    "oi": tick.get("oi", 0),
                    "volume": tick.get("volume", 0),
                    "iv": tick.get("iv", 0),
                    "bid": tick.get("bid", 0),
                    "ask": tick.get("ask", 0),
                    "change_pct": tick.get("change_pct", 0),
                    "last_updated": tick.get("_ts", 0),
                })
            return rows

    def get_spot_prices(self) -> dict[str, float]:
        with self._lock:
            result: dict[str, float] = {}
            for key, tick in self._ticks.items():
                parts = key.split(":")
                if len(parts) == 2 and parts[1] == "SPOT":
                    stock = parts[0]
                    ltp = tick.get("ltp", 0)
                    if ltp > 0:
                        result[stock] = ltp
            return result


class ValidationCaptureStore:
    def __init__(self, path: str):
        self.path = path
        self._lock = threading.Lock()
        self._recent: deque[dict[str, Any]] = deque(maxlen=25)

    def append(self, record: dict[str, Any]) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        line = json.dumps(record, default=str)
        with self._lock:
            with open(self.path, "a", encoding="utf-8") as handle:
                handle.write(line + "\n")
            self._recent.appendleft(record)

    def recent(self, limit: int = 10) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._recent)[: max(1, min(limit, len(self._recent) or 1))]


class CandleStore:
    INTERVALS = ("1minute", "5minute", "30minute", "1day")

    def __init__(self):
        self._lock = threading.Lock()
        self._candles: dict[str, dict[str, dict[int, dict[str, Any]]]] = {}

    def clear(self) -> None:
        with self._lock:
            self._candles.clear()

    def seed(self, symbol: str, interval: str, candles: list[dict[str, Any]]) -> None:
        if interval not in self.INTERVALS:
            return
        with self._lock:
            symbol_store = self._candles.setdefault(symbol, {})
            bucket_store = symbol_store.setdefault(interval, {})
            for candle in candles:
                dt_raw = candle.get("datetime")
                price = _safe_float(candle.get("close"))
                if not dt_raw or price <= 0:
                    continue
                try:
                    bucket = int(datetime.fromisoformat(str(dt_raw).replace("Z", "+00:00")).timestamp())
                except ValueError:
                    try:
                        bucket = int(datetime.strptime(str(dt_raw), "%Y-%m-%d %H:%M:%S").timestamp())
                    except ValueError:
                        continue
                bucket_store[bucket] = {
                    "datetime": str(dt_raw),
                    "open": _safe_float(candle.get("open"), price),
                    "high": _safe_float(candle.get("high"), price),
                    "low": _safe_float(candle.get("low"), price),
                    "close": price,
                    "volume": _safe_float(candle.get("volume")),
                }

    def update(self, symbol: str, price: float, volume: float = 0.0, ts: float | None = None) -> None:
        if price <= 0:
            return
        now = ts or time.time()
        with self._lock:
            symbol_store = self._candles.setdefault(symbol, {})
            for interval in self.INTERVALS:
                bucket = _bucket_epoch(now, interval)
                interval_store = symbol_store.setdefault(interval, {})
                candle = interval_store.get(bucket)
                if candle is None:
                    interval_store[bucket] = {
                        "datetime": datetime.fromtimestamp(bucket).strftime("%Y-%m-%d %H:%M:%S"),
                        "open": price,
                        "high": price,
                        "low": price,
                        "close": price,
                        "volume": volume,
                    }
                    continue
                candle["high"] = max(candle["high"], price)
                candle["low"] = min(candle["low"], price)
                candle["close"] = price
                candle["volume"] += volume

    def to_stream_payload(self, limit: int = 2) -> dict[str, dict[str, list[dict[str, Any]]]]:
        with self._lock:
            payload: dict[str, dict[str, list[dict[str, Any]]]] = {}
            for symbol, interval_map in self._candles.items():
                for interval, bucket_map in interval_map.items():
                    recent = [bucket_map[key] for key in sorted(bucket_map.keys())[-limit:]]
                    if recent:
                        payload.setdefault(symbol, {})[interval] = recent
            return payload


class TickStoreFacade:
    def __init__(self, store: Any):
        self.store = store

    def get_all(self) -> dict[str, Any]:
        return self.store.get_all()

    def to_option_chain_delta(self) -> list[dict[str, Any]]:
        return self.store.to_option_chain_delta()

    def get_spot_prices(self) -> dict[str, float]:
        return self.store.get_spot_prices()


class JsonStateStore:
    def __init__(self, path: str, default_factory: Callable[[], dict[str, Any]]):
        self.path = path
        self.default_factory = default_factory
        self._lock = threading.Lock()

    def load(self) -> dict[str, Any]:
        with self._lock:
            if not os.path.exists(self.path):
                return self.default_factory()
            try:
                with open(self.path, "r", encoding="utf-8") as handle:
                    payload = json.load(handle)
                return payload if isinstance(payload, dict) else self.default_factory()
            except Exception:
                return self.default_factory()

    def save(self, payload: dict[str, Any]) -> None:
        directory = os.path.dirname(self.path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        tmp = self.path + ".tmp"
        with self._lock:
            with open(tmp, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=True, indent=2)
            os.replace(tmp, self.path)
