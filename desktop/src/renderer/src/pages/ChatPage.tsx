import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  createConversation,
  generateTitle,
  getConfig,
  listMessages,
  streamChat,
  uploadDocument,
  type ChatMessage,
  type ChatTimings,
  type ChatUsage,
  type Document,
  type ImageAttachment,
  type StoredMessageDTO,
  type ToolCallStored
} from '../lib/api'
import { useLlamaStatus } from '../hooks/useLlamaStatus'
import MessageContent from '../components/MessageContent'
import ToolCallCard from '../components/ToolCallCard'
import DocumentsPanel, { isSupportedFile as isSupportedDoc } from '../components/DocumentsPanel'
import AttachMenu from '../components/AttachMenu'

const DEFAULT_SYSTEM = '당신은 간결하고 정확한 어시스턴트입니다.'

type StoredMessage = ChatMessage & {
  reasoning?: string
  usage?: ChatUsage
  timings?: ChatTimings
  model_id?: string
  tool_calls?: ToolCallStored[]
  images?: ImageAttachment[]
}

type ThinkParser = {
  buf: string
  mode: 'content' | 'thinking'
  content: string
  reasoning: string
}

function makeParser(): ThinkParser {
  return { buf: '', mode: 'content', content: '', reasoning: '' }
}

function pushDelta(p: ThinkParser, delta: string): { content: string; reasoning: string } {
  p.buf += delta
  while (p.buf) {
    if (p.mode === 'content') {
      const idx = p.buf.indexOf('<think>')
      if (idx >= 0) {
        p.content += p.buf.slice(0, idx)
        p.buf = p.buf.slice(idx + '<think>'.length)
        p.mode = 'thinking'
      } else {
        const safe = p.buf.length - 6
        if (safe > 0) {
          p.content += p.buf.slice(0, safe)
          p.buf = p.buf.slice(safe)
        }
        break
      }
    } else {
      const idx = p.buf.indexOf('</think>')
      if (idx >= 0) {
        p.reasoning += p.buf.slice(0, idx)
        p.buf = p.buf.slice(idx + '</think>'.length)
        p.mode = 'content'
      } else {
        const safe = p.buf.length - 7
        if (safe > 0) {
          p.reasoning += p.buf.slice(0, safe)
          p.buf = p.buf.slice(safe)
        }
        break
      }
    }
  }
  return {
    content: p.content + (p.mode === 'content' ? p.buf : ''),
    reasoning: p.reasoning + (p.mode === 'thinking' ? p.buf : '')
  }
}

function flushParser(p: ThinkParser): { content: string; reasoning: string } {
  if (p.mode === 'content') p.content += p.buf
  else p.reasoning += p.buf
  p.buf = ''
  return { content: p.content, reasoning: p.reasoning }
}

/** 이미지 파일을 PNG/JPEG data URL 로 정규화. 긴쪽 max 1568px로 리사이즈. */
async function normalizeImage(file: File, maxDim = 1568): Promise<string> {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('이미지 디코딩 실패 (지원 안 되는 포맷일 수 있음)'))
      el.src = objectUrl
    })
    let { width, height } = img
    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context 실패')
    ctx.drawImage(img, 0, 0, width, height)
    // 투명도 보존 위해 PNG. 큰 사진 위주면 JPEG 0.9 가 더 작음 — 간단히 PNG 고정.
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function dtoToStored(d: StoredMessageDTO): StoredMessage {
  return {
    role: d.role,
    content: d.content,
    reasoning: d.reasoning ?? undefined,
    usage: d.usage ?? undefined,
    timings: d.timings ?? undefined,
    model_id: d.model_id ?? undefined,
    tool_calls: d.tool_calls ?? undefined
  }
}

