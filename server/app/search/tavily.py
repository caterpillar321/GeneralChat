"""Tavily Search API provider."""

from __future__ import annotations

import httpx

from .base import SearchProvider, SearchResponse, SearchResult

_ENDPOINT = "https://api.tavily.com/search"


class TavilyProvider(SearchProvider):
    name = "tavily"

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    async def search(self, query: str, max_results: int = 5) -> SearchResponse:
        payload = {
            "api_key": self.api_key,
            "query": query,
            "max_results": max_results,
            "include_answer": True,
            "search_depth": "advanced",  # 더 풍부한 결과
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(_ENDPOINT, json=payload)
            r.raise_for_status()
            data = r.json()
        results = [
            SearchResult(
                title=item.get("title", ""),
                url=item.get("url", ""),
                content=item.get("content", "") or "",
                score=item.get("score"),
                published_date=item.get("published_date") or item.get("publishedDate"),
            )
            for item in data.get("results", [])
        ]
        return SearchResponse(
            query=query,
            answer=data.get("answer"),
            results=results,
            provider=self.name,
        )
