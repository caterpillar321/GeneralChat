"""문자 단위 청킹 — 페이지 경계 보존."""

from __future__ import annotations

from typing import Any

CHUNK_SIZE = 1500
OVERLAP = 200


def chunk_pages(pages: list[tuple[int, str]]) -> list[dict[str, Any]]:
    """(page_num, text) 리스트 → 청크 리스트.

    각 청크는 단일 페이지 안. 경계 넘지 않음 (페이지 단위 메타 보존 위해).
    """
    out: list[dict[str, Any]] = []
    chunk_idx = 0
    for page_num, text in pages:
        text = text.strip()
        if not text:
            continue
        pos = 0
        while pos < len(text):
            chunk_text = text[pos : pos + CHUNK_SIZE].strip()
            if chunk_text:
                out.append(
                    {
                        "chunk_idx": chunk_idx,
                        "page_num": page_num,
                        "content": chunk_text,
                        "char_start": pos,
                        "char_end": pos + len(chunk_text),
                    }
                )
                chunk_idx += 1
            step = CHUNK_SIZE - OVERLAP
            if step <= 0:
                step = CHUNK_SIZE
            next_pos = pos + step
            if next_pos >= len(text):
                break
            pos = next_pos
    return out
