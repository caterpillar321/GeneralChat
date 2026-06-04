# GeneralChat

엔지니어와 로컬 모델 애호가를 위한 LLM 챗봇 데스크톱 앱.

llama.cpp 기반 로컬 추론, 멀티모달(이미지) 입력, 대화 단위 RAG (PDF/DOCX/PPTX),
웹 검색 tool calling, 멀티 모델 비교 — 한 앱에서.

> **Windows / Linux 설치 인스톨러 제공.** 코드 서명은 아직 안 돼 있어 첫 실행 시
> SmartScreen 경고가 뜰 수 있습니다 (아래 안내).

## 다운로드

[**최신 release**](https://github.com/caterpillar321/GeneralChat/releases/latest) 에서:

| OS | 파일 |
|---|---|
| Windows | `GeneralChat-x.y.z-setup.exe` (NSIS 인스톨러) |
| Linux | `GeneralChat-x.y.z.AppImage` 또는 `.deb` |

앱은 **추론 엔진(llama.cpp)과 모델 가중치는 포함하지 않습니다** — 사용자가 따로
준비합니다 (아래 "사전 준비"). 사이드카 모델(자동 제목·RAG 임베딩)은 앱 안에서
원클릭 다운로드 가능.

## 주요 기능

- **채팅**: 스트리밍, 마크다운, KaTeX 수식, 코드 syntax highlighting, reasoning(CoT) 분리
- **모델 관리**: GGUF 자동 스캔, 양자화/멀티파트/mmproj 인식, 가족별 그룹화,
  사이즈 라벨 기반 mmproj 매칭 (31B mmproj ↔ E4B 모델 같은 mismatch 방지)
- **멀티모달(vision)**: mmproj 자동 매칭, 이미지 드래그/붙여넣기/첨부
  (canvas 로 PNG 정규화 + 1568px 리사이즈 → webp/heic 호환), vision on/off 토글
  (mmproj 가 깨졌거나 llama.cpp 미지원 시 텍스트 전용 fallback)
- **KV cache 컨트롤**: F16 / Q8_0 / Q4_0 프리셋, V 양자화 시 flash-attn 강제, 비대칭 경고
- **모델 로딩 stepper**: 로딩 단계(CUDA init → 레이어 적재 N/M → KV → mmproj → warmup)
  실시간 표시 + 경과 시간
- **mmproj GPU/CPU 오프로드** 토글 (기본 CPU — 비전 인코더는 양자화 강건성 낮아 BF16 권장)
- **자동 제목**: CPU 사이드카 (작은 모델) — 메인 모델 KV cache 무손상. auto/truncate/manual
- **웹 검색**: Tavily provider, multi-round tool calling, 출처 게시일 인지, 출처 popover
- **대화 단위 RAG**: PDF/DOCX/PPTX 첨부 → 청킹 → 임베딩 사이드카 (Qwen3-Embedding-0.6B)
  → sqlite-vec → `search_documents` tool 자동 활성. 대화 한정 벡터 검색
- **인용 추적**: 답변 본문 [1] [2] → 클릭 popover (출처 제목·URL·페이지·발췌)
- **인앱 모델 다운로더**: Settings 에서 사이드카 모델 (제목·임베딩) 원클릭 다운로드
- **자동 업데이트 알림**: 새 release 나오면 사이드바에 알림 (클릭 → release 페이지)
- **대화 영속**: SQLite, 사이드바 날짜별 그룹화, 자동 제목, 이름변경/삭제

## 아키텍처

```
Electron (React + TS)  ──IPC/HTTP──  Python FastAPI 사이드카  ──HTTP──  llama-server
   UI                                  대화 DB·RAG·웹검색·                추론
                                       모델 스캔·다운로드            (+ title/embedding 사이드카)
```

- 패키지 빌드 시 Python 사이드카는 PyInstaller 로 번들 (사용자가 Python 설치 불필요)
- 개발 모드는 `uv run uvicorn` 으로 사이드카 실행

---

## 사전 준비 (설치본 사용자)

### 1. llama.cpp (`llama-server`)
[llama.cpp Releases](https://github.com/ggml-org/llama.cpp/releases) 에서 OS·GPU 에 맞는 빌드:
- Windows + NVIDIA: `llama-bin-win-cuda-*.zip`
- Windows CPU: `llama-bin-win-cpu-*.zip`
- 또는 직접 빌드 (아래 개발자 섹션 참고)

> 최신 모델(예: Gemma 4 12B 의 `gemma4uv` projector)을 쓰려면 **최신 llama.cpp** 가 필요합니다.
> mmproj 로드가 `unknown projector type` 으로 실패하면 llama.cpp 를 업데이트하세요.

### 2. 메인 모델 GGUF
HuggingFace (`bartowski`, `ggml-org`, `unsloth`, `Qwen` 등) 에서 받아 한 폴더에 모음.
- 고비트(Q6/Q8): ggml-org / bartowski 등 아무 데나
- 저비트(Q4↓): unsloth Dynamic (`UD-Q4_K_XL` 등) 이 같은 사이즈 대비 품질 우위
- **vision** 쓰려면 같은 폴더에 그 모델의 mmproj (BF16 권장) 같이 두기

### 3. 사이드카 모델 (선택)
자동 제목·RAG 용 작은 모델 — **앱 Settings 에서 원클릭 다운로드** 또는 직접:
```bash
# 자동 제목 (CPU)
hf download bartowski/Qwen2.5-0.5B-Instruct-GGUF --include "Qwen2.5-0.5B-Instruct-Q8_0.gguf" --local-dir ~/models/qwen2.5-0.5b
# RAG 임베딩 (CPU)
hf download Qwen/Qwen3-Embedding-0.6B-GGUF --include "Qwen3-Embedding-0.6B-Q8_0.gguf" --local-dir ~/models/qwen3-embedding-0.6b
```

### 4. 앱 첫 실행 → Settings
- `llama-server 바이너리 경로` 입력
- `모델 디렉토리` 추가 (GGUF 가 있는 폴더)
- 기본 n_ctx / max_tokens 조정
- (선택) Title·임베딩 사이드카: 다운로드 버튼 또는 경로 입력 후 enable
- (선택) 웹 검색: Tavily 가입 → API key
- **저장** → **Models** 에서 Load → **Chat**

---

## 개발 (소스에서 실행)

### 환경 요구

| 항목 | 권장 |
|---|---|
| OS | Linux / Windows (둘 다 CI 빌드됨) |
| Node | LTS (22+) — nvm 권장 |
| Python | 3.10+ |
| `uv` | 최신 |
| GPU | NVIDIA CUDA (옵션 — CPU only 도 동작) |

### 셋업

```bash
# 사전 도구
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.nvm/nvm.sh && nvm install --lts && corepack enable && corepack prepare pnpm@latest --activate
curl -LsSf https://astral.sh/uv/install.sh | sh

# 클론 + 의존성
git clone https://github.com/caterpillar321/GeneralChat ~/GeneralChat
cd ~/GeneralChat/server && uv sync
cd ../desktop && pnpm install

# 실행
pnpm dev
# pnpm 의 build-script 정책으로 막히면:
./node_modules/.bin/electron-vite dev
```

### 패키지 빌드

로컬 빌드:
```bash
# 1) Python 사이드카 (PyInstaller)
cd server && uv run pyinstaller generalchat-server.spec --clean --noconfirm
# 2) Electron + 인스톨러
cd ../desktop && pnpm build && ./node_modules/.bin/electron-builder --linux   # 또는 --win
```

CI 로 빌드/릴리즈 (권장):
```bash
git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z
# .github/workflows/build.yml 이 Linux+Windows 빌드 → GitHub Release 자동 생성
```

---

## 트러블슈팅

### Windows SmartScreen 경고
코드 서명 미적용 → "Windows의 PC 보호" 화면. **추가 정보 → 실행**.

### mmproj 로드 실패 `unknown projector type: ...`
llama.cpp 가 그 모델의 projector 를 모름 (구버전). llama.cpp 업데이트, 또는 Load
다이얼로그에서 **vision 활성화 OFF** 로 텍스트 전용 로드.

### `error while handling argument "-fa": expected value`
최신 llama.cpp 는 `-fa` 가 `on|off|auto` 값을 요구. 본 앱은 자동 처리.

### 이미지 첨부 "Failed to load image"
WEBP/HEIC 등. 본 앱이 canvas 로 PNG 정규화하므로 정상이어야 함. `Ctrl+R` 후 재시도.

### GPU 절반만 사용 (속도 저하)
VRAM 부족으로 일부 layer 가 CPU 로 오버플로된 것. 양자화 한 단계 낮추거나
(Q6→Q4_K_M), KV 프리셋을 `Q8_0/Q8_0 + FA` 로, 또는 n_ctx 줄이기.

### KV cache 비대칭으로 NaN/assert
V 캐시 양자화 시 flash-attn 필수 (자동 토글). 깨지면 프리셋 `Safe (F16/F16)`.

### 사이드카 spawn 안 됨 / 로그 확인
- 메인 모델: `curl http://127.0.0.1:8081/health` (포트는 Settings default_port)
- 백엔드: `curl http://127.0.0.1:8765/health`
- 로그: `~/.cache/generalchat/log/llama-server-{main|title|embedding}.log`

### `pnpm dev` 가 ERR_PNPM_IGNORED_BUILDS
`pnpm-workspace.yaml` 의 `allowBuilds` 모든 항목 `true`, `verifyDepsBeforeRun: false`.

---

## 데이터 위치

| 데이터 | Linux | Windows |
|---|---|---|
| 설정 (config.json) | `~/.config/generalchat/` | `%APPDATA%\generalchat\` |
| DB (대화·메시지·문서·청크) | `~/.local/share/generalchat/db.sqlite` | `%LOCALAPPDATA%\generalchat\db.sqlite` |
| 첨부 문서 사본 | `~/.local/share/generalchat/documents/` | `%LOCALAPPDATA%\generalchat\documents\` |
| 다운받은 사이드카 모델 | `~/.local/share/generalchat/models/sidecar/` | `%LOCALAPPDATA%\generalchat\models\sidecar\` |
| 로그 | `~/.cache/generalchat/log/` | `%LOCALAPPDATA%\generalchat\log\` |

> 앱 업데이트(재설치)는 binary 만 교체하며 위 사용자 데이터는 보존됩니다.
> DB 스키마는 자동 마이그레이션.

## 로드맵 / 미완

- 첫 실행 onboarding wizard (현재는 Settings 안내 카드)
- MCP 서버 연결 / 외부 도구 확장
- 코드 서명 (Windows SmartScreen 제거)
- 풀 자동 업데이트 (현재는 알림 → 수동 재설치)

## 라이선스

(미정)
