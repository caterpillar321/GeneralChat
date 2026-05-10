"""LLM tool 정의 + 실행 라우팅.

각 도구는 활성 조건이 다르다 — `available_tools(conversation_id, use_web_search)` 로
요청·대화 상태에 맞게 필터링해서 LLM에 전달한다.
"""

from __future__ import annotations

from typing import Any

from app.db import documents as doc_dao
from app.embedding.sidecar import embed_one
from app.search.base import format_for_llm
from app.search.factory import get_provider as get_search_provider

WEB_SEARCH_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": (
            "Search the web for up-to-date information. "
            "Use when you need recent facts, news, current data, or anything you don't reliably know. "
            "Pass a concise query in any language."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query string"}
            },
            "required": ["query"],
        },
    },
}

SEARCH_DOCUMENTS_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "search_documents",
        "description": (
            "Search the user's uploaded documents (PDFs etc.) attached to THIS conversation. "
            "Use when the user refers to attached materials, says '이 문서/자료', or asks about "
            "anything that should be answered from the uploaded files. Pass a concise query in any language."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query string"},
                "top_k": {
                    "type": "integer",
                    "description": "Number of passages to return (default 5)",
                },
            },
            "required": ["query"],
        },
    },
}


def available_tools(
    *, conversation_id: str | None, use_web_search: bool
) -> list[dict[str, Any]]:
    tools: list[dict[str, Any]] = []
    if use_web_search:
        tools.append(WEB_SEARCH_TOOL)
    if conversation_id:
        docs = doc_dao.list_documents(conversation_id)
        if any(d.get("status") == "ready" for d in docs):
            tools.append(SEARCH_DOCUMENTS_TOOL)
    return tools


def _format_doc_results(rows: list[dict[str, Any]], query: str) -> str:
    if not rows:
        return f"검색 결과 없음 (query: {query!r})"
    lines = [f"# 문서 검색 결과 ({len(rows)} passages)"]
    for i, r in enumerate(rows, 1):
        snippet = (r.get("content") or "").strip().replace("\n", " ")
        if len(snippet) > 600:
            snippet = snippet[:600] + "…"
        page = r.get("page_num")
        page_str = f" · p.{page}" if page else ""
        name = r.get("document_name", "?")
        lines.append(f"\n**[{i}] `{name}`{page_str}**")
        lines.append(f"    {snippet}")
    lines.append(
        "\n위 발췌를 근거로 답하세요. 인용 시 [1], [2] 형식. 출처는 문서명·페이지 함께 표기."
    )
    return "\n".join(lines)


async def execute_tool(
    name: str, arguments: dict[str, Any], *, conversation_id: str | None = None
) -> str:
    if name == "web_search":
        provider = get_search_provider()
        if provider is None:
            return "ERROR: 검색 provider 미설정. Settings에서 활성화 필요."
        query = arguments.get("query", "")
        if not query:
            return "ERROR: query 인자 누락."
        try:
            resp = await provider.search(query)
            return format_for_llm(resp)
        except Exception as e:
            return f"ERROR: 검색 실패 — {e}"

    if name == "search_documents":
        if not conversation_id:
            return "ERROR: conversation_id 컨텍스트 없음."
        query = arguments.get("query", "")
        top_k = int(arguments.get("top_k", 5) or 5)
        top_k = max(1, min(top_k, 20))
        if not query:
            return "ERROR: query 인자 누락."
        try:
            qemb = await embed_one(query)
        except Exception as e:
            return f"ERROR: 임베딩 사이드카 호출 실패 — {e}"
        rows = doc_dao.search_chunks_in_conversation(conversation_id, qemb, top_k)
        return _format_doc_results(rows, query)

    return f"ERROR: 알 수 없는 tool: {name}"
