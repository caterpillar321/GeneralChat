import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  deleteConversation,
  listConversations,
  updateConversation,
  type Conversation
} from '../lib/api'

const ONE_DAY = 24 * 60 * 60 * 1000

function bucketLabel(ts: number, now: number): string {
  const d = new Date(ts)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const startToday = today.getTime()
  if (ts >= startToday) return '오늘'
  if (ts >= startToday - ONE_DAY) return '어제'
  if (ts >= startToday - 7 * ONE_DAY) return '이번 주'
  if (ts >= startToday - 30 * ONE_DAY) return '이번 달'
  return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월'
}

export default function ConversationList(): React.JSX.Element {
  const [convs, setConvs] = useState<Conversation[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const navigate = useNavigate()
  const location = useLocation()

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await listConversations()
      setConvs(list)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void refresh()
    // 페이지 이동 시(특히 채팅 후) 갱신
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [refresh, location.pathname])

  const grouped: { label: string; items: Conversation[] }[] = []
  const now = Date.now()
  for (const c of convs) {
    const label = bucketLabel(c.updated_at, now)
    const last = grouped[grouped.length - 1]
    if (last && last.label === label) last.items.push(c)
    else grouped.push({ label, items: [c] })
  }

  const startEdit = (c: Conversation): void => {
    setEditing(c.id)
    setEditValue(c.title || '')
  }

  const saveEdit = async (id: string): Promise<void> => {
    const title = editValue.trim()
    setEditing(null)
    if (!title) return
    await updateConversation(id, { title }).catch(() => {})
    void refresh()
  }

  const handleDelete = async (e: React.MouseEvent, id: string): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('이 대화를 삭제할까요?')) return
    await deleteConversation(id).catch(() => {})
    if (location.pathname === `/chat/${id}`) navigate('/chat')
    void refresh()
  }

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
      <Link
        to="/chat"
        className="block px-3 py-2 rounded text-sm bg-emerald-700 hover:bg-emerald-600 text-zinc-50 text-center font-medium"
      >
        + New Chat
      </Link>

      {convs.length === 0 && (
        <p className="px-3 py-2 text-xs text-zinc-600 italic">대화 없음</p>
      )}

      {grouped.map((g) => (
        <div key={g.label}>
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-600">
            {g.label}
          </div>
          <div className="space-y-0.5">
            {g.items.map((c) => (
              <div key={c.id} className="group relative">
                {editing === c.id ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveEdit(c.id)
                      if (e.key === 'Escape') setEditing(null)
                    }}
                    onBlur={() => void saveEdit(c.id)}
                    className="w-full px-2 py-1.5 rounded text-sm bg-zinc-800 border border-zinc-700 text-zinc-100"
                  />
                ) : (
                  <NavLink
                    to={`/chat/${c.id}`}
                    onDoubleClick={() => startEdit(c)}
                    className={({ isActive }) =>
                      `block px-2 py-1.5 pr-9 rounded text-sm truncate ${
                        isActive
                          ? 'bg-zinc-800 text-zinc-50'
                          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                      }`
                    }
                    title={c.title || '(제목 없음)'}
                  >
                    {c.title || <span className="italic text-zinc-600">(제목 없음)</span>}
                  </NavLink>
                )}
                {editing !== c.id && (
                  <button
                    onClick={(e) => void handleDelete(e, c.id)}
                    className="absolute right-1 top-1 px-1.5 py-0.5 text-[11px] rounded text-rose-400 hover:bg-rose-950/40 opacity-0 group-hover:opacity-100"
                    title="삭제"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
