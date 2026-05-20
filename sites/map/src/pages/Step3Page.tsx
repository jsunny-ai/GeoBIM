import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import "maplibre-gl/dist/maplibre-gl.css"
import { ArrowLeft, Eye, EyeOff, Layers, Map as MapIcon, Sliders, Globe } from "lucide-react"
import { useVoxelViewer, type VisibilityState } from "@/features/voxel/useVoxelViewer"
import { parseUrlParams, fetchBoreholesByBbox } from "@/lib/parseUrl"
import type { Borehole } from "@/lib/types"
import { cn } from "@/lib/utils"

// STRATA_LEGEND와 동기화 — moderate_rock 제거
const GROUPS = [
  { key: "soil",           label: "토사 계열",  color: "#8B7355" },
  { key: "weathered_rock", label: "풍화암",     color: "#C4A57B" },
  { key: "soft_rock",      label: "연암 계열",  color: "#6B8E5A" },
  { key: "hard_rock",      label: "경암 계열",  color: "#3D3D3D" },
] as const

const CELL_SIZES = [5, 10, 20, 50] as const

type Basemap = "Satellite" | "Hybrid" | "Base" | "gray" | "midnight" | "osm"

// URL 파라미터 파싱 (동기, mock 없음)
const { polygon, boreholeIds, bbox, error: parseError } = parseUrlParams()

