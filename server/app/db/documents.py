"""문서 / 청크 DAO + sqlite-vec 헬퍼."""

from __future__ import annotations

import time
import uuid
from typing import Any

import sqlite_vec

from .connection import db


def _now_ms() -> int:
    return int(time.time() * 1000)


def insert_document(
    *,
    conversation_id: str,
    name: str,
    source_path: str,
    mime: str | None,
    size_bytes: int,
) -> str:
    did = uuid.uuid4().hex
    now = _now_ms()
    with db() as conn:
        conn.execute(
            "INSERT INTO documents "
            "(id, conversation_id, name, source_path, mime, size_bytes, "
            " status, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (did, conversation_id, name, source_path, mime, size_bytes, "indexing", now),
        )
    return did


def update_document_status(
    document_id: str,
    *,
    status: str,
    error: str | None = None,
    total_pages: int | None = None,
    total_chunks: int | None = None,
    embedding_model: str | None = None,
) -> None:
    sets: list[str] = ["status=?"]
    args: list[Any] = [status]
    if error is not None:
        sets.append("error=?")
        args.append(error)
    if total_pages is not None:
        sets.append("total_pages=?")
        args.append(total_pages)
    if total_chunks is not None:
        sets.append("total_chunks=?")
        args.append(total_chunks)
    if embedding_model is not None:
        sets.append("embedding_model=?")
        args.append(embedding_model)
    if status == "ready":
        sets.append("indexed_at=?")
        args.append(_now_ms())
    args.append(document_id)
    with db() as conn:
        conn.execute(f"UPDATE documents SET {', '.join(sets)} WHERE id=?", args)


def list_documents(conversation_id: str) -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, conversation_id, name, mime, total_pages, total_chunks, "
            "       size_bytes, embedding_model, status, error, indexed_at, created_at "
            "FROM documents WHERE conversation_id=? ORDER BY created_at DESC",
            (conversation_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_document(document_id: str) -> dict[str, Any] | None:
    with db() as conn:
        row = conn.execute(
            "SELECT id, conversation_id, name, source_path, mime, total_pages, "
            "       total_chunks, size_bytes, embedding_model, status, error, "
            "       indexed_at, created_at "
            "FROM documents WHERE id=?",
            (document_id,),
        ).fetchone()
        return dict(row) if row else None


def delete_document(document_id: str) -> bool:
    with db() as conn:
        # chunks_vec 는 ON DELETE CASCADE 미지원 (가상 테이블) — 수동 정리
        chunk_ids = [
            r["id"]
            for r in conn.execute(
                "SELECT id FROM chunks WHERE document_id=?", (document_id,)
            ).fetchall()
        ]
        if chunk_ids:
            placeholders = ",".join("?" * len(chunk_ids))
            conn.execute(
                f"DELETE FROM chunks_vec WHERE rowid IN ({placeholders})", chunk_ids
            )
        cur = conn.execute("DELETE FROM documents WHERE id=?", (document_id,))
        return cur.rowcount > 0


def insert_chunks_with_embeddings(
    document_id: str,
    chunks: list[dict[str, Any]],
    embeddings: list[list[float]],
) -> int:
    """청크 + 임베딩을 atomic 하게 INSERT. 새로 만든 chunk id를 chunks_vec.rowid 로 사용."""
    if len(chunks) != len(embeddings):
        raise ValueError("chunks/embeddings 길이 불일치")
    inserted = 0
    with db() as conn:
        for ch, emb in zip(chunks, embeddings):
            cur = conn.execute(
                "INSERT INTO chunks "
                "(document_id, chunk_idx, page_num, content, char_start, char_end) "
                "VALUES (?,?,?,?,?,?)",
                (
                    document_id,
                    ch["chunk_idx"],
                    ch.get("page_num"),
                    ch["content"],
                    ch.get("char_start"),
                    ch.get("char_end"),
                ),
            )
            chunk_id = cur.lastrowid
            conn.execute(
                "INSERT INTO chunks_vec(rowid, embedding) VALUES (?, ?)",
                (chunk_id, sqlite_vec.serialize_float32(emb)),
            )
            inserted += 1
    return inserted


def search_chunks_in_conversation(
    conversation_id: str,
    query_embedding: list[float],
    top_k: int = 5,
) -> list[dict[str, Any]]:
    """이 대화의 chunks 에 한정해 직접 cosine 거리 계산.

    sqlite-vec 의 `MATCH ? AND k = N` 은 전역 KNN 후 필터라 다른 대화 청크가
    먼저 차면 결과가 부족해진다. 대화 단위 RAG에서는 후보 수가 작으니 (수백 미만)
    `vec_distance_cosine` 으로 직접 계산하는 게 정확하다.
    """
    with db() as conn:
        rows = conn.execute(
            "SELECT chunks.id, chunks.document_id, chunks.chunk_idx, chunks.page_num, "
            "       chunks.content, documents.name AS document_name, "
            "       vec_distance_cosine(chunks_vec.embedding, ?) AS distance "
            "FROM chunks_vec "
            "JOIN chunks ON chunks.id = chunks_vec.rowid "
            "JOIN documents ON chunks.document_id = documents.id "
            "WHERE documents.conversation_id = ? AND documents.status = 'ready' "
            "ORDER BY distance ASC "
            "LIMIT ?",
            (
                sqlite_vec.serialize_float32(query_embedding),
                conversation_id,
                top_k,
            ),
        ).fetchall()
        return [dict(r) for r in rows]
