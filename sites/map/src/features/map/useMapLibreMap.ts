import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import maplibregl from "maplibre-gl"
import { MapboxOverlay } from "@deck.gl/mapbox"
import { ColumnLayer, ScatterplotLayer, GeoJsonLayer } from "@deck.gl/layers"
import { getStrataRgb } from "@shared/strataColor"
import type { Borehole } from "@/lib/types"

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------
export interface LngLat { lng: number; lat: number }
type Basemap = "Satellite" | "Hybrid" | "Base" | "gray" | "midnight" | "osm"

interface LayerSegment {
  boreholeId: number
  boreholeName: string
  projectName: string
  soilType: string
  depthTop: number
  depthBottom: number
  thickness: number
  elevation: number
  zTop: number
  zBot: number
  lon: number
  lat: number
  rgb: [number, number, number]
}

const TILE_PROXY = "/api/v1/tiles/vworld"

// moderate_rock 제거 — STRATA_LEGEND와 동기화
const STRATA_LABELS: Record<string, string> = {
  soil:           "토사 계열",
  weathered_rock: "풍화암",
  soft_rock:      "연암 계열",
  hard_rock:      "경암 계열",
}

function getTilesAndAttribution(basemap: Basemap): { tiles: string[]; attribution: string } {
  if (basemap === "osm") {
    return {
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      attribution: "© OpenStreetMap contributors",
    }
  }
  return {
    tiles: [`${TILE_PROXY}/${basemap}/{z}/{x}/{y}`],
    attribution: "© V-World (국토교통부 · 공간정보산업진흥원)",
  }
}

function buildStyle(basemap: Basemap): maplibregl.StyleSpecification {
  const { tiles, attribution } = getTilesAndAttribution(basemap)
  return {
    version: 8,
    sources: { bg: { type: "raster", tiles, tileSize: 256, attribution } },
    layers: [{ id: "bg", type: "raster", source: "bg" }],
  }
}

