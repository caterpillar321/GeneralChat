from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    config_routes,
    conversations_routes,
    health,
    llama_routes,
    models_routes,
    search_routes,
)
from app.chat import routes as chat_routes
from app.db.connection import init_db
from app.llama import manager as llama_manager


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    init_db()
    yield
    if llama_manager.is_running():
        await llama_manager.stop()
    if llama_manager.title.is_running():
        await llama_manager.title.stop()


app = FastAPI(title="GeneralChat Server", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Conversation-Id"],
)

app.include_router(health.router)
app.include_router(config_routes.router)
app.include_router(models_routes.router)
app.include_router(llama_routes.router)
app.include_router(chat_routes.router)
app.include_router(conversations_routes.router)
app.include_router(search_routes.router)
