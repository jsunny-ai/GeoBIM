import { useEffect, useRef, useState, useCallback, type ReactNode } from "react"
import "maplibre-gl/dist/maplibre-gl.css"
import { ArrowLeft, Eye, EyeOff } from "lucide-react"
import { useVoxelViewer, type VisibilityState } from "@/features/voxel/useVoxelViewer"
import { parseUrlParams, fetchBoreholesByBbox } from "@/lib/parseUrl"
import type { Borehole } from "@/lib/types"

const GROUPS = [
  { key: "soil",           label: "토사 계열",  color: "#8B7355" },
  { key: "weathered_rock", label: "풍화암",     color: "#C4A57B" },
  { key: "soft_rock",      label: "연암 계열",  color: "#6B8E5A" },
  { key: "hard_rock",      label: "경암 계열",  color: "#3D3D3D" },
] as const

const CELL_SIZES = [5, 10, 20, 50] as const

type Basemap = "Satellite" | "Hybrid" | "Base" | "gray" | "midnight" | "osm"

// ── 색상 팔레트 (KH_Geo 동일) ────────────────────────────────
const C = {
  bgDark:   "#0f172a",
  panel:    "rgba(30, 41, 59, 0.95)",
  panelAlt: "rgba(15, 23, 42, 0.95)",
  border:   "rgba(255,255,255,0.1)",
  text:     "#f8fafc",
  muted:    "#94a3b8",
  primary:  "#4f46e5",
  accent:   "#10b981",
  red:      "#ef4444",
  logText:  "#a7f3d0",
} as const

const { polygon, boreholeIds, bbox, error: parseError } = parseUrlParams()

