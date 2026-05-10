import { useEffect, useMemo, useState } from 'react'
import { listModels, rescanModels, type ModelEntry } from '../lib/api'
import ModelLoadDialog from '../components/ModelLoadDialog'
import { useLlamaStatus } from '../hooks/useLlamaStatus'

export default function ModelsPage(): React.JSX.Element {
  const [models, setModels] = useState<ModelEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ModelEntry | null>(null)
  const llama = useLlamaStatus()

  useEffect(() => {
    listModels()
      .then(setModels)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const rescan = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const r = await rescanModels()
      setModels(r)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    if (!models) return null
    if (!query.trim()) return models
    const q = query.toLowerCase()
    return models.filter(
      (m) =>
        m.display_name.toLowerCase().includes(q) ||
        m.family.toLowerCase().includes(q) ||
        (m.quant?.toLowerCase().includes(q) ?? false)
    )
  }, [models, query])

  const groupedByFamily = useMemo(() => {
    if (!filtered) return null
    const map = new Map<string, ModelEntry[]>()
    for (const m of filtered) {
      if (!map.has(m.family)) map.set(m.family, [])
      map.get(m.family)!.push(m)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  return (
    <div className="p-8 max-w-5xl h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Models</h2>
        <div className="flex items-center gap-2">
          {models && (
            <span className="text-xs text-zinc-500">
              {filtered?.length ?? 0} / {models.length}
            </span>
          )}
          <button
            onClick={rescan}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
          >
            {loading ? '스캔 중…' : '다시 스캔'}
          </button>
        </div>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="이름·가족·양자화 검색…"
        className="w-full mb-6 px-3 py-2 rounded border border-zinc-800 bg-zinc-900 text-sm focus:outline-none focus:border-zinc-600"
      />

      {error && (
        <div className="rounded border border-rose-700 bg-rose-950/40 p-3 text-sm text-rose-200 mb-4">
          {error}
        </div>
      )}

      {loading && !models && <p className="text-zinc-500 text-sm">Loading…</p>}

      {models && models.length === 0 && (
        <p className="text-zinc-500 text-sm">
          등록된 디렉토리가 없거나 GGUF 파일을 못 찾았습니다. Settings에서 디렉토리를 추가하세요.
        </p>
      )}

      {groupedByFamily?.map(([family, items]) => (
        <section key={family} className="mb-8">
          <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-3">
            {family} <span className="text-zinc-700">·</span> {items.length}
          </h3>
          <div className="space-y-2">
            {items.map((m) => (
              <ModelCard
                key={m.id + m.main_file}
                model={m}
                onLoad={() => setSelected(m)}
                isLoaded={llama?.status === 'running' && llama.model_id === m.id}
              />
            ))}
          </div>
        </section>
      ))}

      {selected && (
        <ModelLoadDialog model={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

function ModelCard({
  model,
  onLoad,
  isLoaded
}: {
  model: ModelEntry
  onLoad: () => void
  isLoaded: boolean
}): React.JSX.Element {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3 hover:border-zinc-700 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="font-medium text-zinc-100 truncate">{model.display_name}</span>
          {model.is_vision && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-violet-900/50 text-violet-300 shrink-0">
              🖼 vision
            </span>
          )}
          {!model.is_vision && model.can_be_vision && (
            <span
              className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0 border border-zinc-700"
              title="이 모델 가족은 vision 가능. mmproj GGUF를 같은 폴더에 두면 활성화됨."
            >
              📷 vision possible — mmproj 필요
            </span>
          )}
          {model.parts.length > 1 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300 shrink-0">
              {model.parts.length} parts
            </span>
          )}
          {isLoaded && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300 shrink-0">
              loaded
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-zinc-500">
            {model.total_size_bytes < 1024 ** 3
              ? (model.total_size_bytes / 1024 ** 2).toFixed(0) + ' MB'
              : (model.total_size_bytes / 1024 ** 3).toFixed(2) + ' GB'}
          </span>
          <button
            onClick={onLoad}
            disabled={isLoaded}
            className="px-3 py-1 text-xs rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
          >
            {isLoaded ? 'Loaded' : 'Load'}
          </button>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-xs">
        {model.params && <span className="text-zinc-300 font-medium">{model.params}</span>}
        {model.quant && (
          <span className="text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800/80">
            {model.quant}
          </span>
        )}
        <span className="font-mono text-zinc-600 truncate">{model.main_file}</span>
      </div>
    </div>
  )
}
