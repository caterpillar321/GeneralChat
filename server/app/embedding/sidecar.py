"""임베딩 사이드카 — llama-server `--embeddings` 모드, CPU 강제."""

from __future__ import annotations

from pathlib import Path

import httpx

from app.config.store import load_config
from app.llama import manager
from app.llama.schema import LlamaStartArgs


async def ensure_sidecar() -> int | None:
    """살아있게 보장. 동작하면 port 반환, 아니면 None."""
    cfg = load_config()
    if not cfg.embedding_sidecar_enabled or not cfg.embedding_model_path:
        return None
    if not cfg.llama_server_path or not Path(cfg.llama_server_path).exists():
        return None
    if not Path(cfg.embedding_model_path).exists():
        return None

    if manager.embedding.is_running():
        return cfg.embedding_sidecar_port

    args = LlamaStartArgs(
        model_id="embedding-sidecar",
        n_ctx=cfg.embedding_sidecar_n_ctx,
        n_gpu_layers=0,  # CPU 강제
        cache_type_k="f16",
        cache_type_v="f16",
        flash_attn=False,
        embedding_mode=True,
        extra_args=["-t", str(cfg.embedding_sidecar_n_threads)],
    )
    state = await manager.embedding.start(
        args,
        server_path=cfg.llama_server_path,
        model_path=cfg.embedding_model_path,
        mmproj_path=None,
        multipart_paths=[],
        port=cfg.embedding_sidecar_port,
        health_timeout=180.0,
    )
    return cfg.embedding_sidecar_port if state.status == "running" else None


async def embed_texts(texts: list[str], batch_size: int = 32) -> list[list[float]]:
    """N개 텍스트를 임베딩. 사이드카 자동 보장."""
    port = await ensure_sidecar()
    if port is None:
        raise RuntimeError(
            "임베딩 사이드카 미설정 또는 로드 실패. Settings에서 model_path 확인."
        )

    embeddings: list[list[float]] = []
    async with httpx.AsyncClient(timeout=180.0) as client:
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            r = await client.post(
                f"http://127.0.0.1:{port}/v1/embeddings",
                json={"input": batch, "model": "embedding"},
            )
            r.raise_for_status()
            data = r.json()
            for item in data.get("data", []):
                embeddings.append(item["embedding"])
    return embeddings


async def embed_one(text: str) -> list[float]:
    arr = await embed_texts([text])
    if not arr:
        raise RuntimeError("임베딩 실패: 빈 결과")
    return arr[0]
