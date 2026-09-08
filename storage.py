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


def save_completion(
    *,
    receipt_code: str,
    reward_code: Optional[str],
    ip_address: Optional[str],
    status: str,
) -> int:
    created_at = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO completions (receipt_code, reward_code, ip_address, status, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (receipt_code, reward_code, ip_address, status, created_at),
        )
        return int(cur.lastrowid)


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


def completion_stats() -> dict:
    """Totals for the admin dashboard."""
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS total,
                COUNT(reward_code) AS with_reward,
                COUNT(DISTINCT ip_address) AS unique_ips,
                MAX(created_at) AS last_run
            FROM completions
            """
        ).fetchone()
        today = conn.execute(
            "SELECT COUNT(*) AS n FROM completions WHERE substr(created_at, 1, 10) = ?",
            (datetime.now(timezone.utc).date().isoformat(),),
        ).fetchone()
    return {
        "total": row["total"] or 0,
        "with_reward": row["with_reward"] or 0,
        "unique_ips": row["unique_ips"] or 0,
        "last_run": row["last_run"],
        "today": today["n"] or 0,
    }


def delete_completion(row_id: int) -> bool:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM completions WHERE id = ?", (row_id,))
        return cur.rowcount > 0


def clear_completions() -> int:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM completions")
        return cur.rowcount
