import { Map, Upload, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Props {
  active?: "projects" | "map" | "upload"
}

async function handleLogout() {
  try {
    await fetch("http://localhost:8000/api/v1/auth/logout", {
      method: "POST",
      credentials: "include",
    })
  } finally {
    window.location.href = "http://localhost:5170/"
  }
}

export default function Navbar({ active }: Props) {
  return (
    <header className="h-12 border-b border-border bg-card px-4 flex items-center justify-between shrink-0">
      <a href="/" className="flex items-center gap-2">
        <div className="h-6 w-6 rounded bg-gradient-to-br from-sky-400 to-indigo-500" />
        <span className="text-sm font-semibold">GeoBIM Stratum</span>
      </a>

      <nav className="flex items-center gap-1">
        <Button
          variant={active === "projects" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs"
          asChild={false}
          onClick={() => { window.location.href = "http://localhost:5171/" }}
        >
          프로젝트
        </Button>
        <Button
          variant={active === "map" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs"
          onClick={() => { window.location.href = "http://localhost:5172/" }}
        >
          <Map className="mr-1 h-3.5 w-3.5" /> 지도
        </Button>
        <Button
          variant={active === "upload" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs"
          onClick={() => { window.location.href = "http://localhost:5174/" }}
        >
          <Upload className="mr-1 h-3.5 w-3.5" /> 업로드
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={handleLogout}
        >
          <LogOut className="mr-1 h-3.5 w-3.5" /> 로그아웃
        </Button>
      </nav>
    </header>
  )
}
