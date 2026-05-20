import { useState } from "react"
import { useParams } from "react-router-dom"
import { ArrowLeft, Pencil, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useProject } from "@/features/projects/hooks"
import { useBoreholes } from "@/features/boreholes/hooks"
import Navbar from "@/components/Navbar"
import StratigraphyColumn from "@/components/StratigraphyColumn"
import BoreholeEditorPanel from "@/components/BoreholeEditorPanel"
import type { Borehole } from "@/lib/types"

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const projectId = Number(id)

  const { data: project } = useProject(projectId)
  const { data: boreholes, isLoading } = useBoreholes(projectId)

  const [selected, setSelected] = useState<Borehole | null>(null)
  const [editing, setEditing] = useState(false)

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <Navbar active="projects" />

      <div className="flex flex-1 overflow-hidden">
        {/* 좌측: 시추공 목록 */}
        <aside className="w-60 border-r border-border flex flex-col shrink-0">
          <div className="p-3 border-b border-border">
            <a
              href="/"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
            >
              <ArrowLeft className="h-3 w-3" /> 목록으로
            </a>
            <p className="text-xs font-medium leading-snug line-clamp-2">
              {project?.name ?? "…"}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading && (
              <div className="p-3 text-xs text-muted-foreground">로딩 중…</div>
            )}
            {boreholes?.map((b) => (
              <button
                key={b.id}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors ${
                  selected?.id === b.id ? "bg-accent text-accent-foreground" : ""
                }`}
                onClick={() => { setSelected(b); setEditing(false) }}
              >
                <div className="font-medium">{b.name}</div>
                <div className="text-muted-foreground mt-0.5">
                  {b.strata.length}개 지층 · {b.elevation != null ? `${b.elevation}m` : "-"}
                </div>
              </button>
            ))}
            {boreholes?.length === 0 && (
              <div className="p-3 text-xs text-muted-foreground">시추공 없음</div>
            )}
          </div>
        </aside>

        {/* 우측: 주상도 / 편집 패널 */}
        <main className="flex-1 overflow-y-auto p-6">
          {!selected && (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              좌측에서 시추공을 선택하세요
            </div>
          )}

          {selected && (
            <div className="max-w-lg mx-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold">{selected.name}</h2>
                <div className="flex items-center gap-2">
                  {selected.strata.length > 0 && (
                    <Badge variant="slate" className="text-xs">
                      {selected.strata.length}개 지층
                    </Badge>
                  )}
                  <Button
                    size="sm"
                    variant={editing ? "secondary" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => setEditing(!editing)}
                  >
                    {editing
                      ? <><X className="h-3 w-3 mr-1" /> 닫기</>
                      : <><Pencil className="h-3 w-3 mr-1" /> 편집</>
                    }
                  </Button>
                </div>
              </div>

              {editing ? (
                <BoreholeEditorPanel
                  borehole={selected}
                  onClose={() => setEditing(false)}
                />
              ) : (
                <StratigraphyColumn borehole={selected} />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
