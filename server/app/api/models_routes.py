from fastapi import APIRouter

from app.config.store import load_config
from app.models.scanner import ModelEntry, scan_dirs

router = APIRouter(prefix="/api/models")


@router.get("")
def list_models() -> list[ModelEntry]:
    cfg = load_config()
    return scan_dirs(cfg.model_dirs)


@router.post("/scan")
def rescan() -> list[ModelEntry]:
    """현재는 list_models 와 동일. 추후 캐시 무효화 자리."""
    cfg = load_config()
    return scan_dirs(cfg.model_dirs)
