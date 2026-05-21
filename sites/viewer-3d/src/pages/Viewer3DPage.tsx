import { useEffect, useRef, useState, useCallback, type ReactNode } from "react"
import "maplibre-gl/dist/maplibre-gl.css"
import { useVoxelViewer, type VisibilityState } from "@/features/voxel/useVoxelViewer"
import { parseUrlParams, fetchBoreholesByBbox } from "@/lib/parseUrl"
import type { Borehole } from "@/lib/types"

// ── 지층 색상·레이블 (KH_Geo step3 동일) ────────────────────────────
const LAYER_COLOR: Record<string, string> = {
  soil:          "#8b7355",
  weathered_rock:"#c4a57b",
  soft_rock:     "#6b8e5a",
  hard_rock:     "#3d3d3d",
}
const LAYER_LABEL: Record<string, string> = {
  soil:          "토사 계열",
  weathered_rock:"풍화암",
  soft_rock:     "연암 계열",
  hard_rock:     "경암 계열",
}
const LAYER_KEYS = ["soil", "weathered_rock", "soft_rock", "hard_rock"] as const

const CELL_SIZES = [5, 10, 20, 50] as const
type Basemap = "Satellite" | "Hybrid" | "Base" | "gray" | "midnight" | "osm"

// ── KH_Geo 색상 팔레트 ────────────────────────────────────────────────
const C = {
  bg:        "#0a0e1a",
  panel:     "rgba(15,20,32,.95)",
  inner:     "#10141f",
  border:    "#2a3344",
  text:      "#e8e8e8",
  secondary: "#cbd5e1",
  tertiary:  "#8a9bb8",
  btnActive: "#2473bd",
  btnBorder: "#3084d0",
  btnIdle:   "#1a2030",
  btnIdleBd: "#3a4a6a",
  accent:    "#e8503a",
  success:   "#1f8a4c",
  successBd: "#27a35c",
  input:     "#1a2030",
  red:       "#e85353",
} as const

// ── 공통 스타일 ──────────────────────────────────────────────────────
const panel: React.CSSProperties = {
  position: "absolute", top: 14, left: 14,
  background: C.panel, padding: "14px 16px", borderRadius: 10,
  border: `1px solid ${C.border}`, boxShadow: "0 4px 18px rgba(0,0,0,.5)",
  minWidth: 230, zIndex: 10, color: C.text,
  fontFamily: "'Noto Sans KR',-apple-system,sans-serif",
}
const tablePanel: React.CSSProperties = {
  width: 320, background: "rgba(15,20,32,.98)",
  borderLeft: `1px solid ${C.border}`, color: C.text,
  display: "flex", flexDirection: "column",
  fontFamily: "'Noto Sans KR',sans-serif",
}
const selectStyle: React.CSSProperties = {
  width: "100%", background: C.input, color: C.text,
  border: `1px solid ${C.btnIdleBd}`, borderRadius: 6,
  padding: "6px 8px", fontSize: 13,
  fontFamily: "'Noto Sans KR',sans-serif",
}
const btnBase: React.CSSProperties = {
  padding: "7px 9px", borderRadius: 6,
  fontSize: 12, cursor: "pointer", transition: "all .15s",
  fontFamily: "'Noto Sans KR',sans-serif",
}
const btnActive: React.CSSProperties = {
  ...btnBase, background: C.btnActive, color: "#fff",
  border: `1px solid ${C.btnBorder}`, fontWeight: 600,
}
const btnIdle: React.CSSProperties = {
  ...btnBase, background: C.btnIdle, color: C.secondary,
  border: `1px solid ${C.btnIdleBd}`,
}
const segActive: React.CSSProperties = {
  flex: 1, ...btnBase, background: C.btnActive, color: "#fff",
  border: `1px solid ${C.btnBorder}`, fontWeight: 600,
}
const segIdle: React.CSSProperties = {
  flex: 1, ...btnBase, background: C.btnIdle, color: C.secondary,
  border: `1px solid ${C.btnIdleBd}`,
}
const statusBar: React.CSSProperties = {
  position: "absolute", bottom: 14, left: 14,
  background: "rgba(15,20,32,.92)", padding: "8px 13px", borderRadius: 7,
  fontSize: 11, color: C.secondary, border: `1px solid ${C.border}`, zIndex: 10,
  fontFamily: "'Noto Sans KR',sans-serif", maxWidth: "50vw",
}
const hint: React.CSSProperties = {
  position: "absolute", top: 14, right: 14,
  background: "rgba(15,20,32,.85)", padding: "9px 12px", borderRadius: 6,
  fontSize: 11, color: C.tertiary, border: `1px solid ${C.border}`, zIndex: 10,
  fontFamily: "'Noto Sans KR',sans-serif",
}
const th: React.CSSProperties = {
  textAlign: "left", padding: "6px 8px", color: C.tertiary,
  fontWeight: 600, borderBottom: `1px solid ${C.border}`,
}
const td: React.CSSProperties = { padding: "5px 8px", color: C.secondary }
const tdNum: React.CSSProperties = { ...td, textAlign: "right" }

