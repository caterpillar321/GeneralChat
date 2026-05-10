import { useEffect, useState } from 'react'
import { getConfig, saveConfig, discoverDefaults, type AppConfig } from '../lib/api'

export default function SettingsPage(): React.JSX.Element {
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [discovered, setDiscovered] = useState<{ llama_server_path: string | null } | null>(null)
  const [newDir, setNewDir] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getConfig().then(setCfg).catch((e) => setError(String(e)))
    discoverDefaults().then(setDiscovered).catch(() => {})
  }, [])

  if (!cfg) {
    return (
      <div className="p-8 text-sm text-zinc-500">
        {error ? <span className="text-rose-400">{error}</span> : 'Loading…'}
      </div>
    )
  }

  const update = (patch: Partial<AppConfig>): void => setCfg({ ...cfg, ...patch })

  const addDir = (): void => {
    const trimmed = newDir.trim()
    if (!trimmed) return
    if (cfg.model_dirs.includes(trimmed)) {
      setNewDir('')
      return
    }
    update({ model_dirs: [...cfg.model_dirs, trimmed] })
    setNewDir('')
  }

  const removeDir = (d: string): void =>
    update({ model_dirs: cfg.model_dirs.filter((x) => x !== d) })

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const updated = await saveConfig(cfg)
      setCfg(updated)
      setSavedAt(new Date())
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl h-full overflow-y-auto">
      <h2 className="text-2xl font-semibold mb-6">Settings</h2>

      {error && (
        <div className="rounded border border-rose-700 bg-rose-950/40 p-3 text-sm text-rose-200 mb-4">
          {error}
        </div>
      )}

      <section className="mb-8">
        <label className="block text-sm font-medium mb-2">llama-server 바이너리 경로</label>
        <input
          type="text"
          value={cfg.llama_server_path ?? ''}
          onChange={(e) => update({ llama_server_path: e.target.value || null })}
          placeholder={discovered?.llama_server_path ?? '/path/to/llama-server'}
          className="w-full px-3 py-2 rounded border border-zinc-800 bg-zinc-900 text-sm font-mono focus:outline-none focus:border-zinc-600"
        />
        {discovered?.llama_server_path &&
          cfg.llama_server_path !== discovered.llama_server_path && (
            <button
              type="button"
              onClick={() =>
                update({ llama_server_path: discovered.llama_server_path })
              }
              className="mt-2 text-xs text-emerald-400 hover:text-emerald-300"
            >
              ↳ 발견된 경로 사용: {discovered.llama_server_path}
            </button>
          )}
      </section>

      <section className="mb-8">
        <label className="block text-sm font-medium mb-2">
          모델 디렉토리 (.gguf 파일이 있는 폴더)
        </label>
        <div className="space-y-2 mb-3">
          {cfg.model_dirs.length === 0 && (
            <p className="text-xs text-zinc-500 italic">등록된 디렉토리 없음</p>
          )}
          {cfg.model_dirs.map((d) => (
            <div
              key={d}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded border border-zinc-800 bg-zinc-900 text-sm"
            >
              <span className="font-mono text-zinc-300 truncate">{d}</span>
              <button
                onClick={() => removeDir(d)}
                className="text-xs text-rose-400 hover:text-rose-300 shrink-0"
              >
                제거
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newDir}
            onChange={(e) => setNewDir(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addDir()}
            placeholder="/home/user/models"
            className="flex-1 px-3 py-2 rounded border border-zinc-800 bg-zinc-900 text-sm font-mono focus:outline-none focus:border-zinc-600"
          />
          <button
            onClick={addDir}
            className="px-4 py-2 text-sm rounded bg-zinc-800 hover:bg-zinc-700"
          >
            추가
          </button>
        </div>
      </section>

      <section className="mb-8 grid grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium mb-2">llama-server 기본 포트</label>
          <input
            type="number"
            value={cfg.default_port}
            onChange={(e) => update({ default_port: Number(e.target.value) || 8081 })}
            className="w-32 px-3 py-2 rounded border border-zinc-800 bg-zinc-900 text-sm focus:outline-none focus:border-zinc-600"
          />
          <p className="mt-1 text-xs text-zinc-500">llama.cpp가 띄울 포트. 우리 백엔드(8765)와 다른 값.</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">기본 n_ctx (context size)</label>
          <input
            type="number"
            value={cfg.default_n_ctx}
            min={512}
            step={1024}
            onChange={(e) => update({ default_n_ctx: Number(e.target.value) || 32768 })}
            className="w-32 px-3 py-2 rounded border border-zinc-800 bg-zinc-900 text-sm focus:outline-none focus:border-zinc-600"
          />
          <p className="mt-1 text-xs text-zinc-500">
            새 모델 로드 시 다이얼로그에 채워질 디폴트.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">기본 max_tokens (응답 길이)</label>
          <input
            type="number"
            value={cfg.default_max_tokens}
            min={128}
            step={512}
            onChange={(e) =>
              update({ default_max_tokens: Number(e.target.value) || 8192 })
            }
            className="w-32 px-3 py-2 rounded border border-zinc-800 bg-zinc-900 text-sm focus:outline-none focus:border-zinc-600"
          />
          <p className="mt-1 text-xs text-zinc-500">
            한 응답 생성 토큰 상한. 깊이 있는 답을 원하면 8192~16384.
          </p>
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm font-medium mb-2">
            <input
              type="checkbox"
              checked={cfg.default_mmproj_offload_to_gpu}
              onChange={(e) =>
                update({ default_mmproj_offload_to_gpu: e.target.checked })
              }
            />
            mmproj 기본 GPU 오프로드
          </label>
          <p className="mt-1 text-xs text-zinc-500">
            OFF (기본): 비전 인코더를 CPU에서 실행 (VRAM 절약). ON: GPU 사용 (빠름, VRAM↑).
            Models Load 다이얼로그에서 모델별로 또 조정 가능.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <label className="block text-sm font-medium mb-2">대화 제목 자동 생성 방식</label>
        <select
          value={cfg.title_strategy}
          onChange={(e) =>
            update({ title_strategy: e.target.value as 'auto' | 'truncate' | 'manual' })
          }
          className="w-full max-w-md px-3 py-2 rounded border border-zinc-800 bg-zinc-900 text-sm focus:outline-none focus:border-zinc-600"
        >
          <option value="auto">Auto — LLM 호출 (사이드카 우선, 메인 폴백)</option>
          <option value="truncate">Truncate — 첫 메시지 앞 30자 자르기 (LLM 호출 없음)</option>
          <option value="manual">Manual — 자동 안 함 (직접 입력)</option>
        </select>
        <p className="mt-1 text-xs text-zinc-500">
          Auto + 사이드카가 가장 깔끔. Auto 실패 시 자동으로 Truncate 폴백.
        </p>
      </section>

      <section className="mb-8 rounded border border-zinc-800 p-4 bg-zinc-900/40">
        <h3 className="text-sm font-medium mb-1">웹 검색</h3>
        <p className="text-xs text-zinc-500 mb-3">
          채팅 입력창의 🌐 버튼을 켜면 마지막 메시지를 쿼리로 검색해 결과를 LLM에 전달합니다.
        </p>

        <label className="block text-xs text-zinc-400 mb-1">Provider</label>
        <select
          value={cfg.search_provider}
          onChange={(e) =>
            update({
              search_provider: e.target.value as
                | 'none'
                | 'tavily'
                | 'brave'
                | 'searxng'
                | 'ddg'
            })
          }
          className="w-full max-w-md px-3 py-2 rounded border border-zinc-800 bg-zinc-950 text-sm focus:outline-none focus:border-zinc-600"
        >
          <option value="none">사용 안 함</option>
          <option value="tavily">Tavily — 가입 + API key, 1000/월 무료, AI 친화</option>
          <option value="brave" disabled>
            Brave Search — 추후 (가입 + API key, 2000/월 무료)
          </option>
          <option value="searxng" disabled>
            SearXNG — 추후 (셀프호스트 또는 공개 인스턴스)
          </option>
          <option value="ddg" disabled>DuckDuckGo — 추후</option>
        </select>

        {cfg.search_provider === 'tavily' && (
          <div className="mt-3">
            <label className="block text-xs text-zinc-400 mb-1">Tavily API key</label>
            <input
              type="password"
              value={cfg.search_tavily_api_key ?? ''}
              onChange={(e) =>
                update({ search_tavily_api_key: e.target.value || null })
              }
              placeholder="tvly-..."
              className="w-full px-3 py-2 rounded border border-zinc-800 bg-zinc-950 text-xs font-mono focus:outline-none focus:border-zinc-600"
            />
            <p className="text-[11px] text-zinc-600 mt-1">
              <a
                href="https://app.tavily.com/"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 hover:underline"
              >
                tavily.com
              </a>{' '}
              에서 가입 후 API keys 페이지에서 받기. 평문으로 config.json 에 저장됨.
            </p>
          </div>
        )}

        <div className="mt-3 max-w-xs">
          <label className="block text-xs text-zinc-400 mb-1">최대 결과 수</label>
          <input
            type="number"
            value={cfg.search_max_results}
            min={1}
            max={20}
            onChange={(e) =>
              update({ search_max_results: Number(e.target.value) || 5 })
            }
            className="w-24 px-2 py-1.5 rounded border border-zinc-800 bg-zinc-950 text-xs"
          />
        </div>
      </section>

      <section className="mb-8 rounded border border-zinc-800 p-4 bg-zinc-900/40">
        <h3 className="text-sm font-medium mb-1">임베딩 사이드카 (RAG, CPU)</h3>
        <p className="text-xs text-zinc-500 mb-3">
          PDF/DOCX/PPTX 첨부 시 청크별 벡터 임베딩에 사용. 별도 작은 GGUF 모델을 CPU 로 띄움.
          첫 호출 시 lazy spawn (~10-30초).
        </p>

        <label className="flex items-center gap-2 mb-3 text-sm">
          <input
            type="checkbox"
            checked={cfg.embedding_sidecar_enabled}
            onChange={(e) => update({ embedding_sidecar_enabled: e.target.checked })}
          />
          사이드카 사용 (RAG 활성화)
        </label>

        <label className="block text-xs text-zinc-400 mb-1">모델 경로 (.gguf)</label>
        <input
          type="text"
          value={cfg.embedding_model_path ?? ''}
          onChange={(e) =>
            update({ embedding_model_path: e.target.value || null })
          }
          placeholder="/home/user/models/qwen3-embedding-0.6b/Qwen3-Embedding-0.6B-Q8_0.gguf"
          className="w-full px-3 py-2 rounded border border-zinc-800 bg-zinc-950 text-xs font-mono focus:outline-none focus:border-zinc-600"
          disabled={!cfg.embedding_sidecar_enabled}
        />
        <p className="text-[11px] text-zinc-600 mt-1">
          추천: <code className="text-zinc-400">Qwen3-Embedding-0.6B Q8_0</code> (1024차원, 한국어 우세).
          다운: <code className="text-zinc-400">hf download Qwen/Qwen3-Embedding-0.6B-GGUF --include &quot;Qwen3-Embedding-0.6B-Q8_0.gguf&quot; --local-dir ~/models/qwen3-embedding-0.6b</code>
        </p>

        <div className="grid grid-cols-4 gap-3 mt-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">포트</label>
            <input
              type="number"
              value={cfg.embedding_sidecar_port}
              onChange={(e) =>
                update({ embedding_sidecar_port: Number(e.target.value) || 8083 })
              }
              disabled={!cfg.embedding_sidecar_enabled}
              className="w-full px-2 py-1.5 rounded border border-zinc-800 bg-zinc-950 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">CPU 스레드</label>
            <input
              type="number"
              value={cfg.embedding_sidecar_n_threads}
              min={1}
              max={64}
              onChange={(e) =>
                update({ embedding_sidecar_n_threads: Number(e.target.value) || 4 })
              }
              disabled={!cfg.embedding_sidecar_enabled}
              className="w-full px-2 py-1.5 rounded border border-zinc-800 bg-zinc-950 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">n_ctx</label>
            <input
              type="number"
              value={cfg.embedding_sidecar_n_ctx}
              min={512}
              step={512}
              onChange={(e) =>
                update({ embedding_sidecar_n_ctx: Number(e.target.value) || 4096 })
              }
              disabled={!cfg.embedding_sidecar_enabled}
              className="w-full px-2 py-1.5 rounded border border-zinc-800 bg-zinc-950 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">embedding 차원</label>
            <input
              type="number"
              value={cfg.embedding_dim}
              onChange={(e) =>
                update({ embedding_dim: Number(e.target.value) || 1024 })
              }
              disabled={!cfg.embedding_sidecar_enabled}
              className="w-full px-2 py-1.5 rounded border border-zinc-800 bg-zinc-950 text-xs"
            />
          </div>
        </div>
        <p className="text-[11px] text-zinc-600 mt-2">
          ⚠ 차원 변경 시 chunks_vec 가상 테이블이 맞지 않으면 새 인덱싱이 실패합니다.
          모델별 차원: Qwen3-Embedding-0.6B = 1024, bge-m3 = 1024, gte-multilingual-base = 768.
        </p>
      </section>

      <section className="mb-8 rounded border border-zinc-800 p-4 bg-zinc-900/40">
        <h3 className="text-sm font-medium mb-1">Title 사이드카 (CPU)</h3>
        <p className="text-xs text-zinc-500 mb-3">
          작은 모델을 CPU로 별도 띄워 자동 제목 생성에 사용. 메인 모델 KV cache에 영향 0.
          첫 호출 시 lazy spawn (모델 로딩 ~1-3초).
        </p>

        <label className="flex items-center gap-2 mb-3 text-sm">
          <input
            type="checkbox"
            checked={cfg.title_sidecar_enabled}
            onChange={(e) => update({ title_sidecar_enabled: e.target.checked })}
          />
          사이드카 사용
        </label>

        <label className="block text-xs text-zinc-400 mb-1">모델 경로 (.gguf)</label>
        <input
          type="text"
          value={cfg.title_sidecar_model_path ?? ''}
          onChange={(e) =>
            update({ title_sidecar_model_path: e.target.value || null })
          }
          placeholder="/home/user/models/gemma-4-E2B-it-Q4_K_M.gguf"
          className="w-full px-3 py-2 rounded border border-zinc-800 bg-zinc-950 text-xs font-mono focus:outline-none focus:border-zinc-600"
          disabled={!cfg.title_sidecar_enabled}
        />
        <p className="text-[11px] text-zinc-600 mt-1">
          추천: Gemma 4 E2B Q4_K_M, Llama 3.2 1B, Qwen 2.5 0.5B 등 작은 instruction 모델.
        </p>

        <div className="grid grid-cols-3 gap-3 mt-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">포트</label>
            <input
              type="number"
              value={cfg.title_sidecar_port}
              onChange={(e) =>
                update({ title_sidecar_port: Number(e.target.value) || 8082 })
              }
              disabled={!cfg.title_sidecar_enabled}
              className="w-full px-2 py-1.5 rounded border border-zinc-800 bg-zinc-950 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">CPU 스레드</label>
            <input
              type="number"
              value={cfg.title_sidecar_n_threads}
              min={1}
              max={64}
              onChange={(e) =>
                update({ title_sidecar_n_threads: Number(e.target.value) || 4 })
              }
              disabled={!cfg.title_sidecar_enabled}
              className="w-full px-2 py-1.5 rounded border border-zinc-800 bg-zinc-950 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">n_ctx</label>
            <input
              type="number"
              value={cfg.title_sidecar_n_ctx}
              min={512}
              step={512}
              onChange={(e) =>
                update({ title_sidecar_n_ctx: Number(e.target.value) || 4096 })
              }
              disabled={!cfg.title_sidecar_enabled}
              className="w-full px-2 py-1.5 rounded border border-zinc-800 bg-zinc-950 text-xs"
            />
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-sm font-medium"
        >
          {saving ? '저장 중…' : '저장'}
        </button>
        {savedAt && (
          <span className="text-xs text-zinc-500">
            마지막 저장: {savedAt.toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  )
}
