import React from "react"
import { MAP_URL } from "@shared/urls"

export type Basemap = "Satellite" | "Hybrid" | "Base"

const C = {
  panel: "rgba(250,248,245,.97)",
  border: "#e9e4da",
  text: "#1c1917",
  secondary: "#44403c",
  tertiary: "#78716c",
  btnActive: "#D4D1CB",
  btnBorder: "#BEBAB3",
  btnIdle: "#f2ede6",
  btnIdleBd: "#e9e4da",
  input: "#f2ede6",
  red: "#dc2626",
} as const

const panelStyle: React.CSSProperties = {
  position: "absolute",
  top: 14,
  left: 14,
  background: C.panel,
  padding: "14px 16px",
  borderRadius: 10,
  border: `1px solid ${C.border}`,
  boxShadow: "0 4px 18px rgba(0,0,0,.12)",
  minWidth: 250,
  zIndex: 10,
  color: C.text,
  fontFamily: "'Noto Sans KR',-apple-system,sans-serif",
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  background: C.input,
  color: C.text,
  border: `1px solid ${C.btnIdleBd}`,
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
  fontFamily: "'Noto Sans KR',sans-serif",
}

const btnBase: React.CSSProperties = {
  padding: "7px 9px",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
  transition: "all .15s",
  fontFamily: "'Noto Sans KR',sans-serif",
}

const segActive: React.CSSProperties = {
  flex: 1,
  ...btnBase,
  background: C.btnActive,
  color: C.text,
  border: `1px solid ${C.btnBorder}`,
  fontWeight: 600,
}

const segIdle: React.CSSProperties = {
  flex: 1,
  ...btnBase,
  background: C.btnIdle,
  color: C.secondary,
  border: `1px solid ${C.btnIdleBd}`,
}

const LAYER_COLOR: Record<string, number> = {
  soil: 0x8b7355,
  weathered_rock: 0xc4a57b,
  soft_rock: 0x6b8e5a,
  normal_rock: 0x5f6552,
  hard_rock: 0x3d3d3d,
  unknown: 0xb4b4b4,
}

const LAYER_LABEL: Record<string, string> = {
  soil: "토사",
  weathered_rock: "풍화암",
  soft_rock: "연암",
  normal_rock: "보통암",
  hard_rock: "경암",
  unknown: "미분류",
}

interface ViewerControlsProps {
  basemap: Basemap
  setBasemap: (map: Basemap) => void
  showDrape: boolean
  setShowDrape: React.Dispatch<React.SetStateAction<boolean>>
  renderMode: "smooth" | "voxel"
  setRenderMode: (mode: "smooth" | "voxel") => void
  verticalExag: number
  setVerticalExag: (exag: number) => void
  depthBelowMSL: number
  setDepthBelowMSL: (depth: number) => void
  visibility: Record<string, boolean>
  setVisibility: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  showColumns: boolean
  setShowColumns: React.Dispatch<React.SetStateAction<boolean>>
  showGroundwater: boolean
  setShowGroundwater: React.Dispatch<React.SetStateAction<boolean>>
  showGroundwaterMarkers: boolean
  setShowGroundwaterMarkers: React.Dispatch<React.SetStateAction<boolean>>
  groundwaterOpacity: number
  setGroundwaterOpacity: React.Dispatch<React.SetStateAction<number>>
  groundwaterObservationCount: number
  groundwaterCanBuildSurface: boolean
  basementMode: "extend" | "unknown"
  setBasementMode: (mode: "extend" | "unknown") => void
  onOpenExport: () => void
  sectionEnabled: boolean
  onToggleSection: () => void
}