export default function ChatPage(): React.JSX.Element {
  const { id: routeId } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const llama = useLlamaStatus()

  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM)
  const [messages, setMessages] = useState<StoredMessage[]>([])
  const [convId, setConvId] = useState<string | null>(routeId ?? null)
  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([])
  const [maxTokens, setMaxTokens] = useState(8192)
  const [useWebSearch, setUseWebSearch] = useState(false)
  const [docsBumpKey, setDocsBumpKey] = useState(0)
  const [docsCount, setDocsCount] = useState(0)
  const [pdfUploading, setPdfUploading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamContent, setStreamContent] = useState('')
  const [streamReasoning, setStreamReasoning] = useState('')
  const [streamToolCalls, setStreamToolCalls] = useState<ToolCallStored[]>([])
  const [runningToolIds, setRunningToolIds] = useState<Set<string>>(new Set())
  const [streamTimings, setStreamTimings] = useState<ChatTimings | null>(null)
  const [waitingStartedAt, setWaitingStartedAt] = useState<number | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [lastUsage, setLastUsage] = useState<ChatUsage | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const justNavigatedRef = useRef(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const docInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (justNavigatedRef.current) {
      justNavigatedRef.current = false
      return
    }
    cancelRef.current?.()
    setError(null)
    setStreamContent('')
    setStreamReasoning('')
    setStreamToolCalls([])
    setRunningToolIds(new Set())
    setStreaming(false)
    setStreamTimings(null)
    setLastUsage(null)
    setConvId(routeId ?? null)
    if (!routeId) {
      setMessages([])
      return
    }
    void (async () => {
      try {
        const list = await listMessages(routeId)
        setMessages(list.map(dtoToStored))
        const lastWithUsage = [...list].reverse().find((m) => m.usage)
        if (lastWithUsage?.usage) setLastUsage(lastWithUsage.usage)
      } catch (e) {
        setError(String(e))
      }
    })()
  }, [routeId])

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth'
    })
  }, [messages, streamContent, streamReasoning, streamToolCalls])

  // default max_tokens 한 번 가져옴
  useEffect(() => {
    getConfig().then((cfg) => setMaxTokens(cfg.default_max_tokens)).catch(() => {})
  }, [])

  // streaming 시작/종료에 따라 wait timer 토글
  useEffect(() => {
    if (streaming) {
      setWaitingStartedAt(Date.now())
      setElapsedSec(0)
    } else {
      setWaitingStartedAt(null)
      setElapsedSec(0)
    }
  }, [streaming])

  // 1초마다 elapsedSec 갱신 (placeholder 표시 중일 때만)
  useEffect(() => {
    if (waitingStartedAt == null) return
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - waitingStartedAt) / 1000))
    }, 250)
    return () => clearInterval(id)
  }, [waitingStartedAt])

  if (!llama || llama.status !== 'running') {
    return (
      <div className="p-8 max-w-2xl">
        <h2 className="text-2xl font-semibold mb-4">Chat</h2>
        <div className="rounded border border-amber-700 bg-amber-950/40 p-4">
          <p className="text-sm text-amber-200 mb-2">
            모델이 로드되지 않았습니다. Models에서 골라 Load 하세요.
          </p>
          <Link
            to="/models"
            className="inline-block mt-2 px-3 py-1.5 text-sm rounded bg-amber-700 hover:bg-amber-600"
          >
            Models 열기
          </Link>
        </div>
      </div>
    )
  }

  const send = (): void => {
    const text = input.trim()
    if ((!text && pendingImages.length === 0) || streaming) return

    // PDF 자동 생성으로 convId 가 미리 박혔을 수 있으니 메시지 수만으로 판정
    const isFirstTurn = messages.length === 0
    const userImages = pendingImages.length > 0 ? pendingImages : undefined
    const newMessages: StoredMessage[] = [
      ...messages,
      { role: 'user', content: text, images: userImages }
    ]
    setMessages(newMessages)
    setInput('')
    setPendingImages([])
    setStreaming(true)
    setStreamContent('')
    setStreamReasoning('')
    setStreamToolCalls([])
    setRunningToolIds(new Set())
    setStreamTimings(null)
    setError(null)

    const reqMessages: ChatMessage[] = systemPrompt.trim()
      ? [
          { role: 'system', content: systemPrompt },
          ...newMessages.map((m) => ({ role: m.role, content: m.content }))
        ]
      : newMessages.map((m) => ({ role: m.role, content: m.content }))

    let resolvedConvId: string | null = convId
    const parser = makeParser()
    const accumulatedTcs: ToolCallStored[] = []

    cancelRef.current = streamChat(
      {
        messages: reqMessages,
        conversation_id: convId ?? undefined,
        system_prompt: systemPrompt,
        use_web_search: useWebSearch,
        images: userImages,
        max_tokens: maxTokens
      },
      {
        onConversationId: (id) => {
          resolvedConvId = id
          setConvId(id)
          if (!routeId) {
            justNavigatedRef.current = true
            navigate(`/chat/${id}`, { replace: true })
          }
        },
        onContent: (delta) => {
          const snap = pushDelta(parser, delta)
          setStreamContent(snap.content)
          setStreamReasoning(snap.reasoning)
        },
        onReasoning: (delta) => {
          parser.reasoning += delta
          setStreamReasoning(
            parser.reasoning + (parser.mode === 'thinking' ? parser.buf : '')
          )
        },
        onToolCallEnd: (id, name, args) => {
          const tc: ToolCallStored = {
            id,
            name,
            arguments: args,
            result: '',
            round: 0,
            ok: true
          }
          accumulatedTcs.push(tc)
          setStreamToolCalls([...accumulatedTcs])
          setRunningToolIds((prev) => new Set(prev).add(id))
        },
        onToolResult: (id, result, ok) => {
          const idx = accumulatedTcs.findIndex((t) => t.id === id)
          if (idx >= 0) {
            accumulatedTcs[idx] = { ...accumulatedTcs[idx], result, ok }
            setStreamToolCalls([...accumulatedTcs])
          }
          setRunningToolIds((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        },
        onDone: ({ error: err, usage, timings }) => {
          cancelRef.current = null
          setStreaming(false)
          const final = flushParser(parser)
          if (err) {
            setError(String(err))
            return
          }
          if (final.content || final.reasoning || accumulatedTcs.length > 0) {
            setMessages((prev) => [
              ...prev,
              {
                role: 'assistant',
                content: final.content,
                reasoning: final.reasoning || undefined,
                usage,
                timings,
                model_id: llama.model_id ?? undefined,
                tool_calls: accumulatedTcs.length > 0 ? accumulatedTcs : undefined
              }
            ])
          }
          if (usage) setLastUsage(usage)
          setStreamContent('')
          setStreamReasoning('')
          setStreamToolCalls([])
          setRunningToolIds(new Set())
          setStreamTimings(timings ?? null)

          if (isFirstTurn && resolvedConvId) {
            generateTitle(resolvedConvId).catch(() => {})
          }
        }
      }
    )
  }

  const cancel = (): void => {
    cancelRef.current?.()
    cancelRef.current = null
  }

  /** 다양한 포맷 (webp/heic/avif/png/jpg)을 항상 JPEG 또는 PNG 로 정규화 + 리사이즈.
   *  llama.cpp 의 stb_image 가 png/jpg/bmp/gif/tga/psd/hdr/pnm 만 지원해서
   *  webp/heic 첨부가 실패. canvas 로 다시 그려서 PNG/JPEG 보장. */
  const attachFile = async (file: File): Promise<void> => {
    try {
      const dataUrl = await normalizeImage(file)
      setPendingImages((prev) => [...prev, { data_url: dataUrl, name: file.name }])
    } catch (err) {
      setError(`이미지 처리 실패 (${file.name}): ${String(err)}`)
    }
  }

  const attachDocument = async (file: File): Promise<void> => {
    setError(null)
    setPdfUploading(true)
    try {
      let cid = convId
      if (!cid) {
        // 새 대화 자동 생성 후 그 id 사용
        const conv = await createConversation({ system_prompt: systemPrompt })
        cid = conv.id
        setConvId(cid)
        justNavigatedRef.current = true
        navigate(`/chat/${cid}`, { replace: true })
      }
      await uploadDocument(cid, file)
      setDocsBumpKey((k) => k + 1) // DocumentsPanel refresh
    } catch (err) {
      setError(`문서 업로드 실패 (${file.name}): ${String(err)}`)
    } finally {
      setPdfUploading(false)
    }
  }

  const newChat = (): void => {
    cancelRef.current?.()
    navigate('/chat')
  }

  const usedTokens = lastUsage?.total_tokens
  const ctx = llama.n_ctx ?? 0
  const remaining = ctx && usedTokens != null ? Math.max(0, ctx - usedTokens) : null

  return (
    <div className="flex flex-col h-full">
      <header className="px-6 py-3 border-b border-zinc-800 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold truncate">{llama.model_id ?? 'Chat'}</h2>
          <div className="flex items-center gap-3 text-xs text-zinc-500 flex-wrap">
            <span>port {llama.port}</span>
            <span>pid {llama.pid}</span>
            {ctx > 0 && (
              <span className="text-zinc-400">
                ctx{' '}
                <span className="text-zinc-200 font-medium">{usedTokens ?? 0}</span>
                <span className="text-zinc-600"> / </span>
                <span>{ctx}</span>
                {remaining != null && (
                  <span className="text-zinc-600"> · {remaining} 남음</span>
                )}
              </span>
            )}
            {streamTimings?.predicted_per_second != null && (
              <span className="text-emerald-400">
                {streamTimings.predicted_per_second.toFixed(1)} tok/s
              </span>
            )}
          </div>
        </div>
        <button onClick={newChat} className="px-3 py-1.5 text-xs rounded bg-zinc-800 hover:bg-zinc-700">
          New
        </button>
      </header>

      <details className="px-6 py-2 border-b border-zinc-800 text-sm">
        <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">System prompt</summary>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={3}
          className="mt-2 w-full px-3 py-2 rounded border border-zinc-800 bg-zinc-900 text-sm resize-y"
        />
      </details>

      <DocumentsPanel
        key={docsBumpKey}
        conversationId={convId}
        onDocumentsChanged={(ds) => setDocsCount(ds.length)}
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
        {messages.length === 0 && !streamContent && !streamReasoning && streamToolCalls.length === 0 && (
          <p className="text-zinc-500 text-sm">메시지를 입력해 시작하세요.</p>
        )}
        {messages.map((m, i) => (
          <Bubble
            key={i}
            role={m.role}
            content={m.content}
            reasoning={m.reasoning}
            usage={m.usage}
            timings={m.timings}
            modelId={m.model_id}
            toolCalls={m.tool_calls}
            images={m.images}
          />
        ))}
        {(streamContent || streamReasoning || streamToolCalls.length > 0) && (
          <Bubble
            role="assistant"
            content={streamContent}
            reasoning={streamReasoning}
            modelId={llama.model_id ?? undefined}
            toolCalls={streamToolCalls}
            runningToolIds={runningToolIds}
            streaming
          />
        )}
        {streaming && !streamContent && !streamReasoning && streamToolCalls.length === 0 && (
          <WaitingBubble
            elapsedSec={elapsedSec}
            withImages={
              messages.length > 0 &&
              messages[messages.length - 1].role === 'user' &&
              (messages[messages.length - 1].images?.length ?? 0) > 0
            }
            useWebSearch={useWebSearch}
          />
        )}
        {error && (
          <div className="rounded border border-rose-700 bg-rose-950/40 p-3 text-sm text-rose-200">
            {error}
          </div>
        )}
      </div>

      <footer
        className="px-6 py-4 border-t border-zinc-800"
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          e.preventDefault()
          if (streaming) return
          for (const f of Array.from(e.dataTransfer.files)) {
            if (f.type.startsWith('image/')) {
              void attachFile(f)
            } else if (isSupportedDoc(f)) {
              void attachDocument(f)
            }
          }
        }}
      >
        {pendingImages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingImages.map((img, i) => (
              <div
                key={i}
                className="relative group rounded overflow-hidden border border-zinc-800"
              >
                <img
                  src={img.data_url}
                  alt={img.name ?? ''}
                  className="h-16 w-16 object-cover"
                />
                <button
                  onClick={() =>
                    setPendingImages((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-zinc-950/80 text-zinc-200 text-[10px] hover:bg-rose-600"
                  title="제거"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* hidden file inputs (메뉴 → ref click) */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            for (const f of Array.from(e.target.files ?? [])) {
              if (f.type.startsWith('image/')) void attachFile(f)
            }
            e.target.value = ''
          }}
        />
        <input
          ref={docInputRef}
          type="file"
          accept=".pdf,.txt,.md,.markdown,.docx,.pptx,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          multiple
          hidden
          onChange={(e) => {
            for (const f of Array.from(e.target.files ?? [])) {
              if (isSupportedDoc(f)) void attachDocument(f)
            }
            e.target.value = ''
          }}
        />

        {/* 통합 입력 박스: textarea + 하단 toolbar */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 focus-within:border-zinc-600 transition-colors">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            onPaste={(e) => {
              for (const item of Array.from(e.clipboardData.items)) {
                if (item.type.startsWith('image/')) {
                  const f = item.getAsFile()
                  if (f) void attachFile(f)
                }
              }
            }}
            rows={2}
            placeholder={
              llama.is_vision
                ? '메시지 입력 (이미지는 드래그/붙여넣기/메뉴)'
                : '메시지 입력 (Enter 전송, Shift+Enter 줄바꿈)'
            }
            className="w-full px-3 py-2 bg-transparent text-sm resize-none focus:outline-none disabled:opacity-50"
            disabled={streaming}
          />
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-t border-zinc-800">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <AttachMenu
                disabled={streaming}
                visionEnabled={llama.is_vision}
                useWebSearch={useWebSearch}
                onToggleWebSearch={() => setUseWebSearch((v) => !v)}
                onPickImage={() => imageInputRef.current?.click()}
                onPickDoc={() => docInputRef.current?.click()}
              />
              {pendingImages.length > 0 && (
                <Chip color="zinc" title="첨부된 이미지">
                  🖼 {pendingImages.length}
                </Chip>
              )}
              {docsCount > 0 && (
                <Chip color="emerald" title="이 대화의 자료 (search_documents tool 자동 활성)">
                  📁 {docsCount}
                </Chip>
              )}
              {useWebSearch && (
                <Chip color="sky" title="모델이 필요시 web_search 호출">
                  🌐 web
                </Chip>
              )}
              {pdfUploading && (
                <Chip color="amber" title="문서 업로드/인덱싱 중">
                  📄 업로드 중…
                </Chip>
              )}
              {!llama.is_vision && pendingImages.length > 0 && (
                <Chip color="rose" title="현재 모델 vision 미지원">
                  ⚠ vision 미지원
                </Chip>
              )}
            </div>
            {streaming ? (
              <button
                onClick={cancel}
                className="px-4 py-1.5 rounded bg-rose-700 hover:bg-rose-600 text-sm font-medium shrink-0"
              >
                중지
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim() && pendingImages.length === 0}
                className="px-4 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-sm font-medium shrink-0"
              >
                전송
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  )
}

function Chip({
  color,
  title,
  children
}: {
  color: 'zinc' | 'emerald' | 'sky' | 'amber' | 'rose'
  title?: string
  children: React.ReactNode
}): React.JSX.Element {
  const colorMap: Record<typeof color, string> = {
    zinc: 'bg-zinc-800/60 border-zinc-700 text-zinc-300',
    emerald: 'bg-emerald-900/40 border-emerald-800 text-emerald-200',
    sky: 'bg-sky-900/40 border-sky-800 text-sky-200',
    amber: 'bg-amber-900/40 border-amber-800 text-amber-200',
    rose: 'bg-rose-900/40 border-rose-800 text-rose-200'
  }
  return (
    <span
      className={`px-2 py-0.5 text-[11px] rounded-full border ${colorMap[color]}`}
      title={title}
    >
      {children}
    </span>
  )
}

function WaitingBubble({
  elapsedSec,
  withImages,
  useWebSearch
}: {
  elapsedSec: number
  withImages: boolean
  useWebSearch: boolean
}): React.JSX.Element {
  const label = withImages
    ? '이미지 인코딩 + 프롬프트 평가 중'
    : useWebSearch
      ? '도구 호출 판단 중'
      : '프롬프트 평가 중'
  return (
    <div className="flex justify-start">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-sm text-zinc-400 flex items-center gap-3">
        <span className="inline-flex items-center gap-1">
          <span
            className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-pulse"
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-pulse"
            style={{ animationDelay: '200ms' }}
          />
          <span
            className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-pulse"
            style={{ animationDelay: '400ms' }}
          />
        </span>
        <span>{label}</span>
        {elapsedSec > 0 && <span className="text-xs text-zinc-600">{elapsedSec}s</span>}
      </div>
    </div>
  )
}

function Bubble({
  role,
  content,
  reasoning,
  usage,
  timings,
  modelId,
  toolCalls,
  runningToolIds,
  images,
  streaming
}: {
  role: 'system' | 'user' | 'assistant'
  content: string
  reasoning?: string
  usage?: ChatUsage
  timings?: ChatTimings
  modelId?: string
  toolCalls?: ToolCallStored[]
  runningToolIds?: Set<string>
  images?: ImageAttachment[]
  streaming?: boolean
}): React.JSX.Element {
  const isUser = role === 'user'
  const shortModel = modelId ? modelId.split('/').pop() : null

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg text-sm ${
          isUser
            ? 'bg-emerald-900/40 border border-emerald-800 text-zinc-100'
            : 'bg-zinc-900 border border-zinc-800 text-zinc-100'
        }`}
      >
        <div className="px-4 pt-2.5 flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">{role}</span>
          {shortModel && (
            <span
              className="text-[9px] text-zinc-600 font-mono truncate max-w-[60%]"
              title={modelId}
            >
              {shortModel}
            </span>
          )}
        </div>

        {images && images.length > 0 && (
          <div className="mx-4 my-1.5 flex flex-wrap gap-2">
            {images.map((img, i) => (
              <img
                key={i}
                src={img.data_url}
                alt={img.name ?? ''}
                className="max-h-40 rounded border border-zinc-800"
              />
            ))}
          </div>
        )}

        {toolCalls && toolCalls.length > 0 && (
          <div className="mx-4 my-1.5 space-y-1">
            {toolCalls.map((tc) => (
              <ToolCallCard
                key={tc.id}
                tc={tc}
                running={runningToolIds?.has(tc.id) ?? false}
              />
            ))}
          </div>
        )}

        {reasoning && (
          <details className="mx-4 my-1.5 rounded border border-zinc-800 bg-zinc-950/40">
            <summary className="cursor-pointer px-2.5 py-1 text-[11px] text-violet-300 hover:text-violet-200">
              💭 thinking ({reasoning.length} chars)
            </summary>
            <div className="px-2.5 py-2 text-xs text-zinc-400 border-t border-zinc-800">
              {role === 'assistant' ? (
                <MessageContent text={reasoning} />
              ) : (
                <div className="whitespace-pre-wrap">{reasoning}</div>
              )}
              {streaming && (
                <span className="ml-1 inline-block w-1.5 h-3 bg-violet-400 animate-pulse" />
              )}
            </div>
          </details>
        )}

        {content && (
          <div className="px-4 pt-1 pb-2.5">
            {role === 'assistant' ? (
              <MessageContent text={content} />
            ) : (
              <div className="whitespace-pre-wrap">{content}</div>
            )}
            {streaming && !reasoning && (
              <span className="ml-1 inline-block w-1.5 h-3 bg-zinc-300 animate-pulse" />
            )}
          </div>
        )}

        {!streaming && (usage || timings) && (
          <div className="px-4 pb-2 flex gap-3 text-[10px] text-zinc-500">
            {usage && (
              <span>
                {usage.prompt_tokens}+{usage.completion_tokens} = {usage.total_tokens} tok
              </span>
            )}
            {timings?.predicted_per_second != null && (
              <span>{timings.predicted_per_second.toFixed(1)} t/s</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
