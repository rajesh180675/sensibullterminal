from __future__ import annotations

import sqlite3
from pathlib import Path

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
    def __init__(self):
        self.version = 1
        self.ticks = {
            "NIFTY:22000:CE": {
                "ltp": 112.5,
                "oi": 1200,
                "volume": 250,
                "iv": 14.2,
                "bid": 112.0,
                "ask": 113.0,
                "change_pct": 1.2,
                "_ts": 1711450000.0,
            },
            "NIFTY:SPOT": {"ltp": 22105.4, "_ts": 1711450000.0},
        }

    def get_all(self):
        return {"ticks": dict(self.ticks), "version": self.version}

    def get_version(self):
        return self.version

    def to_option_chain_delta(self):
        return [{
            "stock_code": "NIFTY",
            "strike": 22000,
            "right": "CE",
            "ltp": 112.5,
            "oi": 1200,
            "volume": 250,
            "iv": 14.2,
            "bid": 112.0,
            "ask": 113.0,
            "change_pct": 1.2,
            "last_updated": 1711450000.0,
        }]

    def get_spot_prices(self):
        return {"NIFTY": 22105.4}


class FakeCandleStore:
    def to_stream_payload(self, limit=2):
        _ = limit
        return {
            "NIFTY": {
                "1minute": [{
                    "datetime": "2026-03-26 09:15:00",
                    "open": 22090.0,
                    "high": 22110.0,
                    "low": 22080.0,
                    "close": 22105.4,
                    "volume": 1200.0,
                }],
            },
        }


class FakeValidationCapture:
    path = "logs/test_validation.jsonl"

    def recent(self, limit=10):
        return [{"kind": "preview", "leg_count": 1}][:limit]


class FakeRateLimiter:
    MIN_INTERVAL_MS = 600
    calls_last_minute = 3
    queue_depth = 0


class FakeBreeze:
    def get_quotes(self, **kwargs):
        _ = kwargs
        return {"Success": [{"ltp": 22105.4}]}


