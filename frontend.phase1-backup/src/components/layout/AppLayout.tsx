import { NavLink } from "react-router-dom"
import { FolderKanban, Map as MapIcon, Settings, Upload, UserCircle } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

interface MenuItem {
  to: string
  label: string
  icon: typeof FolderKanban
  disabled?: boolean
}

const MENU: MenuItem[] = [
  { to: "/projects", label: "프로젝트",   icon: FolderKanban },
  { to: "/map",      label: "지도",       icon: MapIcon },
  { to: "/upload",   label: "PDF 업로드", icon: Upload },
  { to: "/settings", label: "설정",       icon: Settings, disabled: true },
]

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="relative flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  )
}

function Header() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-2">
        <div className="h-6 w-6 rounded bg-gradient-to-br from-sky-400 to-indigo-500" />
        <span className="text-base font-semibold tracking-tight">GeoBIM Stratum</span>
      </div>
      <button
        type="button"
        className="text-muted-foreground transition hover:text-foreground"
        aria-label="사용자"
      >
        <UserCircle className="h-6 w-6" />
      </button>
    </header>
  )
}

function Sidebar() {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card/40 py-4">
      <nav className="flex flex-col gap-1 px-3">
        {MENU.map((item) => (
          <SidebarItem key={item.to} item={item} />
        ))}
      </nav>
    </aside>
  )
}

function SidebarItem({ item }: { item: MenuItem }) {
  const Icon = item.icon

  if (item.disabled) {
    return (
      <div
        className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/60"
        title="추후 제공 예정"
      >
        <Icon className="h-4 w-4" />
        <span>{item.label}</span>
      </div>
    )
  }

  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-sky-400" />
          )}
          <Icon className="h-4 w-4" />
          <span>{item.label}</span>
        </>
      )}
    </NavLink>
  )
}
