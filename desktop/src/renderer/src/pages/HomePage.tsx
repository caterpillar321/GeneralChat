import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getConfig, type AppConfig } from '../lib/api'

export default function HomePage(): React.JSX.Element {
  const [cfg, setCfg] = useState<AppConfig | null>(null)

  useEffect(() => {
    getConfig()
      .then(setCfg)
      .catch(() => setCfg(null))
  }, [])

  const isConfigured = cfg && cfg.llama_server_path && cfg.model_dirs.length > 0

  return (
    <div className="p-8 max-w-3xl">
      <h2 className="text-2xl font-semibold mb-6">GeneralChat</h2>

      {cfg === null ? (
        <div className="rounded border border-zinc-800 bg-zinc-900 p-4 mb-6 text-sm text-zinc-400">
          Loading config…
        </div>
      ) : !isConfigured ? (
        <div className="rounded border border-amber-700 bg-amber-950/40 p-4 mb-6">
          <p className="text-sm text-amber-200 mb-1 font-medium">아직 설정되지 않았습니다.</p>
          <p className="text-xs text-amber-300/80">
            Settings에서 llama-server 경로와 모델 디렉토리를 등록하세요.
          </p>
          <Link
            to="/settings"
            className="inline-block mt-3 px-3 py-1.5 text-sm rounded bg-amber-700 hover:bg-amber-600"
          >
            Settings 열기
          </Link>
        </div>
      ) : (
        <div className="rounded border border-emerald-700 bg-emerald-950/40 p-4 mb-6">
          <p className="text-sm text-emerald-200 mb-1 font-medium">설정 완료.</p>
          <p className="text-xs text-emerald-300/80">모델 목록을 확인하세요.</p>
          <Link
            to="/models"
            className="inline-block mt-3 px-3 py-1.5 text-sm rounded bg-emerald-700 hover:bg-emerald-600"
          >
            Models 열기
          </Link>
        </div>
      )}

      <section className="rounded border border-zinc-800 p-4 text-sm text-zinc-400">
        <h3 className="text-zinc-200 font-medium mb-2">개발 진척</h3>
        <ul className="space-y-1 list-disc list-inside text-xs">
          <li>Electron + React + TS + Tailwind: 동작 중</li>
          <li>Python FastAPI 사이드카: 동작 중</li>
          <li>설정 영속화 + 모델 스캐너: 구현됨</li>
          <li>llama-server 라이프사이클: 다음 단계</li>
          <li>채팅 / 첨부 / 웹서치 / RAG / MCP: 후속 단계</li>
        </ul>
      </section>
    </div>
  )
}
