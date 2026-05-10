"""앱 버전 정보 + GitHub 최신 release 조회.

frontend 가 자기 버전(package.json) 과 latest 비교해 알림.
private repo 면 401 → 그냥 latest=None 반환 (silent).
"""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter

router = APIRouter(prefix="/api/version")

GITHUB_RELEASES_URL = (
    "https://api.github.com/repos/caterpillar321/GeneralChat/releases/latest"
)


@router.get("")
async def latest() -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(
                GITHUB_RELEASES_URL,
                headers={"Accept": "application/vnd.github+json"},
            )
            if r.status_code != 200:
                return {
                    "latest": None,
                    "release_url": None,
                    "fetch_error": f"HTTP {r.status_code}",
                }
            data = r.json()
            return {
                "latest": data.get("tag_name"),
                "release_url": data.get("html_url"),
                "published_at": data.get("published_at"),
            }
    except Exception as e:
        return {"latest": None, "release_url": None, "fetch_error": str(e)}
