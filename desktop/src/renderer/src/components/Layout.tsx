import { NavLink, Outlet } from 'react-router-dom'
import ConnectionStatus from './ConnectionStatus'
import LlamaStatus from './LlamaStatus'
import ConversationList from './ConversationList'

export default function Layout(): React.JSX.Element {
  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      <aside className="w-64 border-r border-zinc-800 flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h1 className="text-base font-semibold tracking-tight">GeneralChat</h1>
          <p className="text-[11px] text-zinc-500 mt-0.5">local LLM playground</p>
        </div>

        <ConversationList />

        <nav className="px-2 py-2 space-y-1 border-t border-zinc-800">
          <SidebarLink to="/" label="Home" />
          <SidebarLink to="/models" label="Models" />
          <SidebarLink to="/settings" label="Settings" />
        </nav>

        <div className="p-3 border-t border-zinc-800 space-y-3">
          <LlamaStatus />
          <ConnectionStatus />
        </div>
      </aside>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}

function SidebarLink({
  to,
  label
}: {
  to: string
  label: string
}): React.JSX.Element {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `block px-3 py-1.5 rounded text-sm transition-colors ${
          isActive
            ? 'bg-zinc-800 text-zinc-50'
            : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
        }`
      }
    >
      {label}
    </NavLink>
  )
}
