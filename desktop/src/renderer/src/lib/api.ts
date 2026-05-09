const BASE_URL = 'http://127.0.0.1:8765'

export type TitleStrategy = 'auto' | 'truncate' | 'manual'
export type SearchProviderType = 'none' | 'tavily' | 'brave' | 'searxng' | 'ddg'

export type AppConfig = {
  llama_server_path: string | null
  model_dirs: string[]
  default_port: number
  default_n_ctx: number
  default_max_tokens: number
  default_mmproj_offload_to_gpu: boolean
  title_strategy: TitleStrategy
  title_sidecar_enabled: boolean
  title_sidecar_model_path: string | null
  title_sidecar_port: number
  title_sidecar_n_threads: number
  title_sidecar_n_ctx: number
  search_provider: SearchProviderType
  search_tavily_api_key: string | null
  search_brave_api_key: string | null
  search_searxng_url: string | null
  search_max_results: number
}

export type ModelEntry = {
  id: string
  family: string
  display_name: string
  params: string | null
  quant: string | null
  is_vision: boolean
  can_be_vision: boolean
  main_file: string
  mmproj_file: string | null
  parts: string[]
  total_size_bytes: number
}

export type LlamaStatus = 'stopped' | 'starting' | 'running' | 'error'

export type LlamaState = {
  status: LlamaStatus
  model_id: string | null
  model_path: string | null
  port: number | null
  pid: number | null
  n_ctx: number | null
  is_vision: boolean
  error: string | null
}

export type LlamaStartArgs = {
  model_id: string
  n_ctx: number
  n_gpu_layers: number
  cache_type_k: string
  cache_type_v: string
  flash_attn: boolean
  mmproj_offload_to_gpu: boolean
  extra_args: string[]
}

export type ChatRole = 'system' | 'user' | 'assistant'
export type ChatMessage = { role: ChatRole; content: string }

export type ImageAttachment = {
  data_url: string
  name?: string
}

export type ChatStreamRequest = {
  messages: ChatMessage[]
  conversation_id?: string | null
  system_prompt?: string | null
  use_web_search?: boolean
  images?: ImageAttachment[]
  temperature?: number
  top_k?: number
  top_p?: number
  min_p?: number
  repeat_penalty?: number
  max_tokens?: number
  stop?: string[]
}

export type ChatUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export type ChatTimings = {
  prompt_ms?: number
  predicted_ms?: number
  prompt_per_second?: number
  predicted_per_second?: number
}

export type StreamCallbacks = {
  onContent?: (delta: string) => void
  onReasoning?: (delta: string) => void
  onConversationId?: (id: string) => void
  onToolCallEnd?: (id: string, name: string, args: Record<string, unknown>) => void
  onToolResult?: (id: string, result: string, ok: boolean) => void
  onRoundEnd?: (round: number) => void
  onDone: (info: { error?: Error; usage?: ChatUsage; timings?: ChatTimings }) => void
}

export type Conversation = {
  id: string
  title: string
  model_id: string | null
  system_prompt: string
  sampling: Record<string, unknown> | null
  created_at: number
  updated_at: number
}

export type ToolCallStored = {
  id: string
  name: string
  arguments: Record<string, unknown>
  result: string
  round: number
  ok: boolean
}

