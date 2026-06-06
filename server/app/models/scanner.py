"""GGUF 모델 스캐너.

파일명 휴리스틱으로 가족·파라미터·양자화·멀티파트·mmproj 를 추출하고,
같은 디렉토리 안에서 멀티파트 파일과 비전 프로젝터를 그룹핑한다.
"""

from __future__ import annotations

import re
from pathlib import Path

from pydantic import BaseModel

# 양자화 형식: Q4_K_M, Q6_K, IQ4_XS, F16, BF16, MXFP4, UD-Q4_K_XL 등
QUANT_RE = re.compile(
    r"(?:^|[-_.])("
    r"UD-Q[0-9]+_[A-Z0-9_]+"
    r"|IQ[0-9]+(?:_[A-Z0-9_]+)?"
    r"|Q[0-9]+_[A-Z0-9_]+"
    r"|Q[0-9]+"
    r"|MXFP[0-9]+|FP[0-9]+"
    r"|BF16|F32|F16"
    r")(?:[-_.]|$)",
    re.IGNORECASE,
)

# 멀티파트: -00001-of-00002
MULTIPART_RE = re.compile(r"-(\d{5})-of-(\d{5})$", re.IGNORECASE)

# mmproj 프로젝터 — 파일명 어디에 있든 'mmproj' 토큰이 있으면 보조 파일로 간주.
# 예: mmproj-foo.gguf / foo-mmproj.gguf / foo.mmproj.gguf / mmproj_foo.gguf
MMPROJ_RE = re.compile(r"(?:^|[-_.])mmproj(?:[-_.]|$)", re.IGNORECASE)

# 파라미터 크기: 7B, 27B, 30B-A3B
PARAMS_RE = re.compile(
    r"(?<![A-Za-z0-9])(\d+(?:\.\d+)?[BMG])(?:[-_]A\d+(?:\.\d+)?B)?",
    re.IGNORECASE,
)


class ModelFile(BaseModel):
    path: str
    name: str  # 파일명 stem (.gguf 제외)
    size_bytes: int
    is_mmproj: bool = False
    is_multipart: bool = False
    multipart_index: int | None = None
    multipart_total: int | None = None


class ModelEntry(BaseModel):
    """그룹화된 모델 엔트리 — 한 모델의 한 양자화 변형."""

    id: str
    family: str
    display_name: str
    params: str | None
    quant: str | None
    is_vision: bool = False  # mmproj 매칭됨 — 즉시 vision 가능
    can_be_vision: bool = False  # family/이름 상 vision 가능, mmproj 받으면 활성
    main_file: str  # 첫 파트 또는 단일 파일
    mmproj_file: str | None = None
    parts: list[str] = []  # 단일 파일이면 비어 있음, 멀티파트면 모든 경로
    total_size_bytes: int = 0


FAMILY_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Gemma", re.compile(r"gemma", re.IGNORECASE)),
    ("Qwen", re.compile(r"qwen", re.IGNORECASE)),
    ("Llama", re.compile(r"\bllama[-_]?\d", re.IGNORECASE)),
    ("Mixtral", re.compile(r"mixtral", re.IGNORECASE)),
    ("Mistral", re.compile(r"mistral", re.IGNORECASE)),
    ("Devstral", re.compile(r"devstral", re.IGNORECASE)),
    ("Magistral", re.compile(r"magistral", re.IGNORECASE)),
    ("EXAONE", re.compile(r"exaone", re.IGNORECASE)),
    ("Nemotron", re.compile(r"nemotron", re.IGNORECASE)),
    ("Phi", re.compile(r"\bphi[-_]?\d", re.IGNORECASE)),
    ("DeepSeek", re.compile(r"deepseek", re.IGNORECASE)),
    ("GPT-OSS", re.compile(r"gpt[-_]?oss", re.IGNORECASE)),
    ("Yi", re.compile(r"\byi[-_]?\d", re.IGNORECASE)),
    ("Falcon", re.compile(r"falcon", re.IGNORECASE)),
    ("Command-R", re.compile(r"command[-_]?r", re.IGNORECASE)),
    ("Solar", re.compile(r"\bsolar[-_]", re.IGNORECASE)),
    ("Pixtral", re.compile(r"pixtral", re.IGNORECASE)),
    ("InternVL", re.compile(r"intern[-_]?vl", re.IGNORECASE)),
    ("LLaVA", re.compile(r"llava", re.IGNORECASE)),
]


# vision 가능 family + 변형 패턴 (mmproj 받으면 활성화 가능)
# 같은 family여도 텍스트 전용 변형 있을 수 있어 정확하지 않음 — 보수적으로
_VISION_NAME_PATTERNS = [
    re.compile(r"gemma[-_]?[34]", re.IGNORECASE),  # Gemma 3, 4 (전체 시리즈)
    re.compile(r"qwen[\d.]*[-_]?vl", re.IGNORECASE),  # Qwen VL
    re.compile(r"llama[-_]?3\.2.*vision", re.IGNORECASE),  # Llama 3.2 Vision
    re.compile(r"pixtral", re.IGNORECASE),
    re.compile(r"phi[-_]?\d.*vision", re.IGNORECASE),  # Phi vision
    re.compile(r"intern[-_]?vl", re.IGNORECASE),
    re.compile(r"llava", re.IGNORECASE),
    re.compile(r"devstral.*small.*2", re.IGNORECASE),  # Devstral Small 2 (vision)
    re.compile(r"magistral.*small.*2", re.IGNORECASE),  # Magistral Small 2 (vision)
    re.compile(r"smolvlm", re.IGNORECASE),
    re.compile(r"moondream", re.IGNORECASE),
]


