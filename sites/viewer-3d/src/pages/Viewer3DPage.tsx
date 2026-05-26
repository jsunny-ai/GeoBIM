// @ts-nocheck — Three.js 타입 미설치 및 모노레포 tsc 컴파일 우회 (런타임 정상 가동)
import { useEffect, useRef, useState, useCallback } from "react"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import {
  buildAreaCanvas, buildElevationGrid, idwGrid,
} from "@/lib/terrain"
import { parseUrlParams, fetchBoreholesByBbox } from "@/lib/parseUrl"
import type { Borehole } from "@/lib/types"

// ── 지층 색상·레이블 (지리적 정합성 매핑 완료) ────────────────────────────
const LAYER_COLOR: Record<string, number> = {
  soil:           0x8b7355,
  weathered_rock: 0xc4a57b,
  soft_rock:      0x6b8e5a,
  hard_rock:      0x3d3d3d,
  UNKNOWN:        0xb4b4b4,
  unknown:        0xb4b4b4,
}
const LAYER_LABEL: Record<string, string> = {
  soil: "토사", weathered_rock: "풍화암", soft_rock: "연암", hard_rock: "경암", UNKNOWN: "미분류",
}
// 지층 순서 (위 → 아래) 및 경계 등급
const LAYER_STACK = ["soil", "weathered_rock", "soft_rock", "hard_rock", "UNKNOWN"]
const RANK: Record<string, number> = {
  soil: 0, weathered_rock: 1, soft_rock: 2, hard_rock: 3,
}

