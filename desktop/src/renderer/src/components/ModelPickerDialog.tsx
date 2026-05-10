import { useEffect, useRef, useState } from 'react'
import {
  cancelDownload,
  getDownload,
  startDownload,
  type DownloadEntry,
  type DownloadKind
} from '../lib/api'

export type CatalogItem = {
  name: string
  repo: string
  filename: string
  size_bytes: number
  notes?: string
  license?: string
  recommended?: boolean
  /** 임베딩 모델 차원 (사이드카 차원 자동 설정용) */
  dim?: number
}

const TITLE_CATALOG: CatalogItem[] = [
  {
    name: 'Qwen 2.5 0.5B Instruct (Q8_0)',
    repo: 'bartowski/Qwen2.5-0.5B-Instruct-GGUF',
    filename: 'Qwen2.5-0.5B-Instruct-Q8_0.gguf',
    size_bytes: 530 * 1024 * 1024,
    license: 'Apache 2.0',
    recommended: true,
    notes: '한국어 OK, 가장 가벼움. 첫 사용자 추천'
  },
  {
    name: 'Qwen 2.5 1.5B Instruct (Q8_0)',
    repo: 'bartowski/Qwen2.5-1.5B-Instruct-GGUF',
    filename: 'Qwen2.5-1.5B-Instruct-Q8_0.gguf',
    size_bytes: 1.7 * 1024 * 1024 * 1024,
    license: 'Apache 2.0',
    notes: '품질 ↑, 사이즈 1.7GB'
  },
  {
    name: 'Gemma 4 E2B Instruct (Q8_0)',
    repo: 'bartowski/google_gemma-4-E2B-it-GGUF',
    filename: 'google_gemma-4-E2B-it-Q8_0.gguf',
    size_bytes: 4.6 * 1024 * 1024 * 1024,
    license: 'Gemma TOS',
    notes: '품질 최상, 4.6GB. Gemma TOS 적용'
  }
]

const EMBEDDING_CATALOG: CatalogItem[] = [
  {
    name: 'Qwen3-Embedding 0.6B (Q8_0)',
    repo: 'Qwen/Qwen3-Embedding-0.6B-GGUF',
    filename: 'Qwen3-Embedding-0.6B-Q8_0.gguf',
    size_bytes: 610 * 1024 * 1024,
    license: 'Apache 2.0',
    dim: 1024,
    recommended: true,
    notes: '한국어 ★, 1024차원. 1순위'
  },
  {
    name: 'Qwen3-Embedding 0.6B (F16)',
    repo: 'Qwen/Qwen3-Embedding-0.6B-GGUF',
    filename: 'Qwen3-Embedding-0.6B-f16.gguf',
    size_bytes: 1.1 * 1024 * 1024 * 1024,
    license: 'Apache 2.0',
    dim: 1024,
    notes: '정확도 살짝 ↑, 사이즈 2배'
  }
]

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(0) + ' MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

type Props = {
  kind: DownloadKind
  onClose: () => void
  /** 다운로드 완료 시 부모에게 통보 (path + dim) */
  onDone: (path: string, item: CatalogItem) => void
}

