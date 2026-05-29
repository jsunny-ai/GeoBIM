import React from "react"

export type Basemap = "Satellite" | "Hybrid" | "Base"

const C = {
  panel: "rgba(15,20,32,.95)",
  border: "#2a3344",
  text: "#e8e8e8",
  secondary: "#cbd5e1",
  tertiary: "#8a9bb8",
  btnActive: "#2473bd",
  btnBorder: "#3084d0",
  btnIdle: "#1a2030",
  btnIdleBd: "#3a4a6a",
  input: "#1a2030",
  red: "#e85353",
} as const

const panelStyle: React.CSSProperties = {
  position: "absolute",
  top: 14,
  left: 14,
  background: C.panel,
  padding: "14px 16px",
  borderRadius: 10,
  border: `1px solid ${C.border}`,
  boxShadow: "0 4px 18px rgba(0,0,0,.5)",
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
  color: "#fff",
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

interface ViewerControlsProps {
  basemap: Basemap
  setBasemap: (map: Basemap) => void
  showDrape: boolean
  setShowDrape: React.Dispatch<React.SetStateAction<boolean>>
  renderMode: "smooth" | "voxel" | "rbf"
  setRenderMode: (mode: "smooth" | "voxel" | "rbf") => void
  verticalExag: number
  setVerticalExag: (exag: number) => void
  depthBelowMSL: number
  setDepthBelowMSL: (depth: number) => void
  visibility: Record<string, boolean>
  setVisibility: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  showColumns: boolean
  setShowColumns: React.Dispatch<React.SetStateAction<boolean>>
  showPhantoms?: boolean
  setShowPhantoms?: React.Dispatch<React.SetStateAction<boolean>>
  showConfidence?: boolean
  setShowConfidence?: React.Dispatch<React.SetStateAction<boolean>>
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
  showPhantoms = true,
  setShowPhantoms,
  showConfidence = true,
  setShowConfidence,
}) => {
  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 12, color: C.tertiary }}>KH Geo · 2단계</div>
      <h1 style={{ margin: "2px 0 4px 0", fontSize: 16, fontWeight: 700 }}>3D 지질 뷰어</h1>
      <div style={{ fontSize: 11, color: C.tertiary, marginBottom: 10 }}>
        초정밀 Three.js 지하 기하학 렌더러
      </div>

      <button
        onClick={() => {
          window.location.href = "http://localhost:5172/"
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
          marginBottom: 12,
        }}
      >
        ← 1단계 지도로 복귀
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
        윗면 지도 표시 오버랩
        <span style={{ marginLeft: "auto", fontSize: 10, color: C.tertiary }}>{showDrape ? "켜짐" : "꺼짐"}</span>
      </div>
      <select value={basemap} onChange={(e) => setBasemap(e.target.value as Basemap)} style={selectStyle} disabled={!showDrape}>
        <option value="Base">일반지도 (VWorld)</option>
        <option value="Satellite">항공사진 (위성)</option>
        <option value="Hybrid">위성 + 라벨</option>
      </select>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, marginBottom: 4 }}>렌더 방식</div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => setRenderMode("smooth")}
            style={{
              ...(renderMode === "smooth" ? segActive : segIdle),
              lineHeight: "1.2",
              padding: "4px 2px",
              fontSize: 11,
              flex: 1,
            }}
          >
            마칭큐브
            <span style={{ display: "block", fontSize: "9px", opacity: 0.8 }}>(매끄러움)</span>
          </button>
          <button
            onClick={() => setRenderMode("voxel")}
            style={{
              ...(renderMode === "voxel" ? segActive : segIdle),
              lineHeight: "1.2",
              padding: "4px 2px",
              fontSize: 11,
              flex: 1,
            }}
          >
            복셀
            <span style={{ display: "block", fontSize: "9px", opacity: 0.8 }}>(RLE 격자)</span>
          </button>
          <button
            onClick={() => setRenderMode("rbf")}
            style={{
              ...(renderMode === "rbf" ? segActive : segIdle),
              lineHeight: "1.2",
              padding: "4px 2px",
              fontSize: 11,
              flex: 1,
            }}
          >
            연속 RBF
            <span style={{ display: "block", fontSize: "9px", opacity: 0.8 }}>(SciPy)</span>
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, marginBottom: 4 }}>수직 과장 배율: {verticalExag}배 (1배 ~ 20배)</div>
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
          <span style={{ fontSize: 12 }}>슬리브 바닥 깊이 (m):</span>
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
              background: "#131929",
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
        {["soil", "weathered_rock", "soft_rock", "hard_rock", "unknown"].map((key) => {
          const on = visibility[key]
          return (
            <div
              key={key}
              onClick={() => setVisibility((v) => ({ ...v, [key]: !v[key] }))}
              style={{
                display: "flex",
                alignItems: "center",
                fontSize: 12,
                margin: "3px 0",
                padding: "2px 4px",
                borderRadius: 4,
                cursor: "pointer",
                opacity: on ? 1 : 0.38,
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
              <span style={{ marginLeft: "auto", fontSize: 10, color: C.tertiary }}>{on ? "켜짐" : "꺼짐"}</span>
            </div>
          )
        })}
        <div style={{ fontSize: 10, color: "#6a7a98", marginTop: 6, paddingLeft: 4 }}>
          윗면 지도는 오버랩 표시 스위치로 독립 제어됩니다.
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
        시추공 기둥 오버랩
      </div>

      {setShowPhantoms && (
        <div
          onClick={() => setShowPhantoms((s) => !s)}
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            fontSize: 12,
            cursor: "pointer",
            userSelect: "none",
            opacity: showPhantoms ? 1 : 0.5,
          }}
        >
          <span
            style={{
              width: 13,
              height: 13,
              borderRadius: 3,
              marginRight: 8,
              background: showPhantoms ? C.btnActive : C.btnIdle,
              border: `1px solid ${C.btnIdleBd}`,
              flexShrink: 0,
            }}
          />
          가상 시추공 (Phantom) 표시
        </div>
      )}

      {setShowConfidence && (
        <div
          onClick={() => setShowConfidence((s) => !s)}
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            fontSize: 12,
            cursor: "pointer",
            userSelect: "none",
            opacity: showConfidence ? 1 : 0.5,
          }}
        >
          <span
            style={{
              width: 13,
              height: 13,
              borderRadius: 3,
              marginRight: 8,
              background: showConfidence ? C.btnActive : C.btnIdle,
              border: `1px solid ${C.btnIdleBd}`,
              flexShrink: 0,
            }}
          />
          Convex 신뢰 영역 표시
        </div>
      )}
    </div>
  )
}
