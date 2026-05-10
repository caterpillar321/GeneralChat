import { useCallback, useEffect, useState } from 'react'
import { deleteDocument, listDocuments, type Document } from '../lib/api'

type Props = {
  conversationId: string | null
  /** 자료가 한 개라도 ready 면 부모가 알 수 있게 */
  onDocumentsChanged?: (docs: Document[]) => void
}

function formatSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

export default function DocumentsPanel({
  conversationId,
  onDocumentsChanged
}: Props): React.JSX.Element | null {
  const [docs, setDocs] = useState<Document[]>([])
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)

  const refresh = useCallback(async (): Promise<void> => {
    if (!conversationId) {
      setDocs([])
      setError(null)
      onDocumentsChanged?.([])
      return
    }
    try {
      const list = await listDocuments(conversationId)
      setDocs(list)
      setError(null)
      onDocumentsChanged?.(list)
    } catch (e) {
      const msg = String(e)
      // conversation 삭제됐거나 stale URL — 패널 자체를 숨김 (ChatPage 가 redirect 처리)
      if (msg.includes('404')) {
        setDocs([])
        setError(null)
        onDocumentsChanged?.([])
        return
      }
      setError(msg)
    }
  }, [conversationId, onDocumentsChanged])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // indexing 중인 문서가 있으면 폴링
  useEffect(() => {
    if (!conversationId) return
    const hasIndexing = docs.some((d) => d.status === 'indexing')
    if (!hasIndexing) return
    const id = setInterval(refresh, 1500)
    return () => clearInterval(id)
  }, [conversationId, docs, refresh])

  const handleDelete = async (doc: Document): Promise<void> => {
    if (!conversationId) return
    if (!confirm(`"${doc.name}" 삭제할까요?`)) return
    try {
      await deleteDocument(conversationId, doc.id)
      await refresh()
    } catch (e) {
      setError(String(e))
    }
  }

  if (!conversationId && docs.length === 0) return null
  if (docs.length === 0 && !error) return null

  return (
    <div className="mx-6 mt-3 rounded border border-zinc-800 bg-zinc-900/40">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center justify-between text-xs text-zinc-400 hover:text-zinc-200"
      >
        <span className="flex items-center gap-2">
          {expanded ? '▾' : '▸'} 📁 이 대화의 자료 ({docs.length})
        </span>
        {docs.some((d) => d.status === 'indexing') && (
          <span className="text-amber-400">indexing…</span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1.5">
          {docs.map((d) => (
            <DocRow key={d.id} doc={d} onDelete={() => handleDelete(d)} />
          ))}
          {error && (
            <div className="text-xs text-rose-300 mt-1">{error}</div>
          )}
        </div>
      )}
    </div>
  )
}

function DocRow({
  doc,
  onDelete
}: {
  doc: Document
  onDelete: () => void
}): React.JSX.Element {
  const status = doc.status
  const statusEl =
    status === 'ready' ? (
      <span className="text-emerald-400">✓</span>
    ) : status === 'indexing' ? (
      <span className="text-amber-400">⏳ indexing</span>
    ) : (
      <span className="text-rose-400" title={doc.error ?? ''}>
        ✗ error
      </span>
    )

  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <span>📄</span>
        <span className="truncate text-zinc-200" title={doc.name}>
          {doc.name}
        </span>
        <span className="text-zinc-600 shrink-0">
          {doc.total_pages ? `${doc.total_pages}p · ` : ''}
          {doc.total_chunks ? `${doc.total_chunks} chunks · ` : ''}
          {formatSize(doc.size_bytes)}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {statusEl}
        <button
          onClick={onDelete}
          className="text-zinc-500 hover:text-rose-400 text-[11px]"
          title="삭제"
        >
          ×
        </button>
      </div>
    </div>
  )
}

const SUPPORTED_EXT = /\.(pdf|txt|md|markdown|docx|pptx)$/i
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'

function isSupported(file: File): boolean {
  if (file.type === 'application/pdf') return true
  if (file.type === DOCX_MIME) return true
  if (file.type === PPTX_MIME) return true
  if (file.type.startsWith('text/')) return true
  return SUPPORTED_EXT.test(file.name)
}

export function isSupportedFile(file: File): boolean {
  return isSupported(file)
}
