from __future__ import annotations

from typing import Any

from ...storage.audit_log_repo import AuditLogRepository


class JournalService:
    """Adapter around the legacy seller review manager until extraction is complete."""

    def __init__(self, manager: Any, audit_log: AuditLogRepository | None = None):
        self.manager = manager
        self.audit_log = audit_log

    def get_state(self):
        return self.manager.get_state()

    def replace_state(self, payload: dict[str, Any]):
        state = self.manager.replace_state(payload)
        if self.audit_log is not None:
            self.audit_log.append(
                event_type="reviews.state.replaced",
                actor="user",
                details={
                    "entry_count": len(state.get("entries", [])),
                    "playbook_review_count": len(state.get("playbook_reviews", [])),
                },
            )
        return state
