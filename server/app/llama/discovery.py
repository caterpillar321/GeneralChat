import os
from pathlib import Path
from shutil import which

CANDIDATE_PATHS = [
    "/usr/local/bin/llama-server",
    "/opt/homebrew/bin/llama-server",
    "/opt/llama.cpp/build/bin/llama-server",
    str(Path.home() / "llama.cpp" / "build" / "bin" / "llama-server"),
    str(Path.home() / "llama.cpp" / "llama-server"),
    str(Path.home() / "llama.cpp" / "build" / "llama-server"),
]


def discover_llama_server() -> str | None:
    """흔한 위치 + PATH 에서 llama-server 바이너리 탐색."""
    for p in CANDIDATE_PATHS:
        if Path(p).is_file() and os.access(p, os.X_OK):
            return p
    found = which("llama-server")
    return found
