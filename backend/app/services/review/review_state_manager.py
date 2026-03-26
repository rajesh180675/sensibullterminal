from __future__ import annotations

import threading
from typing import Any

from ..streaming.tick_store import JsonStateStore


class SellerReviewManager:
    def __init__(self, path: str):
        self.store = JsonStateStore(path, lambda: {"entries": [], "playbook_reviews": []})
        self._lock = threading.Lock()
        self._state = self.store.load()

    def get_state(self) -> dict[str, Any]:
        with self._lock:
            return {
                "entries": list(self._state.get("entries", [])),
                "playbook_reviews": list(self._state.get("playbook_reviews", [])),
            }

    def replace_state(self, payload: dict[str, Any]) -> dict[str, Any]:
        entries = payload.get("entries", []) if isinstance(payload, dict) else []
        playbook_reviews = payload.get("playbookReviews", payload.get("playbook_reviews", [])) if isinstance(payload, dict) else []
        if not isinstance(entries, list):
            entries = []
        if not isinstance(playbook_reviews, list):
            playbook_reviews = []
        with self._lock:
            self._state = {"entries": entries, "playbook_reviews": playbook_reviews}
            self.store.save(self._state)
            return {"entries": list(entries), "playbook_reviews": list(playbook_reviews)}