export default function Step3Page() {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)

  // 시추공 데이터 — API에서 비동기 fetch
  const [boreholes, setBoreholes] = useState<Borehole[]>([])
  const [fetchStatus, setFetchStatus] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [fetchErr, setFetchErr] = useState<string | null>(null)

  const [cellSizeM, setCellSizeM] = useState<number>(10)
  const [verticalExag, setVerticalExag] = useState<number>(15)
  const [visibility, setVisibility] = useState<VisibilityState>({
    soil: true, weathered_rock: true, soft_rock: true, hard_rock: true, boreholes: true,
  })

  const [basemap, setBasemap] = useState<Basemap>("Satellite")
  const [zMode, setZMode] = useState<"gl" | "absolute">("gl")
  const [radius, setRadius] = useState<number>(20)
  const [alpha, setAlpha] = useState<number>(200)
  const [show2D, setShow2D] = useState<boolean>(true)
  const [showSolid, setShowSolid] = useState<boolean>(false)
  const [layerVisible, setLayerVisible] = useState<boolean[]>([true, true, true, true])

  // bbox 기반 시추공 fetch (마운트 시 1회)
  useEffect(() => {
    if (!bbox) return
    setFetchStatus("loading")
    fetchBoreholesByBbox(bbox)
      .then((bhs) => {
        const filtered = boreholeIds.length > 0
          ? bhs.filter((b) => boreholeIds.includes(b.id))
          : bhs
        setBoreholes(filtered)
        setFetchStatus("done")
      })
      .catch((e) => { setFetchErr(e.message); setFetchStatus("error") })
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  useVoxelViewer(
    containerRef,
    polygon ?? [],
    boreholes,
    { cellSizeM, verticalExag },
    visibility,
    { basemap, zMode, radius, alpha, show2D, showSolid, layerVisible }
  )

  function toggleGroup(key: keyof VisibilityState) {
    setVisibility((v) => ({ ...v, [key]: !v[key] }))
  }
  function toggleLayerVisible(idx: number) {
    setLayerVisible((prev) => prev.map((v, j) => (j === idx ? !v : v)))
  }

  const params = window.location.search

  if (parseError || !polygon) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground flex-col gap-4">
        <p className="text-sm text-destructive">{parseError ?? "폴리곤 없음 — 1단계에서 영역을 그려주세요."}</p>
        <button
          onClick={() => navigate("/")}
          className="text-xs text-muted-foreground underline"
        >
          ← 지도로 돌아가기
        </button>
      </div>
    )
  }

  return (
    <div className="relative h-screen bg-black overflow-hidden select-none">
      {/* 3D Map 컨테이너 */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* fetch 상태 오버레이 */}
      {fetchStatus === "loading" && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-black/80 text-white text-xs px-4 py-2 rounded-full animate-pulse">
          시추공 데이터 로딩 중…
        </div>
      )}
      {fetchStatus === "error" && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-red-900/80 text-red-200 text-xs px-4 py-2 rounded-full">
          ⚠ {fetchErr}
        </div>
      )}
      {fetchStatus === "done" && boreholes.length === 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-yellow-900/80 text-yellow-200 text-xs px-4 py-2 rounded-full">
          선택 영역에 시추공이 없습니다
        </div>
      )}

      {/* 상단 바 — 내부 navigate 사용 */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10
        bg-card/90 backdrop-blur-md border border-border/80 rounded-full px-5 py-2
        flex items-center gap-4 shadow-xl shadow-black/40">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-semibold"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> 1단계
        </button>
        <div className="h-4 w-[1px] bg-border/50" />
        <button
          onClick={() => navigate("/step2" + params)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          2단계 (지형 솔리드)
        </button>
        <div className="h-4 w-[1px] bg-border/50" />
        <span className="text-xs font-bold text-sky-400">3단계 · 지층 분석</span>
        <div className="h-4 w-[1px] bg-border/50" />
        <span className="text-[11px] text-muted-foreground bg-muted/65 px-2 py-0.5 rounded-full border border-border/50">
          시추공 {boreholes.length}개 · 셀 {cellSizeM}m
        </span>
      </div>

      {/* 우측 상단 힌트 */}
      <div className="absolute top-3 right-3 z-10
        bg-card/85 backdrop-blur border border-border/80 rounded-lg px-3 py-2
        text-[10px] text-muted-foreground font-medium flex flex-col gap-0.5 pointer-events-none shadow-md">
        <span>드래그 = 3D 회전</span>
        <span>Shift + 드래그 = 팬</span>
        <span>스크롤 = 줌</span>
      </div>

      {/* 우하단 컨트롤 패널 */}
      <div className="absolute bottom-4 right-4 z-10 w-80 max-h-[85vh] overflow-y-auto
        bg-[#0b0f19]/95 backdrop-blur-md border border-slate-800 rounded-xl p-4
        flex flex-col gap-4 shadow-2xl shadow-black/80">

        <div className="flex items-center gap-1.5 border-b border-slate-800/80 pb-2">
          <Sliders className="h-4 w-4 text-sky-400" />
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">3D 지층 분석 패널</h2>
        </div>

        {/* 배경 지도 */}
        <div>
          <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1 mb-1.5">
            <MapIcon className="h-3 w-3 text-sky-500" /> 배경 지도
          </label>
          <select
            value={basemap}
            onChange={(e) => setBasemap(e.target.value as Basemap)}
            className="w-full bg-slate-900 border border-slate-700/80 text-xs text-white rounded-md px-2.5 py-1.5 outline-none"
          >
            <option value="Satellite">항공 위성사진 (V-World)</option>
            <option value="Hybrid">위성 + 행정경계 (V-World)</option>
            <option value="Base">일반 전자지도 (V-World)</option>
            <option value="gray">그레이 백지도 (V-World)</option>
            <option value="midnight">야간지도 (V-World)</option>
            <option value="osm">OpenStreetMap</option>
          </select>
        </div>

        {/* 레이어 토글 */}
        <div>
          <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1 mb-1.5">
            <Layers className="h-3 w-3 text-sky-500" /> 레이어 제어
          </label>
          <div className="grid grid-cols-3 gap-1">
            {(["boreholes", "show2D", "showSolid"] as const).map((key) => {
              const labels = { boreholes: "시추공", show2D: "2D 범위", showSolid: "3D 솔리드" }
              const active = key === "boreholes" ? visibility.boreholes : key === "show2D" ? show2D : showSolid
              const toggle = () => {
                if (key === "boreholes") toggleGroup("boreholes")
                else if (key === "show2D") setShow2D((v) => !v)
                else setShowSolid((v) => !v)
              }
              return (
                <button key={key} onClick={toggle}
                  className={cn("text-[10px] font-bold py-1.5 rounded-md border transition-all",
                    active ? "bg-sky-600/90 text-white border-sky-500"
                           : "bg-slate-900 text-slate-400 border-slate-800")}>
                  {labels[key]}
                </button>
              )
            })}
          </div>
        </div>

        {/* Z축 모드 */}
        <div>
          <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1 mb-1.5">
            <Globe className="h-3 w-3 text-sky-500" /> Z축 모드
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {(["gl", "absolute"] as const).map((m) => (
              <button key={m} onClick={() => setZMode(m)}
                className={cn("text-[10px] font-bold py-1.5 rounded-md border transition-all",
                  zMode === m ? "bg-amber-600/90 text-white border-amber-500"
                              : "bg-slate-900 text-slate-400 border-slate-800")}>
                {m === "gl" ? "GL 정렬" : "표고 보존"}
              </button>
            ))}
          </div>
        </div>

        {/* 슬라이더 */}
        <div className="flex flex-col gap-2.5 border-t border-slate-800/80 pt-3">
          {/* 복셀 크기 */}
          <div>
            <p className="text-[11px] font-bold text-slate-400 mb-1.5">복셀 크기</p>
            <div className="flex gap-1">
              {CELL_SIZES.map((s) => (
                <button key={s} onClick={() => setCellSizeM(s)}
                  className={cn("flex-1 text-center text-xs py-1 rounded border transition-colors",
                    cellSizeM === s ? "bg-sky-950/80 text-sky-300 border-sky-500/50 font-bold"
                                    : "bg-slate-900 text-slate-400 border-slate-800")}>
                  {s}m
                </button>
              ))}
            </div>
          </div>

          {([
            ["수직 과장", verticalExag, 1, 60, 1, "배", setVerticalExag],
            ["컬럼 반경", radius, 3, 40, 1, "m", setRadius],
            ["투명도", Math.round((alpha / 255) * 100), 30, 100, 1, "%",
              (v: number) => setAlpha(Math.round((v / 100) * 255))],
          ] as [string, number, number, number, number, string, (v: number) => void][]).map(([label, val, min, max, step, suffix, set]) => (
            <div key={label}>
              <div className="flex items-center justify-between text-[11px] mb-1 font-bold">
                <span className="text-slate-400">{label}</span>
                <span className="text-sky-300 bg-sky-950/60 border border-sky-500/20 px-1.5 rounded">{val}{suffix}</span>
              </div>
              <input type="range" min={min} max={max} step={step} value={val}
                onChange={(e) => set(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-400" />
            </div>
          ))}
        </div>

        {/* 지층별 토글 */}
        <div className="border-t border-slate-800/80 pt-3">
          <p className="text-[11px] font-bold text-slate-400 mb-2">지층별 표시 제어</p>
          <div className="flex flex-col gap-1.5">
            {GROUPS.map(({ key, label, color }, idx) => {
              const active = visibility[key as keyof VisibilityState]
              const visible = layerVisible[idx]
              return (
                <div key={key}
                  className="flex items-center justify-between bg-slate-900/60 border border-slate-800/50 rounded-lg px-2.5 py-1.5">
                  <div onClick={() => toggleLayerVisible(idx)}
                    className="flex items-center gap-2 cursor-pointer flex-1">
                    <span className={cn("h-3.5 w-3.5 rounded shrink-0 border border-white/10 transition-opacity", !visible && "opacity-20")}
                      style={{ backgroundColor: color }} />
                    <span className={cn("text-xs font-semibold transition-all", visible ? "text-slate-200" : "text-slate-500 line-through")}>
                      {label}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button onClick={() => toggleGroup(key as keyof VisibilityState)}
                      className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold transition-colors",
                        active ? "bg-slate-800 text-sky-400" : "bg-slate-950 text-slate-600 line-through")}>
                      {active ? "ON" : "OFF"}
                    </button>
                    <button onClick={() => toggleLayerVisible(idx)}>
                      {visible ? <Eye className="h-3.5 w-3.5 text-sky-400/80" />
                               : <EyeOff className="h-3.5 w-3.5 text-slate-600" />}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
