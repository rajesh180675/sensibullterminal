from __future__ import annotations

from typing import Any


class JournalService:
    """Adapter around the legacy seller review manager until extraction is complete."""

    def __init__(self, manager: Any):
        self.manager = manager

    def get_state(self):
        return self.manager.get_state()

    def replace_state(self, payload: dict[str, Any]):
        return self.manager.replace_state(payload)
