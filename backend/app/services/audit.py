"""Append-only audit trail for the Results League (the audit_log table).
Every create, update, lock and score action writes one row, inside the same
transaction as the change it records, so the two can never disagree."""
from typing import Any, Optional

import psycopg
from psycopg.types.json import Jsonb


def write(
    conn: psycopg.Connection,
    actor_user_id: Optional[int],
    action: str,
    entity: str,
    entity_id: Any,
    details: Optional[dict] = None,
) -> None:
    conn.execute(
        "INSERT INTO audit_log (actor_user_id, action, entity, entity_id, details) VALUES (%s, %s, %s, %s, %s)",
        (actor_user_id, action, entity, str(entity_id), Jsonb(details) if details is not None else None),
    )


def recent(conn: psycopg.Connection, limit: int, entity: Optional[str] = None) -> list[dict]:
    if entity:
        rows = conn.execute(
            "SELECT * FROM audit_log WHERE entity = %s ORDER BY id DESC LIMIT %s", (entity, limit)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT %s", (limit,)).fetchall()
    return [dict(r) for r in rows]
