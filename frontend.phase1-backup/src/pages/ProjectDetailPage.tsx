import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import StratigraphyColumn from "@/features/boreholes/StratigraphyColumn"
import { MOCK_BOREHOLES, MOCK_PROJECTS } from "@/mock/data"
import { cn } from "@/lib/utils"

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const project = MOCK_PROJECTS.find((p) => p.id === id)
  const boreholes = MOCK_BOREHOLES.filter((b) => b.project_id === id)
  const [selectedId, setSelectedId] = useState<string | null>(
    boreholes[0]?.id ?? null,
  )

  const selected = boreholes.find((b) => b.id === selectedId) ?? null

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/projects")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {project?.name ?? `프로젝트 ${id}`}
          </h1>
          <p className="text-sm text-muted-foreground">{project?.region}</p>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* Borehole list */}
        <aside className="flex w-[280px] shrink-0 flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-card/40 p-3">
          <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">
            시추공 목록
          </p>
          {boreholes.length === 0 && (
            <p className="px-2 text-sm text-muted-foreground">
              시추공이 없습니다.
            </p>
          )}
          {boreholes.map((bh) => {
            const totalDepth = bh.strata[bh.strata.length - 1]?.depth_bottom ?? 0
            const isActive = bh.id === selectedId
            return (
              <button
                key={bh.id}
                onClick={() => setSelectedId(bh.id)}
                className={cn(
                  "flex w-full flex-col items-start rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                  isActive
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <span className="font-medium text-foreground">{bh.id}</span>
                <span className="text-xs">
                  표고 {bh.elevation} m · 심도 {totalDepth} m
                </span>
              </button>
            )
          })}
        </aside>

        {/* Stratigraphy panel */}
        <div className="flex-1 overflow-auto rounded-lg border border-border bg-card/40 p-6">
          {selected ? (
            <div className="space-y-3">
              <h2 className="text-base font-semibold">{selected.id} 주상도</h2>
              <StratigraphyColumn borehole={selected} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              좌측에서 시추공을 선택하세요.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
