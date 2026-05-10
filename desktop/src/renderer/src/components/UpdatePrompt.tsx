import { useEffect, useState } from 'react'
import { CURRENT_VERSION, fetchLatestVersion, isNewerVersion } from '../lib/version'

const DISMISS_KEY = 'updateDismissedVersion'

export default function UpdatePrompt(): React.JSX.Element | null {
  const [latest, setLatest] = useState<string | null>(null)
  const [releaseUrl, setReleaseUrl] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const info = await fetchLatestVersion()
        if (cancelled) return
        if (info.latest && isNewerVersion(CURRENT_VERSION, info.latest)) {
          const dismissedFor = window.localStorage.getItem(DISMISS_KEY)
          if (dismissedFor !== info.latest) {
            setLatest(info.latest)
            setReleaseUrl(info.release_url)
          }
        }
      } catch {
        // private repo / 네트워크 단절 — silent
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!latest || dismissed) return null

  const dismiss = (): void => {
    window.localStorage.setItem(DISMISS_KEY, latest)
    setDismissed(true)
  }

  return (
    <div className="rounded border border-amber-700/60 bg-amber-950/40 p-2 text-xs">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-amber-200">
          🔔 새 버전 <span className="font-medium">{latest}</span> 사용 가능
        </span>
        <button
          onClick={dismiss}
          className="text-zinc-500 hover:text-zinc-300 leading-none px-1"
          title="이 버전 알림 숨기기"
        >
          ×
        </button>
      </div>
      <div className="text-[10px] text-zinc-500 mb-1">
        현재: v{CURRENT_VERSION}
      </div>
      {releaseUrl && (
        <a
          href={releaseUrl}
          target="_blank"
          rel="noreferrer"
          className="block px-2 py-1 text-center text-xs rounded bg-amber-700 hover:bg-amber-600 text-amber-50"
        >
          받기
        </a>
      )}
    </div>
  )
}
