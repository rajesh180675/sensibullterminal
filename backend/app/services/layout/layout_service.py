from __future__ import annotations

from typing import Any

from ...storage.layout_repo import LayoutRepository


class LayoutService:
    def __init__(self, repository: LayoutRepository):
        self.repository = repository

    def list_layouts(self, workspace_id: str | None = None) -> list[dict[str, Any]]:
        return self.repository.list_layouts(workspace_id)

    def get_layout(self, layout_id: str) -> dict[str, Any] | None:
        return self.repository.get_layout(layout_id)

    def save_layout(
        self,
        *,
        layout_id: str,
        workspace_id: str,
        name: str,
        panels: dict[str, Any] | list[Any],
        is_default: bool = False,
    ) -> dict[str, Any]:
        return self.repository.save_layout(
            layout_id=layout_id,
            workspace_id=workspace_id,
            name=name,
            panels=panels,
            is_default=is_default,
        )

    def delete_layout(self, layout_id: str) -> bool:
        return self.repository.delete_layout(layout_id)
