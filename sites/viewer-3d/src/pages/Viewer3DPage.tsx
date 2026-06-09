import { useRef, useState, useEffect } from "react"
import { BoreholeTable } from "../components/BoreholeTable"
import { ViewerControls, type Basemap } from "../components/ViewerControls"
import { useBoreholeData } from "../hooks/useBoreholeData"
import { useGeoModel, type GeoModelSettings } from "../hooks/useGeoModel"
import { useThreeScene } from "../hooks/useThreeScene"
import { parseUrlParams } from "@/lib/parseUrl"
import type { Borehole } from "@/lib/types"
import { MAP_URL } from "@shared/urls"

const C = {
  bg: "#faf8f5",
  border: "#e9e4da",
  text: "#1c1917",
  secondary: "#44403c",
  tertiary: "#78716c",
  red: "#dc2626",
} as const

const statusBar: React.CSSProperties = {
  position: "absolute",
  bottom: 14,
  left: 14,
  background: "rgba(250,248,245,.93)",
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
  background: "rgba(250,248,245,.88)",
  padding: "9px 12px",
  borderRadius: 6,
  fontSize: 11,
  color: C.tertiary,
  border: `1px solid ${C.border}`,
  zIndex: 10,
  fontFamily: "'Noto Sans KR',sans-serif",
}

