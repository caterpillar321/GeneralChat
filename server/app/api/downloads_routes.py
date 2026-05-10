"""HuggingFace 모델 다운로드 도우미 API.

- POST /api/downloads/start  → 백그라운드 다운로드 시작
- GET  /api/downloads        → 진행 중·완료 목록
- GET  /api/downloads/{id}   → 단일 항목 상태
- DELETE /api/downloads/{id} → 취소

저장 위치: ~/.local/share/generalchat/models/sidecar/<repo>/<filename>
인증 필요 repo (Gemma 등) 는 1차에서 anonymous 다운로드만 — token 옵션은 추후.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException
from platformdirs import user_data_dir
from pydantic import BaseModel

router = APIRouter(prefix="/api/downloads")

_MODELS_DIR = Path(user_data_dir("generalchat")) / "models" / "sidecar"
_MODELS_DIR.mkdir(parents=True, exist_ok=True)


class StartRequest(BaseModel):
    repo: str
    filename: str
    kind: Literal["title", "embedding", "main"] = "title"


class DownloadEntry(BaseModel):
    id: str
    repo: str
    filename: str
    kind: str
    status: Literal["pending", "downloading", "done", "error", "cancelled"]
    bytes_downloaded: int = 0
    bytes_total: int = 0
    error: str | None = None
    local_path: str | None = None
    started_at: int
    updated_at: int


# 모듈 레벨 진행 상태 (단일 프로세스)
_state: dict[str, DownloadEntry] = {}
_tasks: dict[str, asyncio.Task[None]] = {}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _hf_url(repo: str, filename: str) -> str:
    return f"https://huggingface.co/{repo}/resolve/main/{filename}"


def _target_path(repo: str, filename: str) -> Path:
    safe_repo = repo.replace("/", "__")
    target_dir = _MODELS_DIR / safe_repo
    target_dir.mkdir(parents=True, exist_ok=True)
    return target_dir / filename


async def _download_task(entry_id: str, repo: str, filename: str) -> None:
    entry = _state[entry_id]
    target = _target_path(repo, filename)
    tmp_target = target.with_suffix(target.suffix + ".part")

    try:
        entry.status = "downloading"
        entry.updated_at = _now_ms()
        url = _hf_url(repo, filename)

        async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
            async with client.stream("GET", url) as r:
                if r.status_code != 200:
                    body = await r.aread()
                    raise RuntimeError(
                        f"HTTP {r.status_code}: {body[:300].decode('utf-8', 'replace')}"
                    )
                total = int(r.headers.get("content-length", 0))
                entry.bytes_total = total

                downloaded = 0
                last_update = 0
                with tmp_target.open("wb") as f:
                    async for chunk in r.aiter_bytes(chunk_size=1024 * 1024):
                        f.write(chunk)
                        downloaded += len(chunk)
                        # 200ms 마다 또는 1MB 마다 갱신
                        now = _now_ms()
                        if now - last_update > 200:
                            entry.bytes_downloaded = downloaded
                            entry.updated_at = now
                            last_update = now

        # 완료 — atomic rename
        tmp_target.replace(target)
        entry.bytes_downloaded = entry.bytes_total or downloaded
        entry.local_path = str(target)
        entry.status = "done"
        entry.updated_at = _now_ms()
    except asyncio.CancelledError:
        entry.status = "cancelled"
        entry.updated_at = _now_ms()
        try:
            tmp_target.unlink(missing_ok=True)
        except Exception:
            pass
        raise
    except Exception as e:
        entry.status = "error"
        entry.error = str(e)
        entry.updated_at = _now_ms()
        try:
            tmp_target.unlink(missing_ok=True)
        except Exception:
            pass


@router.post("/start")
async def start_download(
    req: StartRequest, background: BackgroundTasks
) -> DownloadEntry:
    # 이미 받은 파일이면 즉시 done 으로
    target = _target_path(req.repo, req.filename)
    if target.exists():
        existing = DownloadEntry(
            id=uuid.uuid4().hex,
            repo=req.repo,
            filename=req.filename,
            kind=req.kind,
            status="done",
            bytes_downloaded=target.stat().st_size,
            bytes_total=target.stat().st_size,
            local_path=str(target),
            started_at=_now_ms(),
            updated_at=_now_ms(),
        )
        _state[existing.id] = existing
        return existing

    eid = uuid.uuid4().hex
    entry = DownloadEntry(
        id=eid,
        repo=req.repo,
        filename=req.filename,
        kind=req.kind,
        status="pending",
        started_at=_now_ms(),
        updated_at=_now_ms(),
    )
    _state[eid] = entry

    async def _runner() -> None:
        await _download_task(eid, req.repo, req.filename)

    task = asyncio.create_task(_runner())
    _tasks[eid] = task
    return entry


@router.get("")
def list_downloads() -> list[DownloadEntry]:
    return sorted(_state.values(), key=lambda e: -e.started_at)


@router.get("/{entry_id}")
def get_download(entry_id: str) -> DownloadEntry:
    e = _state.get(entry_id)
    if not e:
        raise HTTPException(404, "download not found")
    return e


@router.delete("/{entry_id}")
async def cancel_download(entry_id: str) -> dict[str, bool]:
    e = _state.get(entry_id)
    if not e:
        raise HTTPException(404, "download not found")
    task = _tasks.get(entry_id)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    return {"ok": True}
