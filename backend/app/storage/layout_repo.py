from __future__ import annotations

import json
import sqlite3
import time
from typing import Any


class LayoutRepository:
    def __init__(self, connection: sqlite3.Connection):
        self.connection = connection

    def list_layouts(self, workspace_id: str | None = None) -> list[dict[str, Any]]:
        if workspace_id:
            rows = self.connection.execute(
                """
                SELECT layout_id, workspace_id, name, panels, is_default, created_at, updated_at
                FROM workspace_layouts
                WHERE workspace_id = ?
                ORDER BY is_default DESC, updated_at DESC
                """,
                (workspace_id,),
            ).fetchall()
        else:
            rows = self.connection.execute(
                """
                SELECT layout_id, workspace_id, name, panels, is_default, created_at, updated_at
                FROM workspace_layouts
                ORDER BY workspace_id, is_default DESC, updated_at DESC
                """
            ).fetchall()
        return [self._row_to_layout(row) for row in rows]

    def get_layout(self, layout_id: str) -> dict[str, Any] | None:
        row = self.connection.execute(
            """
            SELECT layout_id, workspace_id, name, panels, is_default, created_at, updated_at
            FROM workspace_layouts
            WHERE layout_id = ?
            """,
            (layout_id,),
        ).fetchone()
        return self._row_to_layout(row) if row else None

    def save_layout(
        self,
        *,
        layout_id: str,
        workspace_id: str,
        name: str,
        panels: dict[str, Any] | list[Any],
        is_default: bool = False,
    ) -> dict[str, Any]:
        now = int(time.time())
        encoded_panels = json.dumps(panels, ensure_ascii=True, separators=(",", ":"))
        existing = self.get_layout(layout_id)
        created_at = existing["created_at"] if existing else now
        if is_default:
            self.connection.execute(
                "UPDATE workspace_layouts SET is_default = 0 WHERE workspace_id = ?",
                (workspace_id,),
            )
        self.connection.execute(
            """
            INSERT INTO workspace_layouts (
                layout_id, workspace_id, name, panels, is_default, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(layout_id) DO UPDATE SET
                workspace_id = excluded.workspace_id,
                name = excluded.name,
                panels = excluded.panels,
                is_default = excluded.is_default,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at
            """,
            (layout_id, workspace_id, name, encoded_panels, int(is_default), created_at, now),
        )
        self.connection.commit()
        return self.get_layout(layout_id) or {}

    def delete_layout(self, layout_id: str) -> bool:
        cursor = self.connection.execute(
            "DELETE FROM workspace_layouts WHERE layout_id = ?",
            (layout_id,),
        )
        self.connection.commit()
        return cursor.rowcount > 0

    @staticmethod
    def _row_to_layout(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "layout_id": row["layout_id"],
            "workspace_id": row["workspace_id"],
            "name": row["name"],
            "panels": json.loads(row["panels"]),
            "is_default": bool(row["is_default"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
