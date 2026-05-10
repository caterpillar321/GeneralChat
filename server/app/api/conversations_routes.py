from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.chat.title import generate_title_for
from app.db import conversations as conv_dao
from app.db import messages as msg_dao

router = APIRouter(prefix="/api/conversations")


class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    system_prompt: Optional[str] = None
    model_id: Optional[str] = None


class ConversationCreate(BaseModel):
    title: str = ""
    system_prompt: str = ""
    model_id: Optional[str] = None


@router.get("")
def list_all() -> list[dict[str, Any]]:
    return conv_dao.list_conversations()


@router.post("")
def create_one(payload: Optional[ConversationCreate] = None) -> dict[str, Any]:
    """빈 대화 생성 — PDF 첨부 등 채팅 외 진입점에서 사용."""
    from app.llama import manager as llama_manager

    p = payload or ConversationCreate()
    model_id = p.model_id
    if model_id is None:
        st = llama_manager.get_state()
        model_id = st.model_id  # None 가능
    cid = conv_dao.create_conversation(
        model_id=model_id,
        system_prompt=p.system_prompt,
        title=p.title,
    )
    return conv_dao.get_conversation(cid) or {"id": cid}


@router.get("/{cid}")
def get_one(cid: str) -> dict[str, Any]:
    c = conv_dao.get_conversation(cid)
    if not c:
        raise HTTPException(404, "conversation not found")
    return c


@router.put("/{cid}")
def update_one(cid: str, patch: ConversationUpdate) -> dict[str, Any]:
    res = conv_dao.update_conversation(
        cid,
        title=patch.title,
        system_prompt=patch.system_prompt,
        model_id=patch.model_id,
    )
    if not res:
        raise HTTPException(404, "conversation not found")
    return res


@router.delete("/{cid}")
def delete_one(cid: str) -> dict[str, bool]:
    ok = conv_dao.delete_conversation(cid)
    if not ok:
        raise HTTPException(404, "conversation not found")
    return {"ok": True}


@router.get("/{cid}/messages")
def list_msgs(cid: str) -> list[dict[str, Any]]:
    if not conv_dao.get_conversation(cid):
        raise HTTPException(404, "conversation not found")
    return msg_dao.list_messages(cid)


@router.post("/{cid}/generate-title")
async def gen_title(cid: str) -> dict[str, str]:
    if not conv_dao.get_conversation(cid):
        raise HTTPException(404, "conversation not found")
    title = await generate_title_for(cid)
    if title is None:
        raise HTTPException(500, "title generation failed (llama 미동작 또는 메시지 부족)")
    return {"title": title}