// Ray casting point-in-polygon
function pointInPolygon(pt: LngLat, poly: LngLat[]): boolean {
  const { lng: px, lat: py } = pt
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lng, yi = poly[i].lat
    const xj = poly[j].lng, yj = poly[j].lat
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useMapLibreMap(
  containerRef: React.RefObject<HTMLDivElement | null>,
  boreholes: Borehole[],
  onBoreholeClick: (b: Borehole) => void,
  opts: {
    vexag: number
    radius: number
    alpha: number
    zMode: "gl" | "absolute"
    showColumns: boolean
    show2D: boolean
    showSolid: boolean
    layerVisible: boolean[]
    basemap: Basemap
  }
): {
  isDrawing: boolean
  polygon: LngLat[] | null
  selectedBoreholes: Borehole[]
  startDrawing: () => void
  cancelDrawing: () => void
} {
  const mapRef = useRef<maplibregl.Map | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)

  const [isDrawing, setIsDrawing] = useState(false)
  const [vertices, setVertices] = useState<LngLat[]>([])
  const [polygon, setPolygon] = useState<LngLat[] | null>(null)

  // 2D GeoJSON footprints state
  const [footprints, setFootprints] = useState<any>(null)

  // 1. 데이터 평탄화
  const segments = useMemo(() => {
    const out: LayerSegment[] = []
    for (const b of boreholes) {
      const projName = `프로젝트 #${b.project_id ?? "?"}`
      for (const s of b.strata) {
        const depthTop = s.depth_top ?? 0
        const depthBottom = s.depth_bottom ?? 0
        const thickness = depthBottom - depthTop
        if (thickness <= 0) continue

        const elev = b.elevation ?? 0
        const zTop = elev - depthTop
        const zBot = elev - depthBottom

        out.push({
          boreholeId: b.id,
          boreholeName: b.name,
          projectName: projName,
          soilType: s.soil_type,
          depthTop,
          depthBottom,
          thickness,
          elevation: elev,
          zTop,
          zBot,
          lon: b.longitude,
          lat: b.latitude,
          rgb: getStrataRgb(s.soil_type),
        })
      }
    }
    return out
  }, [boreholes])

  // 2. 3D GLB & 2D GeoJSON 1회 로드
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/poc/layer_footprints.geojson")
        if (!res.ok) return
        const gj = await res.json()
        if (cancelled) return
        setFootprints(gj)
      } catch (e) {
        console.error("[useMapLibreMap] footprints load failed:", e)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // 3. deck.gl 레이어 빌드
  const makeLayers = useCallback(() => {
    const columnZ = (d: LayerSegment) =>
      opts.zMode === "gl" ? -d.depthTop * opts.vexag : d.zBot * opts.vexag
    const groundZ = (d: Borehole) =>
      opts.zMode === "gl" ? 0.5 : (d.elevation ?? 0) * opts.vexag + 0.5

    const lyrs: any[] = []

    // ── 시추공 3D 컬럼 + 지표 디스크 ──
    if (opts.showColumns) {
      lyrs.push(
        new ColumnLayer<LayerSegment>({
          id: "borehole-columns",
          data: segments,
          diskResolution: 16,
          radius: opts.radius,
          extruded: true,
          pickable: true,
          elevationScale: opts.vexag,
          getPosition: (d) => [d.lon, d.lat, columnZ(d)],
          getElevation: (d) => d.thickness,
          getFillColor: (d) => [...d.rgb, opts.alpha] as [number, number, number, number],
          getLineColor: [0, 0, 0, 80],
          material: {
            ambient: 0.6, diffuse: 0.6, shininess: 10, specularColor: [30, 30, 30],
          },
          updateTriggers: {
            getFillColor: [opts.alpha],
            getPosition: [opts.vexag, opts.zMode],
            getElevation: [opts.vexag],
          },
          onClick: ({ object }: any) => {
            if (object) {
              const bh = boreholes.find((b) => b.id === object.boreholeId)
              if (bh) onBoreholeClick(bh)
            }
          },
        }),
        new ScatterplotLayer<Borehole>({
          id: "borehole-ground",
          data: boreholes,
          getPosition: (d) => [d.longitude, d.latitude, groundZ(d)],
          getRadius: opts.radius * 1.4,
          getFillColor: [255, 220, 120, 180],
          stroked: true,
          lineWidthMinPixels: 1.5,
          getLineColor: [255, 255, 255, 220],
          radiusUnits: "meters",
          updateTriggers: {
            getPosition: [opts.vexag, opts.zMode],
          },
          onClick: ({ object }: any) => {
            if (object) onBoreholeClick(object)
          },
        })
      )
    }

    // ── 2D 지층 범위 —— moderate_rock 제거, STRATA_RGB 지질 톤 적용
    const GEOJSON_MAPPING = ["TOPSOIL", "WEATHERED", "SOFT_ROCK", "HARD_ROCK"]
    const STRATA_COLORS = [
      [139, 115,  85],  // 토사
      [196, 165, 123],  // 풍화암
      [107, 142,  90],  // 연암
      [ 61,  61,  61],  // 경암 (보통암 통합)
    ]

    if (opts.show2D && footprints?.features?.length) {
      GEOJSON_MAPPING.forEach((layerName, idx) => {
        if (!opts.layerVisible[idx]) return
        const filtered = {
          type: "FeatureCollection",
          features: footprints.features.filter((f: any) => f.properties?.layer === layerName),
        }
        if (filtered.features.length === 0) return
        const rgb = STRATA_COLORS[idx]
        const alphaVal = [110, 130, 170, 185, 200][idx]
        lyrs.push(
          new GeoJsonLayer({
            id: `footprint-${layerName}`,
            data: filtered as any,
            filled: true,
            stroked: true,
            getFillColor: [rgb[0], rgb[1], rgb[2], alphaVal],
            getLineColor: [rgb[0], rgb[1], rgb[2], 220],
            lineWidthMinPixels: 0.3,
            pickable: true,
            getElevation: 0,
            extruded: false,
          })
        )
      })
    }

    return lyrs
  }, [segments, boreholes, opts, footprints, onBoreholeClick])

  // 5. 초기 중앙값 좌표 계산
  const center = useMemo(() => {
    if (!boreholes.length) return { lng: 127.0259, lat: 37.2769 }
    const lons = boreholes.map((b) => b.longitude).sort((a, b) => a - b)
    const lats = boreholes.map((b) => b.latitude).sort((a, b) => a - b)
    const mid = Math.floor(boreholes.length / 2)
    return { lng: lons[mid], lat: lats[mid] }
  }, [boreholes])

  // 6. MapLibre 초기화
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(opts.basemap),
      center: [center.lng, center.lat],
      zoom: 14.5,
      pitch: 60,
      bearing: -20,
      maxPitch: 80,
      antialias: true,
    })
    mapRef.current = map

    map.once("load", () => {
      if (overlayRef.current) return
      const overlay = new MapboxOverlay({
        interleaved: false,
        layers: makeLayers(),
        getTooltip: ({ object }: any) => {
          if (!object) return null
          const seg = object as LayerSegment
          if (!("soilType" in seg)) return null
          const translatedLabel = STRATA_LABELS[seg.soilType] || seg.soilType
          return {
            html: `
              <div style="font-family: sans-serif; text-align: left;">
                <b>${seg.boreholeName}</b><br/>
                프로젝트: ${(seg.projectName || "").slice(0, 30)}<br/>
                지층: <b style="color:rgb(${seg.rgb.join(",")})">${translatedLabel}</b><br/>
                심도: ${seg.depthTop}m → ${seg.depthBottom}m (두께 ${seg.thickness.toFixed(2)}m)<br/>
                표고: ${seg.elevation}m · z: ${seg.zBot.toFixed(2)}~${seg.zTop.toFixed(2)}m
              </div>
            `,
            style: {
              background: "rgba(11, 15, 25, 0.95)",
              color: "#fff",
              fontSize: "11px",
              padding: "8px 12px",
              border: "1px solid #1e293b",
              borderRadius: "8px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            },
          }
        },
      })
      map.addControl(overlay as unknown as maplibregl.IControl)
      overlayRef.current = overlay

      // Drawing GeoJSON sources
      map.addSource("draw-line", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
      })
      map.addLayer({
        id: "draw-line",
        type: "line",
        source: "draw-line",
        paint: { "line-color": "#38bdf8", "line-width": 2, "line-dasharray": [4, 2] },
      })
      map.addSource("draw-fill", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "Polygon", coordinates: [[]] }, properties: {} },
      })
      map.addLayer({
        id: "draw-fill",
        type: "fill",
        source: "draw-fill",
        paint: { "fill-color": "#38bdf8", "fill-opacity": 0.12 },
      })
    })

    return () => {
      overlayRef.current = null
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 7. Basemap 동적 변경
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      const src = map.getSource("bg") as any
      if (!src) return
      const { tiles } = getTilesAndAttribution(opts.basemap)
      if (typeof src.setTiles === "function") src.setTiles(tiles)
      else {
        if (map.getLayer("bg")) map.removeLayer("bg")
        if (map.getSource("bg")) map.removeSource("bg")
        map.addSource("bg", { type: "raster", tiles, tileSize: 256 })
        map.addLayer({ id: "bg", type: "raster", source: "bg" }, "draw-line")
      }
    }
    if (map.isStyleLoaded()) apply()
    else map.once("load", apply)
  }, [opts.basemap])

  // 8. Sliders/visibility 변경 시 deck.gl 레이어 갱신
  useEffect(() => {
    overlayRef.current?.setProps({ layers: makeLayers() })
  }, [makeLayers])

  // 9. Drawing Handlers
  const updateDrawSources = useCallback((verts: LngLat[], closed: boolean) => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const coords = verts.map((v) => [v.lng, v.lat])
    const lineSrc = map.getSource("draw-line") as maplibregl.GeoJSONSource | undefined
    lineSrc?.setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates: closed && coords.length ? [...coords, coords[0]] : coords },
      properties: {},
    })
    const fillSrc = map.getSource("draw-fill") as maplibregl.GeoJSONSource | undefined
    if (closed && coords.length >= 3) {
      fillSrc?.setData({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[...coords, coords[0]]] },
        properties: {},
      })
    } else {
      fillSrc?.setData({ type: "Feature", geometry: { type: "Polygon", coordinates: [[]] }, properties: {} })
    }
  }, [])

  const clickHandlerRef = useRef<((e: maplibregl.MapMouseEvent) => void) | null>(null)
  const ctxHandlerRef = useRef<((e: maplibregl.MapMouseEvent) => void) | null>(null)

  const startDrawing = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    setIsDrawing(true)
    setVertices([])
    setPolygon(null)
    updateDrawSources([], false)

    const onClick = (e: maplibregl.MapMouseEvent) => {
      setVertices((prev) => {
        const next = [...prev, { lng: e.lngLat.lng, lat: e.lngLat.lat }]
        updateDrawSources(next, false)
        return next
      })
    }
    const onCtx = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault?.()
      setVertices((prev) => {
        if (prev.length < 3) return prev
        setPolygon(prev)
        setIsDrawing(false)
        updateDrawSources(prev, true)
        if (clickHandlerRef.current) map.off("click", clickHandlerRef.current)
        if (ctxHandlerRef.current) map.off("contextmenu", ctxHandlerRef.current)
        clickHandlerRef.current = null
        ctxHandlerRef.current = null
        return prev
      })
    }

    clickHandlerRef.current = onClick
    ctxHandlerRef.current = onCtx
    map.on("click", onClick)
    map.on("contextmenu", onCtx)
  }, [updateDrawSources])

  const cancelDrawing = useCallback(() => {
    const map = mapRef.current
    if (clickHandlerRef.current) map?.off("click", clickHandlerRef.current)
    if (ctxHandlerRef.current) map?.off("contextmenu", ctxHandlerRef.current)
    clickHandlerRef.current = null
    ctxHandlerRef.current = null
    setIsDrawing(false)
    setVertices([])
    setPolygon(null)
    updateDrawSources([], false)
  }, [updateDrawSources])

  const selectedBoreholes = useMemo(() => {
    if (!polygon || polygon.length < 3) return []
    return boreholes.filter((b) => pointInPolygon({ lng: b.longitude, lat: b.latitude }, polygon))
  }, [polygon, boreholes])

  return { isDrawing, polygon, selectedBoreholes, startDrawing, cancelDrawing }
}
