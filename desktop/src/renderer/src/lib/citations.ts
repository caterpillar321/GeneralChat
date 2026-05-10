/** tool_calls 의 result 텍스트에서 [N] 출처를 추출. */

import type { ToolCallStored } from './api'

export type Source = {
  n: number
  title: string
  url?: string
  doc?: string
  page?: number
  snippet?: string
  toolName: string
}

const WEB_RE =
  /\*\*\[(\d+)\]\s*\[([^\]]+)\]\(([^)]+)\)\*\*\s*\n?\s*([^\n]*)/g
const DOC_RE =
  /\*\*\[(\d+)\]\s*`([^`]+)`(?:\s*·\s*p\.(\d+))?\*\*\s*\n?\s*([^\n]*)/g

function trim(s: string | undefined): string | undefined {
  if (!s) return undefined
  const t = s.trim()
  return t || undefined
}

export function parseSourcesFromToolCalls(
  toolCalls: ToolCallStored[] | undefined
): Source[] {
  if (!toolCalls || toolCalls.length === 0) return []
  const out: Source[] = []
  const seen = new Set<string>()

  for (const tc of toolCalls) {
    const result = tc.result || ''
    if (!result) continue

    // 웹 결과: **[N] [Title](url)** \n snippet
    let m: RegExpExecArray | null
    WEB_RE.lastIndex = 0
    while ((m = WEB_RE.exec(result)) !== null) {
      const n = parseInt(m[1], 10)
      const key = `${tc.id}::${n}::web`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        n,
        title: m[2],
        url: m[3],
        snippet: trim(m[4]),
        toolName: tc.name
      })
    }

    // 문서 결과: **[N] `doc.pdf` · p.42** \n snippet
    DOC_RE.lastIndex = 0
    while ((m = DOC_RE.exec(result)) !== null) {
      const n = parseInt(m[1], 10)
      const key = `${tc.id}::${n}::doc`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        n,
        title: m[2],
        doc: m[2],
        page: m[3] ? parseInt(m[3], 10) : undefined,
        snippet: trim(m[4]),
        toolName: tc.name
      })
    }
  }
  return out.sort((a, b) => a.n - b.n)
}
