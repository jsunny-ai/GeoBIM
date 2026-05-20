import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import "maplibre-gl/dist/maplibre-gl.css"
import { Map, Pen, X, RotateCcw, Box, Layers, ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useMapLibreMap } from "@/features/map/useMapLibreMap"
import StratigraphyPanel from "@/components/StratigraphyPanel"
import type { Borehole, Project } from "@/lib/types"

type Basemap = "Satellite" | "Hybrid" | "Base" | "gray" | "midnight" | "osm"

const BASEMAP_LABELS: Record<Basemap, string> = {
  Satellite: "항공사진 (V-World)",
  Hybrid:    "위성+라벨 (Hybrid)",
  Base:      "일반지도 (Base)",
  gray:      "백지도 (gray)",
  midnight:  "야간 (midnight)",
  osm:       "OSM (키 불필요)",
}

// shared/strataColor.ts의 STRATA_LEGEND와 동기화 (moderate_rock 제거)
const STRATA_LAYER_LABELS = ["토사 계열", "풍화암", "연암 계열", "경암 계열"]
const STRATA_COLORS       = ["#8B7355",   "#C4A57B", "#6B8E5A",   "#3D3D3D"]

export default function MapPage() {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedBorehole, setSelectedBorehole] = useState<Borehole | null>(null)
  const [projectFilter, setProjectFilter] = useState<number | null>(null)

  // API 상태
  const [allBoreholes, setAllBoreholes] = useState<Borehole[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loadingBh, setLoadingBh] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const [basemap,      setBasemap]      = useState<Basemap>("Satellite")
  const [vexag,        setVexag]        = useState(15)
  const [radius,       setRadius]       = useState(35)
  const [alpha,        setAlpha]        = useState(220)
  const [zMode,        setZMode]        = useState<"gl" | "absolute">("gl")
  const [showColumns,  setShowColumns]  = useState(true)
  const [show2D,       setShow2D]       = useState(false)
  const [showSolid,    setShowSolid]    = useState(false)
  const [layerVisible, setLayerVisible] = useState([true, true, true, true])
  const [ctrlOpen,     setCtrlOpen]     = useState(false)

  // 시추공 전체 로드 (마운트 시 1회, include_strata=true)
  useEffect(() => {
    setLoadingBh(true)
    fetch("/api/v1/boreholes?limit=10000&include_strata=true")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data) => {
        setAllBoreholes(data.boreholes ?? [])
        // 프로젝트 목록은 boreholes에서 추출 (별도 API 없을 경우 대비)
        const projMap = new Map<number, Project>()
        ;(data.boreholes ?? []).forEach((b: Borehole) => {
          if (!projMap.has(b.project_id)) {
            projMap.set(b.project_id, { id: b.project_id, name: `프로젝트 #${b.project_id}`, region: null, borehole_count: 0 })
          }
          projMap.get(b.project_id)!.borehole_count++
        })
        setProjects(Array.from(projMap.values()))
        setLoadErr(null)
      })
      .catch((e) => setLoadErr(e.message))
      .finally(() => setLoadingBh(false))
  }, [])

  // 프로젝트 목록 별도 fetch 시도 (API 있으면 덮어쓰기)
  useEffect(() => {
    fetch("/api/v1/projects?limit=200")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.projects) setProjects(data.projects) })
      .catch(() => { /* 조용히 실패 — boreholes에서 추출한 목록 사용 */ })
  }, [])

  const boreholes = projectFilter
    ? allBoreholes.filter((b) => b.project_id === projectFilter)
    : allBoreholes

  const handleBoreholeClick = useCallback((b: Borehole) => {
    setSelectedBorehole(b)
  }, [])

  const { isDrawing, polygon, selectedBoreholes, startDrawing, cancelDrawing } =
    useMapLibreMap(containerRef, boreholes, handleBoreholeClick, {
      vexag, radius, alpha, zMode,
      showColumns, show2D, showSolid, layerVisible,
      basemap,
    })

  function goto3D() {
    if (!polygon) return
    const polyB64 = btoa(
      JSON.stringify({ type: "Polygon", coordinates: [[...polygon.map((p) => [p.lng, p.lat])]] })
    )
    const ids = selectedBoreholes.map((b) => b.id).join(",")
    // 내부 라우트 /step3 으로 이동 (외부 포트 5173 제거)
    navigate(`/step3?polygon=${polyB64}&boreholes=${ids}`)
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground select-none">
      <header className="h-12 border-b bg-muted/40 px-4 flex items-center justify-between shrink-0 z-10">
        <a href="http://localhost:5171/" className="flex items-center gap-2">
          <div className="h-6 w-6 rounded bg-primary" />
          <span className="text-sm font-bold">GeoBIM Stratum</span>
        </a>
        <nav className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground"
            onClick={() => { window.location.href = "http://localhost:5171/" }}>
            프로젝트
          </Button>
          <Button variant="secondary" size="sm" className="h-8 text-xs">
            <Map className="mr-1 h-3.5 w-3.5" /> 지도 Portal
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground"
            onClick={() => { window.location.href = "http://localhost:5174/" }}>
            업로드
          </Button>
        </nav>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <div ref={containerRef} className="absolute inset-0 z-0" />

        <div className="absolute top-4 left-4 z-10 flex flex-col gap-3 w-60">
          <div className="bg-background/95 backdrop-blur border rounded-xl p-3 flex flex-col gap-1.5 max-h-[220px] shadow-lg">
            <p className="text-xs text-muted-foreground font-bold border-b pb-1.5 shrink-0">
              📁 프로젝트 필터
              {loadingBh && <span className="ml-2 text-[10px] animate-pulse">로딩 중…</span>}
              {loadErr && <span className="ml-2 text-[10px] text-destructive" title={loadErr}>⚠ 오류</span>}
              {!loadingBh && !loadErr && <span className="ml-2 text-[10px] text-muted-foreground">{allBoreholes.length}공</span>}
            </p>
            <div className="overflow-y-auto flex flex-col gap-0.5 pr-1">
              <button
                className={`text-xs px-2 py-1.5 rounded-lg text-left transition-colors hover:bg-accent ${projectFilter === null ? "bg-accent text-accent-foreground font-semibold" : "text-muted-foreground"}`}
                onClick={() => setProjectFilter(null)}>전체 프로젝트</button>
              {projects.map((p) => (
                <button key={p.id}
                  className={`text-xs px-2 py-1.5 rounded-lg text-left transition-colors hover:bg-accent line-clamp-1 ${projectFilter === p.id ? "bg-accent text-accent-foreground font-semibold" : "text-muted-foreground"}`}
                  onClick={() => setProjectFilter(p.id)} title={p.name}>
                  {p.name} <span className="text-[10px] opacity-60">({p.borehole_count})</span>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-background/95 backdrop-blur border rounded-xl p-3 shadow-lg">
            <p className="text-xs text-muted-foreground font-bold mb-1.5">🗺 배경지도</p>
            <select value={basemap} onChange={(e) => setBasemap(e.target.value as Basemap)}
              className="w-full text-xs bg-background border border-border rounded-lg px-2 py-1.5 text-foreground">
              {(Object.keys(BASEMAP_LABELS) as Basemap[]).map((k) => (
                <option key={k} value={k}>{BASEMAP_LABELS[k]}</option>
              ))}
            </select>
          </div>

          <div className="bg-background/95 backdrop-blur border rounded-xl p-3 shadow-lg">
            <button className="flex items-center justify-between w-full text-xs text-muted-foreground font-bold"
              onClick={() => setCtrlOpen((v) => !v)}>
              <span className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" /> 레이어 / 설정</span>
              {ctrlOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {ctrlOpen && (
              <div className="flex flex-col gap-2.5 mt-2.5 border-t pt-2.5">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">레이어 표시</p>
                  <div className="flex gap-1 flex-wrap">
                    {([["시추공", showColumns, setShowColumns], ["2D범위", show2D, setShow2D], ["3D솔리드", showSolid, setShowSolid]] as [string, boolean, (v: (p: boolean) => boolean) => void][]).map(([label, val, set]) => (
                      <button key={label} onClick={() => set((v) => !v)}
                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${val ? "bg-sky-500/20 border-sky-500/50 text-sky-300" : "bg-muted border-border text-muted-foreground"}`}>{label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">좌표 모드</p>
                  <div className="flex gap-1">
                    {(["gl", "absolute"] as const).map((m) => (
                      <button key={m} onClick={() => setZMode(m)}
                        className={`flex-1 text-[10px] px-2 py-0.5 rounded border transition-colors ${zMode === m ? "bg-sky-500/20 border-sky-500/50 text-sky-300" : "bg-muted border-border text-muted-foreground"}`}>
                        {m === "gl" ? "GL정렬" : "표고보존"}
                      </button>
                    ))}
                  </div>
                </div>
                {([
                  ["수직 과장", vexag, 1, 60, "×", setVexag],
                  ["컬럼 반경", radius, 5, 100, "m", setRadius],
                  ["투명도", alpha, 60, 255, "", setAlpha],
                ] as [string, number, number, number, string, (v: number) => void][]).map(([label, val, min, max, suffix, set]) => (
                  <div key={label}>
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                      <span>{label}</span><span>{val}{suffix}</span>
                    </div>
                    <input type="range" min={min} max={max} value={val}
                      onChange={(e) => set(Number(e.target.value))} className="w-full h-1 accent-sky-500" />
                  </div>
                ))}
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">지층별 표시</p>
                  <div className="flex flex-col gap-0.5">
                    {STRATA_LAYER_LABELS.map((label, idx) => (
                      <label key={label} className="flex items-center gap-1.5 text-[10px] cursor-pointer">
                        <input type="checkbox" checked={layerVisible[idx]}
                          onChange={() => setLayerVisible((prev) => prev.map((v, j) => j === idx ? !v : v))}
                          className="w-3 h-3 accent-sky-500" />
                        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: STRATA_COLORS[idx] }} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-background/95 backdrop-blur border rounded-xl p-3 flex flex-col gap-2 shadow-lg">
            <p className="text-xs text-muted-foreground font-bold border-b pb-1.5">📐 분석 영역 지정</p>
            {!isDrawing && !polygon && (
              <Button size="sm" className="w-full text-xs" onClick={startDrawing}>
                <Pen className="mr-1 h-3 w-3" /> 영역 그리기 시작
              </Button>
            )}
            {isDrawing && (
              <>
                <p className="text-[10px] text-muted-foreground bg-muted/50 p-2 rounded border">
                  좌클릭: 점 추가 · 우클릭: 완료 (3점 이상)
                </p>
                <Button size="sm" variant="outline" className="w-full text-xs" onClick={cancelDrawing}>
                  <X className="mr-1 h-3 w-3 text-destructive" /> 그리기 취소
                </Button>
              </>
            )}
            {polygon && !isDrawing && (
              <>
                <div className="flex justify-center">
                  <Badge variant="secondary" className="text-[10px]">시추공 {selectedBoreholes.length}개 선택됨</Badge>
                </div>
                <Button size="sm" className="w-full text-xs" onClick={goto3D} disabled={selectedBoreholes.length === 0}>
                  <Box className="mr-1 h-3 w-3" /> 3D 지층 분석
                </Button>
                <Button size="sm" variant="outline" className="w-full text-xs" onClick={cancelDrawing}>
                  <RotateCcw className="mr-1 h-3 w-3" /> 초기화
                </Button>
              </>
            )}
          </div>
        </div>

        {selectedBorehole && (
          <div className="absolute right-4 top-4 z-10">
            <StratigraphyPanel borehole={selectedBorehole} onClose={() => setSelectedBorehole(null)} />
          </div>
        )}

        <div className="absolute bottom-4 right-4 z-10 bg-background/80 backdrop-blur border rounded-lg px-3 py-1.5 text-[10px] text-muted-foreground">
          드래그=회전 · Shift+드래그=팬 · 스크롤=줌
        </div>
      </div>
    </div>
  )
}
