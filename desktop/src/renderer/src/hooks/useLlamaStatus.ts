import { useEffect, useState } from 'react'
import { getLlamaStatus, type LlamaState } from '../lib/api'

export function useLlamaStatus(intervalMs = 1500): LlamaState | null {
  const [state, setState] = useState<LlamaState | null>(null)

  useEffect(() => {
    let cancelled = false
    const tick = async (): Promise<void> => {
      try {
        const s = await getLlamaStatus()
        if (!cancelled) setState(s)
      } catch {
        // 백엔드 일시 단절은 무시
      }
    }
    void tick()
    const id = setInterval(tick, intervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [intervalMs])

  return state
}