export default function ModelPickerDialog({ kind, onClose, onDone }: Props): React.JSX.Element {
  const catalog = kind === 'embedding' ? EMBEDDING_CATALOG : TITLE_CATALOG
  const [selected, setSelected] = useState<CatalogItem | null>(
    catalog.find((c) => c.recommended) ?? catalog[0] ?? null
  )
  const [download, setDownload] = useState<DownloadEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current)
    }
  }, [])

  const start = async (): Promise<void> => {
    if (!selected) return
    setError(null)
    try {
      const entry = await startDownload(selected.repo, selected.filename, kind)
      setDownload(entry)

      if (entry.status === 'done' && entry.local_path) {
        // 이미 받았던 파일 — 즉시 완료
        onDone(entry.local_path, selected)
        onClose()
        return
      }

      // 진행률 폴링
      pollTimer.current = window.setInterval(async () => {
        try {
          const cur = await getDownload(entry.id)
          setDownload(cur)
          if (cur.status === 'done' && cur.local_path) {
            window.clearInterval(pollTimer.current!)
            pollTimer.current = null
            onDone(cur.local_path, selected)
            onClose()
          } else if (cur.status === 'error') {
            window.clearInterval(pollTimer.current!)
            pollTimer.current = null
            setError(cur.error ?? '다운로드 실패')
          } else if (cur.status === 'cancelled') {
            window.clearInterval(pollTimer.current!)
            pollTimer.current = null
            setError('취소됨')
          }
        } catch (e) {
          // 일시 단절은 무시
        }
      }, 500)
    } catch (e) {
      setError(String(e))
    }
  }

  const cancel = async (): Promise<void> => {
    if (!download) return
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current)
      pollTimer.current = null
    }
    try {
      await cancelDownload(download.id)
    } catch {
      /* ignore */
    }
    setDownload(null)
  }

  const isDownloading =
    download && (download.status === 'pending' || download.status === 'downloading')
  const pct =
    download && download.bytes_total > 0
      ? Math.floor((download.bytes_downloaded / download.bytes_total) * 100)
      : 0

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={isDownloading ? undefined : onClose}
    >
      <div
        className="w-full max-w-xl rounded-lg border border-zinc-800 bg-zinc-950 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold mb-1">
          {kind === 'embedding' ? '임베딩 모델' : '제목 생성 모델'} 다운로드
        </h3>
        <p className="text-xs text-zinc-500 mb-4">
          HuggingFace 에서 직접 다운로드. 받은 후 자동으로 사이드카 경로에 적용됩니다.
        </p>

        <div className="space-y-2 mb-4">
          {catalog.map((item) => (
            <label
              key={item.repo + item.filename}
              className={`flex items-start gap-2 p-3 rounded border cursor-pointer transition-colors ${
                selected === item
                  ? 'border-emerald-700 bg-emerald-950/30'
                  : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
              }`}
            >
              <input
                type="radio"
                checked={selected === item}
                onChange={() => setSelected(item)}
                disabled={!!isDownloading}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-zinc-100">{item.name}</span>
                  {item.recommended && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300">
                      추천
                    </span>
                  )}
                  <span className="text-[11px] text-zinc-500">
                    {formatBytes(item.size_bytes)}
                  </span>
                  {item.dim != null && (
                    <span className="text-[11px] text-zinc-500">{item.dim}d</span>
                  )}
                </div>
                {item.notes && (
                  <div className="text-[11px] text-zinc-400 mt-0.5">{item.notes}</div>
                )}
                <div className="text-[10px] text-zinc-600 mt-0.5 font-mono truncate">
                  {item.repo}/{item.filename}
                  {item.license ? ` · ${item.license}` : ''}
                </div>
              </div>
            </label>
          ))}
        </div>

        {download && (
          <div className="mb-3">
            <div className="text-xs text-zinc-400 mb-1 flex justify-between">
              <span>{download.status}</span>
              <span>
                {formatBytes(download.bytes_downloaded)}
                {download.bytes_total > 0 && (
                  <>
                    {' / '}
                    {formatBytes(download.bytes_total)} ({pct}%)
                  </>
                )}
              </span>
            </div>
            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-emerald-600 transition-all"
                style={{ width: download.bytes_total > 0 ? `${pct}%` : '20%' }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded border border-rose-700 bg-rose-950/40 p-2 text-xs text-rose-200 mb-3">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {isDownloading ? (
            <button
              onClick={cancel}
              className="px-4 py-2 text-sm rounded bg-rose-700 hover:bg-rose-600"
            >
              취소
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded bg-zinc-800 hover:bg-zinc-700"
              >
                닫기
              </button>
              <button
                onClick={start}
                disabled={!selected}
                className="px-5 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 font-medium"
              >
                다운로드
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
