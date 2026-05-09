"""메시지(message) DAO."""

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
    uj = d.pop("usage_json", None)
    tj = d.pop("timings_json", None)
    cj = d.pop("tool_calls_json", None)
    d["usage"] = json.loads(uj) if uj else None
    d["timings"] = json.loads(tj) if tj else None
    d["tool_calls"] = json.loads(cj) if cj else None
    return d


def insert_message(
    *,
    conversation_id: str,
    role: str,
    content: str,
    reasoning: str | None = None,
    usage: dict[str, Any] | None = None,
    timings: dict[str, Any] | None = None,
    parent_id: str | None = None,
    model_id: str | None = None,
    tool_calls: list[dict[str, Any]] | None = None,
) -> str:
    mid = uuid.uuid4().hex
    now = _now_ms()
    with db() as conn:
        conn.execute(
            "INSERT INTO messages "
            "(id, conversation_id, parent_id, role, content, reasoning, "
            " usage_json, timings_json, model_id, tool_calls_json, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                mid,
                conversation_id,
                parent_id,
                role,
                content,
                reasoning,
                json.dumps(usage) if usage else None,
                json.dumps(timings) if timings else None,
                model_id,
                json.dumps(tool_calls) if tool_calls else None,
                now,
            ),
        )
    return mid


def list_messages(conversation_id: str) -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, conversation_id, parent_id, role, content, reasoning, "
            "       usage_json, timings_json, model_id, tool_calls_json, created_at "
            "FROM messages WHERE conversation_id=? ORDER BY created_at",
            (conversation_id,),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]
