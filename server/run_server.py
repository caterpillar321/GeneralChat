"""PyInstaller 빌드용 entry point — 패키징 시 frozen .exe 진입점.

dev 모드에서는 `uv run uvicorn app.main:app --port 8765 --host 127.0.0.1` 사용.
prod 모드에서는 이 스크립트가 freeze 되어 실행됨.
"""

from __future__ import annotations

import multiprocessing
import sys


def main() -> None:
    multiprocessing.freeze_support()

    import uvicorn

    from app.main import app

    host = "127.0.0.1"
    port = 8765

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--port" and i + 1 < len(args):
            port = int(args[i + 1])
            i += 2
        elif a == "--host" and i + 1 < len(args):
            host = args[i + 1]
            i += 2
        else:
            i += 1

    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