export type StoredMessageDTO = {
  id: string
  conversation_id: string
  parent_id: string | null
  role: ChatRole
  content: string
  reasoning: string | null
  usage: ChatUsage | null
  timings: ChatTimings | null
  model_id: string | null
  tool_calls: ToolCallStored[] | null
  created_at: number
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body}`)
  }
  return res.json() as Promise<T>
}

export const fetchHealth = (): Promise<{ status: string }> => request('/health')

export const getConfig = (): Promise<AppConfig> => request('/api/config')
export const saveConfig = (cfg: AppConfig): Promise<AppConfig> =>
  request('/api/config', { method: 'PUT', body: JSON.stringify(cfg) })
export const discoverDefaults = (): Promise<{ llama_server_path: string | null }> =>
  request('/api/config/discover')

export const listModels = (): Promise<ModelEntry[]> => request('/api/models')
export const rescanModels = (): Promise<ModelEntry[]> =>
  request('/api/models/scan', { method: 'POST' })

export const getLlamaStatus = (): Promise<LlamaState> => request('/api/llama/status')
export const startLlama = (args: LlamaStartArgs): Promise<LlamaState> =>
  request('/api/llama/start', { method: 'POST', body: JSON.stringify(args) })
export const stopLlama = (): Promise<LlamaState> =>
  request('/api/llama/stop', { method: 'POST' })
export const getLlamaLog = (maxBytes = 16384): Promise<{ log: string }> =>
  request(`/api/llama/log?max_bytes=${maxBytes}`)

export const listConversations = (): Promise<Conversation[]> => request('/api/conversations')
export const getConversation = (id: string): Promise<Conversation> =>
  request(`/api/conversations/${id}`)
export const updateConversation = (
  id: string,
  patch: { title?: string; system_prompt?: string; model_id?: string }
): Promise<Conversation> =>
  request(`/api/conversations/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
export const deleteConversation = (id: string): Promise<{ ok: boolean }> =>
  request(`/api/conversations/${id}`, { method: 'DELETE' })
export const listMessages = (id: string): Promise<StoredMessageDTO[]> =>
  request(`/api/conversations/${id}/messages`)
export const generateTitle = (id: string): Promise<{ title: string }> =>
  request(`/api/conversations/${id}/generate-title`, { method: 'POST' })

export function streamChat(req: ChatStreamRequest, cb: StreamCallbacks): () => void {
  const ctrl = new AbortController()
  let lastUsage: ChatUsage | undefined
  let lastTimings: ChatTimings | undefined

  ;(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: ctrl.signal
      })
      if (!res.ok || !res.body) {
        const text = res.body ? await res.text() : `${res.status}`
        throw new Error(`stream error: ${text}`)
      }
      const convId = res.headers.get('X-Conversation-Id') ?? res.headers.get('x-conversation-id')
      if (convId) cb.onConversationId?.(convId)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n\n')) >= 0) {
          const evt = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 2)
          if (!evt.startsWith('data:')) continue
          const data = evt.slice(5).trim()
          if (!data) continue
          let obj: { type?: string; [k: string]: unknown }
          try {
            obj = JSON.parse(data)
          } catch {
            continue
          }
          switch (obj.type) {
            case 'content':
              if (typeof obj.delta === 'string') cb.onContent?.(obj.delta)
              break
            case 'reasoning':
              if (typeof obj.delta === 'string') cb.onReasoning?.(obj.delta)
              break
            case 'tool_call_end':
              cb.onToolCallEnd?.(
                String(obj.id ?? ''),
                String(obj.name ?? ''),
                (obj.arguments as Record<string, unknown>) ?? {}
              )
              break
            case 'tool_result':
              cb.onToolResult?.(
                String(obj.id ?? ''),
                String(obj.result ?? ''),
                obj.ok !== false
              )
              break
            case 'round_end':
              cb.onRoundEnd?.(Number(obj.round ?? 0))
              break
            case 'usage': {
              const { type: _t, ...rest } = obj
              lastUsage = rest as unknown as ChatUsage
              break
            }
            case 'timings': {
              const { type: _t, ...rest } = obj
              lastTimings = rest as unknown as ChatTimings
              break
            }
            case 'error':
              throw new Error(String(obj.message ?? 'stream error'))
            case 'done':
              cb.onDone({ usage: lastUsage, timings: lastTimings })
              return
            default:
              break
          }
        }
      }
      cb.onDone({ usage: lastUsage, timings: lastTimings })
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        cb.onDone({ usage: lastUsage, timings: lastTimings })
        return
      }
      cb.onDone({ error: e as Error, usage: lastUsage, timings: lastTimings })
    }
  })()

  return () => ctrl.abort()
}
