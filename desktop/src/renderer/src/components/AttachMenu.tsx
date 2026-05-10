import { useEffect, useRef, useState } from 'react'

type Props = {
  onPickImage: () => void
  onPickDoc: () => void
  visionEnabled: boolean
  useWebSearch: boolean
  onToggleWebSearch: () => void
  disabled?: boolean
}

export default function AttachMenu({
  onPickImage,
  onPickDoc,
  visionEnabled,
  useWebSearch,
  onToggleWebSearch,
  disabled
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="첨부·도구 메뉴"
        className={`w-7 h-7 rounded-full flex items-center justify-center text-base ${
          open
            ? 'bg-zinc-700 text-zinc-100'
            : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
        } border border-zinc-800 disabled:opacity-50`}
      >
        +
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 w-60 rounded border border-zinc-800 bg-zinc-950 shadow-xl z-20 py-1 text-sm">
          <MenuButton
            onClick={() => {
              setOpen(false)
              onPickImage()
            }}
            disabled={!visionEnabled}
            hint={visionEnabled ? undefined : 'vision 모델 필요'}
          >
            <span>🖼</span>
            <span className="flex-1">이미지 첨부</span>
          </MenuButton>
          <MenuButton
            onClick={() => {
              setOpen(false)
              onPickDoc()
            }}
          >
            <span>📄</span>
            <span className="flex-1">PDF / DOCX / PPTX / TXT 첨부</span>
          </MenuButton>
          <div className="my-1 border-t border-zinc-800" />
          <MenuButton onClick={onToggleWebSearch}>
            <span>🌐</span>
            <span className="flex-1">웹 검색</span>
            <Switch on={useWebSearch} />
          </MenuButton>
        </div>
      )}
    </div>
  )
}

function MenuButton({
  onClick,
  disabled,
  hint,
  children
}: {
  onClick: () => void
  disabled?: boolean
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className="w-full flex items-center gap-2 px-3 py-2 text-left text-zinc-200 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
      {hint && disabled && (
        <span className="text-[10px] text-rose-400 ml-auto">{hint}</span>
      )}
    </button>
  )
}

function Switch({ on }: { on: boolean }): React.JSX.Element {
  return (
    <span
      className={`w-7 h-4 rounded-full relative transition-colors ${
        on ? 'bg-emerald-600' : 'bg-zinc-700'
      }`}
    >
      <span
        className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
          on ? 'left-3.5' : 'left-0.5'
        }`}
      />
    </span>
  )
}
