# GeneralChat

엔지니어와 로컬 모델 애호가를 위한 LLM 챗봇 데스크톱 앱.

llama.cpp 기반의 로컬 추론, 대화 단위 RAG (PDF/DOCX/PPTX), 웹 검색 tool calling,
이미지 첨부, 멀티 모델 비교 — 한 번에.

> 현재는 **개발 모드 실행** 만 지원합니다 (electron-builder 패키징 미완).
> 본인 머신·엔지니어 친구 셋업 정도가 적정선이고, 일반 사용자 배포는 아직 이름.

## 주요 기능

- **채팅**: 스트리밍, 마크다운, KaTeX 수식, syntax highlighting, reasoning(CoT) 분리
- **모델 관리**: GGUF 자동 스캔, 양자화/멀티파트/mmproj 인식, 가족별 그룹화
- **vision**: mmproj 자동 매칭, 이미지 드래그/붙여넣기 (PNG 정규화 + 1568px 리사이즈),
  vision 가능 가족 화이트리스트 (Gemma 3/4, Qwen-VL, Devstral 2, Magistral 2, Pixtral 등)
- **KV cache 컨트롤**: F16/Q8_0/Q4_0 프리셋, V 양자화 시 flash-attn 강제, 비대칭 경고
- **mmproj GPU/CPU 오프로드** 토글 (default CPU)
- **자동 제목**: CPU 사이드카 (Gemma 4 E2B 등) — 메인 KV cache 무손상
- **웹 검색**: Tavily provider, multi-round tool calling, 출처 popover
- **대화 단위 RAG**: PDF/DOCX/PPTX 첨부 → 청킹 → 임베딩 사이드카 (Qwen3-Embedding-0.6B)
  → sqlite-vec → search\_documents tool 자동 활성. 출처 [N] 호버시 미리보기
- **인용 추적**: 답변 본문 [1] [2] → CitationBadge (Floating UI), 클릭으로 popover
- **대화 영속**: SQLite (`~/.local/share/generalchat/db.sqlite`), 사이드바 그룹화

## 환경 요구

| 항목 | 권장 |
|---|---|
| OS | Linux (테스트됨), macOS/Windows 미테스트 |
| Node | LTS (22+) — `nvm install --lts` 권장 |
| Python | 3.10+ |
| `uv` (Python 패키지 매니저) | 최신 |
| GPU | NVIDIA CUDA (옵션 — CPU only도 동작) |
| llama.cpp | 직접 빌드 (`llama-server` 바이너리 필요) |
| 디스크 | 모델 가중치 별도 (수십 GB) |

## 셋업

### 1. 사전 도구

```bash
# Node (nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.nvm/nvm.sh
nvm install --lts
corepack enable
corepack prepare pnpm@latest --activate

# uv (Python 패키지 매니저)
curl -LsSf https://astral.sh/uv/install.sh | sh

# huggingface-cli (모델 다운로드용)
uv tool install huggingface-hub  # 또는 pip install -U huggingface_hub
```

### 2. llama.cpp 빌드

```bash
git clone https://github.com/ggml-org/llama.cpp ~/llama.cpp
cd ~/llama.cpp
cmake -B build -DGGML_CUDA=ON   # CPU only면 -DGGML_CUDA 빼기
cmake --build build --config Release -j
# llama-server 바이너리: ~/llama.cpp/build/bin/llama-server
```

### 3. 모델 가중치

```bash
# 메인 모델 예시 (필요 한 가지 골라 받기)
hf download bartowski/google_gemma-4-31B-it-GGUF \
  --include "google_gemma-4-31B-it-Q6_K.gguf" \
  --local-dir ~/models/gemma-4-31b

# Vision 활성화 (Gemma 4 31B 의 mmproj — 비전 인코더는 BF16 권장)
hf download bartowski/google_gemma-4-31B-it-GGUF \
  --include "mmproj-google_gemma-4-31B-it-bf16.gguf" \
  --local-dir ~/models/gemma-4-31b

# Title 사이드카 모델 (CPU)
hf download bartowski/google_gemma-4-E2B-it-GGUF \
  --include "google_gemma-4-E2B-it-Q4_K_M.gguf" \
  --local-dir ~/models/gemma-4-E2B

# RAG 임베딩 사이드카 모델 (CPU)
hf download Qwen/Qwen3-Embedding-0.6B-GGUF \
  --include "Qwen3-Embedding-0.6B-Q8_0.gguf" \
  --local-dir ~/models/qwen3-embedding-0.6b
```

