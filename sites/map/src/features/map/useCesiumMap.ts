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
  basemap: string = "Base",
  vexag: number = 15,
  radius: number = 10,
  alpha: number = 235,
  zMode: "gl" | "absolute" = "gl",
  layerVisible: boolean[] = [true, true, true, true],
  showColumns: boolean = true,
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
  const vworldLayerRef = useRef<Cesium.ImageryLayer | null>(null)
  const clusterDataSourceRef = useRef<Cesium.CustomDataSource | null>(null)

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
      sceneMode: Cesium.SceneMode.SCENE2D, // 2D 평면 맵 모드로 구동 설정
    })

    // 초기 한반도 영역 지도를 최상단에 추가
    vworldLayerRef.current = viewer.imageryLayers.addImageryProvider(vworldSatellite)

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

    // 시추공 및 클러스터 클릭 감지
    handler.setInputAction((click: any) => {
      const pickedObject = viewer.scene.pick(click.position)
      if (Cesium.defined(pickedObject) && pickedObject.id) {
        const entity = pickedObject.id
        
        // 1. 클러스터(숫자 원)를 클릭한 경우 지도를 해당 위치로 확대
        if (entity.label && entity.label.text) {
          const position = entity.position.getValue(viewer.clock.currentTime)
          if (position) {
            viewer.camera.flyTo({
              destination: position,
              duration: 1.0,
              offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-90), 1000), // 수직으로 1000m 위에서 바라보도록 확대
            })
          }
          return
        }

        // 2. 개별 시추공 포인트(Point)를 클릭한 경우
        const entityId = entity.id
        if (typeof entityId === "string" && entityId.startsWith("bh-")) {
          const bh = boreholes.find((b) => `bh-${b.id}` === entityId)
          if (bh && onBoreholeClick) {
            onBoreholeClick(bh)
          }
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

  // 1-1. 배경지도(basemap) 변경 시 V-World 레이어 교체
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    // OSM은 유지해야 하므로, basemap이 osm이면 vworld 레이어만 제거
    if (vworldLayerRef.current) {
      viewer.imageryLayers.remove(vworldLayerRef.current)
      vworldLayerRef.current = null
    }

    if (basemap !== "osm") {
      const newProvider = new Cesium.UrlTemplateImageryProvider({
        url: `/api/v1/tiles/vworld/${basemap}/{z}/{x}/{y}`,
        credit: `V-World ${basemap} Map`,
        minimumLevel: 6,
        maximumLevel: 19,
        rectangle: Cesium.Rectangle.fromDegrees(124.0, 31.0, 132.0, 43.0),
      })
      vworldLayerRef.current = viewer.imageryLayers.addImageryProvider(newProvider)
    }
    
    viewer.scene.requestRender()
  }, [basemap])

  // 2. 시추공 데이터 렌더링 (클러스터링 포인트 + 지하 실린더)
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    // 지하 3D 실린더 엔티티 초기화
    boreholesEntitiesRef.current.forEach((entity) => viewer.entities.remove(entity))
    boreholesEntitiesRef.current = []

    // 데이터소스(클러스터링용) 초기화
    if (clusterDataSourceRef.current) {
      viewer.dataSources.remove(clusterDataSourceRef.current)
      clusterDataSourceRef.current = null
    }

    const dataSource = new Cesium.CustomDataSource("boreholes")
    clusterDataSourceRef.current = dataSource

    // 클러스터링 비활성화 (모든 마커를 개별적으로 지도에 표기)
    dataSource.clustering.enabled = false

    viewer.dataSources.add(dataSource)

    const SOIL_TYPE_TO_INDEX: Record<string, number> = {
      soil: 0,
      weathered_rock: 1,
      soft_rock: 2,
      hard_rock: 3,
    }

    boreholes.forEach((b) => {
      const elev = b.elevation || 0
      const groundZ = zMode === 'gl' ? 0.5 : elev * vexag + 0.5
      const centerCartesian = Cesium.Cartesian3.fromDegrees(b.longitude, b.latitude, groundZ)

      // 지표면 회색 점 마커 🔘
      dataSource.entities.add({
        id: `bh-${b.id}`,
        position: centerCartesian,
        point: {
          pixelSize: 8,
          color: Cesium.Color.fromCssColorString("#7F8C8D"), // 은회색 계열
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY, // 항상 지표면 위에 표현
          scaleByDistance: new Cesium.NearFarScalar(1500, 1.0, 15000, 0.25),
        },
        label: {
          text: b.name,
          font: "11px sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          pixelOffset: new Cesium.Cartesian2(0, -12), // 회색 점 위쪽으로 텍스트 오프셋 조정
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3000), // 3000m 이상 멀어지면 이름 숨김
        }
      })

      // 지하 3D 실린더 지층 컬럼 렌더링
      if (showColumns && b.strata && b.strata.length > 0) {
        b.strata.forEach((s) => {
          const idx = SOIL_TYPE_TO_INDEX[s.soil_type] ?? 0
          // 지층 가시성 체크
          if (!layerVisible[idx]) return

          const thickness = s.depth_bottom - s.depth_top
          if (thickness <= 0) return

          // 수직 과장이 적용된 기하학적 실린더 길이 및 고도 계산
          const len = thickness * vexag
          const midDepth = (s.depth_top + s.depth_bottom) / 2
          const z = zMode === 'gl' ? -midDepth * vexag : (elev - midDepth) * vexag

          const cylinderCenter = Cesium.Cartesian3.fromDegrees(b.longitude, b.latitude, z)
          const color = SOIL_COLORS[s.soil_type] || DEFAULT_COLOR

          const cylinderEntity = viewer.entities.add({
            id: `cylinder-${b.id}-${s.id}`,
            position: cylinderCenter,
            cylinder: {
              length: len,
              topRadius: radius,
              bottomRadius: radius,
              material: color.withAlpha(alpha / 255),
              heightReference: Cesium.HeightReference.NONE,
            }
          })
          boreholesEntitiesRef.current.push(cylinderEntity)
        })
      }
    })

    viewer.scene.requestRender()
  }, [boreholes, vexag, radius, alpha, zMode, layerVisible, showColumns])

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
