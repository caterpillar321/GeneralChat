from pydantic import BaseModel, Field


class LlamaStartArgs(BaseModel):
    """사용자가 모델을 로드할 때 보내는 옵션."""

    model_id: str
    n_ctx: int = 4096
    n_gpu_layers: int = -1  # -1 = 가능하면 전부 GPU
    cache_type_k: str = "f16"  # f16 / q8_0 / q4_0 등
    cache_type_v: str = "f16"
    flash_attn: bool = False
    # mmproj 를 GPU 에 offload? False = CPU 에서 실행 (VRAM 절약, 느림)
    mmproj_offload_to_gpu: bool = False
    # vision 사용? False 면 mmproj 가 있어도 안 붙임 (텍스트 전용 로드).
    # mmproj 가 깨졌거나 llama.cpp 미지원일 때 텍스트로라도 쓰기 위함.
    use_vision: bool = True
    # 임베딩 모드 — --embeddings 플래그 추가, completion 비활성
    embedding_mode: bool = False
    extra_args: list[str] = Field(default_factory=list)


class LlamaState(BaseModel):
    """현재 llama-server 상태."""

    status: str  # stopped | starting | running | error
    model_id: str | None = None
    model_path: str | None = None
    port: int | None = None
    pid: int | None = None
    n_ctx: int | None = None
    is_vision: bool = False  # mmproj 같이 로드되어 이미지 입력 가능
    # 로딩 진행 (status=starting 동안): meta|tensors|context|kv|mmproj|warmup
    phase: str | None = None
    layers_loaded: int | None = None
    layers_total: int | None = None
    error: str | None = None
