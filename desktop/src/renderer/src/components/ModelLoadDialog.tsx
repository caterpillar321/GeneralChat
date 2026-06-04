import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getConfig,
  getLlamaLog,
  startLlama,
  stopLlama,
  type LlamaStartArgs,
  type LlamaState,
  type ModelEntry
} from '../lib/api'
import { useLlamaStatus } from '../hooks/useLlamaStatus'

const CACHE_TYPES = ['f32', 'f16', 'bf16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0', 'iq4_nl']
const FP_TYPES = new Set(['f32', 'f16', 'bf16'])

type PresetKey = 'safe' | 'balanced' | 'compact' | 'custom'

type Preset = {
  label: string
  hint: string
  cache_type_k: string
  cache_type_v: string
  flash_attn: boolean
}

const PRESETS: Record<Exclude<PresetKey, 'custom'>, Preset> = {
  safe: {
    label: 'Safe (F16/F16)',
    hint: '최대 품질, 메모리 그대로',
    cache_type_k: 'f16',
    cache_type_v: 'f16',
    flash_attn: false
  },
  balanced: {
    label: 'Balanced (Q8_0/Q8_0 + FA)',
    hint: '~50% 메모리, 품질 거의 동일, flash-attn 필수',
    cache_type_k: 'q8_0',
    cache_type_v: 'q8_0',
    flash_attn: true
  },
  compact: {
    label: 'Compact (Q4_0/Q4_0 + FA)',
    hint: '메모리 최소, 일부 모델 품질 저하 가능',
    cache_type_k: 'q4_0',
    cache_type_v: 'q4_0',
    flash_attn: true
  }
}

type Props = {
  model: ModelEntry
  onClose: () => void
}

