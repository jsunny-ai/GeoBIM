import { getStrataColor, getStrataGroup, type StrataGroup } from "@shared/strataColor"
import type { Borehole, LngLat } from "@/lib/types"

export interface Voxel {
  lng: number
  lat: number
  z_bottom: number   // 절대 고도 (m, 해수면 기준)
  z_top: number
  soil_type: string
  group: StrataGroup
  color: string
}

export interface VoxelGridOptions {
  cellSizeM: number      // 수평 셀 크기 (미터)
  verticalExag: number   // 수직 과장 배율
  zMode?: "gl" | "absolute"
}

// ── point-in-polygon (ray casting) ───────────────────────────────────────────
function pip(lng: number, lat: number, poly: LngLat[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const { lng: xi, lat: yi } = poly[i]
    const { lng: xj, lat: yj } = poly[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

// ── nearest borehole (Euclidean in degrees — close enough for small areas) ──
function nearest(lng: number, lat: number, bhs: Borehole[]): Borehole {
  let best = bhs[0]
  let bestD = Infinity
  for (const b of bhs) {
    const d = (b.longitude - lng) ** 2 + (b.latitude - lat) ** 2
    if (d < bestD) { bestD = d; best = b }
  }
  return best
}

// ── main grid generator ──────────────────────────────────────────────────────
export function buildVoxelGrid(
  polygon: LngLat[],
  boreholes: Borehole[],
  opts: VoxelGridOptions,
): { voxels: Voxel[]; cellSizeM: number } {
  if (polygon.length < 3 || boreholes.length === 0) {
    return { voxels: [], cellSizeM: opts.cellSizeM }
  }

  const lons = polygon.map((p) => p.lng)
  const lats = polygon.map((p) => p.lat)
  const minLng = Math.min(...lons)
  const maxLng = Math.max(...lons)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)

  const mPerDegLat = 111000
  const mPerDegLng = 111000 * Math.cos((minLat * Math.PI) / 180)

  const cellLng = opts.cellSizeM / mPerDegLng
  const cellLat = opts.cellSizeM / mPerDegLat

  // 폭발 방지: 예상 셀 수 > 50,000 이면 cellSize 자동 증가
  const estCells =
    Math.ceil((maxLng - minLng) / cellLng) *
    Math.ceil((maxLat - minLat) / cellLat)
  const maxDepth = Math.max(
    ...boreholes.map((b) => Math.max(...b.strata.map((s) => s.depth_bottom), 0)),
  )
  if (estCells * maxDepth > 200_000) {
    const scaled = opts.cellSizeM * Math.sqrt((estCells * maxDepth) / 200_000)
    return buildVoxelGrid(polygon, boreholes, { ...opts, cellSizeM: Math.ceil(scaled) })
  }

  const voxels: Voxel[] = []

  for (let lng = minLng; lng < maxLng; lng += cellLng) {
    for (let lat = minLat; lat < maxLat; lat += cellLat) {
      const cLng = lng + cellLng / 2
      const cLat = lat + cellLat / 2
      if (!pip(cLng, cLat, polygon)) continue

      const bh = nearest(cLng, cLat, boreholes)

      for (const s of bh.strata) {
        // 절대 고도 vs GL 정렬 모드에 맞게 분기 계산
        const absTop = opts.zMode === "gl" ? -s.depth_top : bh.elevation - s.depth_top
        const absBot = opts.zMode === "gl" ? -s.depth_bottom : bh.elevation - s.depth_bottom

        voxels.push({
          lng: cLng,
          lat: cLat,
          z_bottom: absBot * opts.verticalExag,
          z_top: absTop * opts.verticalExag,
          soil_type: s.soil_type,
          group: getStrataGroup(s.soil_type),
          color: getStrataColor(s.soil_type),
        })
      }
    }
  }

  return { voxels, cellSizeM: opts.cellSizeM }
}
