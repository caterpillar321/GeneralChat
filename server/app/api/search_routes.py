from fastapi import APIRouter, HTTPException

from app.config.store import load_config
from app.search.base import SearchResponse
from app.search.factory import get_provider

router = APIRouter(prefix="/api/search")


@router.get("")
async def search(q: str, max_results: int = 5) -> SearchResponse:
    provider = get_provider()
    if not provider:
        raise HTTPException(503, "검색 provider가 설정되지 않았습니다 (Settings → 웹 검색).")
    cfg = load_config()
    n = max(1, min(max_results, cfg.search_max_results))
    try:
        return await provider.search(q, max_results=n)
    except Exception as e:
        raise HTTPException(502, f"검색 실패: {e}") from e
