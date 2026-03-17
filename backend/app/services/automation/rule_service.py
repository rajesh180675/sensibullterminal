from __future__ import annotations

from typing import Any


class RuleService:
    """Adapter around the legacy automation manager until extraction is complete."""

    def __init__(self, manager: Any):
        self.manager = manager

    def list_rules(self):
        return self.manager.list_rules()

    def list_callbacks(self, limit: int = 25):
        return self.manager.list_callbacks(limit=limit)
