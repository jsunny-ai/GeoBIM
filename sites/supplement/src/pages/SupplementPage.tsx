import { useState, useEffect, useCallback } from "react"
import { parseUrlParams, fetchBoreholes } from "@/lib/parseUrl"
import type { Borehole, ExportOptions, InterpolationMode } from "@/lib/types"
import ExistingBoreholeList from "@/components/ExistingBoreholeList"
import NewBoreholeForm from "@/components/NewBoreholeForm"
import ExportPanel from "@/components/ExportPanel"

// ── 색상 팔레트 (KH Geo Stone + Amber 라이트 테마) ───────────────
const C = {
  bg:        "#faf8f5",
  panel:     "rgba(250,248,245,.97)",
  inner:     "#f2ede6",
  border:    "#e9e4da",
  text:      "#1c1917",
  secondary: "#44403c",
  tertiary:  "#78716c",
  btnActive: "#D4D1CB",
  btnBorder: "#BEBAB3",
  btnIdle:   "#f2ede6",
  btnIdleBd: "#e9e4da",
  red:       "#dc2626",
  green:     "#D4D1CB",
  greenBd:   "#BEBAB3",
} as const

const { bbox, polygon, projectId, error: parseError } = parseUrlParams()

export default function SupplementPage() {
  // ── 기존 시추공 ────────────────────────────────────────────────
  const [existingBhs, setExistingBhs] = useState<Borehole[]>([])
  const [loadState, setLoadState]     = useState<"idle" | "loading" | "done" | "error">("idle")
  const [loadErr, setLoadErr]         = useState<string | null>(null)

  // ── 신규 시추공 ────────────────────────────────────────────────
  const [newBhs, setNewBhs] = useState<Borehole[]>([])

  // ── 내보내기 옵션 ──────────────────────────────────────────────
  const [exportOpts, setExportOpts] = useState<ExportOptions>({
    mode: "merge",
    layers: ["soil", "weathered_rock", "soft_rock", "hard_rock"],
    gridRes: 48,
  })

  const [exportState, setExportState] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [exportErr, setExportErr]     = useState<string | null>(null)

  // ── 기존 시추공 로드 ───────────────────────────────────────────
  useEffect(() => {
    if (!bbox) return
    setLoadState("loading")
    fetchBoreholes(bbox, projectId)
      .then((bhs) => {
        setExistingBhs(bhs)
        setLoadState("done")
      })
      .catch((e) => {
        setLoadErr(String(e))
        setLoadState("error")
      })
  }, [])

  // ── 신규 시추공 추가/삭제 ──────────────────────────────────────
  const handleAddNew = useCallback((bh: Borehole) => {
    setNewBhs((prev) => [...prev, { ...bh, id: Date.now(), isNew: true }])
  }, [])

  const handleRemoveNew = useCallback((id: number) => {
    setNewBhs((prev) => prev.filter((b) => b.id !== id))
  }, [])

  // ── LandXML 내보내기 ───────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!bbox) return
    setExportState("loading")
    setExportErr(null)

    try {
      // mode에 따라 전달할 boreholes 결정
      let boreholes: any[] | null = null
      if (exportOpts.mode === "new_only") {
        boreholes = newBhs
      } else if (newBhs.length > 0) {
        // merge: 신규만 추가 전송 (기존은 백엔드 DB에서 자동 조회)
        boreholes = newBhs
      }
      // merge + 신규 없으면 boreholes=null → 백엔드가 DB 전체 사용

      const body = {
        bbox,
        project_id: projectId,
        grid_res: exportOpts.gridRes,
        boreholes,
        layers: exportOpts.layers,
        mode: exportOpts.mode,
      }

      const res = await fetch("/api/v1/export/landxml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(detail.detail ?? res.statusText)
      }

      // 파일 다운로드
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      const cd   = res.headers.get("Content-Disposition") ?? ""
      const fn   = cd.match(/filename="([^"]+)"/)?.[1] ?? "geobim_stratum.xml"
      a.href = url; a.download = fn; a.click()
      URL.revokeObjectURL(url)

      setExportState("done")
      setTimeout(() => setExportState("idle"), 3000)
    } catch (e) {
      setExportErr(String(e))
      setExportState("error")
    }
  }, [bbox, projectId, exportOpts, newBhs])

  // ── URL 에러 화면 ──────────────────────────────────────────────
  if (parseError || !bbox) {
    return (
      <div style={{
        display: "flex", height: "100vh",
        alignItems: "center", justifyContent: "center",
        background: C.bg, color: C.text, flexDirection: "column", gap: 16,
        fontFamily: "'Noto Sans KR',sans-serif",
      }}>
        <p style={{ fontSize: 13, color: C.red }}>{parseError ?? "영역 정보가 없습니다."}</p>
        <a href="http://localhost:5172/" style={{ fontSize: 12, color: C.tertiary, textDecoration: "underline" }}>
          ← 1단계 지도로 돌아가기
        </a>
      </div>
    )
  }

  // ── 메인 레이아웃 ──────────────────────────────────────────────
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100vh", background: C.bg,
      fontFamily: "'Noto Sans KR',-apple-system,sans-serif",
      color: C.text, overflow: "hidden",
    }}>
      {/* ── 헤더 ── */}
      <header style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "10px 20px",
        background: C.panel, borderBottom: `1px solid ${C.border}`,
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 11, color: C.tertiary }}>KH Geo · 3단계</div>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>데이터 보완 · 내보내기</h1>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            onClick={() => {
              const params = new URLSearchParams(window.location.search)
              window.open(`http://localhost:5173/?${params.toString()}`, "_blank")
            }}
            style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer",
              background: C.btnIdle, border: `1px solid ${C.btnIdleBd}`, color: C.secondary,
            }}
          >
            2단계 3D 뷰어로 확인 ↗
          </button>
          <button
            onClick={() => { window.location.href = "http://localhost:5172/" }}
            style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer",
              background: "rgba(232,83,58,.12)", border: `1px solid ${C.red}`, color: C.red,
            }}
          >
            ← 1단계 지도
          </button>
        </div>
      </header>

      {/* ── 요약 배지 ── */}
      <div style={{
        display: "flex", gap: 12, padding: "8px 20px",
        background: C.inner, borderBottom: `1px solid ${C.border}`,
        flexShrink: 0, fontSize: 12, color: C.tertiary,
      }}>
        <span>
          조사 영역: <strong style={{ color: C.secondary }}>
            {bbox[0].toFixed(5)}, {bbox[1].toFixed(5)} ~ {bbox[2].toFixed(5)}, {bbox[3].toFixed(5)}
          </strong>
        </span>
        {projectId && (
          <span>· 프로젝트 ID: <strong style={{ color: C.secondary }}>{projectId}</strong></span>
        )}
        <span>· 기존 시추공: <strong style={{ color: C.secondary }}>{existingBhs.length}개</strong></span>
        {newBhs.length > 0 && (
          <span>· 추가 시추공: <strong style={{ color: "#1c1917" }}>{newBhs.length}개</strong></span>
        )}
      </div>

      {/* ── 3단 본문 ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── 좌측: 기존 시추공 목록 ── */}
        <div style={{
          width: 280, flexShrink: 0, overflowY: "auto",
          borderRight: `1px solid ${C.border}`,
          background: C.panel,
        }}>
          <ExistingBoreholeList
            boreholes={existingBhs}
            loadState={loadState}
            loadErr={loadErr}
          />
        </div>

        {/* ── 중앙: 추가 시추공 입력 ── */}
        <div style={{
          flex: 1, overflowY: "auto",
          borderRight: `1px solid ${C.border}`,
          background: C.inner,
          padding: "16px 20px",
        }}>
          <NewBoreholeForm
            newBhs={newBhs}
            onAdd={handleAddNew}
            onRemove={handleRemoveNew}
          />
        </div>

        {/* ── 우측: 내보내기 패널 ── */}
        <div style={{
          width: 320, flexShrink: 0, overflowY: "auto",
          background: C.panel,
        }}>
          <ExportPanel
            opts={exportOpts}
            setOpts={setExportOpts}
            newBhCount={newBhs.length}
            existingBhCount={existingBhs.length}
            exportState={exportState}
            exportErr={exportErr}
            onExport={handleExport}
          />
        </div>
      </div>
    </div>
  )
}
                         