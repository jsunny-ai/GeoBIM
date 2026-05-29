import { useRef, useState, useEffect } from "react"
import { BoreholeTable } from "../components/BoreholeTable"
import { ViewerControls, type Basemap } from "../components/ViewerControls"
import { useBoreholeData } from "../hooks/useBoreholeData"
import { useGeoModel, type GeoModelSettings } from "../hooks/useGeoModel"
import { useThreeScene } from "../hooks/useThreeScene"
import { parseUrlParams } from "@/lib/parseUrl"
import type { Borehole } from "@/lib/types"

const C = {
  bg: "#0a0e1a",
  border: "#2a3344",
  text: "#e8e8e8",
  secondary: "#cbd5e1",
  tertiary: "#8a9bb8",
  red: "#e85353",
} as const

const statusBar: React.CSSProperties = {
  position: "absolute",
  bottom: 14,
  left: 14,
  background: "rgba(15,20,32,.92)",
  padding: "8px 13px",
  borderRadius: 7,
  fontSize: 11,
  color: C.secondary,
  border: `1px solid ${C.border}`,
  zIndex: 10,
  fontFamily: "'Noto Sans KR',sans-serif",
  maxWidth: "50vw",
}

const hint: React.CSSProperties = {
  position: "absolute",
  top: 14,
  right: 14,
  background: "rgba(15,20,32,.85)",
  padding: "9px 12px",
  borderRadius: 6,
  fontSize: 11,
  color: C.tertiary,
  border: `1px solid ${C.border}`,
  zIndex: 10,
  fontFamily: "'Noto Sans KR',sans-serif",
}

const { polygon, boreholeIds, bbox, error: parseError } = parseUrlParams()

export default function Viewer3DPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const bhPosRef = useRef<Record<number, { x: number; y: number; z: number }>>({})

  const [status, setStatus] = useState("초기화 중...")
  const [selectedBh, setSelectedBh] = useState<number | null>(null)
  const [verticalExag, setVerticalExag] = useState(1)
  const [depthBelowMSL, setDepthBelowMSL] = useState(50)
  const [basemap, setBasemap] = useState<Basemap>("Base")
  const [showColumns, setShowColumns] = useState(true)
  const [showDrape, setShowDrape] = useState(true)
  const [renderMode, setRenderMode] = useState<"smooth" | "voxel" | "rbf">("smooth")
  const [showPhantoms, setShowPhantoms] = useState(true)
  const [showConfidence, setShowConfidence] = useState(true)
  const [visibility, setVisibility] = useState<Record<string, boolean>>({
    soil: true,
    weathered_rock: true,
    soft_rock: true,
    hard_rock: true,
    unknown: true,
  })

  const { sceneRef, cameraRef, controlsRef } = useThreeScene(containerRef)
  const { boreholes, fetchStatus, fetchErr } = useBoreholeData(bbox, polygon, boreholeIds)
  const [bhState, setBhState] = useState<(Borehole & { dem_elevation?: number })[]>([])

  useEffect(() => {
    if (boreholes && boreholes.length > 0) {
      setBhState(boreholes)
    }
  }, [boreholes])

  const handleUpdateElevation = async (bhId: number, newElev: number) => {
    const response = await fetch(`/api/v1/boreholes/${bhId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elevation: newElev }),
    })
    if (!response.ok) {
      throw new Error("표고 서버 반영 실패: " + response.statusText)
    }

    setBhState((prev) =>
      prev.map((b) => (b.id === bhId ? { ...b, elevation: newElev } : b))
    )
  }

  const modelSettings: GeoModelSettings = {
    verticalExag,
    depthBelowMSL,
    basemap,
    visibility,
    showColumns,
    showDrape,
    renderMode,
    selectedBh,
    setSelectedBh,
    setStatus,
    bhPosRef,
    showPhantoms,
    showConfidence,
  }

  const { focusBorehole } = useGeoModel(sceneRef, cameraRef, controlsRef, bhState, bbox, modelSettings)

  if (parseError || !polygon) {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: C.bg,
          color: C.text,
          flexDirection: "column",
          gap: 16,
          fontFamily: "'Noto Sans KR',sans-serif",
        }}
      >
        <p style={{ fontSize: 13, color: C.red }}>{parseError ?? "영역 정보가 없습니다."}</p>
        <a href="http://localhost:5172/" style={{ fontSize: 12, color: C.tertiary, textDecoration: "underline" }}>
          1단계 지도로 돌아가기
        </a>
      </div>
    )
  }

  return (
    <div style={{ position: "relative", height: "100vh", display: "flex", background: "#000", overflow: "hidden", userSelect: "none" }}>
      <div style={{ position: "relative", flex: 1 }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

        <ViewerControls
          basemap={basemap}
          setBasemap={setBasemap}
          showDrape={showDrape}
          setShowDrape={setShowDrape}
          renderMode={renderMode}
          setRenderMode={setRenderMode}
          verticalExag={verticalExag}
          setVerticalExag={setVerticalExag}
          depthBelowMSL={depthBelowMSL}
          setDepthBelowMSL={setDepthBelowMSL}
          visibility={visibility}
          setVisibility={setVisibility}
          showColumns={showColumns}
          setShowColumns={setShowColumns}
          showPhantoms={showPhantoms}
          setShowPhantoms={setShowPhantoms}
          showConfidence={showConfidence}
          setShowConfidence={setShowConfidence}
        />

        <div style={hint}>
          <div>마우스 좌클릭 + 드래그 = 3D 회전</div>
          <div>Shift + 마우스 드래그 = 시점 이동</div>
          <div>마우스 휠 = 카메라 줌 인/아웃</div>
        </div>

        {fetchStatus === "loading" && (
          <div
            style={{
              position: "absolute",
              bottom: 50,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 20,
              background: "rgba(0,0,0,0.8)",
              color: C.text,
              fontSize: 12,
              padding: "6px 16px",
              borderRadius: 20,
              fontFamily: "'Noto Sans KR',sans-serif",
            }}
          >
            시추공 데이터를 불러오는 중...
          </div>
        )}
        {fetchStatus === "error" && (
          <div
            style={{
              position: "absolute",
              bottom: 50,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 20,
              background: "rgba(127,29,29,0.8)",
              color: "#fca5a5",
              fontSize: 12,
              padding: "6px 16px",
              borderRadius: 20,
              fontFamily: "'Noto Sans KR',sans-serif",
            }}
          >
            {fetchErr}
          </div>
        )}

        <div style={statusBar}>{status}</div>
      </div>

      <BoreholeTable
        boreholes={bhState}
        selectedBh={selectedBh}
        setSelectedBh={setSelectedBh}
        focusBorehole={focusBorehole}
        onUpdateElevation={handleUpdateElevation}
      />
    </div>
  )
}
