from fastapi import APIRouter, HTTPException

from app.config.store import load_config
from app.llama import manager
from app.llama.schema import LlamaStartArgs, LlamaState
from app.models.scanner import scan_dirs

router = APIRouter(prefix="/api/llama")


@router.get("/status")
def status() -> LlamaState:
    return manager.get_state()


@router.post("/start")
async def start(args: LlamaStartArgs) -> LlamaState:
    cfg = load_config()
    if not cfg.llama_server_path:
        raise HTTPException(400, "llama-server 바이너리 경로가 설정되지 않았습니다.")
    if not cfg.model_dirs:
        raise HTTPException(400, "모델 디렉토리가 등록되지 않았습니다.")

    entries = scan_dirs(cfg.model_dirs)
    matched = next((e for e in entries if e.id == args.model_id), None)
    if matched is None:
        raise HTTPException(404, f"모델을 찾을 수 없음: {args.model_id}")

    return await manager.start(
        args,
        server_path=cfg.llama_server_path,
        model_path=matched.main_file,
        mmproj_path=matched.mmproj_file,
        multipart_paths=matched.parts,
        port=cfg.default_port,
    )


@router.post("/stop")
async def stop() -> LlamaState:
    return await manager.stop()


@router.get("/log")
def get_log(max_bytes: int = 16384) -> dict[str, str]:
    return {"log": manager.read_log(max_bytes)}
