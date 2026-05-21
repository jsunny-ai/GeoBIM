import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import "cesium/Build/Cesium/Widgets/widgets.css"
import * as Cesium from "cesium"
import { useCesiumMap } from "@/features/map/useCesiumMap"
import type { Borehole, Project, BoreholeApiResponse } from "@/lib/types"

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

const blur = "blur(10px)"

export default function MapPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [projectFilter, setProjectFilter] = useState<number | null>(null)
  const [allBoreholes, setAllBoreholes] = useState<Borehole[]>([])
  const [projects, setProjects]           = useState<Project[]>([])
  const [loadingBh, setLoadingBh]         = useState(true)
  const [loadErr, setLoadErr]             = useState<string | null>(null)

  // 선택 패널 — 체크 상태
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())

  // 로그 패널
  const [logCollapsed, setLogCollapsed] = useState(false)
  const [logs, setLogs] = useState<string[]>(["초기화 프로세스 시작..."])
  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev.slice(-49), `> ${msg}`])
  }, [])

  // ── 데이터 로드 ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/v1/boreholes?limit=10000&include_strata=true")
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body: BoreholeApiResponse = await res.json()
        if (!cancelled) {
          setAllBoreholes(body.boreholes)
          addLog(`시추공 ${body.boreholes.length}개 로드 완료`)
        }
      } catch (e: any) {
        if (!cancelled) {
          setLoadErr(e.message || "시추공 데이터 로드 실패")
          addLog(`오류: ${e.message}`)
        }
      } finally {
        if (!cancelled) setLoadingBh(false)
      }
    })()
    return () => { cancelled = true }
  }, [addLog])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/v1/projects?limit=1000")
        if (!res.ok) return
        const body = await res.json()
        if (!cancelled) {
          setProjects(body.projects || [])
          addLog("V-World 기본지도 로드 완료")
        }
      } catch {}
    })()
    return () => { cancelled = true }
  }, [addLog])

  // ── 필터 적용 ─────────────────────────────────────────────
  const filteredBoreholes = projectFilter
    ? allBoreholes.filter((b) => b.project_id === projectFilter)
    : allBoreholes

  // ── Cesium 훅 ─────────────────────────────────────────────
  const { isDrawing, polygon, selectedBoreholes, startDrawing, cancelDrawing, zoomIn, zoomOut } =
    useCesiumMap(containerRef, filteredBoreholes, "Base")

  // 폴리곤 완성 시 → 전체 선택
  useEffect(() => {
    if (polygon) {
      setCheckedIds(new Set(selectedBoreholes.map((b) => b.id)))
      addLog(`영역 내 시추공 ${selectedBoreholes.length}개 감지`)
    } else {
      setCheckedIds(new Set())
    }
  }, [polygon, selectedBoreholes, addLog])

  // ── BBOX 계산 ─────────────────────────────────────────────
  const calculatedBbox = useMemo<[number, number, number, number] | null>(() => {
    if (!polygon || polygon.length === 0) return null
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
    polygon.forEach((pt) => {
      const lng = Cesium.Math.toDegrees(pt.longitude)
      const lat = Cesium.Math.toDegrees(pt.latitude)
      if (lng < minLng) minLng = lng
      if (lat < minLat) minLat = lat
      if (lng > maxLng) maxLng = lng
      if (lat > maxLat) maxLat = lat
    })
    return [minLng, minLat, maxLng, maxLat]
  }, [polygon])

  // ── 2단계 이동 ────────────────────────────────────────────
  const handleGenerate = () => {
    if (!calculatedBbox) return
    const bboxStr = calculatedBbox.map((v) => v.toFixed(6)).join(",")
    const bhIdsStr = [...checkedIds].join(",")
    const polyDeg = polygon!.map((pt) => ({
      lng: Cesium.Math.toDegrees(pt.longitude),
      lat: Cesium.Math.toDegrees(pt.latitude),
    }))
    const polyStr = JSON.stringify(polyDeg)
    addLog(`3D 뷰어로 이동 (시추공 ${checkedIds.size}개)`)
    window.location.href = `http://localhost:5173/?bbox=${bboxStr}&boreholeIds=${bhIdsStr}&polygon=${encodeURIComponent(polyStr)}`
  }

  // ── 초기화 ───────────────────────────────────────────────
  const handleClear = () => {
    cancelDrawing()
    setCheckedIds(new Set())
    addLog("초기화 완료")
  }

  // ── 체크박스 토글 ─────────────────────────────────────────
  const toggleCheck = (id: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    if (checkedIds.size === selectedBoreholes.length) {
      setCheckedIds(new Set())
    } else {
      setCheckedIds(new Set(selectedBoreholes.map((b) => b.id)))
    }
  }

  const logPanelHeight = logCollapsed ? 36 : 100

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh", background: C.bgDark, overflow: "hidden" }}>
      {/* Cesium 컨테이너 */}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* ── 좌측: 도구 모음 ──────────────────────────────── */}
      <div style={{
        position: "absolute", top: 20, left: 20, width: 200, zIndex: 1000,
        background: C.panel, border: `1px solid ${C.border}`,
        borderRadius: 8, backdropFilter: blur, color: C.text,
        display: "flex", flexDirection: "column", gap: 8, padding: "12px 10px",
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, letterSpacing: "0.08em", marginBottom: 2 }}>
          도구 모음
        </div>

        {/* 영역 그리기 */}
        <PanelBtn
          onClick={isDrawing ? cancelDrawing : startDrawing}
          active={isDrawing}
          color={isDrawing ? C.red : C.primary}
          label={isDrawing ? "✕  그리기 취소" : "✏️  영역 그리기"}
        />

        {/* 지역 필터 */}
        <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>지역 필터</div>
        <select
          value={projectFilter ?? ""}
          onChange={(e) => setProjectFilter(e.target.value === "" ? null : Number(e.target.value))}
          style={{
            width: "100%", padding: "6px 8px", borderRadius: 6,
            background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`,
            color: C.text, fontSize: 12, cursor: "pointer",
          }}
        >
          <option value="">전체 프로젝트</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* 초기화 */}
        <PanelBtn onClick={handleClear} color="#64748b" label="🗑️  초기화" />

        {/* 로딩 표시 */}
        {loadingBh && (
          <div style={{ fontSize: 10, color: C.muted, textAlign: "center" }}>시추공 로딩 중…</div>
        )}
        {loadErr && (
          <div style={{ fontSize: 10, color: C.red }}>⚠ {loadErr}</div>
        )}
      </div>

      {/* ── 우상단: 줌 컨트롤 ───────────────────────────────── */}
      <div style={{
        position: "absolute", top: 20,
        right: polygon ? 348 : 20,
        zIndex: 1000, display: "flex", flexDirection: "column", gap: 4,
        transition: "right 0.25s ease",
      }}>
        {[{ label: "+", fn: zoomIn }, { label: "−", fn: zoomOut }].map(({ label, fn }) => (
          <button key={label} onClick={fn} style={{
            width: 40, height: 40, borderRadius: 6,
            background: C.panel, border: `1px solid ${C.border}`,
            color: C.text, fontSize: 18, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            backdropFilter: blur,
          }}>{label}</button>
        ))}
      </div>

      {/* ── 우측: 시추공 선택 목록 ───────────────────────────── */}
      {polygon && (
        <div style={{
          position: "absolute", top: 20, right: 20, width: 320,
          maxHeight: `calc(100vh - ${logPanelHeight + 40}px)`,
          zIndex: 2001, display: "flex", flexDirection: "column",
          background: C.panelAlt, border: `1px solid ${C.border}`,
          borderRadius: 8, backdropFilter: blur, color: C.text,
          animation: "slideIn 0.25s ease-out",
        }}>
          {/* 헤더 */}
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
              📍 시추공 선택 목록
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, color: C.muted }}>
                선택됨: <b style={{ color: C.text }}>{checkedIds.size}</b> / 총 {selectedBoreholes.length}개
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                <SmallBtn onClick={toggleAll} label={checkedIds.size === selectedBoreholes.length ? "☑ 전체 해제" : "☑ 전체"} />
              </div>
            </div>
          </div>

          {/* 목록 */}
          <div style={{ overflowY: "auto", flex: 1, padding: "6px 0" }}>
            {selectedBoreholes.length === 0 ? (
              <div style={{ padding: "16px 12px", color: C.muted, fontSize: 12, textAlign: "center" }}>
                선택된 시추공 없음
              </div>
            ) : selectedBoreholes.map((bh) => (
              <div
                key={bh.id}
                onClick={() => toggleCheck(bh.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 12px", cursor: "pointer", fontSize: 12,
                  background: checkedIds.has(bh.id) ? "rgba(79,70,229,0.15)" : "transparent",
                  borderLeft: checkedIds.has(bh.id) ? `3px solid ${C.primary}` : "3px solid transparent",
                  transition: "background 0.15s",
                }}
              >
                <div style={{
                  width: 14, height: 14, border: `1.5px solid ${checkedIds.has(bh.id) ? C.primary : C.muted}`,
                  borderRadius: 3, background: checkedIds.has(bh.id) ? C.primary : "transparent",
                  flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {checkedIds.has(bh.id) && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span>}
                </div>
                <span style={{ fontWeight: 600, flex: 1 }}>{bh.name}</span>
                <span style={{ color: C.muted, fontSize: 10 }}>
                  {bh.latitude.toFixed(4)} / {bh.longitude.toFixed(4)}
                </span>
              </div>
            ))}
          </div>

          {/* 생성 버튼 */}
          <div style={{ padding: "10px 12px", borderTop: `1px solid ${C.border}` }}>
            <button
              onClick={handleGenerate}
              disabled={checkedIds.size === 0}
              style={{
                width: "100%", padding: "10px 0", borderRadius: 6,
                background: checkedIds.size > 0 ? C.primary : "#334155",
                border: "none", color: C.text, fontSize: 13, fontWeight: 700,
                cursor: checkedIds.size > 0 ? "pointer" : "not-allowed",
                transition: "background 0.2s",
              }}
            >
              🏗️ 지층 생성 ({checkedIds.size}개 시추공)
            </button>
          </div>
        </div>
      )}

      {/* ── 상태 뱃지 ─────────────────────────────────────── */}
      <div style={{
        position: "absolute", bottom: logPanelHeight + 10, right: 20,
        zIndex: 1000, fontSize: 11, color: C.logText,
        background: "rgba(15,23,42,0.7)", padding: "4px 10px",
        borderRadius: 12, backdropFilter: blur,
      }}>
        {loadingBh ? "시추공 데이터 로딩 중…" : `시추공 ${allBoreholes.length}개 · V-World Base`}
      </div>

      {/* ── 하단: 시스템 로그 ────────────────────────────────── */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: logPanelHeight, zIndex: 2000,
        background: "rgba(15, 23, 42, 0.6)", backdropFilter: blur,
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

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        select option { background: #1e293b; color: #f8fafc; }
      `}</style>
    </div>
  )
}

// ── 재사용 버튼 컴포넌트 ──────────────────────────────────────
function PanelBtn({ onClick, label, color, active }: {
  onClick: () => void
  label: string
  color: string
  active?: boolean
}) {
  return (
    <button onClick={onClick} style={{
      width: "100%", padding: "8px 10px", borderRadius: 6,
      background: active ? `${color}33` : "rgba(255,255,255,0.06)",
      border: `1px solid ${active ? color : "rgba(255,255,255,0.1)"}`,
      color: active ? color : "#f8fafc",
      fontSize: 12, fontWeight: 600, cursor: "pointer",
      textAlign: "left", transition: "background 0.15s, border-color 0.15s",
    }}>
      {label}
    </button>
  )
}

function SmallBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} style={{
      padding: "3px 8px", borderRadius: 4, fontSize: 11,
      background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)",
      color: "#f8fafc", cursor: "pointer",
    }}>
      {label}
    </button>
  )
}