// ── 마칭큐브 삼각형 테이블 (표준 256 케이스, 빈 케이스는 [] ) ──────
const TRI_TABLE: number[][] = [
  [],[0,8,3],[0,1,9],[1,8,3,9,8,1],[1,2,10],[0,8,3,1,2,10],[9,2,10,0,2,9],
  [2,8,3,2,10,8,10,9,8],[3,11,2],[0,11,2,8,11,0],[1,9,0,2,3,11],
  [1,11,2,1,9,11,9,8,11],[3,10,1,11,10,3],[0,10,1,0,8,10,8,11,10],
  [3,9,0,3,11,9,11,10,9],[9,8,10,10,8,11],[4,7,8],[4,3,0,7,3,4],
  [0,1,9,8,4,7],[4,1,9,4,7,1,7,3,1],[1,2,10,8,4,7],[3,4,7,3,0,4,1,2,10],
  [9,2,10,9,0,2,8,4,7],[2,10,9,2,9,7,2,7,3,7,9,4],[8,4,7,3,11,2],
  [11,4,7,11,2,4,2,0,4],[9,0,1,8,4,7,2,3,11],[4,7,11,9,4,11,9,11,2,9,2,1],
  [3,10,1,3,11,10,7,8,4],[1,11,10,1,4,11,1,0,4,7,11,4],
  [4,7,8,9,0,11,9,11,10,11,0,3],[4,7,11,4,11,9,9,11,10],[9,5,4],
  [9,5,4,0,8,3],[0,5,4,1,5,0],[8,5,4,8,3,5,3,1,5],[1,2,10,9,5,4],
  [3,0,8,1,2,10,4,9,5],[5,2,10,5,4,2,4,0,2],[2,10,5,3,2,5,3,5,4,3,4,8],
  [9,5,4,2,3,11],[0,11,2,0,8,11,4,9,5],[0,5,4,0,1,5,2,3,11],
  [2,1,5,2,5,8,2,8,11,4,8,5],[10,3,11,10,1,3,9,5,4],
  [4,9,5,0,8,1,8,10,1,8,11,10],[5,4,0,5,0,11,5,11,10,11,0,3],
  [5,4,8,5,8,10,10,8,11],[9,7,8,5,7,9],[9,3,0,9,5,3,5,7,3],
  [0,7,8,0,1,7,1,5,7],[1,5,3,3,5,7],[9,7,8,9,5,7,10,1,2],
  [10,1,2,9,5,0,5,3,0,5,7,3],[8,0,2,8,2,5,8,5,7,10,5,2],
  [2,10,5,2,5,3,3,5,7],[7,9,5,7,8,9,3,11,2],[9,5,7,9,7,2,9,2,0,2,7,11],
  [2,3,11,0,1,8,1,7,8,1,5,7],[11,2,1,11,1,7,7,1,5],
  [9,5,8,8,5,7,10,1,3,10,3,11],[5,7,0,5,0,9,7,11,0,1,0,10,11,10,0],
  [11,10,0,11,0,3,10,5,0,8,0,7,5,7,0],[11,10,5,7,11,5],[10,6,5],
  [0,8,3,5,10,6],[9,0,1,5,10,6],[1,8,3,1,9,8,5,10,6],[1,6,5,2,6,1],
  [1,6,5,1,2,6,3,0,8],[9,6,5,9,0,6,0,2,6],[5,9,8,5,8,2,5,2,6,3,2,8],
  [2,3,11,10,6,5],[11,0,8,11,2,0,10,6,5],[0,1,9,2,3,11,5,10,6],
  [5,10,6,1,9,2,9,11,2,9,8,11],[6,3,11,6,5,3,5,1,3],
  [0,8,11,0,11,5,0,5,1,5,11,6],[3,11,6,0,3,6,0,6,5,0,5,9],
  [6,5,9,6,9,11,11,9,8],[5,10,6,4,7,8],[4,3,0,4,7,3,6,5,10],
  [1,9,0,5,10,6,8,4,7],[10,6,5,1,9,7,1,7,3,7,9,4],[6,1,2,6,5,1,4,7,8],
  [1,2,5,5,2,6,3,0,4,3,4,7],[8,4,7,9,0,5,0,6,5,0,2,6],
  [7,3,9,7,9,4,3,2,9,5,9,6,2,6,9],[3,11,2,7,8,4,10,6,5],
  [5,10,6,4,7,2,4,2,0,2,7,11],[0,1,9,4,7,8,2,3,11,5,10,6],
  [9,2,1,9,11,2,9,4,11,7,11,4,5,10,6],[8,4,7,3,11,5,3,5,1,5,11,6],
  [5,1,11,5,11,6,1,0,11,7,11,4,0,4,11],
  [0,5,9,0,6,5,0,3,6,11,6,3,8,4,7],[6,5,9,6,9,11,4,7,9,7,11,9],
  [10,4,9,6,4,10],[4,10,6,4,9,10,0,8,3],[10,0,1,10,6,0,6,4,0],
  [8,3,1,8,1,6,8,6,4,6,1,10],[1,4,9,1,2,4,2,6,4],
  [3,0,8,1,2,9,2,4,9,2,6,4],[0,2,4,4,2,6],[8,3,2,8,2,4,4,2,6],
  [10,4,9,10,6,4,11,2,3],[0,8,2,2,8,11,4,9,10,4,10,6],
  [3,11,2,0,1,6,0,6,4,6,1,10],[6,4,1,6,1,10,4,8,1,2,1,11,8,11,1],
  [9,6,4,9,3,6,9,1,3,11,6,3],[8,11,1,8,1,0,11,6,1,9,1,4,6,4,1],
  [3,11,6,3,6,0,0,6,4],[6,4,8,11,6,8],[7,10,6,7,8,10,8,9,10],
  [0,7,3,0,10,7,0,9,10,6,7,10],[10,6,7,1,10,7,1,7,8,1,8,0],
  [10,6,7,10,7,1,1,7,3],[1,2,6,1,6,8,1,8,9,8,6,7],
  [2,6,9,2,9,1,6,7,9,0,9,3,7,3,9],[7,8,0,7,0,6,6,0,2],[7,3,2,6,7,2],
  [2,3,11,10,6,8,10,8,9,8,6,7],[2,0,7,2,7,11,0,9,7,6,7,10,9,10,7],
  [1,8,0,1,7,8,1,10,7,6,7,10,2,3,11],[11,2,1,11,1,7,10,6,1,6,7,1],
  [8,9,6,8,6,7,9,1,6,11,6,3,1,3,6],[0,9,1,11,6,7],
  [7,8,0,7,0,6,3,11,0,11,6,0],[7,11,6],[7,6,11],[3,0,8,11,7,6],
  [0,1,9,11,7,6],[8,1,9,8,3,1,11,7,6],[10,1,2,6,11,7],
  [1,2,10,3,0,8,6,11,7],[2,9,0,2,10,9,6,11,7],
  [6,11,7,2,10,3,10,8,3,10,9,8],[7,2,3,6,2,7],[7,0,8,7,6,0,6,2,0],
  [2,7,6,2,3,7,0,1,9],[1,6,2,1,8,6,1,9,8,8,7,6],[10,7,6,10,1,7,1,3,7],
  [10,7,6,1,7,10,1,8,7,1,0,8],[0,3,7,0,7,10,0,10,9,6,10,7],
  [7,6,10,7,10,8,8,10,9],[6,8,4,11,8,6],[3,6,11,3,0,6,0,4,6],
  [8,6,11,8,4,6,9,0,1],[9,4,6,9,6,3,9,3,1,11,3,6],[6,8,4,6,11,8,2,10,1],
  [1,2,10,3,0,11,0,6,11,0,4,6],[4,11,8,4,6,11,0,2,9,2,10,9],
  [10,9,3,10,3,2,9,4,3,11,3,6,4,6,3],[8,2,3,8,4,2,4,6,2],[0,4,2,4,6,2],
  [1,9,0,2,3,4,2,4,6,4,3,8],[1,9,4,1,4,2,2,4,6],
  [8,1,3,8,6,1,8,4,6,6,10,1],[10,1,0,10,0,6,6,0,4],
  [4,6,3,4,3,8,6,10,3,0,3,9,10,9,3],[10,9,4,6,10,4],[4,9,5,7,6,11],
  [0,8,3,4,9,5,11,7,6],[5,0,1,5,4,0,7,6,11],
  [11,7,6,8,3,4,3,5,4,3,1,5],[9,5,4,10,1,2,7,6,11],
  [6,11,7,1,2,10,0,8,3,4,9,5],[7,6,11,5,4,10,4,2,10,4,0,2],
  [3,4,8,3,5,4,3,2,5,10,5,2,11,7,6],[7,2,3,7,6,2,5,4,9],
  [9,5,4,0,8,6,0,6,2,6,8,7],[3,6,2,3,7,6,1,5,0,5,4,0],
  [6,2,8,6,8,7,2,1,8,4,8,5,1,5,8],[9,5,4,10,1,6,1,7,6,1,3,7],
  [1,6,10,1,7,6,1,0,7,8,7,0,9,5,4],
  [4,0,10,4,10,5,0,3,10,6,10,7,3,7,10],
  [7,6,10,7,10,8,5,4,10,4,8,10],[6,9,5,6,11,9,11,8,9],
  [3,6,11,0,6,3,0,5,6,0,9,5],[0,11,8,0,5,11,0,1,5,5,6,11],
  [6,11,3,6,3,5,5,3,1],[1,2,10,9,5,11,9,11,8,11,5,6],
  [0,11,3,0,6,11,0,9,6,5,6,9,1,2,10],
  [11,8,5,11,5,6,8,0,5,10,5,2,0,2,5],[6,11,3,6,3,5,2,10,3,10,5,3],
  [5,8,9,5,2,8,5,6,2,3,8,2],[9,5,6,9,6,0,0,6,2],
  [1,5,8,1,8,0,5,6,8,3,8,2,6,2,8],[1,5,6,2,1,6],
  [1,3,6,1,6,10,3,8,6,5,6,9,8,9,6],[10,1,0,10,0,6,9,5,0,5,6,0],
  [0,3,8,5,6,10],[10,5,6],[11,5,10,7,5,11],[11,5,10,11,7,5,8,3,0],
  [5,11,7,5,10,11,1,9,0],[10,7,5,10,11,7,9,8,1,8,3,1],
  [11,1,2,11,7,1,7,5,1],[0,8,3,1,2,7,1,7,5,7,2,11],
  [9,7,5,9,2,7,9,0,2,2,11,7],[7,5,2,7,2,11,5,9,2,3,2,8,9,8,2],
  [2,5,10,2,3,5,3,7,5],[8,2,0,8,5,2,8,7,5,10,2,5],
  [9,0,1,5,10,3,5,3,7,3,10,2],[9,8,2,9,2,1,8,7,2,10,2,5,7,5,2],
  [1,3,5,3,7,5],[0,8,7,0,7,1,1,7,5],[9,0,3,9,3,5,5,3,7],[9,8,7,5,9,7],
  [5,8,4,5,10,8,10,11,8],[5,0,4,5,11,0,5,10,11,11,3,0],
  [0,1,9,8,4,10,8,10,11,10,4,5],[10,11,4,10,4,5,11,3,4,9,4,1,3,1,4],
  [2,5,1,2,8,5,2,11,8,4,5,8],[0,4,11,0,11,3,4,5,11,2,11,1,5,1,11],
  [0,2,5,0,5,9,2,11,5,4,5,8,11,8,5],[9,4,5,2,11,3],
  [2,5,10,3,5,2,3,4,5,3,8,4],[5,10,2,5,2,4,4,2,0],
  [3,10,2,3,5,10,3,8,5,4,5,8,0,1,9],[5,10,2,5,2,4,1,9,2,9,4,2],
  [8,4,5,8,5,3,3,5,1],[0,4,5,1,0,5],[8,4,5,8,5,3,9,0,5,0,3,5],[9,4,5],
  [4,11,7,4,9,11,9,10,11],[0,8,3,4,9,7,9,11,7,9,10,11],
  [1,10,11,1,11,4,1,4,0,7,4,11],[3,1,4,3,4,8,1,10,4,7,4,11,10,11,4],
  [4,11,7,9,11,4,9,2,11,9,1,2],[9,7,4,9,11,7,9,1,11,2,11,1,0,8,3],
  [11,7,4,11,4,2,2,4,0],[11,7,4,11,4,2,8,3,4,3,2,4],
  [2,9,10,2,7,9,2,3,7,7,4,9],[9,10,7,9,7,4,10,2,7,8,7,0,2,0,7],
  [3,7,10,3,10,2,7,4,10,1,10,0,4,0,10],[1,10,2,8,7,4],
  [4,9,1,4,1,7,7,1,3],[4,9,1,4,1,7,0,8,1,8,7,1],[4,0,3,7,4,3],
  [4,8,7],[9,10,8,10,11,8],[3,0,9,3,9,11,11,9,10],
  [0,1,10,0,10,8,8,10,11],[3,1,10,11,3,10],[1,2,11,1,11,9,9,11,8],
  [3,0,9,3,9,11,1,2,9,2,11,9],[0,2,11,8,0,11],[3,2,11],
  [2,3,8,2,8,10,10,8,9],[9,10,2,0,9,2],[2,3,8,2,8,10,0,1,8,1,10,8],
  [1,10,2],[1,3,8,9,1,8],[0,9,1],[0,3,8],[],
]

