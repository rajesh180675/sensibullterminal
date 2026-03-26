from __future__ import annotations

import sqlite3
from pathlib import Path

from .migrations import run_migrations


def connect_sqlite(path: str | Path) -> sqlite3.Connection:
    db_path = Path(path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(db_path), check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def init_sqlite(path: str | Path) -> sqlite3.Connection:
    connection = connect_sqlite(path)
    run_migrations(connection)
    return connection