### 4. 저장소 클론 & 의존성

```bash
git clone <이 저장소> ~/GeneralChat
cd ~/GeneralChat

# Python 의존성
cd server
uv sync   # 또는 자동: 첫 실행 시 uv run 이 의존성 설치

# Node 의존성
cd ../desktop
pnpm install
```

`pnpm install` 시 build script 승인 경고가 뜨면 `pnpm-workspace.yaml` 의 `allowBuilds`
에 `electron`, `electron-winstaller`, `esbuild` 가 모두 `true` 인지 확인.

### 5. 실행

```bash
cd desktop
pnpm dev
# 또는 (pnpm 의 deps-status-check 우회 필요한 경우):
./node_modules/.bin/electron-vite dev
```

Electron 메인이 자동으로 Python FastAPI 사이드카(`uv run uvicorn`)를 spawn 합니다.

### 6. 첫 실행 셋업 (앱 안)

1. **Settings** → 다음을 입력:
   - `llama-server 바이너리 경로`: `~/llama.cpp/build/bin/llama-server`
   - `모델 디렉토리`: `~/models` 추가
   - `기본 n_ctx`: 32768 정도
   - **Title 사이드카 (CPU)**: enable + `~/models/gemma-4-E2B/google_gemma-4-E2B-it-Q4_K_M.gguf`
   - **임베딩 사이드카 (RAG, CPU)**: enable + `~/models/qwen3-embedding-0.6b/Qwen3-Embedding-0.6B-Q8_0.gguf`
   - **웹 검색** (옵션): Tavily 가입 → API key 입력
   - **저장**
2. **Models** 페이지 → 모델 카드 → **Load** → KV 프리셋 선택 → 시작
3. **Chat** → 사용

## 트러블슈팅

### `pnpm dev` 가 ERR\_PNPM\_IGNORED\_BUILDS 로 멈춤
`pnpm-workspace.yaml` 의 `allowBuilds` 모든 항목을 `true` 로:
```yaml
allowBuilds:
  electron: true
  electron-winstaller: true
  esbuild: true
verifyDepsBeforeRun: false
```

### `Electron uninstall` 에러
Electron 본체 다운로드가 누락된 상태:
```bash
node desktop/node_modules/electron/install.js
```

### `error while handling argument "-fa": expected value`
최신 llama.cpp 는 `-fa` 가 값(`on`|`off`|`auto`)을 요구. 본 앱은 자동으로 처리하지만,
직접 spawn 명령을 검증해보려면 `~/.cache/generalchat/log/llama-server-main.log` 확인.

### "Failed to load image or audio file" (이미지 첨부 시)
WEBP/HEIC 등 stb\_image 미지원 포맷. 본 앱은 canvas로 PNG 정규화하므로 정상이어야 함.
`Ctrl+R` 로 한 번 새로고침 후 재시도.

### 사이드카 spawn 안 됨
- 메인 모델 살아있는지: `curl http://127.0.0.1:8081/health` (포트는 Settings 의 default\_port)
- 백엔드 살아있는지: `curl http://127.0.0.1:8765/health`
- 사이드카 로그: `~/.cache/generalchat/log/llama-server-{main|title|embedding}.log`

### 임베딩 사이드카 첫 호출 시 ~10-30초 멈춤
정상 — Q8\_0 0.6B 모델 CPU 로드 시간. 두 번째 호출부터는 즉시.

### conversation 삭제 후 URL stale
앱이 자동으로 `/chat` 으로 redirect 합니다. 그래도 이상하면 `Home` 클릭 후 다시 시도.

### KV cache 비대칭으로 NaN/assert
V 캐시를 양자화(Q\*)면 `--flash-attn` 필수. 본 앱은 자동 토글하지만 일부 모델·llama.cpp
조합에선 깨질 수 있음 — 그럴 땐 KV 프리셋 "Safe (F16/F16)" 로.

## 데이터 위치

| 데이터 | 위치 |
|---|---|
| SQLite DB (대화·메시지·문서·청크) | `~/.local/share/generalchat/db.sqlite` |
| 첨부 문서 사본 | `~/.local/share/generalchat/documents/{conv_id}/...` |
| 앱 설정 (config.json) | `~/.config/generalchat/config.json` |
| llama-server 로그 (main/title/embedding) | `~/.cache/generalchat/log/llama-server-*.log` |

## 라이선스

(아직 미정)
