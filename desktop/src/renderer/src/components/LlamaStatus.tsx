import { useLlamaStatus } from '../hooks/useLlamaStatus'
import { stopLlama } from '../lib/api'

export default function LlamaStatus(): React.JSX.Element {
  const state = useLlamaStatus()

  if (!state || state.status === 'stopped') {
    return <div className="text-xs text-zinc-500">No model loaded</div>
  }

  const dotClass =
    state.status === 'running'
      ? 'bg-emerald-500'
      : state.status === 'starting'
        ? 'bg-amber-500 animate-pulse'
        : 'bg-rose-500'

  return (
    <div className="text-xs">
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
        <span className="text-zinc-300 capitalize">{state.status}</span>
      </div>
      {state.model_id && (
        <div className="text-zinc-400 truncate" title={state.model_id}>
          {state.model_id.split('/').pop()}
        </div>
      )}
      {state.error && (
        <div className="mt-1 text-rose-400 truncate" title={state.error}>
          {state.error}
        </div>
      )}
      {state.status === 'running' && (
        <button
          onClick={() => {
            void stopLlama()
          }}
          className="mt-1.5 text-xs text-rose-400 hover:text-rose-300"
        >
          Unload
        </button>
      )}
    </div>
  )
}
