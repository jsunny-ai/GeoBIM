import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import "cesium/Build/Cesium/Widgets/widgets.css"
import * as Cesium from "cesium"
import { useCesiumMap } from "@/features/map/useCesiumMap"
import type { Borehole, Project, BoreholeApiResponse, Stratum } from "@/lib/types"
import { normalizeStrataGroup, getStrataColor, STRATA_LEGEND } from "@shared/strataColor"

// ── KH_Geo 색상 팔레트 ────────────────────────────────────────
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
} as const

const panelStyle: React.CSSProperties = {
  position: "absolute", top: 14, left: 14,
  minWidth: 250, zIndex: 10,
  background: C.panel, padding: "14px 16px",
  border: `1px solid ${C.border}`, borderRadius: 10,
  boxShadow: "0 4px 18px rgba(0,0,0,.5)",
  color: C.text, fontFamily: "'Noto Sans KR', sans-serif",
}

export default function MapPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [projectFilter, setProjectFilter] = useState<number | null>(null)
  const [allBoreholes, setAllBoreholes]   = useState<Borehole[]>([])
  const [projects, setProjects]           = useState<Project[]>([])
  const [status, setStatus]               = useState("초기화 중...")
  const [showMarkers, setShowMarkers]       = useState(true)
  const [selectedBorehole, setSelectedBorehole] = useState<Borehole | null>(null)
  const [bhLoading, setBhLoading]           = useState(false)

  // ── 데이터 로드 ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/v1/boreholes/?limit=10000&include_strata=true")
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body: BoreholeApiResponse = await res.json()
        if (!cancelled) {
          setAllBoreholes(body.boreholes)
          setStatus(`준비 완료 · 시추공 ${body.boreholes.length.toLocaleString()}개`)
        }
      } catch (e: any) {
        if (!cancelled) setStatus(`오류: ${e.message}`)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/v1/projects/?limit=1000")
        if (!res.ok) return
        const body = await res.json()
        if (!cancelled) setProjects(body.projects || [])
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])

  const filteredBoreholes = projectFilter
    ? allBoreholes.filter((b) => b.project_id === projectFilter)
    : allBoreholes

  // ── Cesium 훅 ────────────────────────────────────────────
  const handleBoreholeClick = useCallback(async (bh: Borehole) => {
    setSelectedBorehole(bh)   // 즉시 패널 표시 (기본 정보)
    setBhLoading(true)
    try {
      const res = await fetch(`/api/v1/boreholes/${bh.id}`)
      if (res.ok) {
        const detail: Borehole = await res.json()
        setSelectedBorehole(detail)  // strata 포함 전체 정보로 갱신
      }
    } catch {}
    finally { setBhLoading(false) }
  }, [])

  const { isDrawing, polygon, selectedBoreholes, startDrawing, cancelDrawing } =
    useCesiumMap(containerRef, showMarkers ? filteredBoreholes : [], "Base",
      15, 10, 235, "gl", [true,true,true,true],
      handleBoreholeClick
    )

  // ── BBOX (도 단위) ───────────────────────────────────────
  const bbox = useMemo<{ sw: [number,number]; ne: [number,number] } | null>(() => {
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
    return { sw: [minLat, minLng], ne: [maxLat, maxLng] }
  }, [polygon])

  // ── 2단계 이동 ──────────────────────────────────────────
  const handleProceed = () => {
    if (!bbox) return
    const [swLat, swLng] = bbox.sw
    const [neLat, neLng] = bbox.ne
    const bboxStr = `${swLng.toFixed(6)},${swLat.toFixed(6)},${neLng.toFixed(6)},${neLat.toFixed(6)}`
    const bhIdsStr = selectedBoreholes.map((b) => b.id).join(",")
    const polyDeg = polygon!.map((pt) => ({
      lng: Cesium.Math.toDegrees(pt.longitude),
      lat: Cesium.Math.toDegrees(pt.latitude),
    }))
    window.location.href = `http://localhost:5173/?bbox=${bboxStr}&boreholeIds=${bhIdsStr}&polygon=${encodeURIComponent(JSON.stringify(polyDeg))}`
  }

  const handleClear = () => {
    cancelDrawing()
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh", background: C.bg, overflow: "hidden" }}>
      {/* Cesium 컨테이너 */}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* ── 좌측 패널 ─────────────────────────────────────── */}
      <div style={panelStyle}>
        {/* 워크플로우 레이블 */}
        <div style={{ fontSize: 12, color: C.tertiary, marginBottom: 2 }}>
          KH Geo · 업무 흐름
        </div>
        {/* 단계 헤더 */}
        <div style={{ fontSize: 16, fontWeight: 700, margin: "2px 0 12px 0" }}>
          1단계 · 영역 선택
        </div>

        {/* 시추공 ON/OFF */}
        <Btn
          label="시추공 위치 ON/OFF"
          active={showMarkers}
          onClick={() => setShowMarkers((v) => !v)}
        />

        {/* 영역 그리기 */}
        <Btn
          label={isDrawing ? "그리기 취소" : "영역 선택"}
          active={isDrawing}
          onClick={isDrawing ? cancelDrawing : startDrawing}
          style={{ marginTop: 6 }}
        />

        {/* 선택 초기화 */}
        {bbox && (
          <Btn label="선택 초기화" onClick={handleClear} style={{ marginTop: 6 }} />
        )}

        {/* 프로젝트 필터 */}
        {projects.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: C.tertiary, marginTop: 12, marginBottom: 4 }}>
              프로젝트 필터
            </div>
            <select
              value={projectFilter ?? ""}
              onChange={(e) => setProjectFilter(e.target.value === "" ? null : Number(e.target.value))}
              style={{
                width: "100%", padding: "6px 8px", borderRadius: 6,
                background: C.input, color: C.text, border: `1px solid ${C.btnIdleBd}`,
                fontSize: 13, fontFamily: "inherit",
              }}
            >
              <option value="">전체 프로젝트</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </>
        )}

        {/* 선택 영역 정보 */}
        {bbox && (
          <div style={{
            marginTop: 12, padding: "10px 12px",
            background: C.inner, border: `1px solid ${C.border}`, borderRadius: 6,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: C.text }}>선택된 영역</div>
            <InfoRow label="SW" value={`${bbox.sw[0].toFixed(4)}, ${bbox.sw[1].toFixed(4)}`} />
            <InfoRow label="NE" value={`${bbox.ne[0].toFixed(4)}, ${bbox.ne[1].toFixed(4)}`} />
            <InfoRow
              label="포함 시추공"
              value={`${selectedBoreholes.length.toLocaleString()} 개`}
              valueStyle={{ color: C.accent, fontWeight: 700 }}
            />
          </div>
        )}

        {/* 확인 → 2단계 */}
        {bbox && (
          <button
            onClick={handleProceed}
            style={{
              marginTop: 10, width: "100%", padding: 10, borderRadius: 6,
              background: C.success, border: `1px solid ${C.successBd}`,
              color: C.text, fontSize: 14, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            확인 → 2단계 진행
          </button>
        )}
      </div>

      {/* ── 시추공 정보 패널 ─────────────────────────────────── */}
      {selectedBorehole && (
        <BoreholePanel
          borehole={selectedBorehole}
          loading={bhLoading}
          onClose={() => setSelectedBorehole(null)}
        />
      )}

      {/* ── 우상단 힌트 ─────────────────────────────────────── */}
      <div style={{
        position: "absolute", top: 14, right: 14, zIndex: 10,
        background: "rgba(15,20,32,.85)", padding: "9px 12px",
        borderRadius: 6, fontSize: 11, color: C.tertiary,
        border: `1px solid ${C.border}`,
      }}>
        {isDrawing
          ? "지도에서 마우스를 드래그하여 사각형 영역을 그리세요"
          : '"영역 선택" 클릭 후 지도에서 드래그하세요'}
      </div>

      {/* ── 하단 상태 바 ─────────────────────────────────────── */}
      <div style={{
        position: "absolute", bottom: 14, left: 14, zIndex: 10,
        background: "rgba(15,20,32,.92)", padding: "8px 13px",
        borderRadius: 7, fontSize: 11, color: C.secondary,
        border: `1px solid ${C.border}`,
      }}>
        {status}
      </div>

      <style>{`select option { background: #1a2030; color: #e8e8e8; }`}</style>
    </div>
  )
}

