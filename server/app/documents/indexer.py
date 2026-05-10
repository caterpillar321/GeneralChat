"""파일 업로드 → 파싱 → 청킹 → 임베딩 → 저장 파이프라인."""

from __future__ import annotations

from pathlib import Path

from app.config.store import load_config
from app.db import documents as doc_dao
from app.embedding.sidecar import embed_texts

from .chunker import chunk_pages
from .parser import extract_text


async def index_document(
    document_id: str,
    file_path: str | Path,
    mime: str | None,
) -> None:
    """문서 인덱싱 — 동기/비동기 혼합. 실패 시 documents.status='error'."""
    cfg = load_config()
    try:
        pages = extract_text(file_path, mime)
        if not pages:
            raise RuntimeError("텍스트 추출 결과 0 페이지")

        chunks = chunk_pages(pages)
        if not chunks:
            raise RuntimeError("청크 생성 0개 (빈 문서?)")

        texts = [c["content"] for c in chunks]
        embeddings = await embed_texts(texts)
        if len(embeddings) != len(chunks):
            raise RuntimeError(
                f"임베딩 갯수 불일치: chunks={len(chunks)} embeddings={len(embeddings)}"
            )

        doc_dao.insert_chunks_with_embeddings(document_id, chunks, embeddings)
        doc_dao.update_document_status(
            document_id,
            status="ready",
            total_pages=len(pages),
            total_chunks=len(chunks),
            embedding_model=Path(cfg.embedding_model_path or "").name or None,
        )
    except Exception as e:
        doc_dao.update_document_status(document_id, status="error", error=str(e))
