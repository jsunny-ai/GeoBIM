import { useEffect, useRef, useState } from "react"
import * as Cesium from "cesium"
import { Entity, LabelGraphics, PointGraphics, Viewer } from "resium"
import type { CesiumComponentRef } from "resium"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import StratigraphyColumn from "@/features/boreholes/StratigraphyColumn"
import { getStrataColor } from "@/lib/strataColor"
import { MOCK_BOREHOLES, MOCK_PROJECTS } from "@/mock/data"
import type { Borehole } from "@/mock/data"
import { cn } from "@/lib/utils"

const VWORLD_KEY = import.meta.env.VITE_VWORLD_API_KEY as string

type VWorldLayer = "Satellite" | "Base" | "Hybrid"

const LAYER_OPTIONS: { value: VWorldLayer; label: string }[] = [
  { value: "Satellite", label: "위성" },
  { value: "Base", label: "기본지도" },
  { value: "Hybrid", label: "하이브리드" },
]

function makeVWorldProvider(layer: VWorldLayer) {
  const ext = layer === "Satellite" ? "jpeg" : "png"
  // V-World WMTS: z=0~5 는 타일 없음(XML 반환) → minimumLevel:6
  return new Cesium.UrlTemplateImageryProvider({
    url: `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/${layer}/{z}/{y}/{x}.${ext}`,
    minimumLevel: 6,
    maximumLevel: 19,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    credit: new Cesium.Credit("V-World (국토지리정보원)"),
  })
}

const CENTER_LNG = 127.0
const CENTER_LAT = 37.277
const CAMERA_HEIGHT = 12000

function applyLayer(viewer: Cesium.Viewer, layer: VWorldLayer) {
  viewer.imageryLayers.removeAll()
  if (layer === "Hybrid") {
    viewer.imageryLayers.addImageryProvider(makeVWorldProvider("Base"))
    viewer.imageryLayers.addImageryProvider(makeVWorldProvider("Hybrid"))
  } else {
    viewer.imageryLayers.addImageryProvider(makeVWorldProvider(layer))
  }
}

export default function MapPage() {
  const viewerRef = useRef<CesiumComponentRef<Cesium.Viewer>>(null)
  const [projectId, setProjectId] = useState<string>("all")
  const [selected, setSelected] = useState<Borehole | null>(null)
  const [activeLayer, setActiveLayer] = useState<VWorldLayer>("Satellite")

  const boreholes =
    projectId === "all"
      ? MOCK_BOREHOLES
      : MOCK_BOREHOLES.filter((b) => b.project_id === projectId)

  // viewer 준비 대기 후 초기화 (resium ref가 비동기 설정될 수 있음)
  useEffect(() => {
    let rafId: number
    let attempts = 0

    function init() {
      const viewer = viewerRef.current?.cesiumElement
      if (!viewer) {
        if (attempts++ < 60) {
          // 최대 1초(~60프레임) 대기
          rafId = requestAnimationFrame(init)
        }
        return
      }
      // 카메라 초기 위치 (한국)
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
          CENTER_LNG,
          CENTER_LAT,
          CAMERA_HEIGHT,
        ),
      })
      // V-World 이미지리 추가
      applyLayer(viewer, activeLayer)
    }

    rafId = requestAnimationFrame(init)
    return () => cancelAnimationFrame(rafId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 레이어 변경 시 이미지리 교체 (초기 마운트 후)
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer) return
    applyLayer(viewer, activeLayer)
  }, [activeLayer])

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* 좌상단 컨트롤 패널 */}
      <div className="absolute left-4 top-4 z-10 flex flex-col gap-2">
        {/* 프로젝트 필터 */}
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-52 bg-card/90 backdrop-blur-sm">
            <SelectValue placeholder="프로젝트 선택" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 프로젝트</SelectItem>
            {MOCK_PROJECTS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 레이어 토글 버튼 그룹 */}
        <div className="flex overflow-hidden rounded-md border border-border bg-card/90 backdrop-blur-sm">
          {LAYER_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setActiveLayer(value)}
              className={cn(
                "flex-1 px-3 py-1.5 text-xs font-medium transition-colors",
                activeLayer === value
                  ? "bg-sky-500 text-white"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Cesium 뷰어 — baseLayer/terrain 명시로 Ion 의존성 차단 */}
      <Viewer
        ref={viewerRef}
        full
        timeline={false}
        animation={false}
        homeButton={false}
        navigationHelpButton={false}
        sceneModePicker={false}
        geocoder={false}
        baseLayerPicker={false}
        infoBox={false}
        selectionIndicator={false}
        baseLayer={false as unknown as Cesium.ImageryLayer}
        terrainProvider={new Cesium.EllipsoidTerrainProvider()}
      >
        {boreholes.map((bh) => {
          const bottomStrata = bh.strata[bh.strata.length - 1]
          const hex = getStrataColor(bottomStrata.soil_type)
          const color = Cesium.Color.fromCssColorString(hex)
          const position = Cesium.Cartesian3.fromDegrees(
            bh.longitude,
            bh.latitude,
            bh.elevation,
          )

          return (
            <Entity
              key={bh.id}
              position={position}
              onClick={() => setSelected(bh)}
            >
              <PointGraphics
                pixelSize={14}
                color={color}
                outlineColor={Cesium.Color.WHITE}
                outlineWidth={2}
                heightReference={Cesium.HeightReference.CLAMP_TO_GROUND}
              />
              <LabelGraphics
                text={bh.id}
                font="bold 12px sans-serif"
                fillColor={Cesium.Color.WHITE}
                outlineColor={Cesium.Color.BLACK}
                outlineWidth={2}
                style={Cesium.LabelStyle.FILL_AND_OUTLINE}
                verticalOrigin={Cesium.VerticalOrigin.BOTTOM}
                pixelOffset={new Cesium.Cartesian2(0, -20)}
                disableDepthTestDistance={Number.POSITIVE_INFINITY}
              />
            </Entity>
          )
        })}
      </Viewer>

      {/* 우측 슬라이드 패널 */}
      <div
        className={[
          "absolute right-0 top-0 h-full w-[420px] overflow-y-auto",
          "border-l border-border bg-card/95 backdrop-blur-sm",
          "transition-transform duration-300",
          selected ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
      >
        {selected && (
          <div className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">{selected.id} 주상도</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelected(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <StratigraphyColumn borehole={selected} />
          </div>
        )}
      </div>
    </div>
  )
}
