import { useState } from 'react'
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole
} from '@floating-ui/react'

import type { Source } from '../lib/citations'

type Props = {
  n: number
  source?: Source
}

export default function CitationBadge({ n, source }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate
  })

  // 호버 폐기 (안정성 문제) → 클릭으로만 토글, 외부/Esc 로 dismiss.
  // 호버 미리보기는 native title 로 충분.
  const click = useClick(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'dialog' })

  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role])

  const colorClass = source
    ? source.toolName === 'web_search'
      ? 'bg-sky-900/60 text-sky-300 border-sky-800 hover:bg-sky-900'
      : 'bg-emerald-900/60 text-emerald-300 border-emerald-800 hover:bg-emerald-900'
    : 'bg-zinc-800 text-zinc-500 border-zinc-700'

  // native title 미리보기 — OS tooltip
  const tooltipText = source
    ? [
        source.title + (source.page != null ? ` · p.${source.page}` : ''),
        source.url ?? '',
        (source.snippet ?? '').slice(0, 200)
      ]
        .filter(Boolean)
        .join('\n')
    : `[${n}]`

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        title={tooltipText}
        className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 mx-0.5 rounded text-[10px] font-mono border align-baseline cursor-pointer ${colorClass} ${
          open ? 'ring-1 ring-zinc-400' : ''
        }`}
        aria-label={`인용 ${n} 출처 보기`}
        {...getReferenceProps()}
      >
        {n}
      </button>
      {open && source && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-80 rounded border border-zinc-700 bg-zinc-950 shadow-xl p-3 text-xs"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                {source.toolName === 'web_search' ? '🌐 web' : '📄 document'} · [{n}]
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-zinc-500 hover:text-zinc-200 text-[14px] leading-none px-1"
                title="닫기"
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="text-zinc-100 font-medium mb-1 break-words">
              {source.title}
              {source.page != null && (
                <span className="text-zinc-500 font-normal"> · p.{source.page}</span>
              )}
            </div>
            {source.url && (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 hover:underline text-[11px] break-all block mb-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                {source.url}
              </a>
            )}
            {source.snippet && (
              <div className="text-zinc-300 text-[11px] mt-1 leading-snug whitespace-pre-wrap">
                {source.snippet}
              </div>
            )}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
