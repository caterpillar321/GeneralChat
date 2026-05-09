"""SQLite 연결 및 스키마 초기화.

- WAL 모드 (동시 읽기 친화적)
- check_same_thread=False (FastAPI 스레드풀에서 호출됨)
- 짧은 컨텍스트 매니저로 작업 단위마다 connect/commit
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from platformdirs import user_data_dir

APP_NAME = "generalchat"
_DATA_DIR = Path(user_data_dir(APP_NAME))
_DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = _DATA_DIR / "db.sqlite"

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL DEFAULT '',
  model_id        TEXT,
  system_prompt   TEXT NOT NULL DEFAULT '',
  sampling_json   TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  parent_id       TEXT,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  reasoning       TEXT,
  usage_json      TEXT,
  timings_json    TEXT,
  model_id        TEXT,
  tool_calls_json TEXT,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conv     ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conv_updated      ON conversations(updated_at DESC);
"""

# 점진 마이그레이션: 기존 DB에 컬럼 추가가 필요할 수 있음.
MIGRATIONS = [
    "ALTER TABLE messages ADD COLUMN model_id TEXT",
    "ALTER TABLE messages ADD COLUMN tool_calls_json TEXT",
]


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with db() as conn:
        for stmt in SCHEMA.strip().split(";"):
            s = stmt.strip()
            if s:
                conn.execute(s + ";")
        for mig in MIGRATIONS:
            try:
                conn.execute(mig)
            except sqlite3.OperationalError:
                # 이미 적용됨 (중복 컬럼 등) — 무시
                pass
