"""SQLite storage for completed survey reward codes."""

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

DB_PATH = Path(os.environ.get("DATA_DIR", "data")) / "survey_bot.db"


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS completions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                receipt_code TEXT NOT NULL,
                reward_code TEXT,
                ip_address TEXT,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_completions_created ON completions(created_at DESC)"
        )


@contextmanager
def _connect():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


from debug_log import dbg  # noqa: E402


def save_completion(
    *,
    receipt_code: str,
    reward_code: Optional[str],
    ip_address: Optional[str],
    status: str,
) -> int:
    created_at = datetime.now(timezone.utc).isoformat()
    dbg("storage.py:save_completion", "save attempt", {"db": str(DB_PATH), "status": status, "has_reward": bool(reward_code)}, "H1")
    try:
        with _connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO completions (receipt_code, reward_code, ip_address, status, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (receipt_code, reward_code, ip_address, status, created_at),
            )
            row_id = int(cur.lastrowid)
        dbg("storage.py:save_completion", "save ok", {"row_id": row_id}, "H1")
        return row_id
    except Exception as e:
        dbg("storage.py:save_completion", "save failed", {"error": str(e), "db": str(DB_PATH)}, "H1")
        raise


def list_completions(limit: int = 100) -> list[dict]:
    limit = max(1, min(limit, 500))
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, receipt_code, reward_code, ip_address, status, created_at
            FROM completions
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]
