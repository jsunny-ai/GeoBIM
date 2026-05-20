import { useEffect, useRef, useState } from "react"
import * as Cesium from "cesium"
import "cesium/Build/Cesium/Widgets/widgets.css"
import type { Borehole } from "@/lib/types"

// 지층 구분별 색상 매핑 — 지질 톤, moderate_rock 제거 (보통암 → 경암 통합)
const SOIL_COLORS: Record<string, Cesium.Color> = {
  soil:           Cesium.Color.fromCssColorString("#8B7355"), // 토사
  weathered_rock: Cesium.Color.fromCssColorString("#C4A57B"), // 풍화암
  soft_rock:      Cesium.Color.fromCssColorString("#6B8E5A"), // 연암
  hard_rock:      Cesium.Color.fromCssColorString("#3D3D3D"), // 경암 (보통암 통합)
}

const DEFAULT_COLOR = Cesium.Color.GRAY

// V-World API Key
const VWORLD_KEY = import.meta.env.VITE_VWORLD_KEY || "A5DB0E26-36FA-35BE-8E1A-283E1232A2CA"

export function useCesiumMap(
  containerRef: React.RefObject<HTMLDivElement | null>,
  boreholes: Borehole[],
  onBoreholeClick?: (borehole: Borehole) => void,
) {
  const viewerRef = useRef<Cesium.Viewer | null>(null)
  const handlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null)
  
  // 영역 그리기 관련 상태
  const [isDrawing, setIsDrawing] = useState(false)
  const [polygon, setPolygon] = useState<Cesium.Cartographic[] | null>(null)
  const [selectedBoreholes, setSelectedBoreholes] = useState<Borehole[]>([])

  const activePointsRef = useRef<Cesium.Entity[]>([])
  const activePolygonRef = useRef<Cesium.Entity | null>(null)
  const drawingPointsRef = useRef<Cesium.Cartesian3[]>([])
  const boreholesEntitiesRef = useRef<Cesium.Entity[]>([])

  // 1. Cesium Viewer 초기화 및 V-World 타일 적용
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return

    // 전 세계를 덮는 기본 베이스 맵(OSM) 주입 (배경 공백 및 에러 방지)
    const osmProvider = new Cesium.UrlTemplateImageryProvider({
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      subdomains: ["a", "b", "c"],
      credit: "© OpenStreetMap contributors",
      maximumLevel: 19,
    })

    // V-World 위성영상 레이어 설정 (CORS 및 도메인 비인증 차단 해결을 위해 로컬 백엔드 타일 프록시 사용)
    const vworldSatellite = new Cesium.UrlTemplateImageryProvider({
      url: "/api/v1/tiles/vworld/Satellite/{z}/{x}/{y}",
      credit: "V-World Satellite Map",
      minimumLevel: 6, // V-World는 레벨 6부터 지원 — 0~5 요청 원천 차단
      maximumLevel: 19,
      // 불필요한 영역의 404 에러를 방지하기 위해 한반도 영역으로만 타일 요청 제한!
      rectangle: Cesium.Rectangle.fromDegrees(124.0, 31.0, 132.0, 43.0),
    })

    const viewer = new Cesium.Viewer(containerRef.current, {
      baseLayer: new Cesium.ImageryLayer(osmProvider), // 기본 지도를 OSM으로
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      navigationHelpButton: false,
      timeline: false,
      animation: false,
      fullscreenButton: false,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
    })

    // 한반도 영역 위성지도를 최상단에 추가
    viewer.imageryLayers.addImageryProvider(vworldSatellite)

    viewerRef.current = viewer
    
    // 수원시 영통구 중심 좌표로 카메라 이동
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(127.0601, 37.2625, 4500),
      orientation: {
        heading: Cesium.Math.toRadians(0.0),
        pitch: Cesium.Math.toRadians(-60.0),
        roll: 0.0,
      },
    })

    // 클릭 이벤트용 ScreenSpaceEventHandler 등록
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
    handlerRef.current = handler

    // 시추공 클릭 감지 및 핸들링
    handler.setInputAction((click: any) => {
      const pickedObject = viewer.scene.pick(click.position)
      if (Cesium.defined(pickedObject) && pickedObject.id) {
        const entityId = pickedObject.id.id
        const bh = boreholes.find((b) => `bh-${b.id}` === entityId)
        if (bh && onBoreholeClick) {
          onBoreholeClick(bh)
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    return () => {
      if (handlerRef.current) {
        handlerRef.current.destroy()
        handlerRef.current = null
      }
      if (viewerRef.current) {
        viewerRef.current.destroy()
        viewerRef.current = null
      }
    }
  }, [containerRef, boreholes, onBoreholeClick])

  // 2. 시추공 3D 실린더 및 디스크 렌더링
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    // 기존 시추공 엔티티 제거
    boreholesEntitiesRef.current.forEach((entity) => viewer.entities.remove(entity))
    boreholesEntitiesRef.current = []

    boreholes.forEach((b) => {
      let currentDepth = 0
      const centerCartesian = Cesium.Cartesian3.fromDegrees(b.longitude, b.latitude, b.elevation || 0)

      // 지표면 디스크 (시추공 위치 마커)
      const diskEntity = viewer.entities.add({
        id: `bh-${b.id}`,
        position: centerCartesian,
        ellipse: {
          semiMinorAxis: 15.0,
          semiMajorAxis: 15.0,
          material: Cesium.Color.GOLD.withAlpha(0.85),
          outline: true,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2.0,
          height: b.elevation || 0,
        },
      })
      boreholesEntitiesRef.current.push(diskEntity)

      // 3D 지층 실린더 (적층형 기둥 구조)
      b.strata.forEach((stratum, idx) => {
        const thickness = stratum.depth_bottom - stratum.depth_top
        if (thickness <= 0) return

        const depthCenter = currentDepth + thickness / 2
        const cylinderHeight = b.elevation - depthCenter
        const color = SOIL_COLORS[stratum.soil_type] || DEFAULT_COLOR

        const stratumCylinder = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(b.longitude, b.latitude, cylinderHeight),
          cylinder: {
            length: thickness,
            topRadius: 4.5,
            bottomRadius: 4.5,
            material: color,
            outline: true,
            outlineColor: Cesium.Color.BLACK.withAlpha(0.5),
            outlineWidth: 1.0,
          },
        })
        boreholesEntitiesRef.current.push(stratumCylinder)
        currentDepth = stratum.depth_bottom
      })
    })

    viewer.scene.requestRender()
  }, [boreholes])

  // 3. 영역 그리기 (다각형 드로잉 도구)
  const startDrawing = () => {
    const viewer = viewerRef.current
    const handler = handlerRef.current
    if (!viewer || !handler) return

    setIsDrawing(true)
    setPolygon(null)
    setSelectedBoreholes([])
    drawingPointsRef.current = []
    
    // 기존 영역 엔티티 제거
    activePointsRef.current.forEach((p) => viewer.entities.remove(p))
    activePointsRef.current = []
    if (activePolygonRef.current) {
      viewer.entities.remove(activePolygonRef.current)
      activePolygonRef.current = null
    }

    // 좌클릭: 점 추가
    handler.setInputAction((click: any) => {
      const cartesian = viewer.scene.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid)
      if (cartesian) {
        drawingPointsRef.current.push(cartesian)

        // 클릭 위치에 시각적 포인트 추가
        const pointEntity = viewer.entities.add({
          position: cartesian,
          point: {
            pixelSize: 8,
            color: Cesium.Color.RED,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
        })
        activePointsRef.current.push(pointEntity)

        // 마우스 무브 실시간 폴리곤 피드백 생성
        if (drawingPointsRef.current.length === 2 && !activePolygonRef.current) {
          activePolygonRef.current = viewer.entities.add({
            polygon: {
              hierarchy: new Cesium.CallbackProperty(() => {
                return new Cesium.PolygonHierarchy(drawingPointsRef.current)
              }, false),
              material: Cesium.Color.RED.withAlpha(0.2),
              outline: true,
              outlineColor: Cesium.Color.RED,
              outlineWidth: 2,
            },
          })
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    // 마우스 무브: 드로잉 피드백
    handler.setInputAction((movement: any) => {
      if (drawingPointsRef.current.length > 0) {
        const cartesian = viewer.scene.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid)
        if (cartesian) {
          if (drawingPointsRef.current.length > 1) {
            // 마지막 예비 점 교체
            if (drawingPointsRef.current.length > activePointsRef.current.length) {
              drawingPointsRef.current.pop()
            }
            drawingPointsRef.current.push(cartesian)
          }
        }
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    // 더블클릭: 그리기 완료 및 공간 쿼리(시추공 추출)
    handler.setInputAction(() => {
      if (drawingPointsRef.current.length < 3) return

      // 더블클릭 임시 점 정리
      if (drawingPointsRef.current.length > activePointsRef.current.length) {
        drawingPointsRef.current.pop()
      }

      setIsDrawing(false)
      
      // 그리기 핸들러 원복 및 시추공 클릭 쿼리로 재등록
      handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
      handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)
      handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

      handler.setInputAction((click: any) => {
        const pickedObject = viewer.scene.pick(click.position)
        if (Cesium.defined(pickedObject) && pickedObject.id) {
          const entityId = pickedObject.id.id
          const bh = boreholes.find((b) => `bh-${b.id}` === entityId)
          if (bh && onBoreholeClick) {
            onBoreholeClick(bh)
          }
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

      // Cartographic으로 좌표계 변환
      const cartographics = drawingPointsRef.current.map((c) => Cesium.Cartographic.fromCartesian(c))
      setPolygon(cartographics)

      // PIP(Point-In-Polygon) 알고리즘으로 시추공 필터링
      const selected = boreholes.filter((bh) => {
        return isPointInPolygon(
          { x: bh.longitude, y: bh.latitude },
          cartographics.map((c) => ({
            x: Cesium.Math.toDegrees(c.longitude),
            y: Cesium.Math.toDegrees(c.latitude),
          })),
        )
      })

      setSelectedBoreholes(selected)
      viewer.scene.requestRender()
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

  }

  // 그리기 취소 및 초기화
  const cancelDrawing = () => {
    const viewer = viewerRef.current
    const handler = handlerRef.current
    if (!viewer) return

    setIsDrawing(false)
    setPolygon(null)
    setSelectedBoreholes([])
    drawingPointsRef.current = []

    activePointsRef.current.forEach((p) => viewer.entities.remove(p))
    activePointsRef.current = []
    if (activePolygonRef.current) {
      viewer.entities.remove(activePolygonRef.current)
      activePolygonRef.current = null
    }

    if (handler) {
      handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK)
      handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE)
      handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

      handler.setInputAction((click: any) => {
        const pickedObject = viewer.scene.pick(click.position)
        if (Cesium.defined(pickedObject) && pickedObject.id) {
          const entityId = pickedObject.id.id
          const bh = boreholes.find((b) => `bh-${b.id}` === entityId)
          if (bh && onBoreholeClick) {
            onBoreholeClick(bh)
          }
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
    }

    viewer.scene.requestRender()
  }

  return {
    isDrawing,
    polygon,
    selectedBoreholes,
    startDrawing,
    cancelDrawing,
  }
}

// Ray-Casting 기반 다각형 내 점 판별 함수
function isPointInPolygon(point: { x: number; y: number }, vs: { x: number; y: number }[]) {
  const x = point.x, y = point.y
  let inside = false
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].x, yi = vs[i].y
    const xj = vs[j].x, yj = vs[j].y
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1) + xi
    if (intersect) inside = !inside
  }
  return inside
}
