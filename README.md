# GeneralChat

엔지니어와 로컬 모델 애호가를 위한 LLM 챗봇 데스크톱 앱.

## 구조

```
GeneralChat/
├── desktop/   Electron + React + TypeScript (UI 셸)
└── server/    Python FastAPI (비즈니스 로직, llama-server 관리)
```

## 사전 요구

- Node.js LTS, pnpm
- Python 3.10+, uv
- llama.cpp 빌드 (`llama-server` 바이너리)

## 개발

```bash
# 데스크톱 앱 (Electron이 Python 사이드카를 직접 spawn)
cd desktop && pnpm dev
```

`pnpm dev`가 pnpm 10의 build-script 정책 때문에 막히면 `pnpm-workspace.yaml`에서
`allowBuilds`의 모든 항목이 `true`인지 확인하세요. 임시 우회는 직접 호출:
```bash
cd desktop && ./node_modules/.bin/electron-vite dev
```

백엔드만 따로 띄우려면:
```bash
cd server && uv run uvicorn app.main:app --reload --port 8765
```

## 설정 파일

`~/.config/generalchat/config.json` (Linux). UI Settings 페이지에서 편집.
