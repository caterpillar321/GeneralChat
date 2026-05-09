from fastapi import APIRouter

from app.config.schema import AppConfig
from app.config.store import load_config, save_config
from app.llama.discovery import discover_llama_server

router = APIRouter(prefix="/api/config")


@router.get("")
def get_config() -> AppConfig:
    return load_config()


@router.put("")
def update_config(cfg: AppConfig) -> AppConfig:
    save_config(cfg)
    return cfg


@router.get("/discover")
def discover() -> dict[str, str | None]:
    """온보딩용 — 흔한 위치를 스캔해 자동 발견된 후보를 돌려준다."""
    return {"llama_server_path": discover_llama_server()}
