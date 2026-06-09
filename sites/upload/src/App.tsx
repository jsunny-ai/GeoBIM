import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import type { Project, Tab } from "./lib/types"
import { TABS } from "./lib/constants"
import { apiGet } from "./lib/api"
import { NavBar } from "./components/NavBar"
import { AutoParseTab } from "./components/AutoParseTab"
import { ManualParseTab } from "./components/ManualParseTab"

export default function App() {
  const [tab, setTab] = useState<Tab>("auto")
  const [projects, setProjects] = useState<Project[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [autoReviewReady, setAutoReviewReady] = useState(false)
  const [manualReviewReady, setManualReviewReady] = useState(false)

  // URL 파라미터: project_id (잠금), return_url (완료 후 복귀)
  const urlParams = new URLSearchParams(window.location.search)
  const lockedProjectId = urlParams.get("project_id") ? Number(urlParams.get("project_id")) : undefined
  const returnUrl = urlParams.get("return_url") ?? undefined

  useEffect(() => {
    if (lockedProjectId) {
      setProjects([{ id: lockedProjectId, name: `Project #${lockedProjectId}` }])
      setLoadingProjects(false)
      setProjectError(null)
      return
    }

    let mounted = true
    apiGet<Project[]>("/api/v1/projects/?has_bbox=true")
      .then((data) => {
        if (mounted) setProjects(data)
      })
      .catch((err) => {
        if (mounted) {
          console.warn("프로젝트 목록을 불러오지 못했습니다.", err)
          setProjects([])
          setProjectError(null)
        }
      })
      .finally(() => {
        if (mounted) setLoadingProjects(false)
      })
    return () => {
      mounted = false
    }
  }, [lockedProjectId])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NavBar />

      {/* 프로젝트 연동 배너 */}
      {lockedProjectId && (
        <div className="border-b border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm text-sky-200 flex items-center justify-between">
          <span>
            시추 관리에서 연동됨 — 저장된 데이터는 해당 프로젝트에 자동 반영됩니다.
          </span>
          {returnUrl && (
            <a
              href={returnUrl}
              className="text-xs text-sky-100 hover:underline underline-offset-2"
            >
              ← 시추 관리로 돌아가기
            </a>
          )}
        </div>
      )}

      <main className={cn("mx-auto space-y-6 px-4 py-8", (tab === "auto" && autoReviewReady) || (tab === "manual" && manualReviewReady) ? "max-w-[1600px]" : "max-w-2xl")}>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">PDF 업로드</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            시추 주상도 문서를 업로드하여 지층 데이터를 추출합니다.
          </p>
        </div>

        <div className="flex rounded-lg border border-border bg-card/40 p-1">
          {TABS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                tab === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {projectError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {projectError}
          </div>
        )}

        {tab === "auto" ? (
          <AutoParseTab
            projects={projects}
            loadingProjects={loadingProjects}
            lockedProjectId={lockedProjectId}
            returnUrl={returnUrl}
            onReviewReadyChange={setAutoReviewReady}
          />
        ) : (
          <ManualParseTab
            projects={projects}
            loadingProjects={loadingProjects}
            lockedProjectId={lockedProjectId}
            returnUrl={returnUrl}
            onReviewReadyChange={setManualReviewReady}
          />
        )}
      </main>
    </div>
  )
}
