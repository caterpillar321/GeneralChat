import { useEffect, useState } from 'react'
import { fetchHealth } from '../lib/api'

type Status = 'connecting' | 'ok' | 'error'

export default function ConnectionStatus(): React.JSX.Element {
  const [status, setStatus] = useState<Status>('connecting')

  useEffect(() => {
    let cancelled = false
    const tick = async (): Promise<void> => {
      try {
        await fetchHealth()
        if (!cancelled) setStatus('ok')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }
    void tick()
    const id = setInterval(tick, 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const label =
    status === 'ok' ? 'Backend connected' : status === 'connecting' ? 'Connecting…' : 'Backend offline'
  const dotClass =
    status === 'ok'
      ? 'bg-emerald-500'
      : status === 'connecting'
        ? 'bg-amber-500 animate-pulse'
        : 'bg-rose-500'

  return (
    <div className="flex items-center gap-2 text-xs text-zinc-400">
      <span className={`w-2 h-2 rounded-full ${dotClass}`} />
      <span>{label}</span>
    </div>
  )
}
