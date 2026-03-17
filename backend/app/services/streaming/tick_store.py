from __future__ import annotations

from typing import Any


class TickStoreFacade:
    """Thin facade placeholder for extracting tick-store logic from kaggle_backend.py."""

    def __init__(self, store: Any):
        self.store = store

    def get_all(self) -> dict[str, Any]:
        return self.store.get_all()

    def to_option_chain_delta(self) -> list[dict[str, Any]]:
        return self.store.to_option_chain_delta()

    def get_spot_prices(self) -> dict[str, float]:
        return self.store.get_spot_prices()
