"""채팅 스트리밍 — multi-round tool calling 루프 + 자체 SSE 프로토콜.

이벤트 형식 (모두 `data: <json>\n\n`):
    {"type":"content","delta":"..."}
    {"type":"reasoning","delta":"..."}
    {"type":"tool_call_end","id":"call_x","name":"web_search","arguments":{...}}
    {"type":"tool_result","id":"call_x","result":"...","ok":true}
    {"type":"round_end","round":N}
    {"type":"usage","prompt_tokens":..,"completion_tokens":..,"total_tokens":..}
    {"type":"timings",...}
    {"type":"error","message":"..."}
    {"type":"done"}
"""

from __future__ import annotations

import datetime
import json
from typing import Any, AsyncIterator, Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.chat.tools import available_tools, execute_tool
from app.db import conversations as conv_dao
from app.db import documents as doc_dao
from app.db import messages as msg_dao
from app.llama import manager

router = APIRouter(prefix="/api/chat")

MAX_ROUNDS = 5


def _tool_use_augmentation(
    *,
    has_documents: bool,
    has_web: bool,
    document_inventory: list[dict[str, Any]] | None = None,
) -> str:
    today = datetime.date.today().isoformat()
    parts: list[str] = [
        "\n\n# 시간 정보 및 도구 사용 가이드",
        f"오늘 날짜: {today}",
        "당신의 학습 데이터는 그 이전 어느 시점에 고정되어 있어, 학습 후 일어난 일은 알지 못합니다.",
        "",
    ]
    if has_web:
        parts += [
            "다음 경우엔 반드시 `web_search` 도구를 호출해 사실을 확인하세요:",
            "- 최근/현재 정보 (가격, 뉴스, 출시 일정, 환율, 시세 등)",
            "- 학습 컷오프 이후 발표·출시된 제품·이벤트·논문·인물·뉴스",
            "- 본인의 지식이 확실하지 않거나 시간이 지나 변했을 수 있는 사실",
            '- 사용자가 "검색해줘", "찾아줘" 같이 명시적으로 요청한 경우',
            "",
        ]
    if has_documents:
        parts.append("이 대화에 사용자가 첨부한 문서:")
        if document_inventory:
            for d in document_inventory:
                meta_bits: list[str] = []
                if d.get("total_pages"):
                    meta_bits.append(f"{d['total_pages']} pages")
                if d.get("total_chunks"):
                    meta_bits.append(f"{d['total_chunks']} chunks")
                meta = f" ({', '.join(meta_bits)})" if meta_bits else ""
                parts.append(f"  - {d.get('name', '?')}{meta}")
        parts += [
            "",
            "본문은 컨텍스트에 박혀있지 않습니다 — 내용이 필요하면 `search_documents` 도구를 호출하세요.",
            "다음 경우엔 호출 우선:",
            '- 사용자가 "이 문서/자료/PDF/슬라이드" 같이 첨부 자료를 가리킬 때',
            "- 첨부된 문서로부터 답할 만한 사실·수치·정의·발췌가 필요할 때",
            "- 일반 지식과 충돌할 가능성이 있어 자료를 확인해야 할 때",
            "결과 인용 시 [1], [2] 형식과 함께 문서명·페이지(또는 슬라이드)를 표기하세요.",
            "",
        ]
    parts.append(
        "추측이나 학습 시점 정보에만 의존하지 말고, 필요하면 도구를 먼저 호출하세요. "
        "여러 도구를 같이 쓰거나 같은 도구를 여러 쿼리로 호출해도 됩니다."
    )
    return "\n".join(parts)


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ImageAttachment(BaseModel):
    """이미지 첨부 — base64 data URL 또는 URL."""

    data_url: str  # 'data:image/png;base64,...' 형태
    name: Optional[str] = None


class ChatStreamRequest(BaseModel):
    messages: list[ChatMessage]
    conversation_id: Optional[str] = None
    system_prompt: Optional[str] = None
    use_web_search: bool = False  # tools 활성화
    images: list[ImageAttachment] = []  # 마지막 user 메시지에 첨부될 이미지들
    temperature: float = 0.7
    top_k: int = 40
    top_p: float = 0.95
    min_p: float = 0.05
    repeat_penalty: float = 1.1
    max_tokens: int = 8192
    stop: Optional[list[str]] = None


def _emit(obj: dict[str, Any]) -> bytes:
    return ("data: " + json.dumps(obj, ensure_ascii=False) + "\n\n").encode()


