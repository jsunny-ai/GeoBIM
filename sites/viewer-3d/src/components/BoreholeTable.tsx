import React, { useCallback, useState } from "react"
import type { Borehole } from "@/lib/types"

const C = {
  border: "#2a3344",
  text: "#e8e8e8",
  secondary: "#cbd5e1",
  tertiary: "#8a9bb8",
  inner: "#10141f",
  active: "#2473bd",
  warnOr: "#f59e0b",
  warnRd: "#ef4444",
  warnCr: "#b91c1c",
} as const

const tablePanelStyle: React.CSSProperties = {
  width: 320,
  background: "rgba(15,20,32,.98)",
  borderLeft: `1px solid ${C.border}`,
  color: C.text,
  display: "flex",
  flexDirection: "column",
  fontFamily: "'Noto Sans KR',sans-serif",
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  color: C.tertiary,
  fontWeight: 600,
  borderBottom: `1px solid ${C.border}`,
}

const tdStyle: React.CSSProperties = { padding: "5px 8px", color: C.secondary }
const tdNumStyle: React.CSSProperties = { ...tdStyle, textAlign: "right" }

const LAYER_COLOR: Record<string, number> = {
  soil: 0x8b7355,
  weathered_rock: 0xc4a57b,
  soft_rock: 0x6b8e5a,
  hard_rock: 0x3d3d3d,
  unknown: 0xb4b4b4,
}

const LAYER_LABEL: Record<string, string> = {
  soil: "토사",
  weathered_rock: "풍화암",
  soft_rock: "연암",
  hard_rock: "경암",
  unknown: "미분류",
}

interface BoreholeTableProps {
  boreholes: (Borehole & { dem_elevation?: number })[]
  selectedBh: number | null
  setSelectedBh: (id: number | null) => void
  focusBorehole: (id: number) => void
  onUpdateElevation?: (bhId: number, newElev: number) => Promise<void>
}

