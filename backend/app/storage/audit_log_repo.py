from __future__ import annotations

import json
import sqlite3
import time
from typing import Any


class AuditLogRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def append(
        self,
        *,
        event_type: str,
        actor: str,
        details: dict[str, Any],
        basket_id: str | None = None,
        order_id: str | None = None,
        rule_id: str | None = None,
        timestamp: int | None = None,
    ) -> int:
        cursor = self.connection.execute(
            """
            INSERT INTO audit_log (
                timestamp, event_type, actor, details, basket_id, order_id, rule_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                timestamp or int(time.time()),
                event_type,
                actor,
                json.dumps(details, ensure_ascii=True, separators=(",", ":")),
                basket_id,
                order_id,
                rule_id,
            ),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def list_recent(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self.connection.execute(
            """
            SELECT log_id, timestamp, event_type, actor, details, basket_id, order_id, rule_id
            FROM audit_log
            ORDER BY log_id DESC
            LIMIT ?
            """,
            (max(1, limit),),
        ).fetchall()
        return [
            {
                "log_id": row["log_id"],
                "timestamp": row["timestamp"],
                "event_type": row["event_type"],
                "actor": row["actor"],
                "details": json.loads(row["details"]),
                "basket_id": row["basket_id"],
                "order_id": row["order_id"],
                "rule_id": row["rule_id"],
            }
            for row in rows
        ]
