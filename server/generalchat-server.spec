# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — generalchat 사이드카 (FastAPI + sqlite-vec + RAG).

Linux/Windows 양쪽에서 사용 가능. native binary (sqlite_vec) 와 hidden imports 명시.
빌드: `uv run pyinstaller generalchat-server.spec --clean`
산출: `dist/generalchat-server/`
"""

import os
import sys
from pathlib import Path

# sqlite_vec 패키지 안의 native shared library 를 datas 로 동봉
import sqlite_vec

vec_dir = Path(sqlite_vec.__file__).parent
vec_datas = []
for f in vec_dir.iterdir():
    if f.is_file() and f.suffix in (".so", ".dll", ".dylib", ".py"):
        vec_datas.append((str(f), "sqlite_vec"))

block_cipher = None

a = Analysis(
    ["run_server.py"],
    pathex=[],
    binaries=[],
    datas=vec_datas,
    hiddenimports=[
        # uvicorn 동적 로딩 모듈 — auto-detect 안 됨
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.http.httptools_impl",
        "uvicorn.protocols.websockets.wsproto_impl",
        "uvicorn.protocols.websockets.websockets_impl",
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.loops.uvloop",
        # 우리 앱의 모든 라우터·매니저 — FastAPI router include 가 동적이라 명시
        "app.main",
        "app.api.config_routes",
        "app.api.conversations_routes",
        "app.api.documents_routes",
        "app.api.health",
        "app.api.llama_routes",
        "app.api.models_routes",
        "app.api.search_routes",
        "app.chat.routes",
        "app.chat.tools",
        "app.chat.title",
        "app.config.schema",
        "app.config.store",
        "app.db.connection",
        "app.db.conversations",
        "app.db.documents",
        "app.db.messages",
        "app.documents.chunker",
        "app.documents.indexer",
        "app.documents.parser",
        "app.embedding.sidecar",
        "app.llama.discovery",
        "app.llama.manager",
        "app.llama.schema",
        "app.models.scanner",
        "app.search.base",
        "app.search.factory",
        "app.search.tavily",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # 불필요한 무거운 의존성 제외
        "matplotlib",
        "numpy.tests",
        "pandas",
        "scipy",
        "torch",
        "tensorflow",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="generalchat-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="generalchat-server",
)