const CELL_SIZES = [5, 10, 20, 50] as const
type Basemap = "Satellite" | "Hybrid" | "Base"

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
  minWidth: 250, zIndex: 10, color: C.text,
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
const segActive: React.CSSProperties = {
  flex: 1, ...btnBase, background: C.btnActive, color: "#fff",
  border: `1px solid ${C.btnBorder}`, fontWeight: 600,
}
const segIdle: React.CSSProperties = {
  flex: 1, ...btnBase, background: C.btnIdle, color: C.secondary,
  border: `1px solid ${C.btnIdleBd}`,
}
const btnIdle: React.CSSProperties = {
  ...btnBase, background: C.btnIdle, color: C.secondary,
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

// ── URL 파라미터 파싱 ────────────────────────────────────────────────
const { polygon, boreholeIds, bbox, error: parseError } = parseUrlParams()

export default function Viewer3DPage() {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const dimsRef = useRef({ boxW: 2, boxD: 2, lngWidthM: 1, latWidthM: 1, mScale: 1 })

  // 렌더링에 사용되는 Three.js Object 레퍼런스들
  const smoothMeshRef = useRef<Record<string, THREE.Mesh>>({})
  const voxelMeshRef = useRef<Record<string, THREE.Mesh>>({})
  const drapeRef = useRef<THREE.Mesh | null>(null)
  const bhGroupRef = useRef<THREE.Group | null>(null)
  const markerRef = useRef<THREE.Mesh | null>(null)
  const stratumGroupRef = useRef<THREE.Group | null>(null)
  const bhPosRef = useRef<Record<number, { x: number; y: number; z: number }>>({})

  const [boreholes, setBoreholes]     = useState<Borehole[]>([])
  const [fetchStatus, setFetchStatus] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [fetchErr, setFetchErr]       = useState<string | null>(null)
  const [status, setStatus]           = useState("초기화 중...")
  const [selectedBh, setSelectedBh]   = useState<number | null>(null)

  const [verticalExag, setVerticalExag] = useState<number>(1)
  const [depthBelowMSL, setDepthBelowMSL] = useState<number>(50) // 기본 바닥 깊이
  const [basemap, setBasemap]         = useState<Basemap>("Base")
  const [visibility, setVisibility]     = useState<Record<string, boolean>>({
    soil: true, weathered_rock: true, soft_rock: true, hard_rock: true, UNKNOWN: true,
  })
  const [showColumns, setShowColumns] = useState<boolean>(true)
  const [showDrape, setShowDrape]     = useState<boolean>(true) // 🌟 윗면 지도 독립 제어 상태 신설
  const [renderMode, setRenderMode]   = useState<"smooth" | "voxel">("smooth")

  // 상태를 실시간으로 Three.js 렌더 루프에 노출하기 위한 레퍼런스 미러
  const visibilityRef = useRef(visibility); visibilityRef.current = visibility
  const showColumnsRef = useRef(showColumns); showColumnsRef.current = showColumns
  const showDrapeRef = useRef(showDrape); showDrapeRef.current = showDrape
  const renderModeRef = useRef(renderMode); renderModeRef.current = renderMode
  const verticalExagRef = useRef(verticalExag); verticalExagRef.current = verticalExag

  // 시추공 데이터 로드
  useEffect(() => {
    if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) return
    const [minLng, minLat, maxLng, maxLat] = bbox
    setFetchStatus("loading")
    setStatus("시추공 데이터 로딩 중...")
    fetchBoreholesByBbox(bbox, polygon || undefined, boreholeIds)
      .then((bhs) => {
        let filtered = bhs
        
        // A. 특정 시추공 ID 목록이 지정된 경우 우선 필터링 (지도에서 이미 정밀하게 필터링됨)
        if (boreholeIds.length > 0) {
          filtered = filtered.filter((b) => boreholeIds.includes(Number(b.id)) || boreholeIds.includes(b.id as any))
        } else {
          // B. ID 목록이 없으면 다각형/BBox 기반 필터링 수행
          if (polygon && polygon.length > 0) {
            filtered = filtered.filter((b) => {
              const x = b.longitude, y = b.latitude
              let inside = false
              for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                const xi = polygon[i].lng, yi = polygon[i].lat
                const xj = polygon[j].lng, yj = polygon[j].lat
                const intersect = ((yi > y) !== (yj > y)) &&
                  (x < (xj - xi) * (y - yi) / ((yj - yi) || 1) + xi)
                if (intersect) inside = !inside
              }
              return inside
            })
          }
          filtered = filtered.filter((b) => {
            return b.longitude >= minLng && b.longitude <= maxLng &&
                   b.latitude >= minLat && b.latitude <= maxLat
          })
        }

        // C. 지층 데이터(strata)가 유효한(최소 1개 이상) 시추공만 남김
        filtered = filtered.filter((b) => b.strata && b.strata.length > 0)
        
        // D. Z-Fighting 완화 및 BBox 정규화
        filtered.forEach((b) => {
          b.elevation = b.elevation || 0
          if (b.strata) {
            b.strata.forEach((s, idx) => {
              s.depth_top = s.depth_top || 0
              s.depth_bottom = s.depth_bottom || 0
              if (idx > 0 && s.depth_top < b.strata[idx - 1].depth_bottom) {
                s.depth_top = b.strata[idx - 1].depth_bottom
              }
              if (s.depth_bottom <= s.depth_top) {
                s.depth_bottom = s.depth_top + 0.1
              }
            })
          }
        })

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

  // ── Three.js 씬 초기화 및 지질 렌더링 ──────────────────
  useEffect(() => {
    if (!bbox || !containerRef.current || fetchStatus !== "done") return
    const container = containerRef.current

    // 1) scene / renderer / camera 설정
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0e1a)
    sceneRef.current = scene

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    
    // 이전 렌더러 캔버스 중복 누수를 방지하기 위해 컨테이너 청소 후 마운트!
    container.innerHTML = ""
    container.appendChild(renderer.domElement)
    
    rendererRef.current = renderer

    const camera = new THREE.PerspectiveCamera(
      45, container.clientWidth / container.clientHeight, 0.001, 1000
    )
    camera.position.set(2.4, 2.0, 2.4)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controlsRef.current = controls

    // 조명
    scene.add(new THREE.AmbientLight(0xffffff, 0.65))
    const d1 = new THREE.DirectionalLight(0xffffff, 0.8)
    d1.position.set(3, 5, 2); scene.add(d1)
    const d2 = new THREE.DirectionalLight(0xa0c8ff, 0.35)
    d2.position.set(-2, 3, -2); scene.add(d2)

    // 바닥 격자선 추가
    const gridHelper = new THREE.GridHelper(6, 12, 0x3a4a6a, 0x1a2030)
    gridHelper.position.y = -1.6
    scene.add(gridHelper)

    // 선택 시추공 마커 (역삼각뿔)
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.02, 0.05, 4),
      new THREE.MeshStandardMaterial({
        color: 0xffd24a, emissive: 0x6b5410, roughness: 0.4,
      })
    )
    marker.rotation.x = Math.PI
    marker.visible = false
    scene.add(marker)
    markerRef.current = marker

    // 모든 3D 지층/지형/시추 객체를 한 몸으로 칼안착 팽창시킬 그룹 생성!
    const stratumGroup = new THREE.Group()
    scene.add(stratumGroup)
    stratumGroupRef.current = stratumGroup

    // 2) 3D 공간 미터 척도 변환식 계산
    const [minLng, minLat, maxLng, maxLat] = bbox
    const midLat = (minLat + maxLat) / 2
    const lngWidthM = (maxLng - minLng) * 111320 * Math.cos((midLat * Math.PI) / 180)
    const latWidthM = (maxLat - minLat) * 110540
    const ratio = lngWidthM / latWidthM
    const boxW = 2
    const boxD = boxW / ratio
    const mScale = boxW / lngWidthM
    dimsRef.current = { boxW, boxD, lngWidthM, latWidthM, mScale }

    // 지리좌표 ➡️ Three.js 로컬 X/Z
    const lngToX = (lng: number) => -boxW / 2 + (boxW * (lng - minLng)) / (maxLng - minLng)
    const latToZ = (lat: number) => boxD / 2 - (boxD * (lat - minLat)) / (maxLat - minLat)
    const confRadiusM = Math.max(150, Math.min(400, Math.min(lngWidthM, latWidthM) * 0.5))

    let raf = 0
    const animate = () => {
      raf = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      if (!cameraRef.current || !rendererRef.current || !containerRef.current) return
      const w = containerRef.current.clientWidth
      const h = containerRef.current.clientHeight
      cameraRef.current.aspect = w / h
      cameraRef.current.updateProjectionMatrix()
      rendererRef.current.setSize(w, h)
    }
    window.addEventListener("resize", onResize)

    // 3) 비동기 지표면 및 지질 모델 추출 가동
    ;(async () => {
      const N = 48
      try {
        // 기존 stratumGroup 내 모든 자식 메쉬 소거 및 메모리 해제(dispose)
        if (stratumGroupRef.current) {
          const group = stratumGroupRef.current
          while (group.children.length > 0) {
            const child = group.children[0]
            group.remove(child)
            if ((child as THREE.Mesh).isMesh) {
              (child as THREE.Mesh).geometry.dispose()
              ;((child as THREE.Mesh).material as any).dispose()
            }
          }
        }
        // A. AWS 지표면 로드
        setStatus("지표면(AWS Terrain) 로딩 중...")
        const terr = await buildElevationGrid(bbox, N)

        // B. 시추공 잔차 보정 표고 IDW 보간 지형 생성
        setStatus("시추공 표고 잔차 계산 보간 중...")
        let elevGrid = terr.elevGrid
        const pts = boreholes
          .map((b) => ({ x: b.longitude, y: b.latitude, z: b.elevation }))
          .filter((p) => Number.isFinite(p.z) && p.z < 2000 && p.z > -200)

        if (pts.length >= 1) {
          const residuals = pts.map((p) => ({
            x: p.x, y: p.y, z: p.z - terr.terrainElevAt(p.x, p.y),
          }))
          const resGrid = idwGrid(residuals, terr.gx, terr.gy, 2)
          elevGrid = terr.elevGrid.map((row, j) => row.map((v, i) => v + resGrid[j][i]))
        }

        // C. V-World 윗면 지도 드레이프 비동기 백그라운드 대기로 전환 (지층 형상 즉시 로드 보장)
        setStatus("지형 위성/일반 텍스처 드레이프 합성 중...")
        const LAYER_SETS: Record<string, string[]> = {
          Base: ["Base"], Satellite: ["Satellite"], Hybrid: ["Satellite", "Hybrid"],
        }
        const drapeCanvasPromise = buildAreaCanvas(bbox, LAYER_SETS[basemap])
          .then((drapeCanvas) => {
            const loadedTex = new THREE.CanvasTexture(drapeCanvas)
            loadedTex.colorSpace = THREE.SRGBColorSpace
            loadedTex.wrapS = THREE.ClampToEdgeWrapping
            loadedTex.wrapT = THREE.ClampToEdgeWrapping
            loadedTex.anisotropy = renderer.capabilities.getMaxAnisotropy()
            loadedTex.needsUpdate = true
            return loadedTex
          })
          .catch((err) => {
            console.error("V-World texture load failed:", err)
            return null
          })

        // D. 시추공 세그먼트 파이프라인 매핑 (soil/weathered_rock/soft_rock/hard_rock)
        setStatus("시추 프로파일 지하 복셀 3D 투표 중...")
        const yBotM = -depthBelowMSL
        const profiles: any[] = []

        for (const b of boreholes) {
          if (!Number.isFinite(b.longitude) || !Number.isFinite(b.latitude)) continue
          if (!Number.isFinite(b.elevation)) continue
          // API 응답 데이터 포맷 (strata_group, depth_top, depth_bottom) 파싱!
          const segs = (b.strata || [])
            .filter((s) => Number.isFinite(s.depth_top) && Number.isFinite(s.depth_bottom) && s.depth_bottom > s.depth_top)
            .map((s) => ({
              from: s.depth_top,
              to: s.depth_bottom,
              type: RANK[s.strata_group] !== undefined ? s.strata_group : "UNKNOWN",
            }))
            .sort((p, q) => p.from - q.from)

          if (!segs.length) continue
          let maxD = 0
          for (const s of segs) maxD = Math.max(maxD, s.to)
          profiles.push({ x: b.longitude, y: b.latitude, elev: b.elevation, maxDepth: maxD, segs })
        }

        // 특정 깊이에서의 지층 구하는 함수
        const layerAtDepth = (prof: any, depth: number) => {
          const d = depth < 0 ? 0 : depth
          for (const s of prof.segs) {
            if (d >= s.from && d < s.to) return s.type
          }
          const last = prof.segs[prof.segs.length - 1]
          if (d <= last.to + 1e-6) return last.type
          return null
        }

        // E. 3D 노드 격자 분할
        const NX = N
        let gTop = -Infinity
        for (const row of elevGrid) for (const v of row) if (v > gTop) gTop = v
        const vRange = Math.max(gTop - yBotM, 1)
        const MZ = Math.max(16, Math.min(96, Math.round(vRange / 1.2)))
        const dz = vRange / (MZ - 1) // 수직 해상도(m)
        const idx3 = (i: number, j: number, l: number) => (l * NX + j) * NX + i

        // 근접 시추공 투표 가중치 행렬 구성
        const nearByCol: any[] = new Array(NX * NX)
        for (let j = 0; j < NX; j++) {
          for (let i = 0; i < NX; i++) {
            const lng = minLng + (maxLng - minLng) * (i / (NX - 1))
            const lat = minLat + (maxLat - minLat) * (j / (NX - 1))
            let near: { p: any; w: number }[] = []
            for (const p of profiles) {
              const dxm = (lng - p.x) * 111320 * Math.cos((midLat * Math.PI) / 180)
              const dym = (lat - p.y) * 110540
              const d2 = dxm * dxm + dym * dym
              if (d2 <= confRadiusM * confRadiusM) {
                near.push({ p, w: 1 / Math.max(d2, 1) })
              }
            }
            if (near.length > 24) {
              near.sort((a, b) => b.w - a.w)
              near = near.slice(0, 24)
            }
            nearByCol[j * NX + i] = near
          }
        }

        // 3D 격자 노드 라벨링 (실측 깊이 수직 캡핑 + 마이너 지층 잠식 방지 역제곱 보간)
        const label = new Int8Array(NX * NX * MZ)
        
        for (let j = 0; j < NX; j++) {
          for (let i = 0; i < NX; i++) {
            for (let l = 0; l < MZ; l++) {
              const E = yBotM + dz * l
              if (E > elevGrid[j][i]) continue // 지표 위 공기
              
              const near = nearByCol[j * NX + i]
              if (!near.length) { 
                label[idx3(i, j, l)] = 5 // 미분류
                continue 
              }
              
              const votes: Record<string, number> = {}
              
              for (const { p, w } of near) {
                const depth = p.elev - E
                const lastSeg = p.segs[p.segs.length - 1]
                if (depth > lastSeg.to + dz * 0.5) continue
                
                const t = layerAtDepth(p, depth)
                if (!t) continue
                
                // 마이너 지층(연암 등) 잠식 방지:
                // 1) 격자 해상도(dz * 0.8)를 감안한 넉넉한 수직 마진을 적용하여 1.0m 두께의 연암이 노드에서 미스나지 않고 확실하게 장악되도록 보장
                // 2) 연암이 실제로 존재하는 시추공에 아주 압도적인 보존 가중치(50.0배, 연암 등 극소수층은 500.0배)를 인가하여 다수결에서 짓눌려 소멸(Smooth 3D 수축)하는 것을 원천 차단
                const isActualStrata = p.segs.some((s) => s.type === t && depth >= s.from - dz * 0.8 && depth <= s.to + dz * 0.8)
                const isMinorStrata = (t === "soft_rock")
                const preservationWeight = isActualStrata ? (isMinorStrata ? w * 500.0 : w * 50.0) : w
                
                votes[t] = (votes[t] || 0) + preservationWeight
              }
              
              let best = "UNKNOWN", bestW = 0
              for (const k in votes) {
                if (votes[k] > bestW) {
                  bestW = votes[k]
                  best = k
                }
              }
              
              if (best === "UNKNOWN") {
                label[idx3(i, j, l)] = 5 // 미분류
              } else {
                label[idx3(i, j, l)] = LAYER_STACK.indexOf(best) + 1
              }
            }
          }
        }

        // [DEBUG] 원본 격자 라벨별 개수 및 연암(code=3) 격자 분포 모니터링
        const debugCounts: Record<number, number> = {};
        for (let n = 0; n < label.length; n++) {
          debugCounts[label[n]] = (debugCounts[label[n]] || 0) + 1;
        }
        console.log("=== [DEBUG] 3D GRID LABEL COUNTS ===", debugCounts);

        const nodeWorld = (i: number, j: number, l: number): [number, number, number] => [
          -boxW / 2 + (boxW * i) / (NX - 1),
          (yBotM + dz * l) * mScale * verticalExag,
          boxD / 2 - (boxD * j) / (NX - 1),
        ]

        // F. 지층 Mesh 빌드 (Smooth 마칭큐브 & Voxel 픽셀)
        setStatus("지층면 입체 솔리드 추출 중...")
        const occ: Float32Array[] = []
        for (let c = 0; c <= 5; c++) {
          const f = new Float32Array(label.length)
          for (let n = 0; n < label.length; n++) if (label[n] === c) f[n] = 1
          occ[c] = smooth3D(f, NX, NX, MZ, 2)
        }

        // F-a. Smooth 뷰 (마칭큐브 지층 추출)
        const smoothMeshes: Record<string, THREE.Mesh> = {}
        for (let s = 0; s < 5; s++) {
          const type = LAYER_STACK[s]
          const code = s + 1
          const fL = occ[code]
          const field = new Float32Array(label.length)
          let any = false
          for (let n = 0; n < field.length; n++) {
            let m = 0
            for (let c = 0; c <= 5; c++) {
              if (c !== code && occ[c][n] > m) m = occ[c][n]
            }
            // 원본 격자 라벨이 현재 지층(code)인 핵심 노드는 주변 지층(m)에 의한 소멸 잠식을 차단하여 3D 면 보존
            const isOriginal = (label[n] === code)
            field[n] = isOriginal ? Math.max(fL[n] - m * 0.15, 0.08) : fL[n] - m
            if (field[n] > 0) any = true
          }
          if (!any) continue
          const { positions, normals } = marchingCubes(field, NX, NX, MZ, 0, nodeWorld)
          if (!positions.length) continue

          const geo = new THREE.BufferGeometry()
          geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
          geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3))
          const mat = new THREE.MeshStandardMaterial({
            color: LAYER_COLOR[type], roughness: 0.92, side: THREE.DoubleSide,
          })
          const mesh = new THREE.Mesh(geo, mat)
          mesh.userData.layerType = type
          if (stratumGroupRef.current) stratumGroupRef.current.add(mesh)
          smoothMeshes[type] = mesh
        }
        smoothMeshRef.current = smoothMeshes

        // F-b. Voxel 뷰 (직육면체 복셀 셀)
        const cellW = boxW / (NX - 1), cellD = boxD / (NX - 1)
        const voxelCells: Record<string, any[]> = {
          soil: [], weathered_rock: [], soft_rock: [], hard_rock: [], UNKNOWN: [],
        }
        for (let j = 0; j < NX; j++) {
          for (let i = 0; i < NX; i++) {
            const cx = -boxW / 2 + (boxW * i) / (NX - 1)
            const cz = boxD / 2 - (boxD * j) / (NX - 1)
            let l = 0
            while (l < MZ) {
              const code = label[idx3(i, j, l)]
              if (code === 0) { l++; continue; }
              let l2 = l
              while (l2 < MZ && label[idx3(i, j, l2)] === code) l2++
              voxelCells[LAYER_STACK[code - 1]].push({
                x0: cx - cellW / 2, x1: cx + cellW / 2,
                z0: cz - cellD / 2, z1: cz + cellD / 2,
                yBot: (yBotM + dz * (l - 0.5)) * mScale * verticalExag,
                yTop: (yBotM + dz * (l2 - 0.5)) * mScale * verticalExag,
              })
              l = l2
            }
          }
        }
        const voxelMeshes: Record<string, THREE.Mesh> = {}
        for (const type of LAYER_STACK) {
          const cells = voxelCells[type]
          if (!cells.length) continue
          const mat = new THREE.MeshStandardMaterial({
            color: LAYER_COLOR[type], roughness: 0.92, side: THREE.DoubleSide,
          })
          const mesh = new THREE.Mesh(buildBoxesMesh(cells), mat)
          mesh.userData.layerType = type
          if (stratumGroupRef.current) stratumGroupRef.current.add(mesh)
          voxelMeshes[type] = mesh
        }
        voxelMeshRef.current = voxelMeshes

        // 초기 가시성 설정
        const applyVis = (meshes: Record<string, THREE.Mesh>, active: boolean) => {
          for (const [type, mesh] of Object.entries(meshes)) {
            mesh.visible = active && (visibilityRef.current[type] ?? true)
          }
        }
        applyVis(smoothMeshes, renderModeRef.current === "smooth")
        applyVis(voxelMeshes, renderModeRef.current === "voxel")

        // G. 윗면 지도 드레이프 드로잉 (지도 로딩 중에는 은은한 잔디 녹록색 단색으로 먼저 0.1초 만에 로드)
        const drapeGeo = buildSurfaceMesh(elevGrid, boxW, boxD, mScale, verticalExag)
        const drapeMat = new THREE.MeshStandardMaterial({
          color: 0x4e6e58, roughness: 0.85, side: THREE.DoubleSide,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        })
        const drape = new THREE.Mesh(drapeGeo, drapeMat)
        drape.visible = showDrapeRef.current
        if (stratumGroupRef.current) stratumGroupRef.current.add(drape)
        drapeRef.current = drape

        // 백그라운드 위성 지도가 받아와지면 자연스럽게 실시간 텍스처 매핑 스왑!
        drapeCanvasPromise.then((loadedTex) => {
          if (loadedTex && drapeMat) {
            drapeMat.color.setHex(0xffffff) // 단색 제거하고 실지도로 변경
            drapeMat.map = loadedTex
            drapeMat.needsUpdate = true
            if (rendererRef.current && sceneRef.current && cameraRef.current) {
              rendererRef.current.render(sceneRef.current, cameraRef.current)
            }
          }
        })

        // H. 시추공 3D 컬럼 오버랩 (정교한 표고 정합 달성!)
        const colRadius = Math.max(boxW, boxD) * 0.003
        const bhGroup = new THREE.Group()
        const posMap: Record<number, { x: number; y: number; z: number }> = {}
        for (const b of boreholes) {
          if (!Number.isFinite(b.longitude) || !Number.isFinite(b.latitude)) continue
          const bx = lngToX(b.longitude)
          const bz = latToZ(b.latitude)
          posMap[b.id] = { x: bx, y: (b.elevation || 0) * mScale * verticalExag, z: bz }

          for (const seg of b.strata || []) {
            if (!Number.isFinite(seg.depth_top) || !Number.isFinite(seg.depth_bottom)) continue
            const yTop = (b.elevation - seg.depth_top) * mScale * verticalExag
            const yBot = (b.elevation - seg.depth_bottom) * mScale * verticalExag
            const h = Math.max(yTop - yBot, 1e-5)
            const geo = new THREE.CylinderGeometry(colRadius, colRadius, h, 10)
            const mat = new THREE.MeshStandardMaterial({
              color: LAYER_COLOR[seg.strata_group] ?? LAYER_COLOR.UNKNOWN,
              roughness: 0.7,
            })
            const cyl = new THREE.Mesh(geo, mat)
            cyl.position.set(bx, (yTop + yBot) / 2, bz)
            cyl.userData.layerType = seg.strata_group
            bhGroup.add(cyl)
          }
        }
        bhGroup.visible = showColumnsRef.current
        if (stratumGroupRef.current) stratumGroupRef.current.add(bhGroup)
        bhGroupRef.current = bhGroup
        bhPosRef.current = posMap

        // 메쉬 빌드 직후 최신 수직과장 배율 그룹 단위 선제 적용!
        if (stratumGroupRef.current) {
          stratumGroupRef.current.scale.set(1, verticalExagRef.current, 1)
        }

        fitCamera()
        setStatus(
          `완료 · 시추공 ${boreholes.length}개 · ` +
          `격자 ${NX}×${NX}×${MZ} (dz ${dz.toFixed(1)}m) · ` +
          `신뢰반경 ${confRadiusM.toFixed(0)}m · 영역 ${lngWidthM.toFixed(0)}m × ${latWidthM.toFixed(0)}m`
        )
      } catch (e: any) {
        setStatus(`로드 실패: ${e?.message || e}`)
      }
    })()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", onResize)
      renderer.dispose()
      try { container.removeChild(renderer.domElement) } catch {}
      sceneRef.current = null
      smoothMeshRef.current = {}
      voxelMeshRef.current = {}
      drapeRef.current = null
      bhGroupRef.current = null
      markerRef.current = null
    }
  }, [bbox, basemap, fetchStatus, depthBelowMSL]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 지층 표시 on/off + 렌더 방식 전환 (visible 토글) ──
  useEffect(() => {
    const apply = (meshes: Record<string, THREE.Mesh>, active: boolean) => {
      for (const [type, mesh] of Object.entries(meshes)) {
        if (mesh) mesh.visible = active && (visibility[type] ?? true)
      }
    }
    apply(smoothMeshRef.current, renderMode === "smooth")
    apply(voxelMeshRef.current, renderMode === "voxel")

    // 시추공 기둥의 개별 지층 세그먼트 가시성 연동 제거 (항상 visible 보장)
    if (bhGroupRef.current) {
      bhGroupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh && child.userData.layerType) {
          child.visible = true
        }
      })
    }

    // 윗면 지도는 토사와 완전히 독립
  }, [visibility, renderMode])

  // ── 윗면 지도 가시성 독립 연동 ──
  useEffect(() => {
    if (drapeRef.current) drapeRef.current.visible = showDrape
  }, [showDrape])

  // ── 시추공 컬럼 가시성 연동 ──
  useEffect(() => {
    if (bhGroupRef.current) bhGroupRef.current.visible = showColumns
  }, [showColumns])

  // ── 수직과장 변경 시 stratumGroup 단일 스케일링 60fps 가동! ──
  useEffect(() => {
    if (stratumGroupRef.current) {
      stratumGroupRef.current.scale.set(1, verticalExag, 1)
    }
  }, [verticalExag])

  // ── 복셀 박스 geometries 병합 생성 ──
  function buildBoxesMesh(
    cells: { x0: number; x1: number; z0: number; z1: number; yTop: number; yBot: number }[]
  ) {
    const positions: number[] = []
    const indices: number[] = []
    let vb = 0
    const quad = (
      ax: number, ay: number, az: number, bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number, dx: number, dy: number, dw: number
    ) => {
      positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dw)
      indices.push(vb, vb + 1, vb + 2, vb, vb + 2, vb + 3)
      vb += 4
    }
    for (const c of cells) {
      const yt = c.yTop, yb = c.yBot
      if (yt - yb < 1e-7) continue
      const { x0, x1, z0, z1 } = c
      quad(x0, yt, z0, x1, yt, z0, x1, yt, z1, x0, yt, z1) // 윗면
      quad(x0, yb, z1, x1, yb, z1, x1, yb, z0, x0, yb, z0) // 아랫면
      quad(x0, yb, z0, x1, yb, z0, x1, yt, z0, x0, yt, z0) // z- 측면
      quad(x1, yb, z1, x0, yb, z1, x0, yt, z1, x1, yt, z1) // z+ 측면
      quad(x0, yb, z1, x0, yb, z0, x0, yt, z0, x0, yt, z1) // x- 측면
      quad(x1, yb, z0, x1, yb, z1, x1, yt, z1, x1, yt, z0) // x+ 측면
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    return geo
  }

  // ── 3D 박스블러 평활화 (가장자리 복제하여 형상 수축 최소화) ──
  function smooth3D(src: Float32Array, nx: number, ny: number, nz: number, passes: number) {
    let a = src, b = new Float32Array(src.length)
    const at = (arr: Float32Array, i: number, j: number, k: number) => {
      const ii = i < 0 ? 0 : i >= nx ? nx - 1 : i
      const jj = j < 0 ? 0 : j >= ny ? ny - 1 : j
      const kk = k < 0 ? 0 : k >= nz ? nz - 1 : k
      return arr[(kk * ny + jj) * nx + ii]
    }
    for (let p = 0; p < passes; p++) {
      for (let k = 0; k < nz; k++)
        for (let j = 0; j < ny; j++)
          for (let i = 0; i < nx; i++)
            b[(k * ny + j) * nx + i] = (at(a, i - 1, j, k) + at(a, i, j, k) + at(a, i + 1, j, k)) / 3
      {
        const temp = a;
        a = b;
        b = temp;
      }
      for (let k = 0; k < nz; k++)
        for (let j = 0; j < ny; j++)
          for (let i = 0; i < nx; i++)
            b[(k * ny + j) * nx + i] = (at(a, i, j - 1, k) + at(a, i, j, k) + at(a, i, j + 1, k)) / 3
      {
        const temp = a;
        a = b;
        b = temp;
      }
      for (let k = 0; k < nz; k++)
        for (let j = 0; j < ny; j++)
          for (let i = 0; i < nx; i++)
            b[(k * ny + j) * nx + i] = (at(a, i, j, k - 1) + at(a, i, j, k) + at(a, i, j, k + 1)) / 3
      {
        const temp = a;
        a = b;
        b = temp;
      }
    }
    return a
  }

  // ── 마칭큐브 등치면 연산 ──
  function marchingCubes(
    field: Float32Array, nx: number, ny: number, nz: number, iso: number,
    nodeWorld: (i: number, j: number, l: number) => [number, number, number]
  ) {
    const positions: number[] = []
    const normals: number[] = []
    const OUTSIDE = -1e3
    const at = (i: number, j: number, k: number) =>
      i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? OUTSIDE : field[(k * ny + j) * nx + i]

    const CO = [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ]
    const EV = [
      [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6],
      [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
    ]
    for (let k = -1; k < nz; k++)
      for (let j = -1; j < ny; j++)
        for (let i = -1; i < nx; i++) {
          const cv: number[] = []
          let ci = 0
          for (let c = 0; c < 8; c++) {
            const v = at(i + CO[c][0], j + CO[c][1], k + CO[c][2])
            cv.push(v)
            if (v < iso) ci |= 1 << c
          }
          const tris = TRI_TABLE[ci]
          if (!tris.length) continue
          const cache: Record<number, { p: number[]; n: number[] }> = {}
          const edgeVert = (e: number) => {
            if (cache[e]) return cache[e]
            const a0 = EV[e][0], b0 = EV[e][1]
            const va = cv[a0], vb = cv[b0]
            let t = (iso - va) / ((vb - va) || 1e-9)
            if (t < 0) t = 0; else if (t > 1) t = 1
            const ca = CO[a0], cb = CO[b0]
            const ai = i + ca[0], aj = j + ca[1], ak = k + ca[2]
            const bi = i + cb[0], bj = j + cb[1], bk = k + cb[2]
            const pa = nodeWorld(ai, aj, ak), pb = nodeWorld(bi, bj, bk)
            const p = [
              pa[0] + (pb[0] - pa[0]) * t,
              pa[1] + (pb[1] - pa[1]) * t,
              pa[2] + (pb[2] - pa[2]) * t,
            ]
            const gax = at(ai - 1, aj, ak) - at(ai + 1, aj, ak)
            const gay = at(ai, aj - 1, ak) - at(ai, aj + 1, ak)
            const gaz = at(ai, aj, ak - 1) - at(ai, aj, ak + 1)
            const gbx = at(bi - 1, bj, bk) - at(bi + 1, bj, bk)
            const gby = at(bi, bj - 1, bk) - at(bi, bj + 1, bk)
            const gbz = at(bi, bj, bk - 1) - at(bi, bj, bk + 1)
            const nxv = gax + (gbx - gax) * t
            const nyv = gay + (gby - gay) * t
            const nzv = gaz + (gbz - gaz) * t
            const len = Math.hypot(nxv, nyv, nzv) || 1
            cache[e] = { p, n: [nxv / len, nyv / len, nzv / len] }
            return cache[e]
          }
          for (let t = 0; t < tris.length; t += 3) {
            const v0 = edgeVert(tris[t])
            const v1 = edgeVert(tris[t + 1])
            const v2 = edgeVert(tris[t + 2])
            positions.push(
              v0.p[0], v0.p[1], v0.p[2],
              v1.p[0], v1.p[1], v1.p[2],
              v2.p[0], v2.p[1], v2.p[2]
            )
            normals.push(
              v0.n[0], v0.n[1], v0.n[2],
              v1.n[0], v1.n[1], v1.n[2],
              v2.n[0], v2.n[1], v2.n[2]
            )
          }
        }
    return { positions, normals }
  }

  // ── 단일 지표면 지형 geometry 생성 ──
  function buildSurfaceMesh(grid: number[][], boxW: number, boxD: number, mScale: number, verticalExag: number) {
    const Ny = grid.length, Nx = grid[0].length
    const xAt = (i: number) => -boxW / 2 + (boxW * i) / (Nx - 1)
    const zAt = (j: number) => boxD / 2 - (boxD * j) / (Ny - 1)
    const positions: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    for (let j = 0; j < Ny; j++)
      for (let i = 0; i < Nx; i++) {
        positions.push(xAt(i), grid[j][i] * mScale * verticalExag, zAt(j))
        uvs.push(i / (Nx - 1), j / (Ny - 1))
      }
    for (let j = 0; j < Ny - 1; j++)
      for (let i = 0; i < Nx - 1; i++) {
        const a = j * Nx + i, b = j * Nx + i + 1
        const c = (j + 1) * Nx + i, d = (j + 1) * Nx + i + 1
        indices.push(a, b, d, a, d, c)
      }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    return geo
  }

  // ── 카메라 핏팅 ──
  function fitCamera() {
    const cam = cameraRef.current, ctr = controlsRef.current
    if (!cam || !ctr) return
    const { boxW, boxD } = dimsRef.current
    ctr.target.set(0, -0.1, 0)
    cam.position.set(boxW * 1.0, boxW * 0.9, boxD * 1.1)
    ctr.update()
  }

  // 시추공 포커싱 및 부드러운 카메라 이동
  function focusBorehole(id: number) {
    const p = bhPosRef.current[id]
    const cam = cameraRef.current
    const ctr = controlsRef.current
    if (!p || !cam || !ctr) return
    setSelectedBh(id)

    const dist = Math.max(dimsRef.current.boxW, dimsRef.current.boxD) * 0.55
    const startT = ctr.target.clone()
    const startP = cam.position.clone()
    const endT = new THREE.Vector3(p.x, p.y, p.z)
    const endP = new THREE.Vector3(p.x + dist, p.y + dist * 0.8, p.z + dist)
    let t = 0
    const step = () => {
      t += 0.055
      const e = t < 1 ? 1 - Math.pow(1 - t, 3) : 1 // easeOutCubic
      ctr.target.lerpVectors(startT, endT, e)
      cam.position.lerpVectors(startP, endP, e)
      ctr.update()
      if (t < 1) requestAnimationFrame(step)
    }
    step()
  }

  // 시추공 목록 최대심도 구하기
  const maxDepth = useCallback((b: Borehole) => {
    if (!b.strata?.length) return 0
    return Math.max(...b.strata.map((s) => s.depth_bottom ?? 0))
  }, [])

  // 선택 시추공 갱신 시 역삼각뿔 마커 위치 정합 가동
  useEffect(() => {
    const marker = markerRef.current
    if (!marker) return
    if (selectedBh === null) {
      marker.visible = false
      return
    }
    const b = boreholes.find((h) => h.id === selectedBh)
    if (!b) {
      marker.visible = false
      return
    }
    const { boxW, boxD, mScale } = dimsRef.current
    const bx = -boxW / 2 + (boxW * (b.longitude - bbox![0])) / (bbox![2] - bbox![0])
    const bz = -boxD / 2 + (boxD * (b.latitude - bbox![1])) / (bbox![3] - bbox![1])
    const by = (b.elevation || 0) * mScale * verticalExag
    marker.position.set(bx, by + 0.05, bz)
    marker.visible = true
  }, [selectedBh, boreholes, verticalExag]) // eslint-disable-line react-hooks/exhaustive-deps

  // 오류 뷰어
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

      {/* ── 3D Three.js 씬 영역 ───────────────────────────────────────── */}
      <div style={{ position: "relative", flex: 1 }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

        {/* ── 좌측 패널 (업무 흐름) ──────────────────────────────── */}
        <div style={panel}>
          <div style={{ fontSize: 12, color: C.tertiary }}>KH Geo · 2단계</div>
          <h1 style={{ margin: "2px 0 4px 0", fontSize: 16, fontWeight: 700 }}>
            3D 지질 뷰어
          </h1>
          <div style={{ fontSize: 11, color: C.tertiary, marginBottom: 10 }}>
            초정밀 Three.js 지하 기하학 렌더러
          </div>

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

          {/* 윗면 지도 표시 제어 스위치 신설 */}
          <div
            onClick={() => setShowDrape((s) => !s)}
            style={{
              marginTop: 6, display: "flex", alignItems: "center", fontSize: 12,
              cursor: "pointer", userSelect: "none",
              opacity: showDrape ? 1 : 0.5, marginBottom: 6,
            }}
          >
            <span style={{
              width: 13, height: 13, borderRadius: 3, marginRight: 8,
              background: showDrape ? C.btnActive : C.btnIdle,
              border: "1px solid rgba(255,255,255,.2)", display: "inline-block", flexShrink: 0,
            }} />
            윗면 지도 표시 오버랩
            <span style={{ marginLeft: "auto", fontSize: 10, color: C.tertiary }}>
              {showDrape ? "켜짐" : "꺼짐"}
            </span>
          </div>
          <select
            value={basemap}
            onChange={(e) => setBasemap(e.target.value as Basemap)}
            style={selectStyle}
            disabled={!showDrape}
          >
            <option value="Base">일반지도 (VWorld)</option>
            <option value="Satellite">항공사진 (위성)</option>
            <option value="Hybrid">위성 + 라벨</option>
          </select>

          {/* 렌더 방식 */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>렌더 방식</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setRenderMode("smooth")}
                style={{
                  ...(renderMode === "smooth" ? segActive : segIdle),
                  lineHeight: "1.3", paddingTop: "5px", paddingBottom: "5px",
                }}
              >
                매끄러움
                <span style={{ display: "block", fontSize: "10px", opacity: 0.8 }}>(마칭큐브)</span>
              </button>
              <button
                onClick={() => setRenderMode("voxel")}
                style={{
                  ...(renderMode === "voxel" ? segActive : segIdle),
                  lineHeight: "1.3", paddingTop: "5px", paddingBottom: "5px",
                }}
              >
                픽셀
                <span style={{ display: "block", fontSize: "10px", opacity: 0.8 }}>(RLE 복셀)</span>
              </button>
            </div>
          </div>

          {/* 수직 과장 */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              수직 과장 배율:  {verticalExag}배 (1배 ~ 20배)
            </div>
            <input
              type="range" min={1} max={20} step={1} value={verticalExag}
              onChange={(e) => setVerticalExag(Number(e.target.value))}
              style={{ width: "100%", accentColor: C.btnActive }}
            />
          </div>

          {/* 추가 굴착 깊이 */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 12 }}>솔리드 바닥 깊이 (m):</span>
              <input
                type="number" min={10} max={100} step={1} value={depthBelowMSL}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) {
                    setDepthBelowMSL(Math.max(10, Math.min(100, v)))
                  }
                }}
                style={{
                  width: 50, background: "#131929", border: `1px solid ${C.border}`,
                  borderRadius: 4, color: C.primary, fontSize: 11, textAlign: "center",
                  padding: "1px 3px", outline: "none",
                }}
              />
            </div>
            <input
              type="range" min={10} max={100} step={2} value={depthBelowMSL}
              onChange={(e) => setDepthBelowMSL(Number(e.target.value))}
              style={{ width: "100%", accentColor: C.btnActive }}
            />
          </div>

          {/* 지층 필터링 */}
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 12, color: C.tertiary, marginBottom: 6 }}>
              지층 표시 제어
            </div>
            {["soil", "weathered_rock", "soft_rock", "hard_rock", "UNKNOWN"].map((key) => {
              const on = visibility[key]
              return (
                <div
                  key={key}
                  onClick={() => setVisibility((v) => ({ ...v, [key]: !v[key] }))}
                  style={{
                    display: "flex", alignItems: "center", fontSize: 12,
                    margin: "3px 0", padding: "2px 4px", borderRadius: 4,
                    cursor: "pointer", opacity: on ? 1 : 0.38, userSelect: "none",
                  }}
                >
                  <span style={{
                    width: 13, height: 13, borderRadius: 3, marginRight: 8,
                    background: `#${LAYER_COLOR[key].toString(16).padStart(6, "0")}`,
                    border: "1px solid rgba(255,255,255,.2)", flexShrink: 0,
                  }} />
                  {LAYER_LABEL[key]}
                  <span style={{ marginLeft: "auto", fontSize: 10, color: C.tertiary }}>
                    {on ? "켜짐" : "꺼짐"}
                  </span>
                </div>
              )
            })}
            <div style={{ fontSize: 10, color: "#6a7a98", marginTop: 6, paddingLeft: 4 }}>
              ※ 윗면 지도는 오버랩 표시 스위치로 독립 제어됩니다.
            </div>
          </div>

          {/* 시추공 컬럼 */}
          <div
            onClick={() => setShowColumns((s) => !s)}
            style={{
              marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`,
              display: "flex", alignItems: "center", fontSize: 12,
              cursor: "pointer", userSelect: "none",
              opacity: showColumns ? 1 : 0.5,
            }}
          >
            <span style={{
              width: 13, height: 13, borderRadius: 3, marginRight: 8,
              background: showColumns ? C.btnActive : C.btnIdle,
              border: `1px solid ${C.btnIdleBd}`, flexShrink: 0,
            }} />
            시추공 기둥 오버랩
          </div>
        </div>

        {/* ── 우상단 카메라 가이드 ─────────────────────────────────────── */}
        <div style={hint}>
          <div>마우스 좌클릭 + 드래그 = 3D 회전</div>
          <div>Shift + 마우스 드래그 = 시점 이동</div>
          <div>마우스 휠 = 카메라 줌 인/아웃</div>
        </div>

        {/* ── 상태 오버레이 ──────────────────────────────── */}
        {fetchStatus === "loading" && (
          <div style={{
            position: "absolute", bottom: 50, left: "50%", transform: "translateX(-50%)",
            zIndex: 20, background: "rgba(0,0,0,0.8)", color: C.text,
            fontSize: 12, padding: "6px 16px", borderRadius: 20,
            fontFamily: "'Noto Sans KR',sans-serif",
          }}>
            3D 기하학 격자 공간 빌드 중…
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

        <div style={statusBar}>{status}</div>
      </div>

      {/* ── 우측 시추공 데이터 ───────────────────────────────── */}
      <div style={tablePanel}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>시추공 데이터</div>
          <div style={{ fontSize: 11, color: C.tertiary }}>
            {boreholes.length}개 발견 · 행 클릭 시 시추공 카메라 포커스
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ position: "sticky", top: 0, background: C.inner }}>
                <th style={th}>공명</th>
                <th style={{ ...th, textAlign: "right" }}>표고(m)</th>
                <th style={{ ...th, textAlign: "right" }}>심도(m)</th>
                <th style={th}>지층</th>
              </tr>
            </thead>
            <tbody>
              {boreholes.map((b) => {
                const depth = maxDepth(b)
                const sel = selectedBh === b.id
                return (
                  <tr
                    key={b.id}
                    onClick={() => {
                      if (sel) {
                        setSelectedBh(null)
                      } else {
                        focusBorehole(b.id)
                      }
                    }}
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
                      {(() => {
                        const uniqueGroups: string[] = []
                        for (const s of b.strata || []) {
                          const grp = s.strata_group ?? ""
                          if (grp && !uniqueGroups.includes(grp)) {
                            uniqueGroups.push(grp)
                          }
                        }
                        return uniqueGroups.map((grp, i) => {
                          const rgbNum = LAYER_COLOR[grp] ?? LAYER_COLOR.UNKNOWN
                          const col = `#${rgbNum.toString(16).padStart(6, "0")}`
                          const lbl = LAYER_LABEL[grp] ?? grp
                          return (
                            <span
                              key={i}
                              title={lbl}
                              style={{
                                display: "inline-block", width: 9, height: 9,
                                marginRight: 1, borderRadius: 1,
                                background: col,
                              }}
                            />
                          )
                        })
                      })()}
                    </td>
                  </tr>
                )
              })}
              {boreholes.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ ...td, color: "#6a7a98", textAlign: "center", padding: 20 }}>
                    선택 영역 내 시추공이 탐지되지 않았습니다.
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
