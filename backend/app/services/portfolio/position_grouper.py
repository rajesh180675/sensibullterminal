from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

class PositionGrouper:
    def __init__(self, engine: Any):
        self.engine = engine

    def _get_active_groups(self) -> list[dict[str, Any]]:
        cursor = self.engine.db.execute("SELECT group_id, symbol, status, legs_json FROM strategy_groups WHERE status = 'open'")
        groups = []
        for row in cursor.fetchall():
            groups.append({
                "group_id": row[0],
                "symbol": row[1],
                "status": row[2],
                "legs": json.loads(row[3])
            })
        return groups

    def group_broker_positions(self, broker_positions: list[dict[str, Any]]) -> dict[str, Any]:
        """
        Matches live broker_positions against known strategy_groups via contract_key.
        Auto-closes strategies when all leg lots reach 0, and emits close_journal_entry.
        """
        active_groups = self._get_active_groups()
        grouped = []
        orphan_positions = broker_positions.copy()

        for group in active_groups:
            group_legs = group["legs"]
            matched_legs = []
            all_lots_zero = True

            for leg in group_legs:
                contract_key = leg.get("contract_key")
                # Find matching broker position
                matching_pos = next((p for p in orphan_positions if p.get("contract_key") == contract_key), None)
                if matching_pos:
                    lots = int(matching_pos.get("quantity", 0))
                    matched_legs.append({**leg, "live_quantity": lots, "current_price": matching_pos.get("ltp", 0)})
                    if lots != 0:
                        all_lots_zero = False
                    # Remove from orphans
                    orphan_positions = [p for p in orphan_positions if p.get("contract_key") != contract_key]
                else:
                    matched_legs.append({**leg, "live_quantity": 0, "current_price": 0})

            # Auto-close strategy if all leg lots reached 0
            if all_lots_zero and len(group_legs) > 0:
                self._close_strategy_group(group["group_id"])
                group["status"] = "closed"

            grouped.append({
                "group_id": group["group_id"],
                "symbol": group["symbol"],
                "status": group["status"],
                "legs": matched_legs
            })

        return {
            "strategy_groups": grouped,
            "orphan_positions": orphan_positions
        }

    def _close_strategy_group(self, group_id: str) -> None:
        logger.info(f"Auto-closing strategy group {group_id} (all legs hit 0)")
        self.engine.db.execute(
            "UPDATE strategy_groups SET status = 'closed', updated_at = strftime('%s', 'now') WHERE group_id = ?",
            (group_id,)
        )
        self.engine.db.commit()
        
        # Emit close_journal_entry trigger
        payload = json.dumps({"action": "close_journal_entry", "group_id": group_id, "reason": "all_leg_lots_zero"})
        self.engine.db.execute(
            "INSERT INTO audit_log (timestamp, event_type, actor, details) VALUES (strftime('%s', 'now'), 'strategy_auto_close', 'system', ?)",
            (payload,)
        )
        self.engine.db.commit()