def can_be_vision(name: str) -> bool:
    """mmproj 없어도 가족·변형명 상 vision 가능한지."""
    return any(p.search(name) for p in _VISION_NAME_PATTERNS)


# 모델 사이즈 라벨: 7B, 31B, E4B, E2B, 27B, 30B 등. mmproj↔모델 호환성 판정용.
_SIZE_LABEL_RE = re.compile(r"(?<![a-z0-9])(e?\d+(?:\.\d+)?b)(?![a-z])", re.IGNORECASE)


def _size_labels(name: str) -> set[str]:
    return {m.lower() for m in _SIZE_LABEL_RE.findall(name)}


def match_mmproj(model_name: str, directory: Path, mmproj_files: list["ModelFile"]):
    """모델과 호환되는 mmproj 선택.

    같은 폴더 후보 중에서:
    - 사이즈 라벨(예: 31B / E4B)이 둘 다 명시됐는데 **다르면 제외** (mismatch 방지)
    - 사이즈 라벨이 일치하면 강한 매치
    - mmproj 에 사이즈 라벨 없으면 (generic mmproj-model-f16 등) 약한 후보로 fallback
    """
    candidates = [mp for mp in mmproj_files if Path(mp.path).parent == directory]
    if not candidates:
        return None

    model_sizes = _size_labels(model_name)
    scored: list[tuple[int, "ModelFile"]] = []
    for mp in candidates:
        mp_sizes = _size_labels(mp.name)
        if mp_sizes and model_sizes:
            if mp_sizes & model_sizes:
                scored.append((2, mp))  # 사이즈 일치 — 강한 매치
            # else: 사이즈 명시됐는데 불일치 → 후보에서 제외 (31B mmproj ↔ E4B 모델 방지)
        else:
            scored.append((1, mp))  # 사이즈 불명 generic mmproj → 약한 후보

    if not scored:
        return None
    scored.sort(key=lambda x: -x[0])
    return scored[0][1]


def detect_family(name: str) -> str:
    for family, pat in FAMILY_PATTERNS:
        if pat.search(name):
            return family
    return "Unknown"


def detect_quant(name: str) -> str | None:
    m = QUANT_RE.search(name)
    return m.group(1).upper() if m else None


def detect_params(name: str) -> str | None:
    m = PARAMS_RE.search(name)
    if not m:
        return None
    # MoE 표기 (e.g. 30B-A3B) 보존
    full = m.group(0)
    return full.upper() if full else None


def detect_multipart(stem: str) -> tuple[int, int] | None:
    m = MULTIPART_RE.search(stem)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None


def is_mmproj(name: str) -> bool:
    return bool(MMPROJ_RE.search(name))


def scan_directory(root: Path) -> list[ModelFile]:
    out: list[ModelFile] = []
    if not root.exists() or not root.is_dir():
        return out
    for p in root.rglob("*.gguf"):
        if not p.is_file():
            continue
        stem = p.stem
        mp = detect_multipart(stem)
        try:
            size = p.stat().st_size
        except OSError:
            continue
        out.append(
            ModelFile(
                path=str(p),
                name=stem,
                size_bytes=size,
                is_mmproj=is_mmproj(stem),
                is_multipart=mp is not None,
                multipart_index=mp[0] if mp else None,
                multipart_total=mp[1] if mp else None,
            )
        )
    return out


def group_models(files: list[ModelFile]) -> list[ModelEntry]:
    main_files: list[ModelFile] = []
    mmproj_files: list[ModelFile] = []
    for f in files:
        (mmproj_files if f.is_mmproj else main_files).append(f)

    # 멀티파트 그룹: 같은 디렉토리, 멀티파트 접미사 제거한 stem이 같은 것끼리
    by_key: dict[str, list[ModelFile]] = {}
    for f in main_files:
        key_stem = MULTIPART_RE.sub("", f.name) if f.is_multipart else f.name
        key = f"{Path(f.path).parent}::{key_stem}"
        by_key.setdefault(key, []).append(f)

    entries: list[ModelEntry] = []
    for group in by_key.values():
        group.sort(key=lambda x: x.multipart_index or 0)
        first = group[0]
        directory = Path(first.path).parent

        clean_name = MULTIPART_RE.sub("", first.name)
        family = detect_family(clean_name)
        quant = detect_quant(clean_name)
        params = detect_params(clean_name)

        # 호환되는 mmproj 만 매칭 (사이즈 라벨 비교 — 31B mmproj ↔ E4B 모델 방지)
        matched_mmproj = match_mmproj(clean_name, directory, mmproj_files)

        entries.append(
            ModelEntry(
                id=f"{family}/{clean_name}",
                family=family,
                display_name=clean_name,
                params=params,
                quant=quant,
                is_vision=matched_mmproj is not None,
                can_be_vision=can_be_vision(clean_name),
                main_file=first.path,
                mmproj_file=matched_mmproj.path if matched_mmproj else None,
                parts=[f.path for f in group] if len(group) > 1 else [],
                total_size_bytes=sum(f.size_bytes for f in group),
            )
        )

    entries.sort(key=lambda e: (e.family, e.display_name))
    return entries


def scan_dirs(dirs: list[str]) -> list[ModelEntry]:
    all_files: list[ModelFile] = []
    seen_paths: set[str] = set()
    for d in dirs:
        for f in scan_directory(Path(d).expanduser()):
            if f.path in seen_paths:
                continue
            seen_paths.add(f.path)
            all_files.append(f)
    return group_models(all_files)