export const BoreholeTable: React.FC<BoreholeTableProps> = ({
  boreholes,
  selectedBh,
  setSelectedBh,
  focusBorehole,
  onUpdateElevation,
}) => {
  const [filterMode, setFilterMode] = useState<"all" | "warn" | "edited">("all")
  const [editingBhId, setEditingBhId] = useState<number | null>(null)
  const [editVal, setEditVal] = useState<string>("")
  const [isSaving, setIsSaving] = useState(false)
  const [editLogs, setEditLogs] = useState<Record<number, { original: number; modified: number; time: string }>>({})

  const maxDepth = useCallback((b: Borehole) => {
    if (!b.strata?.length) return 0
    return Math.max(...b.strata.map((s) => s.depth_bottom ?? 0))
  }, [])

  // 1. 개별 오차 및 심각도 판정 헬퍼
  const getElevationInfo = useCallback((b: Borehole & { dem_elevation?: number }) => {
    const dem = b.dem_elevation ?? b.elevation
    const delta = b.elevation - dem
    const diff = Math.abs(delta)
    
    let severity: "normal" | "minor" | "major" | "critical" = "normal"
    if (diff >= 2.0) severity = "critical"
    else if (diff >= 1.0) severity = "major"
    else if (diff >= 0.5) severity = "minor"
    
    return { dem, delta, diff, severity }
  }, [])

  // 2. 필터링 대상 시추공 분류
  const filteredBoreholes = boreholes.filter((b) => {
    const { diff } = getElevationInfo(b)
    if (filterMode === "warn") return diff >= 0.5
    if (filterMode === "edited") return editLogs[b.id] !== undefined
    return true
  })

  const warnCount = boreholes.filter((b) => getElevationInfo(b).diff >= 0.5).length

  const handleStartEdit = (b: Borehole & { dem_elevation?: number }, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingBhId(b.id)
    setEditVal(b.elevation.toFixed(2))
  }

  const handleSaveEdit = async (b: Borehole & { dem_elevation?: number }) => {
    const num = parseFloat(editVal)
    if (isNaN(num)) return
    
    try {
      setIsSaving(true)
      if (onUpdateElevation) {
        await onUpdateElevation(b.id, num)
      }
      // 수정 이력 로그 업데이트
      setEditLogs((prev) => ({
        ...prev,
        [b.id]: {
          original: b.elevation,
          modified: num,
          time: new Date().toLocaleTimeString(),
        },
      }))
      setEditingBhId(null)
    } catch (err) {
      alert("표고 보정 실패: " + err)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div style={tablePanelStyle}>
      {/* A. 상단 타이틀 영역 */}
      <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>시추공 데이터</span>
          {warnCount > 0 && (
            <span style={{ fontSize: 10, background: "rgba(239,68,68,.18)", color: C.warnRd, padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>
              ⚠️ 경고 {warnCount}개
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: C.tertiary, marginTop: 2 }}>
          {boreholes.length}개 발견 · 행 클릭 시 시추공 카메라 포커스
        </div>
      </div>

      {/* B. 필터링 버튼 바 */}
      <div style={{ display: "flex", padding: "6px 10px", gap: 4, borderBottom: `1px solid ${C.border}`, background: "rgba(10,14,26,.4)" }}>
        {(["all", "warn", "edited"] as const).map((mode) => {
          const active = filterMode === mode
          const labels = { all: "전체", warn: "경고대상", edited: "보정이력" }
          return (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              style={{
                flex: 1,
                fontSize: 10,
                padding: "3px 0",
                cursor: "pointer",
                border: `1px solid ${active ? C.border : "transparent"}`,
                borderRadius: 4,
                background: active ? "rgba(36,115,189,.18)" : "transparent",
                color: active ? "#fff" : C.tertiary,
                fontWeight: active ? 600 : 400,
                fontFamily: "'Noto Sans KR',sans-serif",
              }}
            >
              {labels[mode]}
            </button>
          )
        })}
      </div>

      {/* C. 테이블 뷰포트 */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: C.inner, zIndex: 5 }}>
              <th style={thStyle}>공명</th>
              <th style={{ ...thStyle, textAlign: "right" }}>표고(m)</th>
              <th style={{ ...thStyle, textAlign: "right" }}>심도(m)</th>
              <th style={thStyle}>지층</th>
            </tr>
          </thead>
          <tbody>
            {filteredBoreholes.map((b) => {
              const depth = maxDepth(b)
              const sel = selectedBh === b.id
              const { dem, diff, severity } = getElevationInfo(b)
              const isEdited = editLogs[b.id] !== undefined
              
              // 심각도 아이콘 점 렌더링
              let badgeDot = null
              if (severity === "critical") {
                badgeDot = <span title={`🚨 표고 심각한 오차: ${diff.toFixed(2)}m (DEM: ${dem.toFixed(1)}m)`} style={{ display: "inline-block", width: 8, height: 8, background: C.warnCr, borderRadius: "50%", marginRight: 5, animation: "pulse 1.5s infinite" }} />
              } else if (severity === "major") {
                badgeDot = <span title={`🔴 표고 요주의 오차: ${diff.toFixed(2)}m (DEM: ${dem.toFixed(1)}m)`} style={{ display: "inline-block", width: 7, height: 7, background: C.warnRd, borderRadius: "50%", marginRight: 5 }} />
              } else if (severity === "minor") {
                badgeDot = <span title={`🟡 표고 경미한 오차: ${diff.toFixed(2)}m (DEM: ${dem.toFixed(1)}m)`} style={{ display: "inline-block", width: 7, height: 7, background: C.warnOr, borderRadius: "50%", marginRight: 5 }} />
              } else if (isEdited) {
                badgeDot = <span title="✅ 표고 수동 보정 완료" style={{ display: "inline-block", width: 7, height: 7, background: "#10b981", borderRadius: "50%", marginRight: 5 }} />
              }

              return (
                <React.Fragment key={b.id}>
                  <tr
                    onClick={() => {
                      if (sel) setSelectedBh(null)
                      else focusBorehole(b.id)
                    }}
                    style={{
                      borderBottom: "1px solid #1f2738",
                      cursor: "pointer",
                      background: sel ? "rgba(36,115,189,.15)" : "transparent",
                    }}
                  >
                    <td style={{ ...tdStyle, fontWeight: sel ? 700 : 400, display: "flex", alignItems: "center" }}>
                      {badgeDot}
                      <span style={{ textDecoration: isEdited ? "underline" : "none" }}>{b.name}</span>
                    </td>
                    <td style={tdNumStyle}>
                      <span
                        onClick={(e) => handleStartEdit(b, e)}
                        title="클릭 시 표고 인라인 보정 팝오버 활성화"
                        style={{
                          borderBottom: diff >= 0.5 ? `1px dashed ${severity === "critical" ? C.warnCr : severity === "major" ? C.warnRd : C.warnOr}` : "none",
                          color: isEdited ? "#10b981" : diff >= 0.5 ? (severity === "critical" ? "#ff7b7b" : C.warnOr) : C.secondary,
                          padding: "2px 4px",
                          borderRadius: 3,
                          background: diff >= 0.5 ? "rgba(255,255,255,0.03)" : "transparent",
                        }}
                      >
                        {b.elevation?.toFixed(1)}
                      </span>
                    </td>
                    <td style={tdNumStyle}>{depth.toFixed(1)}</td>
                    <td style={tdStyle}>
                      {uniqueLayerGroups(b).map((grp, i) => {
                        const rgbNum = LAYER_COLOR[grp] ?? LAYER_COLOR.unknown
                        const col = `#${rgbNum.toString(16).padStart(6, "0")}`
                        const lbl = LAYER_LABEL[grp] ?? grp
                        return (
                          <span
                            key={`${grp}-${i}`}
                            title={lbl}
                            style={{
                              display: "inline-block",
                              width: 9,
                              height: 9,
                              marginRight: 1,
                              borderRadius: 1,
                              background: col,
                            }}
                          />
                        )
                      })}
                    </td>
                  </tr>

                  {/* D. 인라인 표고 보정 팝오버 편집 폼 */}
                  {editingBhId === b.id && (
                    <tr style={{ background: "rgba(10,14,26,.85)" }}>
                      <td colSpan={4} style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", color: C.tertiary }}>
                            <span>지형(DEM) 표고: <strong>{dem.toFixed(2)}m</strong></span>
                            <span style={{ color: diff >= 0.5 ? C.warnRd : C.tertiary }}>
                              차이: <strong>{(b.elevation - dem).toFixed(2)}m</strong>
                            </span>
                          </div>
                          
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <input
                              type="number"
                              step="0.01"
                              value={editVal}
                              onChange={(e) => setEditVal(e.target.value)}
                              disabled={isSaving}
                              style={{
                                flex: 1,
                                background: "#0c0f17",
                                border: `1px solid ${C.border}`,
                                borderRadius: 4,
                                color: "#fff",
                                padding: "4px 8px",
                                fontSize: 11,
                                outline: "none",
                              }}
                            />
                            
                            <button
                              onClick={() => setEditVal(dem.toFixed(2))}
                              disabled={isSaving}
                              title="DEM 표고값으로 자동 매핑"
                              style={{
                                padding: "4px 8px",
                                background: "rgba(245,158,11,.15)",
                                border: `1px solid ${C.warnOr}`,
                                borderRadius: 4,
                                color: C.warnOr,
                                fontSize: 10,
                                cursor: "pointer",
                                fontFamily: "'Noto Sans KR',sans-serif",
                              }}
                            >
                              DEM자동보정
                            </button>
                          </div>

                          {isEdited && (
                            <div style={{ fontSize: 9, color: "#10b981" }}>
                              이력: {editLogs[b.id].original.toFixed(2)}m → {editLogs[b.id].modified.toFixed(2)}m ({editLogs[b.id].time})
                            </div>
                          )}

                          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", marginTop: 4 }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingBhId(null); }}
                              disabled={isSaving}
                              style={{
                                padding: "3px 8px",
                                background: "transparent",
                                border: `1px solid ${C.border}`,
                                borderRadius: 3,
                                color: C.tertiary,
                                cursor: "pointer",
                                fontSize: 10,
                              }}
                            >
                              취소
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSaveEdit(b); }}
                              disabled={isSaving}
                              style={{
                                padding: "3px 8px",
                                background: C.active,
                                border: `1px solid ${C.active}`,
                                borderRadius: 3,
                                color: "#fff",
                                cursor: "pointer",
                                fontSize: 10,
                                fontWeight: 600,
                              }}
                            >
                              {isSaving ? "보정 중..." : "보정 완료"}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
            {filteredBoreholes.length === 0 && (
              <tr>
                <td colSpan={4} style={{ ...tdStyle, color: "#6a7a98", textAlign: "center", padding: 20 }}>
                  해당 조건의 시추공이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function uniqueLayerGroups(b: Borehole) {
  const groups: string[] = []
  for (const s of b.strata || []) {
    const group = s.strata_group || "unknown"
    if (!groups.includes(group)) groups.push(group)
  }
  return groups
}