// ──────────────────────────────────────────────────────────────────────
const { polygon, boreholeIds, bbox, error: parseError } = parseUrlParams()

export default function Viewer3DPage() {
  const containerRef = useRef<HTMLDivElement>(null)

  const [boreholes, setBoreholes]     = useState<Borehole[]>([])
  const [fetchStatus, setFetchStatus] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [fetchErr, setFetchErr]       = useState<string | null>(null)
  const [status, setStatus]           = useState("초기화 중...")
  const [selectedBh, setSelectedBh]   = useState<number | null>(null)

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
  const [renderMode, setRenderMode]   = useState<"smooth" | "voxel">("smooth")

  // 시추공 데이터 로드
  useEffect(() => {
    if (!bbox) return
    setFetchStatus("loading")
    setStatus("시추공 데이터 로딩 중...")
    fetchBoreholesByBbox(bbox)
      .then((bhs) => {
        const filtered = boreholeIds.length > 0
          ? bhs.filter((b) => boreholeIds.includes(b.id))
          : bhs
        setBoreholes(filtered)
        setFetchStatus("done")
        setStatus(`완료 · 시추공 ${filtered.length}개`)
      })
      .catch((e) => {
        setFetchErr(e.message)
        setFetchStatus("error")
        setStatus(`오류: ${e.message}`)
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

  // 심도(m) 계산
  const maxDepth = useCallback((b: Borehole) => {
    if (!b.strata?.length) return 0
    return Math.max(...b.strata.map((s) => s.depth_bottom ?? 0))
  }, [])

  if (parseError || !polygon) {
    return (
      <div style={{
        display: "flex", height: "100vh", alignItems: "center", justifyContent: "center",
        background: C.bg, color: C.text, flexDirection: "column", gap: 16,
        fontFamily: "'Noto Sans KR',sans-serif",
      }}>
        <p style={{ fontSize: 13, color: C.red }}>{parseError ?? "폴리곤 없음"}</p>
        <a href="http://localhost:5172/" style={{ fontSize: 12, color: C.tertiary, textDecoration: "underline" }}>
          ← 지도로 돌아가기
        </a>
      </div>
    )
  }

  return (
    <div style={{ position: "relative", height: "100vh", display: "flex", background: "#000", overflow: "hidden", userSelect: "none" }}>

      {/* ── 3D 뷰 영역 ───────────────────────────────────────── */}
      <div style={{ position: "relative", flex: 1 }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

        {/* ── 좌측 컨트롤 패널 ──────────────────────────────── */}
        <div style={panel}>
          <div style={{ fontSize: 12, color: C.tertiary }}>KH Geo · 업무 흐름</div>
          <h1 style={{ margin: "2px 0 4px 0", fontSize: 16, fontWeight: 700 }}>
            2단계 · 지층 뷰어
          </h1>
          <div style={{ fontSize: 11, color: C.tertiary, marginBottom: 10 }}>
            3D 복셀 분류 · 시추공 {boreholes.length}개
          </div>

          {/* 지도로 복귀 */}
          <button
            onClick={() => { window.location.href = "http://localhost:5172/" }}
            style={{
              width: "100%", padding: "7px 0", borderRadius: 6,
              background: "rgba(232,83,58,.15)", border: `1px solid ${C.red}`,
              color: C.red, fontSize: 12, fontWeight: 700, cursor: "pointer",
              fontFamily: "'Noto Sans KR',sans-serif", marginBottom: 12,
            }}
          >
            ← 1단계 지도로 복귀
          </button>

          {/* 윗면 지도 */}
          <div style={{ fontSize: 12, marginBottom: 4 }}>윗면 지도</div>
          <select
            value={basemap}
            onChange={(e) => setBasemap(e.target.value as Basemap)}
            style={selectStyle}
          >
            <option value="Base">일반지도</option>
            <option value="Satellite">항공사진</option>
            <option value="Hybrid">위성 + 라벨</option>
            <option value="gray">그레이 백지도</option>
            <option value="midnight">미드나잇 야간</option>
            <option value="osm">OpenStreetMap</option>
          </select>

          {/* 렌더 방식 */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>렌더 방식</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => { setRenderMode("smooth"); setShowSolid(false) }}
                style={renderMode === "smooth" ? segActive : segIdle}
              >
                매끄러움
              </button>
              <button
                onClick={() => { setRenderMode("voxel"); setShowSolid(true) }}
                style={renderMode === "voxel" ? segActive : segIdle}
              >
                픽셀(복셀)
              </button>
            </div>
          </div>

          {/* 지층 투명도 */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              지층 투명도  {Math.round((alpha / 255) * 100)}%
            </div>
            <input
              type="range" min={80} max={255} step={1} value={alpha}
              onChange={(e) => setAlpha(Number(e.target.value))}
              style={{ width: "100%", accentColor: C.btnActive }}
            />
          </div>

          {/* 지층 표시 */}
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 12, color: C.tertiary, marginBottom: 6 }}>
              지층 표시 (클릭 = 켜기/끄기)
            </div>
            {LAYER_KEYS.map((key) => {
              const on = visibility[key]
              return (
                <div
                  key={key}
                  onClick={() => toggleGroup(key)}
                  style={{
                    display: "flex", alignItems: "center", fontSize: 12,
                    margin: "3px 0", padding: "2px 4px", borderRadius: 4,
                    cursor: "pointer", opacity: on ? 1 : 0.38, userSelect: "none",
                  }}
                >
                  <span style={{
                    width: 13, height: 13, borderRadius: 3, marginRight: 8,
                    background: LAYER_COLOR[key],
                    border: "1px solid rgba(255,255,255,.2)", flexShrink: 0,
                  }} />
                  {LAYER_LABEL[key]}
                  <span style={{ marginLeft: "auto", fontSize: 10, color: C.tertiary }}>
                    {on ? "표시" : "숨김"}
                  </span>
                </div>
              )
            })}
          </div>

          {/* 시추공 컬럼 토글 */}
          <div
            onClick={() => toggleGroup("boreholes")}
            style={{
              marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`,
              display: "flex", alignItems: "center", fontSize: 12,
              cursor: "pointer", userSelect: "none",
              opacity: visibility.boreholes ? 1 : 0.5,
            }}
          >
            <span style={{
              width: 13, height: 13, borderRadius: 3, marginRight: 8,
              background: visibility.boreholes ? C.btnActive : C.btnIdle,
              border: `1px solid ${C.btnIdleBd}`, flexShrink: 0,
            }} />
            시추공 컬럼 오버랩 (검증용)
          </div>

          {/* 수직 과장 */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              수직 과장  {verticalExag}x
            </div>
            <input
              type="range" min={1} max={60} step={1} value={verticalExag}
              onChange={(e) => setVerticalExag(Number(e.target.value))}
              style={{ width: "100%", accentColor: C.btnActive }}
            />
          </div>

          {/* 셀 크기 */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>복셀 셀 크기</div>
            <div style={{ display: "flex", gap: 4 }}>
              {CELL_SIZES.map((s) => (
                <button key={s} onClick={() => setCellSizeM(s)} style={{
                  flex: 1, padding: "4px 0", borderRadius: 4, fontSize: 11,
                  background: cellSizeM === s ? "rgba(36,115,189,0.3)" : "rgba(255,255,255,0.06)",
                  border: `1px solid ${cellSizeM === s ? C.btnBorder : C.border}`,
                  color: cellSizeM === s ? "#a5b4fc" : C.tertiary,
                  cursor: "pointer", fontWeight: cellSizeM === s ? 700 : 400,
                  fontFamily: "'Noto Sans KR',sans-serif",
                }}>
                  {s}m
                </button>
              ))}
            </div>
          </div>

          {/* 네비게이션 버튼 */}
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <button
              onClick={() => { window.location.href = "http://localhost:5172/" }}
              style={{ ...btnIdle, flex: 1 }}
            >
              ← 1단계
            </button>
          </div>
        </div>

        {/* ── 우상단 힌트 ─────────────────────────────────────── */}
        <div style={hint}>
          <div>드래그 = 3D 회전</div>
          <div>Shift + 드래그 = 지도 이동</div>
          <div>스크롤 = 줌 인/아웃</div>
        </div>

        {/* ── fetch 상태 오버레이 ──────────────────────────────── */}
        {fetchStatus === "loading" && (
          <div style={{
            position: "absolute", bottom: 50, left: "50%", transform: "translateX(-50%)",
            zIndex: 20, background: "rgba(0,0,0,0.8)", color: C.text,
            fontSize: 12, padding: "6px 16px", borderRadius: 20,
            fontFamily: "'Noto Sans KR',sans-serif",
          }}>
            시추공 데이터 로딩 중…
          </div>
        )}
        {fetchStatus === "error" && (
          <div style={{
            position: "absolute", bottom: 50, left: "50%", transform: "translateX(-50%)",
            zIndex: 20, background: "rgba(127,29,29,0.8)", color: "#fca5a5",
            fontSize: 12, padding: "6px 16px", borderRadius: 20,
            fontFamily: "'Noto Sans KR',sans-serif",
          }}>
            ⚠ {fetchErr}
          </div>
        )}
        {fetchStatus === "done" && boreholes.length === 0 && (
          <div style={{
            position: "absolute", bottom: 50, left: "50%", transform: "translateX(-50%)",
            zIndex: 20, background: "rgba(120,53,15,0.8)", color: "#fde68a",
            fontSize: 12, padding: "6px 16px", borderRadius: 20,
            fontFamily: "'Noto Sans KR',sans-serif",
          }}>
            선택 영역에 시추공이 없습니다
          </div>
        )}

        {/* ── 하단 상태 바 ─────────────────────────────────────── */}
        <div style={statusBar}>{status}</div>
      </div>

      {/* ── 우측 시추공 데이터 표 ───────────────────────────────── */}
      <div style={tablePanel}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>시추공 데이터</div>
          <div style={{ fontSize: 11, color: C.tertiary }}>
            {boreholes.length}개 · 행 클릭 시 선택
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ position: "sticky", top: 0, background: C.inner }}>
                <th style={th}>시추공</th>
                <th style={{ ...th, textAlign: "right" }}>표고(m)</th>
                <th style={{ ...th, textAlign: "right" }}>심도(m)</th>
                <th style={th}>지층 구성</th>
              </tr>
            </thead>
            <tbody>
              {boreholes.map((b) => {
                const depth = maxDepth(b)
                const sel = selectedBh === b.id
                return (
                  <tr
                    key={b.id}
                    onClick={() => setSelectedBh(sel ? null : b.id)}
                    style={{
                      borderBottom: `1px solid #1f2738`,
                      cursor: "pointer",
                      background: sel ? "rgba(36,115,189,.28)" : "transparent",
                    }}
                  >
                    <td style={{ ...td, fontWeight: sel ? 700 : 400 }}>{b.name}</td>
                    <td style={tdNum}>{b.elevation?.toFixed(1)}</td>
                    <td style={tdNum}>{depth.toFixed(1)}</td>
                    <td style={td}>
                      {(b.strata || []).map((s, i) => {
                        const grp = s.strata_group ?? ""
                        const col = LAYER_COLOR[grp] ?? "#b4b4b4"
                        const lbl = LAYER_LABEL[grp] ?? grp
                        return (
                          <span
                            key={i}
                            title={`${lbl} ${s.depth_top?.toFixed(1)}~${s.depth_bottom?.toFixed(1)}m`}
                            style={{
                              display: "inline-block", width: 10, height: 10,
                              marginRight: 1, borderRadius: 1,
                              background: col,
                            }}
                          />
                        )
                      })}
                    </td>
                  </tr>
                )
              })}
              {boreholes.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ ...td, color: "#6a7a98", textAlign: "center", padding: 20 }}>
                    선택 영역에 시추공이 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`select option { background: #1a2030; color: #e8e8e8; }`}</style>
    </div>
  )
}