export default function ModelLoadDialog({ model, onClose }: Props): React.JSX.Element {
  const navigate = useNavigate()
  const [args, setArgs] = useState<LlamaStartArgs>({
    model_id: model.id,
    n_ctx: 32768,
    n_gpu_layers: -1,
    cache_type_k: 'f16',
    cache_type_v: 'f16',
    flash_attn: false,
    mmproj_offload_to_gpu: false,
    use_vision: true,
    extra_args: []
  })
  const [ctxLoaded, setCtxLoaded] = useState(false)

  // 영속 설정의 기본값 가져와 초기값 갱신 (사용자가 손대기 전 한 번만)
  useEffect(() => {
    if (ctxLoaded) return
    getConfig()
      .then((cfg) => {
        setArgs((prev) => ({
          ...prev,
          n_ctx: cfg.default_n_ctx,
          mmproj_offload_to_gpu: cfg.default_mmproj_offload_to_gpu
        }))
      })
      .catch(() => {})
      .finally(() => setCtxLoaded(true))
  }, [ctxLoaded])
  const [preset, setPreset] = useState<PresetKey>('safe')
  const [extraArgsText, setExtraArgsText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState('')
  const [showLog, setShowLog] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)
  const status = useLlamaStatus()

  // running 으로 전환 = 다이얼로그 닫고 채팅으로
  useEffect(() => {
    if (submitting && status?.status === 'running' && status.model_id === model.id) {
      onClose()
      navigate('/chat')
    } else if (submitting && status?.status === 'error') {
      setSubmitting(false)
      setError(status.error ?? 'unknown error')
    }
  }, [submitting, status, model.id, navigate, onClose])

  // 로딩/에러 중에는 로그 폴링
  useEffect(() => {
    const polling = submitting || !!error
    if (!polling) return
    let cancelled = false
    const tick = async (): Promise<void> => {
      try {
        const r = await getLlamaLog()
        if (!cancelled) setLog(r.log)
      } catch {
        /* ignore */
      }
    }
    void tick()
    const id = setInterval(tick, 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [submitting, error])

  // 로그 자동 스크롤
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  const update = (patch: Partial<LlamaStartArgs>): void => setArgs((prev) => ({ ...prev, ...patch }))

  const applyPreset = (p: PresetKey): void => {
    setPreset(p)
    if (p !== 'custom') {
      const cfg = PRESETS[p]
      update({
        cache_type_k: cfg.cache_type_k,
        cache_type_v: cfg.cache_type_v,
        flash_attn: cfg.flash_attn
      })
    }
  }

  // V 양자화 시 flash_attn 자동 ON 강제
  const vIsQuantized = !FP_TYPES.has(args.cache_type_v.toLowerCase())
  useEffect(() => {
    if (vIsQuantized && !args.flash_attn) update({ flash_attn: true })
  }, [vIsQuantized, args.flash_attn])

  const isAsymmetric = args.cache_type_k.toLowerCase() !== args.cache_type_v.toLowerCase()

  const submit = async (): Promise<void> => {
    setSubmitting(true)
    setStartedAt(Date.now())
    setError(null)
    setLog('')
    setShowLog(true)
    const finalArgs: LlamaStartArgs = {
      ...args,
      extra_args: extraArgsText.split(/\s+/).map((s) => s.trim()).filter(Boolean)
    }
    try {
      await startLlama(finalArgs)
    } catch (e) {
      setError(String(e))
      setSubmitting(false)
    }
  }

  const cancelStart = async (): Promise<void> => {
    await stopLlama().catch(() => {})
    setSubmitting(false)
    setError('사용자가 취소함')
  }

  const isLoading = submitting && status?.status !== 'error'

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={isLoading ? undefined : onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-zinc-800 bg-zinc-950 p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-1">Load Model</h3>
        <p className="text-sm text-zinc-400 mb-4 truncate" title={model.display_name}>
          {model.display_name}
        </p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <Field label="n_ctx (context size)">
            <input
              type="number"
              value={args.n_ctx}
              min={512}
              step={512}
              onChange={(e) => update({ n_ctx: Number(e.target.value) || 4096 })}
              className="w-full px-2 py-1.5 rounded border border-zinc-800 bg-zinc-900 text-sm"
              disabled={isLoading}
            />
          </Field>
          <Field label="n_gpu_layers (-1 = all)">
            <input
              type="number"
              value={args.n_gpu_layers}
              min={-1}
              onChange={(e) => update({ n_gpu_layers: Number(e.target.value) })}
              className="w-full px-2 py-1.5 rounded border border-zinc-800 bg-zinc-900 text-sm"
              disabled={isLoading}
            />
          </Field>
        </div>

        <Field label="KV cache 프리셋">
          <select
            value={preset}
            onChange={(e) => applyPreset(e.target.value as PresetKey)}
            disabled={isLoading}
            className="w-full px-2 py-1.5 rounded border border-zinc-800 bg-zinc-900 text-sm"
          >
            {(['safe', 'balanced', 'compact'] as const).map((k) => (
              <option key={k} value={k}>
                {PRESETS[k].label} — {PRESETS[k].hint}
              </option>
            ))}
            <option value="custom">Custom (직접 설정)</option>
          </select>
        </Field>

        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="cache_type_k">
              <select
                value={args.cache_type_k}
                onChange={(e) => update({ cache_type_k: e.target.value })}
                disabled={isLoading}
                className="w-full px-2 py-1.5 rounded border border-zinc-800 bg-zinc-900 text-sm"
              >
                {CACHE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="cache_type_v">
              <select
                value={args.cache_type_v}
                onChange={(e) => update({ cache_type_v: e.target.value })}
                disabled={isLoading}
                className="w-full px-2 py-1.5 rounded border border-zinc-800 bg-zinc-900 text-sm"
              >
                {CACHE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>
        )}

        <label className="flex items-center gap-2 mt-4 text-sm">
          <input
            type="checkbox"
            checked={args.flash_attn}
            onChange={(e) => update({ flash_attn: e.target.checked })}
            disabled={vIsQuantized || isLoading}
          />
          Flash attention (-fa)
          {vIsQuantized && (
            <span className="text-xs text-amber-400">— V 양자화로 강제 ON</span>
          )}
        </label>

        {model.mmproj_file && (
          <>
            <label className="flex items-center gap-2 mt-2 text-sm">
              <input
                type="checkbox"
                checked={args.use_vision}
                onChange={(e) => update({ use_vision: e.target.checked })}
                disabled={isLoading}
              />
              vision 활성화 (mmproj 로드)
              <span className="text-xs text-zinc-500">
                — OFF면 텍스트 전용 (mmproj 깨졌거나 llama.cpp 미지원 시)
              </span>
            </label>
            {args.use_vision && (
              <label className="flex items-center gap-2 mt-2 text-sm">
                <input
                  type="checkbox"
                  checked={args.mmproj_offload_to_gpu}
                  onChange={(e) => update({ mmproj_offload_to_gpu: e.target.checked })}
                  disabled={isLoading}
                />
                mmproj GPU 오프로드
                <span className="text-xs text-zinc-500">
                  — OFF면 CPU에서 실행 (VRAM 절약, 느림)
                </span>
              </label>
            )}
          </>
        )}

        {isAsymmetric && (
          <div className="mt-3 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-200">
            ⚠ 비대칭 KV 캐시 (K={args.cache_type_k}, V={args.cache_type_v}) — 일부 모델
            (특히 GQA·sliding window)에서 NaN/assert 발생할 수 있습니다. 안전하지 않으면 같은 타입으로.
          </div>
        )}

        <div className="mt-4">
          <Field label="추가 인자 (공백 구분)">
            <input
              type="text"
              value={extraArgsText}
              onChange={(e) => setExtraArgsText(e.target.value)}
              placeholder="--threads 8 --batch-size 256"
              disabled={isLoading}
              className="w-full px-2 py-1.5 rounded border border-zinc-800 bg-zinc-900 text-sm font-mono"
            />
          </Field>
        </div>

        {error && (
          <div className="mt-3 rounded border border-rose-700 bg-rose-950/40 p-2 text-xs text-rose-200">
            {error}
          </div>
        )}

        {isLoading && (
          <LoadingStepper status={status} useVision={args.use_vision} startedAt={startedAt} />
        )}

        {(submitting || error || log) && (
          <div className="mt-3">
            <button
              onClick={() => setShowLog((v) => !v)}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              {showLog ? '▾' : '▸'} llama-server 로그 ({log.length} bytes)
            </button>
            {showLog && (
              <pre
                ref={logRef}
                className="mt-2 max-h-64 overflow-auto p-2 rounded border border-zinc-800 bg-zinc-900 text-[11px] font-mono text-zinc-300 whitespace-pre-wrap"
              >
                {log || '(아직 출력 없음)'}
              </pre>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          {isLoading ? (
            <button
              onClick={cancelStart}
              className="px-4 py-2 text-sm rounded bg-rose-700 hover:bg-rose-600"
            >
              취소 / 종료
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded bg-zinc-800 hover:bg-zinc-700"
            >
              닫기
            </button>
          )}
          {!isLoading && (
            <button
              onClick={submit}
              className="px-5 py-2 text-sm rounded bg-emerald-700 hover:bg-emerald-600 font-medium"
            >
              Load
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="block text-sm">
      <span className="block mb-1 text-zinc-400 text-xs">{label}</span>
      {children}
    </label>
  )
}

type StepDef = { key: string; label: string; hint?: string }

function LoadingStepper({
  status,
  useVision,
  startedAt
}: {
  status: LlamaState | null
  useVision: boolean
  startedAt: number
}): React.JSX.Element {
  // 'init' = phase=null 구간 (프로세스 시작 + CUDA init + mmap), 보통 첫 빈 구간이 길다
  const steps: StepDef[] = [
    { key: 'init', label: '프로세스 시작 · CUDA 초기화', hint: '디스크·드라이버 준비' },
    { key: 'meta', label: '모델 메타 읽기' },
    { key: 'tensors', label: 'GPU 레이어 적재', hint: '가장 오래 — 가중치를 VRAM으로' },
    { key: 'context', label: '컨텍스트 생성' },
    { key: 'kv', label: 'KV 캐시 할당' },
    ...(useVision
      ? [{ key: 'mmproj', label: '비전 인코더 로드', hint: 'mmproj (BF16·CPU)' }]
      : []),
    { key: 'warmup', label: '워밍업' }
  ]
  const order = steps.map((s) => s.key)
  // phase 가 null 이면 'init' 단계로 간주
  const phase = status?.phase ?? null
  const curIdx = phase ? order.indexOf(phase) : 0

  const loaded = status?.layers_loaded ?? null
  const total = status?.layers_total ?? null
  const layerPct = loaded != null && total ? Math.floor((loaded / total) * 100) : null

  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 250)
    return () => clearInterval(id)
  }, [startedAt])

  return (
    <div className="mt-3 rounded border border-amber-700/60 bg-amber-950/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-amber-200 font-medium">모델 로딩 중…</span>
        <span className="text-[11px] text-zinc-500">
          {elapsed}s 경과 · 타임아웃 600s
        </span>
      </div>
      <div className="space-y-1">
        {steps.map((s, i) => {
          const done = curIdx > i
          const active = curIdx === i
          const icon = done ? '✓' : active ? '●' : '○'
          const color = done
            ? 'text-emerald-400'
            : active
              ? 'text-amber-300'
              : 'text-zinc-600'
          return (
            <div key={s.key} className={`flex items-center gap-2 text-xs ${color}`}>
              <span className="w-3 text-center shrink-0">
                {active ? (
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                ) : (
                  icon
                )}
              </span>
              <span className={active ? 'font-medium' : ''}>{s.label}</span>
              {s.key === 'tensors' && (active || done) && layerPct != null && (
                <span className="text-zinc-500">
                  ({loaded}/{total})
                </span>
              )}
              {active && s.hint && (
                <span className="text-[10px] text-zinc-600">— {s.hint}</span>
              )}
            </div>
          )
        })}
      </div>
      {curIdx === order.indexOf('tensors') && layerPct != null && (
        <div className="mt-2 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-amber-500 transition-all"
            style={{ width: `${layerPct}%` }}
          />
        </div>
      )}
    </div>
  )
}