// ── 재사용 컴포넌트 ───────────────────────────────────────────
function Btn({ label, active, onClick, style }: {
  label: string; active?: boolean; onClick: () => void; style?: React.CSSProperties
}) {
  return (
    <button onClick={onClick} style={{
      width: "100%", padding: "8px 10px", borderRadius: 6,
      fontSize: 13, cursor: "pointer", transition: "all .15s",
      fontFamily: "'Noto Sans KR', sans-serif",
      background: active ? "#2473bd" : "#1a2030",
      color: active ? "#fff" : "#cbd5e1",
      border: `1px solid ${active ? "#3084d0" : "#3a4a6a"}`,
      fontWeight: active ? 600 : 400,
      ...style,
    }}>
      {label}
    </button>
  )
}

function InfoRow({ label, value, valueStyle }: {
  label: string; value: string; valueStyle?: React.CSSProperties
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
      <span style={{ color: "#8a9bb8" }}>{label}</span>
      <span style={{ color: "#cbd5e1", ...valueStyle }}>{value}</span>
    </div>
  )
}

function BoreholePanel({ borehole, loading, onClose }: { borehole: Borehole; loading?: boolean; onClose: () => void }) {
  const sorted = [...(borehole.strata ?? [])].sort((a, b) => a.depth_top - b.depth_top)
  const totalDepth = sorted.length ? Math.max(...sorted.map((s) => s.depth_bottom)) : 0
  const LOG_H = 220 // px

  return (
    <div style={{
      position: "absolute", bottom: 14, right: 14, width: 260, zIndex: 20,
      background: "rgba(15,20,32,.97)", border: `1px solid ${C.border}`,
      borderRadius: 10, boxShadow: "0 4px 20px rgba(0,0,0,.6)",
      color: C.text, fontFamily: "'Noto Sans KR',-apple-system,sans-serif",
      overflow: "hidden",
    }}>
      {/* 헤더 */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderBottom: `1px solid ${C.border}`,
        background: "rgba(36,115,189,.15)",
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{borehole.name}</div>
          <div style={{ fontSize: 11, color: C.tertiary, marginTop: 1 }}>
            시추공 정보
          </div>
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: C.tertiary,
          fontSize: 18, cursor: "pointer", lineHeight: 1, padding: "0 2px",
        }}>×</button>
      </div>

      <div style={{ padding: "12px 14px" }}>
        {/* 기본 정보 */}
        <div style={{
          padding: "8px 10px", background: C.inner,
          borderRadius: 6, border: `1px solid ${C.border}`, marginBottom: 12,
        }}>
          <InfoRow label="표고" value={borehole.elevation != null ? `${borehole.elevation.toFixed(1)} m` : "-"} />
          <InfoRow label="위도" value={borehole.latitude.toFixed(5)} />
          <InfoRow label="경도" value={borehole.longitude.toFixed(5)} />
          <InfoRow label="총 심도" value={totalDepth > 0 ? `${totalDepth.toFixed(1)} m` : "-"} />
          <InfoRow label="지층 수" value={`${sorted.length} 개`} />
        </div>

        {/* 지층 시각화 */}
        {loading ? (
          <div style={{ fontSize: 11, color: C.tertiary, textAlign: "center", padding: "12px 0" }}>
            지층 데이터 로드 중...
          </div>
        ) : sorted.length > 0 ? (
          <>
            <div style={{ fontSize: 11, color: C.tertiary, marginBottom: 6 }}>지층 구성</div>
            <div style={{ display: "flex", gap: 6, position: "relative" }}>
              {/* 1단 (왼쪽): 심도 숫자 컬럼 */}
              <div style={{ width: 35, position: "relative", height: LOG_H, flexShrink: 0 }}>
                {sorted.map((s, i) => {
                  const distFromBottomPx = totalDepth > 0 ? ((totalDepth - s.depth_top) / totalDepth) * LOG_H : 100
                  const showDepthTop = distFromBottomPx >= 16
                  const topPx = totalDepth > 0 ? (s.depth_top / totalDepth) * LOG_H : 0
                  
                  return showDepthTop ? (
                    <div key={i} style={{
                      position: "absolute", top: topPx, right: 0,
                      fontSize: 9, color: C.tertiary, lineHeight: "10px",
                      textAlign: "right", whiteSpace: "nowrap",
                    }}>
                      {s.depth_top.toFixed(1)}m
                    </div>
                  ) : null
                })}
                {/* 최하단 깊이 */}
                <div style={{
                  position: "absolute", bottom: 0, right: 0,
                  fontSize: 9, color: C.tertiary, textAlign: "right",
                }}>
                  {totalDepth.toFixed(1)}m
                </div>
              </div>

              {/* 2단 (가운데): 지층 구성 기둥 (컬러 바) */}
              <div style={{
                width: 24, height: LOG_H, borderRadius: 4,
                overflow: "hidden", flexShrink: 0,
                border: `1px solid ${C.border}`,
                display: "flex", flexDirection: "column",
              }}>
                {sorted.map((s, i) => {
                  const thickness = s.depth_bottom - s.depth_top
                  const heightPx = totalDepth > 0 ? (thickness / totalDepth) * LOG_H : 0
                  const col = getStrataColor(s.soil_type)
                  return (
                    <div key={i} style={{
                      width: "100%", height: heightPx,
                      background: col, flexShrink: 0,
                    }} />
                  )
                })}
              </div>

              {/* 3단 (오른쪽): 지층명 레이블 컬럼 */}
              <div style={{ flex: 1, position: "relative", height: LOG_H }}>
                {sorted.map((s, i) => {
                  const thickness = s.depth_bottom - s.depth_top
                  const topPx = totalDepth > 0 ? (s.depth_top / totalDepth) * LOG_H : 0
                  const heightPx = totalDepth > 0 ? (thickness / totalDepth) * LOG_H : 0
                  const grp = normalizeStrataGroup(s.soil_type)
                  const col = getStrataColor(s.soil_type)
                  const lbl = STRATA_LEGEND.find(l => l.group === grp)?.label ?? s.soil_type
                  
                  return (
                    <div key={i} style={{
                      position: "absolute", top: topPx, left: 4, right: 0,
                      height: heightPx, overflow: "hidden",
                      display: "flex", alignItems: "center",
                    }}>
                      {heightPx > 22 && (
                        <div style={{
                          display: "flex", alignItems: "center", gap: 4,
                        }}>
                          <span style={{
                            width: 8, height: 8, borderRadius: 2,
                            background: col, flexShrink: 0, display: "inline-block",
                          }} />
                          <span style={{ fontSize: 11, color: C.secondary, whiteSpace: "nowrap" }}>{lbl}</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* 범례 */}
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: "4px 8px" }}>
              {sorted
                .filter((s, i, arr) => {
                  const key = normalizeStrataGroup(s.soil_type)
                  return arr.findIndex((x) => normalizeStrataGroup(x.soil_type) === key) === i
                })
                .map((s) => {
                  const grp = normalizeStrataGroup(s.soil_type)
                  const col = getStrataColor(s.soil_type)
                  const lbl = STRATA_LEGEND.find(l => l.group === grp)?.label ?? s.soil_type
                  return (
                    <div key={grp} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: col, display: "inline-block" }} />
                      <span style={{ color: C.secondary }}>{lbl}</span>
                    </div>
                  )
                })}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: C.tertiary, textAlign: "center", padding: "12px 0" }}>
            지층 데이터 없음
          </div>
        )}
      </div>
    </div>
  )
}
