// 빌드 타임에 vite define 으로 주입 (electron.vite.config.ts)
export const CURRENT_VERSION: string = __APP_VERSION__

/** "v0.1.2" / "0.1.2" 모두 받아 [0, 1, 2] 로. */
function parse(v: string): number[] {
  return v
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
}

export function isNewerVersion(current: string, latest: string): boolean {
  const c = parse(current)
  const l = parse(latest)
  const len = Math.max(c.length, l.length)
  for (let i = 0; i < len; i++) {
    const ci = c[i] ?? 0
    const li = l[i] ?? 0
    if (li > ci) return true
    if (li < ci) return false
  }
  return false
}

export type VersionInfo = {
  latest: string | null
  release_url: string | null
  published_at?: string | null
  fetch_error?: string | null
}

export async function fetchLatestVersion(): Promise<VersionInfo> {
  const res = await fetch('http://127.0.0.1:8765/api/version')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as VersionInfo
}