class FakeEngine:
    def __init__(self):
        self.connected = True
        self.ws_running = True
        self.subscribed = {"NIFTY:22000:CE:27-Mar-2026"}
        self.rate_limiter = FakeRateLimiter()
        self.automation_rules = FakeRuleManager()
        self.seller_reviews = FakeReviewManager()
        self.tick_store = FakeTickStore()
        self.candle_store = FakeCandleStore()
        self.validation_capture = FakeValidationCapture()
        self.breeze = FakeBreeze()

    def connect(self, api_key, api_secret, session_token):
        return {
            "success": True,
            "session_token": session_token,
            "message": f"Connected with {api_key}/{api_secret}",
        }

    def disconnect(self):
        self.connected = False

    @staticmethod
    def get_weekly_expiries(stock_code, count=5):
        return [{"date": "27-Mar-2026", "label": stock_code, "days_away": 1, "weekday": "Friday"}][:count]

    @staticmethod
    def generate_checksum(timestamp, payload, secret):
        return f"{timestamp}:{len(str(payload))}:{secret}"

    def fetch_option_chain(self, stock_code, exchange_code, expiry_date, right, strike_price):
        return [{
            "stock_code": stock_code,
            "exchange_code": exchange_code,
            "expiry_date": expiry_date,
            "right": right,
            "strike_price": strike_price or "22000",
            "ltp": 112.5,
        }]

    def get_quote(self, *args):
        return {"Success": [{"args": list(args)}]}

    def get_historical(self, *args):
        _ = args
        return [{"datetime": "2026-03-26 09:15:00", "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 10}]

    def get_market_depth(self, *args):
        _ = args
        return {"bids": [{"price": 100, "quantity": 25}], "asks": [{"price": 101, "quantity": 20}]}

    def preview_strategy(self, legs):
        return {"estimatedPremium": 12.0, "estimatedFees": 1.5, "legs": legs, "validation": {"kind": "preview"}}

    def calculate_margin(self, legs):
        return {
            "margin_required": float(len(legs)) * 1000.0,
            "available_margin": 50000.0,
            "span_margin": 800.0,
            "block_trade_margin": 200.0,
            "order_margin": 1000.0,
            "trade_margin": 950.0,
            "validation": {"kind": "margin"},
        }

    def repair_preview(self, current_legs, repair_legs, meta):
        return {"incrementalPreview": {"estimatedPremium": 5.0}, "current": current_legs, "repair": repair_legs, "meta": meta}

    def place_strategy_order(self, legs):
        return [{"leg_index": idx, "success": True, "order_id": f"OID-{idx}", "error": ""} for idx, _ in enumerate(legs)]

    def square_off_position(self, payload):
        _ = payload
        return {"Status": 200, "Success": {"order_id": "SQ-1"}}

    def cancel_order(self, order_id, exchange_code):
        return {"Status": 200, "Success": {"order_id": order_id, "exchange_code": exchange_code}}

    def modify_order(self, order_id, exchange_code, quantity, price, stoploss, validity):
        _ = (exchange_code, quantity, price, stoploss, validity)
        return {"Status": 200, "Success": {"order_id": order_id}}

    def get_order_book(self):
        return {"Success": [{"order_id": "OID-1", "status": "OPEN"}]}

    def get_trade_book(self):
        return {"Success": [{"order_id": "OID-1", "price": "101"}]}

    def get_positions(self):
        return {"positions": [{"stock_code": "NIFTY", "quantity": "75"}], "holdings": []}

    def get_funds(self):
        return {"available_margin": 50000.0}

    def unsubscribe_all(self):
        self.subscribed.clear()

    def subscribe_option_chain(self, stock_code, exchange_code, expiry_date, strikes, rights):
        _ = (stock_code, exchange_code, expiry_date, rights)
        return {"subscribed": len(strikes), "total_subs": len(strikes), "errors": []}


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


def test_market_and_order_routes_use_modular_services(tmp_path):
    client = build_client(tmp_path)

    optionchain = client.get("/api/optionchain", params={
        "stock_code": "NIFTY",
        "exchange_code": "NFO",
        "expiry_date": "27-Mar-2026",
        "right": "Call",
    })
    assert optionchain.status_code == 200
    assert optionchain.json()["data"][0]["stock_code"] == "NIFTY"

    preview = client.post("/api/preview", json={"legs": [{"stock_code": "NIFTY"}]})
    assert preview.status_code == 200
    assert preview.json()["data"]["estimatedPremium"] == 12.0

    execute = client.post("/api/strategy/execute", json={"legs": [{"stock_code": "NIFTY"}]})
    assert execute.status_code == 200
    assert execute.json()["results"][0]["order_id"] == "OID-0"


def test_stream_routes_and_websocket_payloads(tmp_path):
    client = build_client(tmp_path)

    subscribe = client.post("/api/ws/subscribe", json={
        "stock_code": "NIFTY",
        "exchange_code": "NFO",
        "expiry_date": "27-Mar-2026",
        "strikes": [22000, 22100],
        "rights": ["Call", "Put"],
    })
    assert subscribe.status_code == 200
    assert subscribe.json()["subscribed"] == 2

    ticks = client.get("/api/ticks", params={"since_version": 0})
    assert ticks.status_code == 200
    assert ticks.json()["changed"] is True
    assert ticks.json()["ticks"][0]["stock_code"] == "NIFTY"

    with client.websocket_connect("/ws/ticks") as websocket:
        payload = websocket.receive_json()
        assert payload["type"] == "tick_update"
        assert payload["spot_prices"]["NIFTY"] == 22105.4
        assert "candle_streams" in payload


def test_sqlite_layout_recovery_and_error_cases(tmp_path):
    db_path = Path(tmp_path) / "recovery.db"
    connection = init_sqlite(db_path)
    repo = LayoutRepository(connection)
    repo.save_layout(
        layout_id="persisted-layout",
        workspace_id="terminal-shell",
        name="Recovered",
        panels={"bottomDockOpen": False},
        is_default=True,
    )
    connection.close()

    reopened = sqlite3.connect(db_path)
    reopened.row_factory = sqlite3.Row
    recovered_repo = LayoutRepository(reopened)
    recovered = recovered_repo.get_layout("persisted-layout")
    assert recovered is not None
    assert recovered["panels"]["bottomDockOpen"] is False

    client = build_client(tmp_path)
    bad_save = client.put("/api/layouts/bad-layout", json={"workspace_id": "market"})
    assert bad_save.status_code == 400
    assert "workspace_id, name, and panels are required" in bad_save.json()["error"]

    missing_delete = client.delete("/api/layouts/does-not-exist")
    assert missing_delete.status_code == 404
