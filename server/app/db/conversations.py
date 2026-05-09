"""대화(conversation) DAO."""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from .connection import db


def _now_ms() -> int:
    return int(time.time() * 1000)


def _row_to_dict(row: Any) -> dict[str, Any]:
    d = dict(row)
    sj = d.pop("sampling_json", None)
    d["sampling"] = json.loads(sj) if sj else None
    return d


def create_conversation(
    *,
    model_id: str | None = None,
    system_prompt: str = "",
    sampling: dict[str, Any] | None = None,
    title: str = "",
) -> str:
    cid = uuid.uuid4().hex
    now = _now_ms()
    with db() as conn:
        conn.execute(
            "INSERT INTO conversations (id, title, model_id, system_prompt, sampling_json, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (cid, title, model_id, system_prompt, json.dumps(sampling) if sampling else None, now, now),
        )
    return cid


def list_conversations(limit: int = 200) -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, title, model_id, system_prompt, sampling_json, created_at, updated_at "
            "FROM conversations ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]


def get_conversation(cid: str) -> dict[str, Any] | None:
    with db() as conn:
        row = conn.execute(
            "SELECT id, title, model_id, system_prompt, sampling_json, created_at, updated_at "
            "FROM conversations WHERE id=?",
            (cid,),
        ).fetchone()
        return _row_to_dict(row) if row else None


def update_conversation(
    cid: str,
    *,
    title: str | None = None,
    system_prompt: str | None = None,
    model_id: str | None = None,
) -> dict[str, Any] | None:
    sets: list[str] = []
    args: list[Any] = []
    if title is not None:
        sets.append("title=?")
        args.append(title)
    if system_prompt is not None:
        sets.append("system_prompt=?")
        args.append(system_prompt)
    if model_id is not None:
        sets.append("model_id=?")
        args.append(model_id)
    if not sets:
        return get_conversation(cid)
    sets.append("updated_at=?")
    args.append(_now_ms())
    args.append(cid)
    with db() as conn:
        conn.execute(f"UPDATE conversations SET {', '.join(sets)} WHERE id=?", args)
    return get_conversation(cid)


def touch(cid: str) -> None:
    with db() as conn:
        conn.execute("UPDATE conversations SET updated_at=? WHERE id=?", (_now_ms(), cid))


def delete_conversation(cid: str) -> bool:
    with db() as conn:
        cur = conn.execute("DELETE FROM conversations WHERE id=?", (cid,))
        return cur.rowcount > 0
