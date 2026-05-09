from pathlib import Path

from platformdirs import user_config_dir

from .schema import AppConfig

APP_NAME = "generalchat"
CONFIG_FILENAME = "config.json"


def config_path() -> Path:
    d = Path(user_config_dir(APP_NAME))
    d.mkdir(parents=True, exist_ok=True)
    return d / CONFIG_FILENAME


def load_config() -> AppConfig:
    p = config_path()
    if not p.exists():
        return AppConfig()
    try:
        return AppConfig.model_validate_json(p.read_text())
    except Exception:
        # 손상된 설정 파일 → 빈 설정으로 폴백
        return AppConfig()


def save_config(cfg: AppConfig) -> None:
    p = config_path()
    p.write_text(cfg.model_dump_json(indent=2))