export default function Viewer3DPage() {
  const containerRef = useRef<HTMLDivElement>(null)

  const [boreholes, setBoreholes]     = useState<Borehole[]>([])
  const [fetchStatus, setFetchStatus] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [fetchErr, setFetchErr]       = useState<string | null>(null)

  const [cellSizeM, setCellSizeM]       = useState<number>(10)
  const [verticalExag, setVerticalExag] = useState<number>(15)
  const [visibility, setVisibility]     = useState<VisibilityState>({
    soil: true, weathered_rock: true, soft_rock: true, hard_rock: true, boreholes: true,
  })

  const [basemap, setBasemap]         = useState<Basemap>("Satellite")
  const [zMode, setZMode]             = useState<"gl" | "absolute">("gl")
  const [radius, setRadius]           = useState<number>(20)
  const [alpha, setAlpha]             = useState<number>(200)
  const [show2D, setShow2D]           = useState<boolean>(true)
  const [showSolid, setShowSolid]     = useState<boolean>(false)
  const [layerVisible, setLayerVisible] = useState<boolean[]>([true, true, true, true])

  // 로그 패널
  const [logCollapsed, setLogCollapsed] = useState(false)
  const [logs, setLogs] = useState<string[]>(["3D 지층 모델 초기화 중..."])
  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev.slice(-49), `> ${msg}`])
  }, [])

  useEffect(() => {
    if (!bbox) return
    setFetchStatus("loading")
    addLog("시추공 데이터 로딩 중...")
    fetchBoreholesByBbox(bbox)
      .then((bhs) => {
        const filtered = boreholeIds.length > 0
          ? bhs.filter((b) => boreholeIds.includes(b.id))
          : bhs
        setBoreholes(filtered)
        setFetchStatus("done")
        addLog(`시추공 ${filtered.length}개 로드 완료`)
      })
      .catch((e) => {
        setFetchErr(e.message)
        setFetchStatus("error")
        addLog(`오류: ${e.message}`)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  const logPanelHeight = logCollapsed ? 36 : 100

  if (parseError || !polygon) {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center",
        background: C.bgDark, color: C.text, flexDirection: "column", gap: 16 }}>
        <p style={{ fontSize: 13, color: C.red }}>{parseError ?? "폴리곤 없음"}</p>
        <a href="http://localhost:5172/" style={{ fontSize: 12, color: C.muted, textDecoration: "underline" }}>
          ← 지도로 돌아가기
        </a>
      </div>
    )
  }

  return (
    <div style={{ position: "relative", height: "100vh", background: "#000", overflow: "hidden", userSelect: "none" }}>
      {/* 3D 컨테이너 */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* ── 상단 정보바 (유지) ─────────────────────────────── */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10
        bg-card/90 backdrop-blur-md border border-border/80 rounded-full px-5 py-2
        flex items-center gap-4 shadow-xl shadow-black/40">
        <button
          onClick={() => { window.location.href = "http://localhost:5172/" }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-semibold"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> 지도로
        </button>
        <div className="h-4 w-[1px] bg-border/50" />
        <span className="text-xs font-bold text-sky-400">GeoBIM & KH_Geo</span>
        <span className="text-xs font-semibold text-foreground">3D 지층 분석 플랫폼</span>
        <div className="h-4 w-[1px] bg-border/50" />
        <span className="text-[11px] text-muted-foreground bg-muted/65 px-2 py-0.5 rounded-full border border-border/50">
          시추공 {boreholes.length}개 · 셀 {cellSizeM}m
        </span>
      </div>

      {/* ── 좌측: 3D 컨트롤 패널 (KH_Geo 배치) ────────────── */}
      <div style={{
        position: "absolute", top: 20, left: 20, width: 250, zIndex: 2001,
        maxHeight: `calc(100vh - ${logPanelHeight + 40}px)`,
        overflowY: "auto", background: C.panel,
        border: `1px solid ${C.border}`, borderRadius: 8,
        backdropFilter: "blur(10px)", color: C.text,
        display: "flex", flexDirection: "column", gap: 0,
        scrollbarWidth: "thin",
      }}>
        {/* 헤더 */}
        <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, letterSpacing: "0.08em", marginBottom: 8 }}>
            3D 컨트롤
          </div>
          {/* 2D 복귀 버튼 */}
          <button
            onClick={() => { window.location.href = "http://localhost:5172/" }}
            style={{
              width: "100%", padding: "7px 0", borderRadius: 6,
              background: "rgba(239,68,68,0.15)", border: `1px solid ${C.red}`,
              color: C.red, fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}
          >
            ✕  2D 지도로 복귀
          </button>
        </div>

        <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* 배경 지도 */}
          <CtrlGroup label="🗺️ 배경 지도">
            <select
              value={basemap}
              onChange={(e) => setBasemap(e.target.value as Basemap)}
              style={{
                width: "100%", padding: "5px 8px", borderRadius: 5,
                background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`,
                color: C.text, fontSize: 11, cursor: "pointer",
              }}
            >
              <option value="Satellite">항공 위성사진</option>
              <option value="Hybrid">위성 + 행정경계</option>
              <option value="Base">일반 전자지도</option>
              <option value="gray">그레이 백지도</option>
              <option value="midnight">미드나잇 야간</option>
              <option value="osm">OpenStreetMap</option>
            </select>
          </CtrlGroup>

          {/* 지층 투명도 */}
          <CtrlGroup label={`지층 투명도  ${Math.round((alpha / 255) * 100)}%`}>
            <input type="range" min={80} max={255} step={1} value={alpha}
              onChange={(e) => setAlpha(Number(e.target.value))}
              style={{ width: "100%", accentColor: C.accent }} />
          </CtrlGroup>

          {/* 지층 그룹 토글 */}
          <CtrlGroup label="지층 그룹 토글">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {GROUPS.map(({ key, label, color }, idx) => {
                const grpOn = visibility[key]
                const layOn = layerVisible[idx]
                return (
                  <div key={key} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: "rgba(255,255,255,0.04)", borderRadius: 5, padding: "4px 8px",
                    border: `1px solid ${C.border}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                      onClick={() => toggleLayerVisible(idx)}>
                      <span style={{
                        width: 12, height: 12, borderRadius: 3,
                        background: color, flexShrink: 0,
                        opacity: layOn ? 1 : 0.2,
                      }} />
                      <span style={{ fontSize: 11, color: layOn ? C.text : C.muted }}>
                        {label}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button onClick={() => toggleGroup(key)} style={{
                        fontSize: 10, padding: "1px 5px", borderRadius: 3,
                        background: grpOn ? "rgba(79,70,229,0.2)" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${grpOn ? C.primary : C.border}`,
                        color: grpOn ? "#a5b4fc" : C.muted, cursor: "pointer",
                      }}>
                        {grpOn ? "ON" : "OFF"}
                      </button>
                      <button onClick={() => toggleLayerVisible(idx)} style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: layOn ? C.accent : C.muted, padding: 0,
                        display: "flex", alignItems: "center",
                      }}>
                        {layOn
                          ? <Eye style={{ width: 13, height: 13 }} />
                          : <EyeOff style={{ width: 13, height: 13 }} />}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </CtrlGroup>

          {/* 수직 과장 */}
          <CtrlGroup label={`수직 과장  ${verticalExag}x`}>
            <input type="range" min={1} max={60} step={1} value={verticalExag}
              onChange={(e) => setVerticalExag(Number(e.target.value))}
              style={{ width: "100%", accentColor: C.accent }} />
          </CtrlGroup>

          {/* 셀 크기 */}
          <CtrlGroup label="복셀 셀 크기">
            <div style={{ display: "flex", gap: 4 }}>
              {CELL_SIZES.map((s) => (
                <button key={s} onClick={() => setCellSizeM(s)} style={{
                  flex: 1, padding: "4px 0", borderRadius: 4, fontSize: 11,
                  background: cellSizeM === s ? "rgba(79,70,229,0.3)" : "rgba(255,255,255,0.06)",
                  border: `1px solid ${cellSizeM === s ? C.primary : C.border}`,
                  color: cellSizeM === s ? "#a5b4fc" : C.muted, cursor: "pointer", fontWeight: cellSizeM === s ? 700 : 400,
                }}>{s}m</button>
              ))}
            </div>
          </CtrlGroup>

          {/* 시추공 반경 */}
          <CtrlGroup label={`시추공 반경  ${radius}m`}>
            <input type="range" min={3} max={40} step={1} value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              style={{ width: "100%", accentColor: C.accent }} />
          </CtrlGroup>

          {/* 좌표 모드 */}
          <CtrlGroup label="Z축 모드">
            <div style={{ display: "flex", gap: 4 }}>
              {(["gl", "absolute"] as const).map((m) => (
                <button key={m} onClick={() => setZMode(m)} style={{
                  flex: 1, padding: "4px 0", borderRadius: 4, fontSize: 10,
                  background: zMode === m ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.06)",
                  border: `1px solid ${zMode === m ? "#f59e0b" : C.border}`,
                  color: zMode === m ? "#fbbf24" : C.muted, cursor: "pointer",
                }}>
                  {m === "gl" ? "GL drape" : "해수고 절대"}
                </button>
              ))}
            </div>
          </CtrlGroup>

          {/* 레이어 가시화 */}
          <CtrlGroup label="레이어 표시">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {[
                { label: "🔭 시추공",  active: visibility.boreholes, onClick: () => toggleGroup("boreholes") },
                { label: "🗺 2D 범위", active: show2D,               onClick: () => setShow2D((v) => !v) },
                { label: "🧱 3D 솔리드", active: showSolid,          onClick: () => setShowSolid((v) => !v) },
              ].map(({ label, active, onClick }) => (
                <button key={label} onClick={onClick} style={{
                  padding: "5px 8px", borderRadius: 5, fontSize: 11, cursor: "pointer",
                  background: active ? "rgba(79,70,229,0.2)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${active ? C.primary : C.border}`,
                  color: active ? "#a5b4fc" : C.muted, textAlign: "left",
                }}>{label}</button>
              ))}
            </div>
          </CtrlGroup>

        </div>
      </div>

      {/* ── 우상단 힌트 ────────────────────────────────────── */}
      <div className="absolute top-3 right-3 z-10
        bg-card/85 backdrop-blur border border-border/80 rounded-lg px-3 py-2
        text-[10px] text-muted-foreground font-medium flex flex-col gap-0.5 pointer-events-none shadow-md">
        <span>🖱 드래그 = 3D 회전</span>
        <span>Shift + 드래그 = 지도 이동</span>
        <span>스크롤 = 줌 인/아웃</span>
      </div>

      {/* ── fetch 상태 오버레이 ─────────────────────────────── */}
      {fetchStatus === "loading" && (
        <div style={{
          position: "absolute", bottom: logPanelHeight + 10, left: "50%", transform: "translateX(-50%)",
          zIndex: 20, background: "rgba(0,0,0,0.8)", color: C.text,
          fontSize: 12, padding: "6px 16px", borderRadius: 20,
        }}>
          시추공 데이터 로딩 중…
        </div>
      )}
      {fetchStatus === "error" && (
        <div style={{
          position: "absolute", bottom: logPanelHeight + 10, left: "50%", transform: "translateX(-50%)",
          zIndex: 20, background: "rgba(127,29,29,0.8)", color: "#fca5a5",
          fontSize: 12, padding: "6px 16px", borderRadius: 20,
        }}>
          ⚠ {fetchErr}
        </div>
      )}
      {fetchStatus === "done" && boreholes.length === 0 && (
        <div style={{
          position: "absolute", bottom: logPanelHeight + 10, left: "50%", transform: "translateX(-50%)",
          zIndex: 20, background: "rgba(120,53,15,0.8)", color: "#fde68a",
          fontSize: 12, padding: "6px 16px", borderRadius: 20,
        }}>
          선택 영역에 시추공이 없습니다
        </div>
      )}

      {/* ── 하단: 시스템 로그 ────────────────────────────────── */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: logPanelHeight, zIndex: 2000,
        background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(4px)",
        borderTop: `1px solid ${C.border}`,
        transition: "height 0.3s cubic-bezier(0.4,0,0.2,1)",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 12px", height: 36, flexShrink: 0, cursor: "pointer",
        }} onClick={() => setLogCollapsed((v) => !v)}>
          <span style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>시스템 로그</span>
          <span style={{ fontSize: 11, color: C.muted }}>{logCollapsed ? "▲" : "▼"}</span>
        </div>
        {!logCollapsed && (
          <div style={{
            flex: 1, overflowY: "auto", padding: "0 12px 6px",
            fontFamily: "monospace", fontSize: 11, color: C.logText,
          }}>
            {logs.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </div>

      <style>{`select option { background: #1e293b; color: #f8fafc; }`}</style>
    </div>
  )
}

// ── 재사용 컨트롤 그룹 ────────────────────────────────────────
function CtrlGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}
