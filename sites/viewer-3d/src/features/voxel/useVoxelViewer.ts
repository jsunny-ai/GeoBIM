import { useEffect, useRef, useState } from "react"
import maplibregl from "maplibre-gl"
import { MapboxOverlay } from "@deck.gl/mapbox"
import { ColumnLayer, ScatterplotLayer, GeoJsonLayer, BitmapLayer } from "@deck.gl/layers"
import { SimpleMeshLayer } from "@deck.gl/mesh-layers"
import { COORDINATE_SYSTEM } from "@deck.gl/core"
import { parse } from "@loaders.gl/core"
import { GLTFLoader } from "@loaders.gl/gltf"
import type { Borehole, LngLat } from "@/lib/types"
import { STRATA_RGB, normalizeStrataGroup, type StrataGroup } from "@shared/strataColor"
import { buildVoxelGrid, type VoxelGridOptions } from "./buildVoxelGrid"

export interface VisibilityState {
  soil: boolean
  weathered_rock: boolean
  soft_rock: boolean
  hard_rock: boolean
  boreholes: boolean
}

export interface ExtraViewerOptions {
  basemap: string
  zMode: "gl" | "absolute"
  radius: number
  alpha: number
  show2D: boolean
  showSolid: boolean
  layerVisible: boolean[]
}

function getTilesAndAttribution(basemap: string, vworldKey: string) {
  if (basemap === "osm" || !vworldKey) {
    return {
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      attribution: "© OpenStreetMap contributors",
    }
  }
  const ext = basemap === "Satellite" ? "jpeg" : "png"
  return {
    tiles: [`https://api.vworld.kr/req/wmts/1.0.0/${vworldKey}/${basemap}/{z}/{y}/{x}.${ext}`],
    attribution: "© V-World",
  }
}

// ── Web Mercator 타일 좌표 헬퍼 ────────────────────────────────────
function lngToWorldX(lng: number, z: number) {
  return ((lng + 180) / 360) * 256 * Math.pow(2, z);
}
function latToWorldY(lat: number, z: number) {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z);
}

/** bbox 영역의 V-World 타일을 합성 + crop → HTMLCanvasElement */
async function buildAreaCanvas(
  bbox: [number, number, number, number],
  layers: string[],
): Promise<HTMLCanvasElement> {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  let zoom = 19;
  while (zoom > 10) {
    const txCount =
      Math.floor(lngToWorldX(maxLng, zoom) / 256) -
      Math.floor(lngToWorldX(minLng, zoom) / 256) + 1;
    const tyCount =
      Math.floor(latToWorldY(minLat, zoom) / 256) -
      Math.floor(latToWorldY(maxLat, zoom) / 256) + 1;
    if (txCount * tyCount <= 100) break;
    zoom--;
  }
  
  const wxMin = lngToWorldX(minLng, zoom);
  const wxMax = lngToWorldX(maxLng, zoom);
  const wyMin = latToWorldY(maxLat, zoom);
  const wyMax = latToWorldY(minLat, zoom);
  const txMin = Math.floor(wxMin / 256), txMax = Math.floor(wxMax / 256);
  const tyMin = Math.floor(wyMin / 256), tyMax = Math.floor(wyMax / 256);

  const grid = document.createElement('canvas');
  grid.width = (txMax - txMin + 1) * 256;
  grid.height = (tyMax - tyMin + 1) * 256;
  const gctx = grid.getContext('2d')!;
  gctx.fillStyle = '#e8e8e8';
  gctx.fillRect(0, 0, grid.width, grid.height);

  const loadTile = (layer: string, x: number, y: number) =>
    new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `/api/v1/tiles/vworld/${layer}/${zoom}/${x}/${y}`;
    });

  for (const layer of layers) {
    const jobs: Promise<void>[] = [];
    for (let tx = txMin; tx <= txMax; tx++)
      for (let ty = tyMin; ty <= tyMax; ty++)
        jobs.push(loadTile(layer, tx, ty).then((img) => {
          if (img) gctx.drawImage(img, (tx - txMin) * 256, (ty - tyMin) * 256);
        }));
    await Promise.all(jobs);
  }

  const cropX = wxMin - txMin * 256;
  const cropY = wyMin - tyMin * 256;
  const cropW = Math.max(1, Math.round(wxMax - wxMin));
  const cropH = Math.max(1, Math.round(wyMax - wyMin));
  const out = document.createElement('canvas');
  out.width = cropW; out.height = cropH;
  out.getContext('2d')!.drawImage(grid, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return out;
}

