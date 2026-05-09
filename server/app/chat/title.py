"""대화 제목 자동 생성.

전략(`AppConfig.title_strategy`):
- `auto`     — LLM에 짧은 1회 호출 (사이드카 우선, 없으면 메인)
- `truncate` — 첫 user 메시지 앞 N자 자르기
- `manual`   — 자동 안 함
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

import httpx

from app.config.store import load_config
from app.db import conversations as conv_dao
from app.db import messages as msg_dao
from app.llama import manager
from app.llama.schema import LlamaStartArgs

_THINK_TAG_RE = re.compile(r"<think>[\s\S]*?</think>", re.IGNORECASE)
_WS_RE = re.compile(r"\s+")
TRUNCATE_LEN = 30
TITLE_MAX_LEN = 50

# 메타 출력 (사고 과정 / 분석 / 메타 안내) 패턴 — 발견 시 LLM 결과 폐기
_META_PREFIXES = (
    "thinking", "analysis", "analyze", "okay", "sure",
    "here is", "here's", "the user", "first,", "step",
    "let me", "i need", "i'll", "title:", "the title",
    "to summarize", "to generate",
    "1.", "**", "*",
)


def _looks_meta(text: str) -> bool:
    low = text.lower().strip()
    if not low:
        return True
    return any(low.startswith(p) for p in _META_PREFIXES)


def _clean(title: str) -> str:
    title = _THINK_TAG_RE.sub("", title)
    # 마크다운 강조 제거
    title = re.sub(r"\*+", "", title)
    title = title.replace("\n", " ").replace("\r", " ")
    title = _WS_RE.sub(" ", title)
    title = title.strip().strip("\"'`.,!?")
    if len(title) > TITLE_MAX_LEN:
        title = title[:TITLE_MAX_LEN]
    return title


def _truncate_title(text: str) -> str:
    text = _WS_RE.sub(" ", (text or "").strip())
    if len(text) > TRUNCATE_LEN:
        text = text[:TRUNCATE_LEN].rstrip() + "…"
    return text


async def _wait_for_first_pair(cid: str) -> tuple[dict | None, dict | None]:
    user_msg = None
    assist_msg = None
    for _ in range(10):
        msgs = msg_dao.list_messages(cid)
        user_msg = next((m for m in msgs if m["role"] == "user"), None)
        assist_msg = next((m for m in msgs if m["role"] == "assistant"), None)
        if user_msg and assist_msg:
            break
        await asyncio.sleep(0.3)
    return user_msg, assist_msg


async def _ensure_sidecar() -> int | None:
    """사이드카가 활성/유효 설정이면 살아있게 보장. 동작하면 port 반환, 아니면 None."""
    cfg = load_config()
    if not cfg.title_sidecar_enabled or not cfg.title_sidecar_model_path:
        return None
    if not cfg.llama_server_path or not Path(cfg.llama_server_path).exists():
        return None
    if not Path(cfg.title_sidecar_model_path).exists():
        return None

    if manager.title.is_running():
        return cfg.title_sidecar_port

    args = LlamaStartArgs(
        model_id="title-sidecar",
        n_ctx=cfg.title_sidecar_n_ctx,
        n_gpu_layers=0,  # CPU 강제
        cache_type_k="f16",
        cache_type_v="f16",
        flash_attn=False,
        extra_args=["-t", str(cfg.title_sidecar_n_threads)],
    )
    state = await manager.title.start(
        args,
        server_path=cfg.llama_server_path,
        model_path=cfg.title_sidecar_model_path,
        mmproj_path=None,
        multipart_paths=[],
        port=cfg.title_sidecar_port,
        health_timeout=120.0,  # 작은 모델은 빠르게 — 2분이면 충분
    )
    return cfg.title_sidecar_port if state.status == "running" else None


async def _generate_via_llm(
    user_content: str, assist_content: str, port: int
) -> str | None:
    payload = {
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a title generator. Reply with ONLY a short title "
                    "(max 5 words, Korean if input is Korean else English). "
                    "Do not think. Do not analyze. Do not explain. Do not use markdown or quotes. "
                    "Output only the bare title text and stop immediately."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Title for this dialog (max 5 words):\n"
                    f"User: {user_content[:200]}\n"
                    f"Assistant: {assist_content[:200]}"
                ),
            },
        ],
        "temperature": 0.3,
        "max_tokens": 20,  # 사고 과정 길게 못 나오게 짧게
        "stream": False,
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                f"http://127.0.0.1:{port}/v1/chat/completions", json=payload
            )
            if r.status_code != 200:
                return None
            data = r.json()
            msg_obj = (data.get("choices") or [{}])[0].get("message", {}) or {}
            # reasoning_content 는 사고 과정이라 제목으로 부적합 — content 만 사용
            text = msg_obj.get("content") or ""
            title = _clean(text)
            # 빈 응답이거나 메타 출력이면 LLM 실패로 간주 (외부에서 truncate 폴백)
            if not title or _looks_meta(title):
                return None
            return title
    except Exception:
        return None


async def generate_title_for(cid: str) -> str | None:
    cfg = load_config()
    strategy = cfg.title_strategy

    if strategy == "manual":
        return None

    user_msg, assist_msg = await _wait_for_first_pair(cid)
    if not user_msg:
        return None

    title: str | None = None

    if strategy == "truncate":
        title = _truncate_title(user_msg["content"])
    else:  # auto
        if not assist_msg:
            return None

        # 1. 사이드카 시도
        sidecar_port = await _ensure_sidecar()
        if sidecar_port is not None:
            title = await _generate_via_llm(
                user_msg["content"], assist_msg["content"], sidecar_port
            )

        # 2. 사이드카 비활성/실패 → 메인 모델
        if not title:
            state = manager.get_state()
            if state.status == "running" and state.port:
                title = await _generate_via_llm(
                    user_msg["content"], assist_msg["content"], state.port
                )

        # 3. 모두 실패 → truncate 폴백
        if not title:
            title = _truncate_title(user_msg["content"])

    if not title:
        return None
    conv_dao.update_conversation(cid, title=title)
    return title
