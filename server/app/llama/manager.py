"""llama-server 자식 프로세스 매니저.

`LlamaServer` 클래스로 만들어 두 인스턴스 운용:
- `main`  — 사용자 채팅용. 큰 모델, GPU.
- `title` — 자동 제목 생성용 CPU 사이드카. 작은 모델.

stdout/stderr 는 인스턴스별 로그 파일로 리다이렉트.
"""

from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path
from typing import Optional

import httpx
from platformdirs import user_log_dir

from .schema import LlamaStartArgs, LlamaState

APP_NAME = "generalchat"
HEALTH_TIMEOUT_SECONDS = 600.0  # 10분 — 큰 모델 로딩 여유

LOG_DIR = Path(user_log_dir(APP_NAME))
LOG_DIR.mkdir(parents=True, exist_ok=True)


class LlamaServer:
    def __init__(self, name: str) -> None:
        self.name = name
        self._state: LlamaState = LlamaState(status="stopped")
        self._process: Optional[subprocess.Popen[bytes]] = None
        self._lock = asyncio.Lock()
        self._log_file = LOG_DIR / f"llama-server-{name}.log"

    @property
    def log_file(self) -> Path:
        return self._log_file

    def get_state(self) -> LlamaState:
        if self._state.status in ("running", "starting"):
            if self._process is None or self._process.poll() is not None:
                self._state = LlamaState(
                    status="error",
                    model_id=self._state.model_id,
                    model_path=self._state.model_path,
                    error="llama-server process exited unexpectedly (자세한 내용은 로그 참고)",
                )
                self._process = None
        return self._state.model_copy()

    def is_running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def read_log(self, max_bytes: int = 16384) -> str:
        if not self._log_file.exists():
            return ""
        try:
            with self._log_file.open("rb") as f:
                f.seek(0, 2)
                size = f.tell()
                f.seek(max(0, size - max_bytes), 0)
                data = f.read()
            return data.decode("utf-8", errors="replace")
        except Exception as e:
            return f"<로그 읽기 실패: {e}>"

    async def _wait_for_health(self, port: int, timeout: float) -> bool:
        loop = asyncio.get_event_loop()
        deadline = loop.time() + timeout
        async with httpx.AsyncClient(timeout=2.0) as client:
            while loop.time() < deadline:
                if not self.is_running():
                    return False
                try:
                    r = await client.get(f"http://127.0.0.1:{port}/health")
                    if r.status_code == 200:
                        return True
                except Exception:
                    pass
                await asyncio.sleep(1.0)
        return False

    @staticmethod
    def _build_command(
        server_path: str,
        model_path: str,
        mmproj_path: str | None,
        args: LlamaStartArgs,
        multipart_paths: list[str],
        port: int,
    ) -> list[str]:
        cmd: list[str] = [server_path, "--host", "127.0.0.1", "--port", str(port)]
        cmd += ["-m", multipart_paths[0] if multipart_paths else model_path]
        cmd += ["-c", str(args.n_ctx)]
        cmd += ["-ngl", str(args.n_gpu_layers)]
        cmd += ["--cache-type-k", args.cache_type_k]
        cmd += ["--cache-type-v", args.cache_type_v]
        cmd += ["-fa", "on" if args.flash_attn else "off"]
        if mmproj_path:
            cmd += ["--mmproj", mmproj_path]
            if not args.mmproj_offload_to_gpu:
                cmd += ["--no-mmproj-offload"]
        if args.embedding_mode:
            cmd += ["--embeddings"]
        cmd += list(args.extra_args)
        return cmd

    async def start(
        self,
        args: LlamaStartArgs,
        *,
        server_path: str,
        model_path: str,
        mmproj_path: str | None = None,
        multipart_paths: list[str] | None = None,
        port: int,
        health_timeout: float = HEALTH_TIMEOUT_SECONDS,
    ) -> LlamaState:
        multipart_paths = multipart_paths or []
        async with self._lock:
            if self.is_running():
                await self._stop_locked()

            cmd = self._build_command(
                server_path, model_path, mmproj_path, args, multipart_paths, port
            )
            self._state = LlamaState(
                status="starting",
                model_id=args.model_id,
                model_path=model_path,
                port=port,
                n_ctx=args.n_ctx,
                is_vision=mmproj_path is not None,
            )

            try:
                with self._log_file.open("w") as lf:
                    lf.write("$ " + " ".join(cmd) + "\n\n")
            except Exception:
                pass

            try:
                log_handle = self._log_file.open("a")
                self._process = subprocess.Popen(
                    cmd,
                    stdout=log_handle,
                    stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL,
                )
                log_handle.close()
                self._state.pid = self._process.pid
            except Exception as e:
                self._process = None
                self._state = LlamaState(
                    status="error",
                    model_id=args.model_id,
                    model_path=model_path,
                    error=f"spawn failed: {e}",
                )
                return self._state.model_copy()

        ok = await self._wait_for_health(port, health_timeout)

        async with self._lock:
            if not ok:
                if self._process is not None and self._process.poll() is None:
                    await self._stop_locked()
                else:
                    self._process = None
                self._state = LlamaState(
                    status="error",
                    model_id=args.model_id,
                    model_path=model_path,
                    error=f"health check timed out after {int(health_timeout)}s — 로그 확인",
                )
            else:
                self._state.status = "running"
            return self._state.model_copy()

    async def stop(self) -> LlamaState:
        async with self._lock:
            await self._stop_locked()
            return self._state.model_copy()

    async def _stop_locked(self) -> None:
        if self._process is not None:
            try:
                self._process.terminate()
                try:
                    await asyncio.to_thread(self._process.wait, 10)
                except subprocess.TimeoutExpired:
                    self._process.kill()
                    await asyncio.to_thread(self._process.wait, 5)
            except Exception:
                pass
            self._process = None
        self._state = LlamaState(status="stopped")


# === 세 인스턴스 ===

main = LlamaServer("main")
title = LlamaServer("title")
embedding = LlamaServer("embedding")


# === 모듈 레벨 호환 함수 (기존 호출 보호) ===


def get_state() -> LlamaState:
    return main.get_state()


def is_running() -> bool:
    return main.is_running()


def read_log(max_bytes: int = 16384) -> str:
    return main.read_log(max_bytes)


async def start(
    args: LlamaStartArgs,
    *,
    server_path: str,
    model_path: str,
    mmproj_path: str | None,
    multipart_paths: list[str],
    port: int,
) -> LlamaState:
    return await main.start(
        args,
        server_path=server_path,
        model_path=model_path,
        mmproj_path=mmproj_path,
        multipart_paths=multipart_paths,
        port=port,
    )


async def stop() -> LlamaState:
    return await main.stop()