export default function Viewer3DPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const bhPosRef = useRef<Record<string, { x: number; y: number; z: number }>>({})

  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null)
  const [polygon, setPolygon] = useState<any[] | null>(null)
  const [boreholeIds, setBoreholeIds] = useState<number[]>([])
  const [projectId, setProjectId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoadingProject, setIsLoadingProject] = useState(true)

  const [status, setStatus] = useState("초기화 중...")
  const [selectedBh, setSelectedBh] = useState<string | null>(null)
  const [verticalExag, setVerticalExag] = useState(1)
  const [depthBelowMSL, setDepthBelowMSL] = useState(50)
  const [basemap, setBasemap] = useState<Basemap>("Base")
  const [showColumns, setShowColumns] = useState(true)
  const [showDrape, setShowDrape] = useState(true)
  const [renderMode, setRenderMode] = useState<"smooth" | "voxel">("smooth")
  const [visibility, setVisibility] = useState<Record<string, boolean>>({
    soil: true,
    weathered_rock: true,
    soft_rock: true,
    normal_rock: true,
    hard_rock: true,
    unknown: true,
  })

  const { sceneRef, cameraRef, controlsRef } = useThreeScene(containerRef)
  const { boreholes, fetchStatus, fetchErr } = useBoreholeData(bbox, polygon, boreholeIds, projectId)
  const [bhState, setBhState] = useState<(Borehole & { dem_elevation?: number })[]>([])

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const projId = sp.get("projectId") || sp.get("project_id")

    if (projId) {
      setProjectId(Number(projId))
      setIsLoadingProject(true)
      ;(async () => {
        try {
          const res = await fetch(`/api/v1/projects/${projId}`)
          if (!res.ok) throw new Error("프로젝트를 불러오지 못했습니다.")
          const proj = await res.json()
          if (proj.bbox && typeof proj.bbox === "object") {
            const { bbox: rectBbox, polygon: rectPoly, borehole_ids: bhIds } = proj.bbox
            setBbox(rectBbox)
            setPolygon(rectPoly)
            setBoreholeIds(bhIds || [])
            setError(null)
          } else {
            throw new Error("프로젝트에 저장된 영역 정보가 없습니다.")
          }
        } catch (err: any) {
          setError(err.message || String(err))
        } finally {
          setIsLoadingProject(false)
        }
      })()
    } else {
      setProjectId(null)
      setIsLoadingProject(false)
      const parsed = parseUrlParams()
      if (parsed.error) {
        setError(parsed.error)
      } else {
        setBbox(parsed.bbox)
        setPolygon(parsed.polygon)
        setBoreholeIds(parsed.boreholeIds)
      }
    }
  }, [])

  useEffect(() => {
    if (boreholes && boreholes.length > 0) {
      setBhState(boreholes)
    }
  }, [boreholes])

  const handleUpdateElevation = async (bhId: string, newElev: number) => {
    const response = await fetch(`/api/v1/boreholes/${bhId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elevation: newElev }),
    })
    if (!response.ok) {
      throw new Error("표고 서버 반영 실패: " + response.statusText)
    }

    setBhState((prev) =>
      prev.map((b) => (Number(b.id) === Number(bhId) ? { ...b, elevation: newElev } : b))
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
  }

  const { focusBorehole } = useGeoModel(sceneRef, cameraRef, controlsRef, bhState, bbox, polygon, modelSettings, containerRef)

  // ── 항상 viewport div를 DOM에 유지 ──────────────────────────────────────
  // useThreeScene의 effect 의존성이 [containerRef](ref 객체)라서
  // isLoadingProject/error 상태에 따라 viewport div를 조건부 제거하면
  // containerRef.current 가 null인 채로 effect가 1회 실행 후 재실행 안 됨 →
  // sceneRef.current = null 고착 → useGeoModel 조기 반환 → "초기화 중..." 고착
  // 해결: viewport div는 항상 렌더링하고, loading/error는 오버레이로 처리

  const showLoadingOverlay = isLoadingProject
  const showErrorOverlay   = !isLoadingProject && !!(error || !polygon || !bbox)

  return (
    <div style={{ position: "relative", height: "100vh", display: "flex", background: C.bg, overflow: "hidden", userSelect: "none" }}>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        {/* Three.js 컨테이너 — 항상 DOM에 유지해야 scene 초기화 보장 */}
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

        {/* ── 로딩 오버레이 ── */}
        {showLoadingOverlay && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 50,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: C.bg, color: C.text, fontSize: 14,
            fontFamily: "'Noto Sans KR',sans-serif",
          }}>
            <p>프로젝트 지질 데이터 로딩 중…</p>
          </div>
        )}

        {/* ── 에러 오버레이 ── */}
        {showErrorOverlay && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 50,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: 16,
            background: C.bg, color: C.text,
            fontFamily: "'Noto Sans KR',sans-serif",
          }}>
            <p style={{ fontSize: 13, color: C.red }}>{error ?? "영역 정보가 없습니다."}</p>
            <a href={MAP_URL} style={{ fontSize: 12, color: C.tertiary, textDecoration: "underline" }}>
              1단계 지도로 돌아가기
            </a>
          </div>
        )}

        {/* ── 정상 UI (loading/error 아닐 때만 표시) ── */}
        {!showLoadingOverlay && !showErrorOverlay && (
          <>
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
            />

            <div style={hint}>
              <div>마우스 좌클릭 + 드래그 = 3D 회전</div>
              <div>Shift + 마우스 드래그 = 시점 이동</div>
              <div>마우스 휠 = 카메라 줌 인/아웃</div>
            </div>

            {fetchStatus === "loading" && (
              <div style={{
                position: "absolute", bottom: 50, left: "50%",
                transform: "translateX(-50%)", zIndex: 20,
                background: "rgba(0,0,0,0.8)", color: C.text,
                fontSize: 12, padding: "6px 16px", borderRadius: 20,
                fontFamily: "'Noto Sans KR',sans-serif",
              }}>
                시추공 데이터를 불러오는 중...
              </div>
            )}
            {fetchStatus === "error" && (
              <div style={{
                position: "absolute", bottom: 50, left: "50%",
                transform: "translateX(-50%)", zIndex: 20,
                background: "rgba(127,29,29,0.8)", color: "#fca5a5",
                fontSize: 12, padding: "6px 16px", borderRadius: 20,
                fontFamily: "'Noto Sans KR',sans-serif",
              }}>
                {fetchErr}
              </div>
            )}

            <div style={statusBar}>{status}</div>
          </>
        )}
      </div>

      {!showLoadingOverlay && !showErrorOverlay && (
        <BoreholeTable
          boreholes={bhState}
          selectedBh={selectedBh}
          setSelectedBh={setSelectedBh}
          focusBorehole={focusBorehole}
          onUpdateElevation={handleUpdateElevation}
        />
      )}
    </div>
  )
}