@router.post("/stream")
async def chat_stream(req: ChatStreamRequest) -> StreamingResponse:
    state = manager.get_state()
    if state.status != "running" or state.port is None:
        raise HTTPException(503, f"llama-server 미동작 (현재 상태: {state.status})")

    conv_id = req.conversation_id
    if conv_id and not conv_dao.get_conversation(conv_id):
        conv_id = None
    if not conv_id:
        conv_id = conv_dao.create_conversation(
            model_id=state.model_id,
            system_prompt=req.system_prompt or "",
        )

    # user 메시지 저장
    last_user = next((m for m in reversed(req.messages) if m.role == "user"), None)
    if last_user:
        msg_dao.insert_message(
            conversation_id=conv_id, role="user", content=last_user.content
        )

    url = f"http://127.0.0.1:{state.port}/v1/chat/completions"
    # 사용 가능 도구 결정: web (사용자 토글) + docs (대화에 ready 문서 있을 때 자동)
    tools_for_llm = available_tools(
        conversation_id=conv_id, use_web_search=req.use_web_search
    )
    use_tools = bool(tools_for_llm)

    # LLM 에 보낼 messages 목록 (라운드마다 갱신, dict 형태)
    msgs: list[dict[str, Any]] = [m.model_dump() for m in req.messages]

    # 이미지 첨부가 있으면 마지막 user 메시지를 multipart content 로 변형
    if req.images:
        for i in range(len(msgs) - 1, -1, -1):
            if msgs[i].get("role") == "user":
                text = msgs[i].get("content") or ""
                parts: list[dict[str, Any]] = []
                if text:
                    parts.append({"type": "text", "text": text})
                for img in req.images:
                    parts.append(
                        {
                            "type": "image_url",
                            "image_url": {"url": img.data_url},
                        }
                    )
                msgs[i] = {"role": "user", "content": parts}
                break

    # 도구 사용 시 system prompt 에 오늘 날짜 + 도구 사용 가이드 + 문서 inventory augment
    if use_tools:
        has_web = any(t["function"]["name"] == "web_search" for t in tools_for_llm)
        has_docs = any(t["function"]["name"] == "search_documents" for t in tools_for_llm)
        document_inventory = None
        if has_docs:
            document_inventory = [
                d for d in doc_dao.list_documents(conv_id) if d.get("status") == "ready"
            ]
        aug = _tool_use_augmentation(
            has_documents=has_docs,
            has_web=has_web,
            document_inventory=document_inventory,
        )
        if msgs and msgs[0].get("role") == "system":
            msgs[0] = {**msgs[0], "content": (msgs[0].get("content") or "") + aug}
        else:
            msgs = [{"role": "system", "content": aug.strip()}, *msgs]

    async def loop() -> AsyncIterator[bytes]:
        # 누적된 결과 (마지막 finalize 시 DB 저장)
        all_content: list[str] = []
        all_reasoning: list[str] = []
        all_tool_calls: list[dict[str, Any]] = []
        last_usage: dict[str, Any] | None = None
        last_timings: dict[str, Any] | None = None

        try:
            async with httpx.AsyncClient(timeout=None) as client:
                for round_idx in range(MAX_ROUNDS):
                    is_last_round = round_idx == MAX_ROUNDS - 1
                    payload: dict[str, Any] = {
                        "messages": msgs,
                        "stream": True,
                        "stream_options": {"include_usage": True},
                        "temperature": req.temperature,
                        "top_k": req.top_k,
                        "top_p": req.top_p,
                        "min_p": req.min_p,
                        "repeat_penalty": req.repeat_penalty,
                        "max_tokens": req.max_tokens,
                    }
                    if req.stop:
                        payload["stop"] = req.stop
                    if use_tools and not is_last_round:
                        payload["tools"] = tools_for_llm
                        payload["tool_choice"] = "auto"

                    round_content: list[str] = []
                    round_reasoning: list[str] = []
                    # index → {id, name, arguments(str buffer)}
                    round_tool_calls: dict[int, dict[str, str]] = {}
                    line_buffer = ""

                    async with client.stream("POST", url, json=payload) as response:
                        if response.status_code != 200:
                            body = await response.aread()
                            yield _emit({
                                "type": "error",
                                "message": f"upstream {response.status_code}: {body[:300].decode('utf-8', 'replace')}",
                            })
                            return

                        async for chunk in response.aiter_bytes():
                            try:
                                line_buffer += chunk.decode("utf-8", errors="replace")
                            except Exception:
                                continue
                            while "\n\n" in line_buffer:
                                evt, line_buffer = line_buffer.split("\n\n", 1)
                                for ln in evt.split("\n"):
                                    if not ln.startswith("data:"):
                                        continue
                                    data = ln[5:].strip()
                                    if data == "[DONE]":
                                        continue
                                    try:
                                        obj = json.loads(data)
                                    except (ValueError, TypeError):
                                        continue
                                    choices = obj.get("choices") or []
                                    if choices:
                                        delta = choices[0].get("delta") or {}
                                        if delta.get("content"):
                                            round_content.append(delta["content"])
                                            yield _emit({"type": "content", "delta": delta["content"]})
                                        if delta.get("reasoning_content"):
                                            round_reasoning.append(delta["reasoning_content"])
                                            yield _emit({"type": "reasoning", "delta": delta["reasoning_content"]})
                                        if delta.get("tool_calls"):
                                            for tcd in delta["tool_calls"]:
                                                idx = tcd.get("index", 0)
                                                slot = round_tool_calls.setdefault(
                                                    idx, {"id": "", "name": "", "arguments": ""}
                                                )
                                                if tcd.get("id"):
                                                    slot["id"] = tcd["id"]
                                                fn = tcd.get("function") or {}
                                                if fn.get("name"):
                                                    slot["name"] = fn["name"]
                                                if fn.get("arguments"):
                                                    slot["arguments"] += fn["arguments"]
                                    if obj.get("usage"):
                                        last_usage = obj["usage"]
                                    if obj.get("timings"):
                                        last_timings = obj["timings"]

                    # --- round 종료 후 처리 ---
                    all_content.extend(round_content)
                    all_reasoning.extend(round_reasoning)

                    if not round_tool_calls:
                        # 일반 답변 → loop 종료
                        yield _emit({"type": "round_end", "round": round_idx + 1})
                        break

                    # tool 실행
                    tool_call_list = [round_tool_calls[k] for k in sorted(round_tool_calls.keys())]
                    assistant_tool_calls = []
                    tool_messages = []

                    for tc in tool_call_list:
                        tc_id = tc["id"] or f"call_{round_idx}_{tool_call_list.index(tc)}"
                        try:
                            args = json.loads(tc["arguments"]) if tc["arguments"] else {}
                        except Exception:
                            args = {}

                        # client 에 tool_call_end emit
                        yield _emit({
                            "type": "tool_call_end",
                            "id": tc_id,
                            "name": tc["name"],
                            "arguments": args,
                        })

                        # 실행
                        try:
                            result_text = await execute_tool(
                                tc["name"], args, conversation_id=conv_id
                            )
                            ok = not result_text.startswith("ERROR")
                        except Exception as e:
                            result_text = f"ERROR: {e}"
                            ok = False

                        # client 에 tool_result emit
                        yield _emit({
                            "type": "tool_result",
                            "id": tc_id,
                            "result": result_text,
                            "ok": ok,
                        })

                        # 누적 (DB 저장용)
                        all_tool_calls.append({
                            "id": tc_id,
                            "name": tc["name"],
                            "arguments": args,
                            "result": result_text,
                            "round": round_idx + 1,
                            "ok": ok,
                        })

                        # multi-round용 messages 갱신
                        assistant_tool_calls.append({
                            "id": tc_id,
                            "type": "function",
                            "function": {
                                "name": tc["name"],
                                "arguments": tc["arguments"] or "{}",
                            },
                        })
                        tool_messages.append({
                            "role": "tool",
                            "tool_call_id": tc_id,
                            "content": result_text[:8000],  # 너무 길면 잘라
                        })

                    # 다음 라운드를 위해 messages 갱신
                    msgs.append({
                        "role": "assistant",
                        "content": "".join(round_content) or None,
                        "tool_calls": assistant_tool_calls,
                    })
                    msgs.extend(tool_messages)

                    yield _emit({"type": "round_end", "round": round_idx + 1})

                    if is_last_round:
                        # 최종 라운드에서도 tool 발화면 — 더 못 돌리니 그대로 종료
                        break

            if last_usage:
                yield _emit({"type": "usage", **last_usage})
            if last_timings:
                yield _emit({"type": "timings", **last_timings})
            yield _emit({"type": "done"})
        except Exception as e:
            yield _emit({"type": "error", "message": str(e)})
        finally:
            content = "".join(all_content)
            reasoning = "".join(all_reasoning) if all_reasoning else None
            if content or reasoning or all_tool_calls:
                msg_dao.insert_message(
                    conversation_id=conv_id,
                    role="assistant",
                    content=content,
                    reasoning=reasoning,
                    usage=last_usage,
                    timings=last_timings,
                    model_id=state.model_id,
                    tool_calls=all_tool_calls or None,
                )
                conv_dao.touch(conv_id)

    return StreamingResponse(
        loop(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Conversation-Id": conv_id,
        },
    )
