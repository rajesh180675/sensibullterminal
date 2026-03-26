from __future__ import annotations

from typing import Any

from ...storage.audit_log_repo import AuditLogRepository


class RuleService:
    """Adapter around the legacy automation manager until extraction is complete."""

    def __init__(self, manager: Any, audit_log: AuditLogRepository | None = None):
        self.manager = manager
        self.audit_log = audit_log

    def list_rules(self):
        return self.manager.list_rules()

    def list_callbacks(self, limit: int = 25):
        return self.manager.list_callbacks(limit=limit)

    def create_rule(self, payload: dict[str, Any]):
        rule = self.manager.create_rule(payload)
        self._log("automation.rule.created", {"rule": rule}, rule_id=str(rule.get("id", "")))
        return rule

    def update_rule(self, rule_id: str, payload: dict[str, Any]):
        rule = self.manager.update_rule(rule_id, payload)
        if rule:
            self._log("automation.rule.updated", {"rule": rule}, rule_id=rule_id)
        return rule

    def delete_rule(self, rule_id: str):
        rule = self.manager.delete_rule(rule_id)
        if rule:
            self._log("automation.rule.deleted", {"rule": rule}, rule_id=rule_id)
        return rule

    def update_rule_status(self, rule_id: str, status: str):
        rule = self.manager.update_rule_status(rule_id, status)
        if rule:
            self._log("automation.rule.status", {"status": status}, rule_id=rule_id)
        return rule

    def evaluate_active_rules(self):
        events = self.manager.evaluate_active_rules()
        if events:
            self._log("automation.rule.evaluated", {"count": len(events), "events": events[:5]})
        return events

    def receive_callback(self, payload: dict[str, Any], source: str = "callback"):
        event = self.manager.receive_callback(payload, source)
        self._log(
            "automation.callback.received",
            {"source": source, "event": event},
            rule_id=str(event.get("ruleId", "")) or None,
        )
        return event

    def _log(self, event_type: str, details: dict[str, Any], rule_id: str | None = None) -> None:
        if self.audit_log is None:
            return
        self.audit_log.append(
            event_type=event_type,
            actor="system",
            details=details,
            rule_id=rule_id,
        )