export function useVoxelViewer(
  containerRef: React.RefObject<HTMLDivElement | null>,
  polygon: LngLat[],
  boreholes: Borehole[],
  opts: VoxelGridOptions,
  visibility: VisibilityState,
  extraOpts: ExtraViewerOptions,
) {
  const mapRef = useRef<maplibregl.Map | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const lastPolyRef = useRef<string>("")

  const [solidCenter, setSolidCenter] = useState<[number, number] | null>(null)
  const [solidMeshes, setSolidMeshes] = useState<any[]>([])
  const [footprints, setFootprints] = useState<any>(null)

  const [clippedCanvas, setClippedCanvas] = useState<HTMLCanvasElement | null>(null)

  // ── 선택 영역 크롭 지도 캔버스 합성 Effect ──
  useEffect(() => {
    if (!polygon || polygon.length < 3) return
    let cancelled = false

    const LAYER_SETS: Record<string, string[]> = {
      Base: ['Base'],
      Satellite: ['Satellite'],
      Hybrid: ['Satellite', 'Hybrid'],
      gray: ['Base'],
      midnight: ['Base'],
      osm: ['Base']
    }
    const selectedLayers = LAYER_SETS[extraOpts.basemap] || ['Base']

    const lngs = polygon.map((p) => p.lng)
    const lats = polygon.map((p) => p.lat)
    const bbox: [number, number, number, number] = [
      Math.min(...lngs), Math.min(...lats),
      Math.max(...lngs), Math.max(...lats),
    ]

    buildAreaCanvas(bbox, selectedLayers)
      .then((canvas) => {
        if (!cancelled) setClippedCanvas(canvas)
      })
      .catch((e) => console.error("[useVoxelViewer] buildAreaCanvas error:", e))

    return () => { cancelled = true }
  }, [polygon, extraOpts.basemap])

  // ── Map & Overlay 초기화 ───────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const vworldKey = (import.meta as any).env?.VITE_VWORLD_KEY
    const { tiles, attribution } = getTilesAndAttribution(extraOpts.basemap, vworldKey)
    const styleSpec: maplibregl.StyleSpecification = {
      version: 8,
      sources: {
        basemap: {
          type: "raster",
          tiles,
          tileSize: 256,
          attribution,
        },
      },
      layers: [{ id: "basemap", type: "raster", source: "basemap" }],
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleSpec,
      center: [127.0259, 37.2769], // 기본 중심 좌표 (수원)
      zoom: 14.5,
      pitch: 60,
      bearing: -20,
      maxPitch: 85,
      antialias: true,
    })

    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      getTooltip: ({ object }: any) => {
        if (!object) return null

        if (object.type === "voxel") {
          return {
            html: `
              <div style="font-weight: bold; color: #38bdf8; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 2px;">복셀 지층 정보</div>
              <div style="display: flex; justify-content: space-between; gap: 12px; margin-bottom: 2px;">
                <span style="color: #94a3b8;">지층명:</span>
                <span style="font-weight: 600; color: #facc15;">${object.soil_type}</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 12px; margin-bottom: 2px;">
                <span style="color: #94a3b8;">표고 범위:</span>
                <span style="font-weight: 500;">EL. ${object.elevation_bottom.toFixed(1)} ~ ${object.elevation_top.toFixed(1)}m</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 12px;">
                <span style="color: #94a3b8;">두께:</span>
                <span style="font-weight: 500; color: #34d399;">${object.height.toFixed(1)}m</span>
              </div>
            `,
            style: {
              backgroundColor: "rgba(15, 23, 42, 0.95)",
              color: "#f8fafc",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              fontSize: "11px",
              fontFamily: "sans-serif",
              boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
              minWidth: "170px",
              lineHeight: "1.5",
            }
          }
        } else if (object.type === "borehole_stratum") {
          return {
            html: `
              <div style="font-weight: bold; color: #f43f5e; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 2px;">시추공 지층 (${object.boreholeName})</div>
              <div style="display: flex; justify-content: space-between; gap: 12px; margin-bottom: 2px;">
                <span style="color: #94a3b8;">지층명:</span>
                <span style="font-weight: 600; color: #facc15;">${object.soil_type}</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 12px; margin-bottom: 2px;">
                <span style="color: #94a3b8;">굴진 심도:</span>
                <span style="font-weight: 500; color: #fb923c;">GL. ${object.depth_top.toFixed(1)} ~ ${object.depth_bottom.toFixed(1)}m</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 12px;">
                <span style="color: #94a3b8;">표고 범위:</span>
                <span style="font-weight: 500;">EL. ${object.elevation_bottom.toFixed(1)} ~ ${object.elevation_top.toFixed(1)}m</span>
              </div>
            `,
            style: {
              backgroundColor: "rgba(15, 23, 42, 0.95)",
              color: "#f8fafc",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              fontSize: "11px",
              fontFamily: "sans-serif",
              boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
              minWidth: "170px",
              lineHeight: "1.5",
            }
          }
        }
        return null
      }
    })

    map.addControl(overlay as unknown as maplibregl.IControl)
    mapRef.current = map
    overlayRef.current = overlay

    return () => {
      if (overlayRef.current) {
        try {
          map.removeControl(overlayRef.current as unknown as maplibregl.IControl)
        } catch {}
      }
      overlayRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ── 배경 지도 변경 효과 ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const vworldKey = (import.meta as any).env?.VITE_VWORLD_KEY
    const applyTiles = () => {
      const src = map.getSource("basemap") as
        | (maplibregl.RasterTileSource & { setTiles?: (tiles: string[]) => void })
        | undefined
      if (!src) return
      const { tiles } = getTilesAndAttribution(extraOpts.basemap, vworldKey)
      if (typeof src.setTiles === "function") {
        src.setTiles(tiles)
      } else {
        if (map.getLayer("basemap")) map.removeLayer("basemap")
        if (map.getSource("basemap")) map.removeSource("basemap")
        map.addSource("basemap", { type: "raster", tiles, tileSize: 256 })
        map.addLayer({ id: "basemap", type: "raster", source: "basemap" }, undefined)
      }

      // 다크 마스킹 기법: 기저 배경은 옅은 톤(0.15)으로 어둡게 깔리도록 조치
      if (map.getLayer("basemap")) {
        map.setPaintProperty("basemap", "raster-opacity", 0.15)
      }
    }

    if (map.isStyleLoaded()) {
      applyTiles()
    } else {
      map.once("load", applyTiles)
    }
  }, [extraOpts.basemap])

  // ── 3D GLTF Solid Meshes 및 2D Footprints 1회 로드 ───────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        console.log("[useVoxelViewer] fetching solid_meta.json...")
        const metaRes = await fetch("/poc/solid_meta.json")
        if (!metaRes.ok) return
        const meta = await metaRes.json()
        if (cancelled) return
        console.log("[useVoxelViewer] meta loaded:", meta.center_wgs84)
        setSolidCenter(meta.center_wgs84)

        console.log("[useVoxelViewer] fetching geological_solid_yeongtong.glb...")
        const glbRes = await fetch("/poc/geological_solid_yeongtong.glb")
        const buf = await glbRes.arrayBuffer()
        const gltf: any = await parse(buf, GLTFLoader)
        if (cancelled) return

        // Raw glTF accessor extraction...
        const json = gltf.json
        const rawBuffers = gltf.buffers || []
        if (!json?.meshes || !rawBuffers.length) return

        const COMP_TYPES: Record<number, any> = {
          5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
          5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
        }
        const COMPS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
        const getBufferAB = (i: number): ArrayBuffer => {
          const b = rawBuffers[i]
          return b?.arrayBuffer || b?.buffer || b
        }
        const readAccessor = (accIdx: number) => {
          const acc = json.accessors[accIdx]
          const bv = json.bufferViews[acc.bufferView]
          const ab = getBufferAB(bv.buffer)
          const offset = (bv.byteOffset || 0) + (acc.byteOffset || 0)
          const TA = COMP_TYPES[acc.componentType]
          const numComp = COMPS[acc.type]
          return new TA(ab, offset, acc.count * numComp)
        }

        const deckMeshes: any[] = []
        json.meshes.forEach((m: any, mi: number) => {
          (m.primitives || []).forEach((p: any, pi: number) => {
            const a = p.attributes || {}
            const positions = a.POSITION !== undefined ? readAccessor(a.POSITION) : null
            const normals   = a.NORMAL !== undefined   ? readAccessor(a.NORMAL)   : null
            const indices   = p.indices !== undefined  ? readAccessor(p.indices)  : null
            if (!positions) return
            deckMeshes.push({
              attributes: {
                positions: { value: positions, size: 3 },
                ...(normals ? { normals: { value: normals, size: 3 } } : {}),
              },
              indices: indices ? { value: indices, size: 1 } : undefined,
            })
          })
        })

        setSolidMeshes(deckMeshes)
        console.log(`[useVoxelViewer] ✓ ${deckMeshes.length} primitives ready`)
      } catch (e) {
        console.error("[useVoxelViewer] solid load failed:", e)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/poc/layer_footprints.geojson")
        if (!res.ok) return
        const gj = await res.json()
        if (cancelled) return
        setFootprints(gj)
        console.log(`[useVoxelViewer] ✓ 2D footprints: ${gj.features?.length || 0} features`)
      } catch (e) {
        console.error("[useVoxelViewer] footprints load failed:", e)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // solidCenter 로드 시 부드럽게 카메라 이동
  const flyToDoneRef = useRef(false)
  useEffect(() => {
    if (!solidCenter || flyToDoneRef.current || !mapRef.current) return
    flyToDoneRef.current = true
    const map = mapRef.current
    const doFly = () => {
      map.flyTo({
        center: solidCenter as [number, number],
        zoom: 15.5,
        pitch: 60,
        bearing: -20,
        duration: 1500,
      })
    }
    if (map.isStyleLoaded()) doFly()
    else map.once("load", doFly)
  }, [solidCenter])

  // ── 데이터 & 시각화 레이어 업데이트 ────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const overlay = overlayRef.current
    if (!map || !overlay) return

    const layers: any[] = []

    // 0. 선택한 영역만큼 잘려진 위성/일반 지도 바닥 레이어 (BitmapLayer)
    if (clippedCanvas && polygon.length >= 3) {
      const lngs = polygon.map((p) => p.lng)
      const lats = polygon.map((p) => p.lat)
      const polyBbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]

      // 상대/절대 고도 모드 및 수직과장률에 맞추어 Z축 바닥 고도를 복셀 최하단 높이로 물리적 정합!
      const zVal = extraOpts.zMode === "gl"
        ? -130 * opts.verticalExag
        : -40 * opts.verticalExag

      layers.push(
        new BitmapLayer({
          id: "clipped-map-canvas-layer",
          bounds: [
            [polyBbox[0], polyBbox[1], zVal], // 좌하단 (W, S, Z)
            [polyBbox[0], polyBbox[3], zVal], // 좌상단 (W, N, Z)
            [polyBbox[2], polyBbox[3], zVal], // 우상단 (E, N, Z)
            [polyBbox[2], polyBbox[1], zVal]  // 우하단 (E, S, Z)
          ],
          image: clippedCanvas,
          pickable: false,
          desaturate: 0,
          transparentColor: [0, 0, 0, 0],
        })
      )
    }

    // 1. 복셀 데이터 격자 생성
    if (polygon.length >= 3 && boreholes.length > 0) {
      const { voxels, cellSizeM } = buildVoxelGrid(polygon, boreholes, { ...opts, zMode: extraOpts.zMode })

      // 1.1 개별 지층 가시성 및 가시성 필터링된 복셀 데이터 추출
      const activeVoxels = voxels.filter((v) => {
        const idx = ["soil", "weathered_rock", "soft_rock", "hard_rock"].indexOf(v.group)
        if (idx !== -1 && !extraOpts.layerVisible[idx]) return false
        return visibility[v.group as keyof VisibilityState]
      })

      // 1.2 복셀 ColumnLayer 정의 (정육면체 복셀 형태)
      const voxelLayer = new ColumnLayer({
        id: "voxel-3d-grid",
        data: activeVoxels,
        diskResolution: 4,
        radius: cellSizeM / Math.sqrt(2), // 딱 들어맞는 정격자 크기
        angle: 45, // lat/lng 격자에 직각 정렬
        extruded: true,
        pickable: true,
        elevationScale: 1,
        getPosition: (v: any) => [v.lng, v.lat, v.z_bottom],
        getElevation: (v: any) => v.z_top - v.z_bottom,
        getFillColor: (v: any) => {
          const rgb = STRATA_RGB[v.group as StrataGroup] || STRATA_RGB.unknown
          return [rgb[0], rgb[1], rgb[2], extraOpts.alpha]
        },
        material: {
          ambient: 0.6,
          diffuse: 0.6,
          shininess: 10,
          specularColor: [30, 30, 30],
        },
        updateTriggers: {
          getPosition: [opts.verticalExag, extraOpts.zMode],
          getElevation: [opts.verticalExag, extraOpts.zMode],
          getFillColor: [extraOpts.alpha, extraOpts.layerVisible],
        },
      })
      layers.push(voxelLayer)
    }

    // 2. 시추공 3D 실린더 세그먼트 생성
    if (visibility.boreholes && boreholes.length > 0) {
      const bhSegments: any[] = []
      for (const bh of boreholes) {
        for (const s of bh.strata) {
          const group = normalizeStrataGroup(s.soil_type)
          const idx = ["soil", "weathered_rock", "soft_rock", "hard_rock"].indexOf(group)
          // 지층별 가시성 토글 미통과 시 배제
          if (idx !== -1 && !extraOpts.layerVisible[idx]) continue

          const absTop = (extraOpts.zMode === "gl" ? -s.depth_top : bh.elevation - s.depth_top) * opts.verticalExag
          const absBot = (extraOpts.zMode === "gl" ? -s.depth_bottom : bh.elevation - s.depth_bottom) * opts.verticalExag
          bhSegments.push({
            type: "borehole_stratum",
            boreholeName: bh.name,
            soil_type: s.soil_type,
            depth_top: s.depth_top,
            depth_bottom: s.depth_bottom,
            z_bottom: absBot,
            thickness: Math.abs(absTop - absBot),
            elevation_top: bh.elevation - s.depth_top,
            elevation_bottom: bh.elevation - s.depth_bottom,
            longitude: bh.longitude,
            latitude: bh.latitude,
          })
        }
      }

      const boreholeLayer = new ColumnLayer({
        id: "borehole-3d-cylinders",
        data: bhSegments,
        diskResolution: 16,
        radius: extraOpts.radius, // 동적 컬럼 반경
        extruded: true,
        pickable: true,
        elevationScale: 1,
        getPosition: (s: any) => [s.longitude, s.latitude, s.z_bottom],
        getElevation: (s: any) => s.thickness,
        getFillColor: (s: any) => {
          const group = normalizeStrataGroup(s.soil_type)
          const rgb = STRATA_RGB[group] || STRATA_RGB.unknown
          return [rgb[0], rgb[1], rgb[2], extraOpts.alpha]
        },
        material: {
          ambient: 0.6,
          diffuse: 0.6,
          shininess: 10,
          specularColor: [30, 30, 30],
        },
        updateTriggers: {
          getPosition: [opts.verticalExag, extraOpts.zMode],
          getElevation: [opts.verticalExag, extraOpts.zMode],
          radius: [extraOpts.radius],
          getFillColor: [extraOpts.alpha],
        },
      })
      layers.push(boreholeLayer)

      // 3. 시추공 지표면 디스크 마커
      const groundLayer = new ScatterplotLayer({
        id: "borehole-ground-markers",
        data: boreholes,
        getPosition: (bh: any) => [bh.longitude, bh.latitude, (extraOpts.zMode === "gl" ? 0 : bh.elevation * opts.verticalExag) + 0.1],
        getRadius: extraOpts.radius * 1.4,
        getFillColor: [255, 255, 255, 180],
        stroked: true,
        lineWidthMinPixels: 1.5,
        getLineColor: [0, 0, 0, 180],
        radiusUnits: "meters",
        updateTriggers: {
          getPosition: [opts.verticalExag, extraOpts.zMode],
          getRadius: [extraOpts.radius],
        },
      })
      layers.push(groundLayer)
    }

    // 4. 2D 지층 범위 (PolygonLayer / GeoJsonLayer)
    // moderate_rock 제거 — TOPSOIL/WEATHERED/SOFT_ROCK/HARD_ROCK 4개
    const GEOJSON_MAPPING = ["TOPSOIL", "WEATHERED", "SOFT_ROCK", "HARD_ROCK"]
    const STRATA_KEYS: StrataGroup[] = ["soil", "weathered_rock", "soft_rock", "hard_rock"]

    if (extraOpts.show2D && footprints?.features?.length) {
      GEOJSON_MAPPING.forEach((layerName, idx) => {
        if (!extraOpts.layerVisible[idx]) return
        const filtered = {
          type: "FeatureCollection",
          features: footprints.features.filter((f: any) => f.properties?.layer === layerName),
        }
        if (filtered.features.length === 0) return
        const group = STRATA_KEYS[idx]
        const rgb = STRATA_RGB[group] || STRATA_RGB.unknown
        const alpha = [110, 130, 170, 185, 200][idx]
        layers.push(
          new GeoJsonLayer({
            id: `footprint-${layerName}`,
            data: filtered as any,
            filled: true,
            stroked: true,
            getFillColor: [rgb[0], rgb[1], rgb[2], alpha],
            getLineColor: [rgb[0], rgb[1], rgb[2], 220],
            lineWidthMinPixels: 0.3,
            pickable: true,
            getElevation: 0,
            extruded: false,
          })
        )
      })
    }

    // 5. 3D Kriging 솔리드 mesh (SimpleMeshLayer)
    // moderate_rock 제거 — STRATA_RGB 지질 톤 4계열
    const SOLID_COLORS = [
      [139, 115,  85, 130],  // 토사
      [196, 165, 123, 175],  // 풍화암
      [107, 142,  90, 215],  // 연암
      [ 61,  61,  61, 240],  // 경암 (보통암 통합)
    ]

    if (extraOpts.showSolid && solidMeshes.length > 0 && solidCenter) {
      for (let i = solidMeshes.length - 1; i >= 0; i--) {
        const prim = solidMeshes[i]
        // Yeongtong GLB 4개 레이어 대응 mapping
        const visibleIdx = solidMeshes.length === 4 ? [0, 1, 2, 3][i] : i
        if (!extraOpts.layerVisible[visibleIdx]) continue

        const color = SOLID_COLORS[visibleIdx] || [180, 180, 180, 200]

        layers.push(
          new SimpleMeshLayer({
            id: `geo-solid-${i}`,
            data: [{ position: [0, 0, 0] }],
            mesh: prim,
            coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
            coordinateOrigin: [solidCenter[0], solidCenter[1], 0],
            getPosition: (d: any) => d.position,
            getColor: color as [number, number, number, number],
            getScale: [1, 1, opts.verticalExag],
            pickable: false,
            material: {
              ambient: 0.55,
              diffuse: 0.6,
              shininess: 10,
              specularColor: [25, 25, 25],
            },
            updateTriggers: {
              getScale: [opts.verticalExag],
              getColor: [i, extraOpts.layerVisible],
            },
          })
        )
      }
    }

    overlay.setProps({ layers })

    // 6. 폴리곤 변경 시 부드러운 카메라 이동
    if (polygon.length >= 3) {
      const polyHash = JSON.stringify(polygon)
      if (polyHash !== lastPolyRef.current) {
        lastPolyRef.current = polyHash
        const centerLng = polygon.reduce((s, p) => s + p.lng, 0) / polygon.length
        const centerLat = polygon.reduce((s, p) => s + p.lat, 0) / polygon.length
        map.flyTo({
          center: [centerLng, centerLat],
          zoom: 15.5,
          pitch: 60,
          bearing: -20,
          duration: 1500,
        })
      }
    }
  }, [polygon, boreholes, opts, visibility, extraOpts, solidMeshes, solidCenter, footprints])
  return mapRef
}