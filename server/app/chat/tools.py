"""LLM tool 정의 + 실행 라우팅."""

from __future__ import annotations

from typing import Any

from app.search.base import format_for_llm
from app.search.factory import get_provider as get_search_provider

# OpenAI 호환 tool schema
TOOLS: list[dict[str, Any]] = [
    {
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
                    "query": {
                        "type": "string",
                        "description": "Search query string",
                    }
                },
                "required": ["query"],
            },
        },
    }
]


async def execute_tool(name: str, arguments: dict[str, Any]) -> str:
    """Tool 실행 후 LLM에 줄 result 텍스트 반환."""
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
    return f"ERROR: 알 수 없는 tool: {name}"
