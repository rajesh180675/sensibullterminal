from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.core.state import BackendState
from backend.app.create_app import create_app
from backend.app.storage.audit_log_repo import AuditLogRepository
from backend.app.storage.database import init_sqlite
from backend.app.storage.layout_repo import LayoutRepository


class FakeRuleManager:
    def __init__(self):
        self.rules = []
        self.callbacks = []

    def list_rules(self):
        return list(self.rules)

    def create_rule(self, payload):
        rule = {"id": payload.get("id", "rule-1"), "name": payload.get("name", "Rule"), **payload}
        self.rules.append(rule)
        return rule

    def update_rule(self, rule_id, payload):
        for rule in self.rules:
            if rule["id"] == rule_id:
                rule.update(payload)
                return rule
        return None

    def delete_rule(self, rule_id):
        for idx, rule in enumerate(self.rules):
            if rule["id"] == rule_id:
                return self.rules.pop(idx)
        return None

    def update_rule_status(self, rule_id, status):
        return self.update_rule(rule_id, {"status": status})

    def evaluate_active_rules(self):
        event = {"ruleId": "rule-1", "status": "ok"}
        self.callbacks.insert(0, event)
        return [event]

    def list_callbacks(self, limit=25):
        return self.callbacks[:limit]

    def receive_callback(self, payload, source="callback"):
        event = {"ruleId": payload.get("ruleId", "rule-1"), "source": source, "payload": payload}
        self.callbacks.insert(0, event)
        return event


class FakeReviewManager:
    def __init__(self):
        self.state = {"entries": [], "playbook_reviews": []}

    def get_state(self):
        return self.state

    def replace_state(self, payload):
        self.state = {
            "entries": payload.get("entries", []),
            "playbook_reviews": payload.get("playbookReviews", payload.get("playbook_reviews", [])),
        }
        return self.state


class FakeTickStore:
    def get_all(self):
        return {"ticks": [], "version": 0}

    def to_option_chain_delta(self):
        return []

    def get_spot_prices(self):
        return {}


class FakeEngine:
    def __init__(self):
        self.automation_rules = FakeRuleManager()
        self.seller_reviews = FakeReviewManager()
        self.tick_store = FakeTickStore()


def build_client(tmp_path):
    connection = init_sqlite(tmp_path / "terminal.db")
    state = BackendState(
        engine=FakeEngine(),
        version="test",
        sqlite_connection=connection,
    )
    return TestClient(create_app(state))


def test_layout_repository_round_trip(tmp_path):
    connection = init_sqlite(tmp_path / "layouts.db")
    repo = LayoutRepository(connection)
    saved = repo.save_layout(
        layout_id="layout-1",
        workspace_id="market",
        name="Primary",
        panels={"dock": ["positions", "orders"]},
        is_default=True,
    )
    assert saved["layout_id"] == "layout-1"
    assert saved["workspace_id"] == "market"
    assert saved["panels"] == {"dock": ["positions", "orders"]}
    assert repo.get_layout("layout-1")["name"] == "Primary"


def test_layout_routes_persist_to_sqlite(tmp_path):
    client = build_client(tmp_path)
    response = client.put(
        "/api/layouts/layout-1",
        json={
            "workspace_id": "market",
            "name": "Default",
            "panels": {"rightDrawerOpen": True},
            "is_default": True,
        },
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["layout_id"] == "layout-1"

    list_response = client.get("/api/layouts", params={"workspace_id": "market"})
    assert list_response.status_code == 200
    assert len(list_response.json()["data"]) == 1


def test_automation_routes_write_audit_log(tmp_path):
    client = build_client(tmp_path)
    create_response = client.post("/api/automation/rules", json={"id": "rule-1", "name": "Guard"})
    assert create_response.status_code == 200
    assert create_response.json()["rule"]["id"] == "rule-1"

    audit_response = client.get("/api/diagnostics/audit-log")
    assert audit_response.status_code == 200
    records = audit_response.json()["records"]
    assert records
    assert records[0]["event_type"] == "automation.rule.created"


def test_review_route_replaces_state_and_logs(tmp_path):
    client = build_client(tmp_path)
    response = client.put(
        "/api/reviews/state",
        json={"entries": [{"symbol": "NIFTY"}], "playbookReviews": [{"id": "case-1"}]},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["entries"][0]["symbol"] == "NIFTY"

    audit_response = client.get("/api/diagnostics/audit-log")
    assert audit_response.status_code == 200
    assert any(record["event_type"] == "reviews.state.replaced" for record in audit_response.json()["records"])


def test_audit_log_repository_lists_recent(tmp_path):
    connection = init_sqlite(tmp_path / "audit.db")
    repo = AuditLogRepository(connection)
    repo.append(event_type="orders.previewed", actor="user", details={"legs": 2})
    repo.append(event_type="orders.sent", actor="user", details={"basket_id": "basket-1"})
    records = repo.list_recent(limit=2)
    assert [record["event_type"] for record in records] == ["orders.sent", "orders.previewed"]
