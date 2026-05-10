"""대화 단위 문서 업로드/관리 API."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from platformdirs import user_data_dir

from app.db import conversations as conv_dao
from app.db import documents as doc_dao
from app.documents.indexer import index_document

router = APIRouter(prefix="/api/conversations")

_DOCS_DIR = Path(user_data_dir("generalchat")) / "documents"
_DOCS_DIR.mkdir(parents=True, exist_ok=True)


@router.get("/{cid}/documents")
def list_documents(cid: str) -> list[dict[str, Any]]:
    if not conv_dao.get_conversation(cid):
        raise HTTPException(404, "conversation not found")
    return doc_dao.list_documents(cid)


@router.post("/{cid}/documents")
async def upload_document(
    cid: str,
    background: BackgroundTasks,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    if not conv_dao.get_conversation(cid):
        raise HTTPException(404, "conversation not found")

    # 파일 저장 (대화별 폴더)
    conv_dir = _DOCS_DIR / cid
    conv_dir.mkdir(parents=True, exist_ok=True)
    safe_name = (file.filename or "untitled").replace("/", "_")[:200]
    saved_path = conv_dir / safe_name
    # 동명 파일이면 suffix
    counter = 1
    while saved_path.exists():
        stem, _, ext = safe_name.rpartition(".")
        saved_path = conv_dir / (f"{stem}_{counter}.{ext}" if ext else f"{safe_name}_{counter}")
        counter += 1

    contents = await file.read()
    saved_path.write_bytes(contents)

    doc_id = doc_dao.insert_document(
        conversation_id=cid,
        name=file.filename or saved_path.name,
        source_path=str(saved_path),
        mime=file.content_type,
        size_bytes=len(contents),
    )

    # 백그라운드로 인덱싱 (응답 반환 후 실행, status: indexing → ready/error)
    background.add_task(index_document, doc_id, saved_path, file.content_type)

    return doc_dao.get_document(doc_id) or {"id": doc_id}


@router.delete("/{cid}/documents/{doc_id}")
def delete_document(cid: str, doc_id: str) -> dict[str, bool]:
    if not conv_dao.get_conversation(cid):
        raise HTTPException(404, "conversation not found")
    doc = doc_dao.get_document(doc_id)
    if not doc:
        raise HTTPException(404, "document not found")
    if doc["conversation_id"] != cid:
        raise HTTPException(403, "wrong conversation")
    # 파일도 삭제 시도
    try:
        Path(doc["source_path"]).unlink(missing_ok=True)
    except Exception:
        pass
    doc_dao.delete_document(doc_id)
    return {"ok": True}