export const ViewerControls: React.FC<ViewerControlsProps> = ({
  basemap,
  setBasemap,
  showDrape,
  setShowDrape,
  renderMode,
  setRenderMode,
  verticalExag,
  setVerticalExag,
  depthBelowMSL,
  setDepthBelowMSL,
  visibility,
  setVisibility,
  showColumns,
  setShowColumns,
  showGroundwater,
  setShowGroundwater,
  showGroundwaterMarkers,
  setShowGroundwaterMarkers,
  groundwaterOpacity,
  setGroundwaterOpacity,
  groundwaterObservationCount,
  groundwaterCanBuildSurface,
  basementMode,
  setBasementMode,
  onOpenExport,
  sectionEnabled,
  onToggleSection,
}) => {
  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 12, color: C.tertiary }}>KH Geo · 2단계</div>
      <h1 style={{ margin: "2px 0 4px 0", fontSize: 16, fontWeight: 700 }}>3D 지질 뷰어</h1>
      <div style={{ fontSize: 11, color: C.tertiary, marginBottom: 10 }}>
        Three.js 기반 지층 형상 뷰어
      </div>

      <button
        onClick={() => {
          window.location.href = MAP_URL
        }}
        style={{
          width: "100%",
          padding: "7px 0",
          borderRadius: 6,
          background: "rgba(232,83,58,.15)",
          border: `1px solid ${C.red}`,
          color: C.red,
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "'Noto Sans KR',sans-serif",
          marginBottom: 6,
        }}
      >
        1단계 지도로 돌아가기
      </button>

      <button
        onClick={onOpenExport}
        style={{
          width: "100%",
          padding: "7px 0",
          borderRadius: 6,
          background: "rgba(160,155,148,.15)",
          border: "1px solid #BEBAB3",
          color: C.text,
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "'Noto Sans KR',sans-serif",
          marginBottom: 12,
        }}
      >
        데이터 내보내기
      </button>

      <button
        onClick={onToggleSection}
        style={{
          width: "100%",
          padding: "7px 0",
          borderRadius: 6,
          background: sectionEnabled ? "rgba(8,145,178,.18)" : C.btnIdle,
          border: `1px solid ${sectionEnabled ? "#0891b2" : C.btnIdleBd}`,
          color: sectionEnabled ? "#0e7490" : C.secondary,
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "'Noto Sans KR',sans-serif",
          marginBottom: 12,
        }}
      >
        {sectionEnabled ? "수직 단면 편집" : "수직 단면"}
      </button>

      <div
        onClick={() => setShowDrape((s) => !s)}
        style={{
          marginTop: 6,
          display: "flex",
          alignItems: "center",
          fontSize: 12,
          cursor: "pointer",
          userSelect: "none",
          opacity: showDrape ? 1 : 0.5,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            width: 13,
            height: 13,
            borderRadius: 3,
            marginRight: 8,
            background: showDrape ? C.btnActive : C.btnIdle,
            border: "1px solid rgba(255,255,255,.2)",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        표면 지도 표시
        <span style={{ marginLeft: "auto", fontSize: 10, color: C.tertiary }}>{showDrape ? "켬" : "끔"}</span>
      </div>
      <select value={basemap} onChange={(e) => setBasemap(e.target.value as Basemap)} style={selectStyle} disabled={!showDrape}>
        <option value="Base">일반지도 (VWorld)</option>
        <option value="Satellite">항공사진</option>
        <option value="Hybrid">항공사진 + 라벨</option>
      </select>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, marginBottom: 4 }}>렌더 방식</div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setRenderMode("smooth")} style={renderMode === "smooth" ? segActive : segIdle}>
            매끄러운 면
          </button>
          <button onClick={() => setRenderMode("voxel")} style={renderMode === "voxel" ? segActive : segIdle}>
            복셀
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, marginBottom: 4 }}>수직 과장 배율: {verticalExag}배</div>
        <input
          type="range"
          min={1}
          max={20}
          step={1}
          value={verticalExag}
          onChange={(e) => setVerticalExag(Number(e.target.value))}
          style={{ width: "100%", accentColor: C.btnActive }}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 12 }}>모델 바닥 깊이 (m):</span>
          <input
            type="number"
            min={10}
            max={100}
            step={1}
            value={depthBelowMSL}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v)) setDepthBelowMSL(Math.max(10, Math.min(100, v)))
            }}
            style={{
              width: 50,
              background: C.input,
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              color: C.text,
              fontSize: 11,
              textAlign: "center",
              padding: "1px 3px",
              outline: "none",
            }}
          />
        </div>
        <input
          type="range"
          min={10}
          max={100}
          step={2}
          value={depthBelowMSL}
          onChange={(e) => setDepthBelowMSL(Number(e.target.value))}
          style={{ width: "100%", accentColor: C.btnActive }}
        />
      </div>

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 12, color: C.tertiary, marginBottom: 6 }}>지층 표시 제어</div>
        {["soil", "weathered_rock", "soft_rock", "normal_rock", "hard_rock", "unknown"].map((key) => {
          const on = visibility[key]
          const disabled = key === "unknown" && basementMode === "extend"
          return (
            <div
              key={key}
              onClick={disabled ? undefined : () => setVisibility((v) => ({ ...v, [key]: !v[key] }))}
              style={{
                display: "flex",
                alignItems: "center",
                fontSize: 12,
                margin: "3px 0",
                padding: "2px 4px",
                borderRadius: 4,
                cursor: disabled ? "default" : "pointer",
                opacity: disabled ? 0.22 : on ? 1 : 0.38,
                userSelect: "none",
              }}
            >
              <span
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: 3,
                  marginRight: 8,
                  background: `#${LAYER_COLOR[key].toString(16).padStart(6, "0")}`,
                  border: "1px solid rgba(255,255,255,.2)",
                  flexShrink: 0,
                }}
              />
              {LAYER_LABEL[key]}
              <span style={{ marginLeft: "auto", fontSize: 10, color: C.tertiary }}>{on ? "켬" : "끔"}</span>
            </div>
          )
        })}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}>미분류 구간 처리</div>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => setBasementMode("extend")}
              style={{
                ...(basementMode === "extend" ? segActive : segIdle),
                lineHeight: "1.2",
                padding: "4px 2px",
                fontSize: 11,
                flex: 1,
              }}
            >
              연장
            </button>
            <button
              onClick={() => setBasementMode("unknown")}
              style={{
                ...(basementMode === "unknown" ? segActive : segIdle),
                lineHeight: "1.2",
                padding: "4px 2px",
                fontSize: 11,
                flex: 1,
              }}
            >
              미분류 유지
            </button>
          </div>
        </div>
      </div>

      <div
        onClick={() => setShowColumns((s) => !s)}
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          fontSize: 12,
          cursor: "pointer",
          userSelect: "none",
          opacity: showColumns ? 1 : 0.5,
        }}
      >
        <span
          style={{
            width: 13,
            height: 13,
            borderRadius: 3,
            marginRight: 8,
            background: showColumns ? C.btnActive : C.btnIdle,
            border: `1px solid ${C.btnIdleBd}`,
            flexShrink: 0,
          }}
        />
        시추공 기둥 표시
      </div>

      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 12, color: C.tertiary, marginBottom: 6 }}>수리 정보</div>
        <div
          onClick={() => setShowGroundwater((value) => !value)}
          style={{ display: "flex", alignItems: "center", fontSize: 12, cursor: "pointer", opacity: showGroundwater ? 1 : 0.45 }}
        >
          <span style={{ width: 13, height: 13, borderRadius: 3, marginRight: 8, background: "#22b8cf", border: "1px solid #0891b2" }} />
          지하수 포화영역
          <span style={{ marginLeft: "auto", fontSize: 10, color: C.tertiary }}>{showGroundwater ? "켬" : "끔"}</span>
        </div>
        <div
          onClick={() => setShowGroundwaterMarkers((value) => !value)}
          style={{ display: "flex", alignItems: "center", marginTop: 5, fontSize: 12, cursor: "pointer", opacity: showGroundwaterMarkers ? 1 : 0.45 }}
        >
          <span style={{ width: 13, height: 13, borderRadius: "50%", marginRight: 8, background: "#0284c7", border: "2px solid #bae6fd", boxSizing: "border-box" }} />
          실측 수위 마커
          <span style={{ marginLeft: "auto", fontSize: 10, color: C.tertiary }}>{showGroundwaterMarkers ? "켬" : "끔"}</span>
        </div>
        <div style={{ marginTop: 7, fontSize: 11, color: groundwaterCanBuildSurface ? C.secondary : C.red }}>
          실측 {groundwaterObservationCount}개 · {groundwaterCanBuildSurface ? "솔리드 생성" : "3개 미만: 마커만 표시"}
        </div>
        <div style={{ marginTop: 7, fontSize: 11, color: C.tertiary }}>
          투명도 {Math.round(groundwaterOpacity * 100)}%
        </div>
        <input
          type="range"
          min={0.15}
          max={0.8}
          step={0.05}
          value={groundwaterOpacity}
          disabled={!showGroundwater}
          onChange={(event) => setGroundwaterOpacity(Number(event.target.value))}
          style={{ width: "100%", accentColor: "#0891b2" }}
        />
      </div>
    </div>
  )
}
