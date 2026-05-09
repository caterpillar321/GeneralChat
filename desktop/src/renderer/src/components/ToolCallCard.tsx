import type { ToolCallStored } from '../lib/api'

type Props = {
  tc: ToolCallStored
  /** 진행 상태 — running 이면 결과 미수신, done 이면 result 표시 */
  running?: boolean
}

function shortArgs(args: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(args)
    return s.length > 80 ? s.slice(0, 80) + '…' : s
  } catch {
    return ''
  }
}

export default function ToolCallCard({ tc, running }: Props): React.JSX.Element {
  const isOk = tc.ok !== false
  const statusLabel = running ? '⏳ 실행 중' : isOk ? '✓ 완료' : '✗ 실패'
  const statusColor = running
    ? 'text-amber-400'
    : isOk
      ? 'text-emerald-400'
      : 'text-rose-400'

  return (
    <details className="rounded border border-sky-900/60 bg-sky-950/30 group">
      <summary className="cursor-pointer px-3 py-1.5 text-[11px] flex items-center gap-2 hover:bg-sky-950/50">
        <span className="text-sky-300 font-medium shrink-0">🌐 {tc.name}</span>
        <span className="text-zinc-500 font-mono truncate flex-1">{shortArgs(tc.arguments)}</span>
        <span className={`shrink-0 ${statusColor}`}>{statusLabel}</span>
      </summary>
      <div className="px-3 py-2 border-t border-sky-900/60 text-xs space-y-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">arguments</div>
          <pre className="text-[11px] text-zinc-400 whitespace-pre-wrap font-mono">
            {JSON.stringify(tc.arguments, null, 2)}
          </pre>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">result</div>
          <pre className="text-[11px] text-zinc-400 whitespace-pre-wrap font-mono max-h-64 overflow-auto">
            {tc.result || (running ? '(실행 중...)' : '(빈 결과)')}
          </pre>
        </div>
      </div>
    </details>
  )
}
