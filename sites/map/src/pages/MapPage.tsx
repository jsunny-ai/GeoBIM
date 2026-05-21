import { useCallback, useEffect, useRef, useState, useMemo } from "react"
import "cesium/Build/Cesium/Widgets/widgets.css"
import { Pen, X } from "lucide-react"
import { useCesiumMap } from "@/features/map/useCesiumMap"
import type { Borehole, Project, BoreholeApiResponse } from "@/lib/types"

export default function MapPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [projectFilter, setProjectFilter] = useState<number | null>(null)

  // API 상태
  const [allBoreholes, setAllBoreholes] = useState<Borehole[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loadingBh, setLoadingBh] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  // 시추공 전체 로드 (마운트 시 1회)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/v1/boreholes?limit=10000&include_strata=true")
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body: BoreholeApiResponse = await res.json()
        if (!cancelled) {
          setAllBoreholes(body.boreholes)
          setLoadErr(null)
        }
      } catch (e: any) {
        if (!cancelled) setLoadErr(e.message || "시추공 데이터 로드 실패")
      } finally {
        if (!cancelled) setLoadingBh(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // 프로젝트 목록 로드
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/v1/projects?limit=1000")
        if (!res.ok) return
        const body = await res.json()
        if (!cancelled) setProjects(body.projects || [])
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])

  // 프로젝트 필터 적용
  const filteredBoreholes = projectFilter
    ? allBoreholes.filter((b) => b.project_id === projectFilter)
    : allBoreholes

  // Cesium 맵 훅 호출
  const { isDrawing, polygon, selectedBoreholes, startDrawing, cancelDrawing } =
    useCesiumMap(containerRef, filteredBoreholes, "Base")

  // polygon 좌표 배열로부터 BBOX(minLng, minLat, maxLng, maxLat)를 실시간 산출하는 헬퍼
  const calculatedBbox = useMemo<[number, number, number, number] | null>(() => {
    if (!polygon || polygon.length === 0) return null
    let minLng = Number.POSITIVE_INFINITY
    let minLat = Number.POSITIVE_INFINITY
    let maxLng = Number.NEGATIVE_INFINITY
    let maxLat = Number.NEGATIVE_INFINITY

    polygon.forEach((pt) => {
      if (pt.lng < minLng) minLng = pt.lng
      if (pt.lat < minLat) minLat = pt.lat
      if (pt.lng > maxLng) maxLng = pt.lng
      if (pt.lat > maxLat) maxLat = pt.lat
    })

    return [minLng, minLat, maxLng, maxLat]
  }, [polygon])

  // 2단계 3D 솔리드 뷰어(5173포트)로 BBOX 및 시추공 파라미터를 물고 도약하는 함수
  const handleProceedToStep2 = () => {
    if (!calculatedBbox) return
    const bboxStr = calculatedBbox.map((v) => v.toFixed(6)).join(",")
    const bhIdsStr = selectedBoreholes.map((b) => b.id).join(",")
    const polyStr = JSON.stringify(polygon)

    window.location.href = `http://localhost:5173/?bbox=${bboxStr}&boreholeIds=${bhIdsStr}&polygon=${encodeURIComponent(polyStr)}`
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh", background: "#0f172a" }}>
      {/* Cesium 3D 뷰어 컨테이너 */}
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* 좌측 사이드바 */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          width: 270,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          zIndex: 10,
        }}
      >


        {/* 프로젝트 필터 패널 */}
        <div
          style={{
            background: "rgba(15, 23, 42, 0.92)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: "12px 14px",
            backdropFilter: "blur(12px)",
            color: "#f8fafc",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            📁 대상 건설 프로젝트 필터
          </div>
          <div
            style={{
              maxHeight: 180,
              overflowY: "auto",
              fontSize: 12,
            }}
          >
            <div
              onClick={() => setProjectFilter(null)}
              style={{
                padding: "5px 8px",
                borderRadius: 6,
                cursor: "pointer",
                marginBottom: 2,
                background: projectFilter === null ? "rgba(56, 189, 248, 0.25)" : "transparent",
                fontWeight: projectFilter === null ? 600 : 400,
              }}
            >
              전체 프로젝트
            </div>
            {projects.map((p) => (
              <div
                key={p.id}
                onClick={() => setProjectFilter(p.id)}
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  cursor: "pointer",
                  marginBottom: 2,
                  background: projectFilter === p.id ? "rgba(56, 189, 248, 0.25)" : "transparent",
                  fontWeight: projectFilter === p.id ? 600 : 400,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={p.name}
              >
                {p.name}
              </div>
            ))}
          </div>
        </div>

        {/* 시추공 분석 범위 지정 */}
        <div
          style={{
            background: "rgba(15, 23, 42, 0.92)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: "12px 14px",
            backdropFilter: "blur(12px)",
            color: "#f8fafc",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            📐 시추공 분석 범위 지정
          </div>
          {isDrawing ? (
            <button
              onClick={cancelDrawing}
              style={{
                width: "100%",
                padding: "8px 0",
                borderRadius: 6,
                border: "1px solid rgba(248,113,113,0.5)",
                background: "rgba(248,113,113,0.15)",
                color: "#fca5a5",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <X size={14} /> 그리기 취소
            </button>
          ) : (
            <button
              onClick={startDrawing}
              style={{
                width: "100%",
                padding: "8px 0",
                borderRadius: 6,
                border: "1px solid rgba(56,189,248,0.4)",
                background: "rgba(56,189,248,0.1)",
                color: "#7dd3fc",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Pen size={14} /> 영역 그리기 시작
            </button>
          )}

          {/* 선택 영역 세부 정보 패널 */}
          {calculatedBbox && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 10px",
                background: "rgba(16, 24, 39, 0.6)",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.06)",
                fontSize: 11,
                color: "#cbd5e1",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6, color: "#fff" }}>선택 영역 좌표</div>
              <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0" }}>
                <span>경도 범위</span>
                <span>{calculatedBbox[0].toFixed(4)}° ~ {calculatedBbox[2].toFixed(4)}°</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", margin: "2px 0" }}>
                <span>위도 범위</span>
                <span>{calculatedBbox[1].toFixed(4)}° ~ {calculatedBbox[3].toFixed(4)}°</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", margin: "4px 0 0 0", paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <span>포함 시추공</span>
                <span style={{ color: "#38bdf8", fontWeight: 700 }}>{selectedBoreholes.length} 개</span>
              </div>
            </div>
          )}

          {/* 2단계 진행 확인 버튼 */}
          {calculatedBbox && (
            <button
              onClick={handleProceedToStep2}
              style={{
                width: "100%",
                padding: "10px 0",
                marginTop: 10,
                borderRadius: 6,
                border: "1px solid #22c55e",
                background: "#22c55e",
                color: "#fff",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                transition: "background 0.2s",
                boxShadow: "0 4px 12px rgba(34, 197, 94, 0.3)",
              }}
            >
              확인 ➡️ 2단계 진행 (3D 생성)
            </button>
          )}
        </div>
      </div>

      {/* 로딩/에러 표시 */}
      {loadingBh && (
        <div style={{ position: "absolute", top: 12, right: 12, color: "#94a3b8", fontSize: 12, zIndex: 10 }}>
          시추공 데이터 로딩 중...
        </div>
      )}
      {loadErr && (
        <div style={{ position: "absolute", top: 12, right: 12, color: "#f87171", fontSize: 12, zIndex: 10 }}>
          ⚠ {loadErr}
        </div>
      )}
    </div>
  )
}
