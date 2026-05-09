from typing import Literal

from pydantic import BaseModel, Field

TitleStrategy = Literal["auto", "truncate", "manual"]
SearchProviderType = Literal["none", "tavily", "brave", "searxng", "ddg"]


class AppConfig(BaseModel):
    """앱 영속 설정. ~/.config/generalchat/config.json 에 저장."""

    llama_server_path: str | None = None
    model_dirs: list[str] = Field(default_factory=list)
    default_port: int = 8081
    default_n_ctx: int = 32768
    default_max_tokens: int = 8192
    # mmproj 기본은 CPU (VRAM 절약). Settings에서 GPU 오프로딩 켤 수 있음.
    default_mmproj_offload_to_gpu: bool = False
    title_strategy: TitleStrategy = "auto"

    # CPU 사이드카 — 자동 제목용 작은 모델, 메인 모델 KV cache 무손상
    title_sidecar_enabled: bool = False
    title_sidecar_model_path: str | None = None
    title_sidecar_port: int = 8082
    title_sidecar_n_threads: int = 4
    title_sidecar_n_ctx: int = 4096

    # 웹 검색
    search_provider: SearchProviderType = "none"
    search_tavily_api_key: str | None = None
    search_brave_api_key: str | None = None
    search_searxng_url: str | None = None
    search_max_results: int = 5
