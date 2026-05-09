"""Config 를 보고 활성 provider 인스턴스를 만든다."""

from __future__ import annotations

from app.config.store import load_config

from .base import SearchProvider
from .tavily import TavilyProvider


def get_provider() -> SearchProvider | None:
    cfg = load_config()
    p = cfg.search_provider
    if p == "tavily":
        if not cfg.search_tavily_api_key:
            return None
        return TavilyProvider(cfg.search_tavily_api_key)
    # 추후 brave / searxng / ddg 추가
    return None
