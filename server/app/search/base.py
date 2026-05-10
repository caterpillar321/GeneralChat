"""웹 검색 provider 추상 인터페이스."""

from __future__ import annotations

from abc import ABC, abstractmethod

from pydantic import BaseModel


class SearchResult(BaseModel):
    title: str
    url: str
    content: str  # snippet / 본문 일부
    score: float | None = None
    published_date: str | None = None  # provider가 주면 — 시점 인지용


class SearchResponse(BaseModel):
    query: str
    answer: str | None = None  # provider 가 요약 제공 시 (Tavily 등)
    results: list[SearchResult]
    provider: str


class SearchProvider(ABC):
    name: str

    @abstractmethod
    async def search(self, query: str, max_results: int = 5) -> SearchResponse: ...


def format_for_llm(resp: SearchResponse) -> str:
    """LLM에 inject 할 수 있는 형태로 검색 결과 직렬화 (마크다운)."""
    lines: list[str] = [f"# 웹 검색 결과 (provider: {resp.provider})"]
    if resp.answer:
        lines.append(f"\n**요약**: {resp.answer}")
    if resp.results:
        lines.append("\n**출처**:")
        for i, r in enumerate(resp.results, 1):
            snippet = (r.content or "").strip().replace("\n", " ")
            if len(snippet) > 400:
                snippet = snippet[:400] + "…"
            date_suffix = f" ({r.published_date})" if r.published_date else ""
            # 제목을 링크로 + 게시일
            lines.append(f"\n**[{i}] [{r.title}]({r.url})**{date_suffix}")
            if snippet:
                lines.append(f"    {snippet}")
    lines.append(
        "\n\n위 결과를 근거로 답하세요. URL을 인용할 때는 [1], [2] 식으로 번호로 표기하세요. "
        "출처 게시일이 오래됐다면 (예: 1년 이상 전) 정보가 갱신됐을 가능성을 고려하고, "
        "필요하면 더 최신 자료를 추가 검색하세요."
    )
    return "\n".join(lines)
