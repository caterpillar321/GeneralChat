import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

import type { Source } from '../lib/citations'
import CitationBadge from './CitationBadge'

const CITATION_RE = /\[(\d+)\]/g

/** 텍스트 내 [N] 패턴을 CitationBadge 로 변환. 다른 React 노드는 그대로. */
function transformWithCitations(
  node: React.ReactNode,
  sources: Source[],
  keyPrefix = ''
): React.ReactNode {
  if (typeof node === 'string') {
    if (!CITATION_RE.test(node)) return node
    CITATION_RE.lastIndex = 0
    const out: React.ReactNode[] = []
    let last = 0
    let m: RegExpExecArray | null
    while ((m = CITATION_RE.exec(node)) !== null) {
      if (m.index > last) out.push(node.slice(last, m.index))
      const n = parseInt(m[1], 10)
      const source = sources.find((s) => s.n === n)
      out.push(
        <CitationBadge key={`${keyPrefix}-${m.index}`} n={n} source={source} />
      )
      last = m.index + m[0].length
    }
    if (last < node.length) out.push(node.slice(last))
    return out
  }
  if (Array.isArray(node)) {
    return node.map((child, i) =>
      typeof child === 'string'
        ? transformWithCitations(child, sources, `${keyPrefix}-${i}`)
        : child
    )
  }
  return node
}

const components: Components = {
  h1: (p) => <h1 className="text-xl font-bold mt-3 mb-2" {...p} />,
  h2: (p) => <h2 className="text-lg font-bold mt-3 mb-2" {...p} />,
  h3: (p) => <h3 className="text-base font-semibold mt-2.5 mb-1.5" {...p} />,
  h4: (p) => <h4 className="text-sm font-semibold mt-2 mb-1" {...p} />,
  p: (p) => <p className="my-2 leading-relaxed" {...p} />,
  ul: (p) => <ul className="list-disc ml-6 my-2 space-y-0.5" {...p} />,
  ol: (p) => <ol className="list-decimal ml-6 my-2 space-y-0.5" {...p} />,
  li: (p) => <li className="my-0.5" {...p} />,
  blockquote: (p) => (
    <blockquote className="border-l-2 border-zinc-700 pl-3 my-2 text-zinc-400 italic" {...p} />
  ),
  hr: (p) => <hr className="my-3 border-zinc-800" {...p} />,
  a: ({ href, ...p }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-emerald-400 hover:underline"
      {...p}
    />
  ),
  table: (p) => (
    <div className="overflow-x-auto my-2">
      <table className="border-collapse text-xs" {...p} />
    </div>
  ),
  thead: (p) => <thead className="bg-zinc-900" {...p} />,
  th: (p) => <th className="border border-zinc-800 px-2 py-1 text-left font-semibold" {...p} />,
  td: (p) => <td className="border border-zinc-800 px-2 py-1" {...p} />,
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...rest }) => {
    const inline = !className
    const text = String(children).replace(/\n$/, '')
    if (inline) {
      return (
        <code
          className="px-1 py-0.5 rounded bg-zinc-800 text-emerald-200 text-[0.9em] font-mono"
          {...rest}
        >
          {children}
        </code>
      )
    }
    const m = /language-(\w+)/.exec(className ?? '')
    const lang = m?.[1] ?? 'text'
    return (
      <div className="my-2 rounded-md overflow-hidden border border-zinc-800">
        <div className="px-3 py-1 bg-zinc-900 text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
          {lang}
        </div>
        <SyntaxHighlighter
          language={lang}
          style={oneDark}
          PreTag="div"
          customStyle={{
            margin: 0,
            padding: '12px',
            fontSize: '12.5px',
            background: '#0a0a0a'
          }}
          codeTagProps={{ style: { fontFamily: 'ui-monospace, SFMono-Regular, monospace' } }}
        >
          {text}
        </SyntaxHighlighter>
      </div>
    )
  }
}

function MessageContentImpl({
  text,
  sources
}: {
  text: string
  sources?: Source[]
}): React.JSX.Element {
  // sources 가 있으면 inline citation 변환을 추가한 components 사용
  const finalComponents: Components = sources && sources.length > 0
    ? {
        ...components,
        p: ({ children, ...p }) => (
          <p className="my-2 leading-relaxed" {...p}>
            {transformWithCitations(children, sources, 'p')}
          </p>
        ),
        li: ({ children, ...p }) => (
          <li className="my-0.5" {...p}>
            {transformWithCitations(children, sources, 'li')}
          </li>
        ),
        strong: ({ children, ...p }) => (
          <strong {...p}>{transformWithCitations(children, sources, 'st')}</strong>
        ),
        em: ({ children, ...p }) => (
          <em {...p}>{transformWithCitations(children, sources, 'em')}</em>
        )
      }
    : components

  return (
    <div className="text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={finalComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

const MessageContent = memo(MessageContentImpl)
export default MessageContent
