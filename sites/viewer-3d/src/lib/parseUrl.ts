import type { Borehole } from "@shared/types"

export interface LngLat {
  lng: number
  lat: number
}

export interface GeoJSONPolygon {
  type: "Polygon"
  coordinates: [number, number][][]
}

export interface ParsedParams {
  polygon: LngLat[] | null
  boreholeIds: number[]
  bbox: [number, number, number, number] | null
  error: string | null
}

export function parseUrlParams(): ParsedParams {
  const sp = new URLSearchParams(window.location.search)
  const bboxStr = sp.get("bbox")
  const bhIds = sp.get("boreholeIds")
  const polyStr = sp.get("polygon")

  if (!bboxStr) {
    return { polygon: null, boreholeIds: [], bbox: null, error: "bbox 파라미터 없음 — 1단계(지도)부터 시작하세요." }
  }

  try {
    // 1. bbox 파싱
    const bbox = bboxStr.split(",").map(Number) as [number, number, number, number]
    if (bbox.length !== 4 || bbox.some(isNaN)) {
      return { polygon: null, boreholeIds: [], bbox: null, error: "잘못된 bbox 형식" }
    }

    // 2. boreholeIds 파싱
    const boreholeIds = bhIds
      ? bhIds.split(",").map(Number).filter(n => !isNaN(n))
      : []

    // 3. polygon 파싱
    let polygon: LngLat[] | null = null
    if (polyStr) {
      polygon = JSON.parse(decodeURIComponent(polyStr)) as LngLat[]
    }

    return { polygon, boreholeIds, bbox, error: null }
  } catch (err) {
    return { polygon: null, boreholeIds: [], bbox: null, error: "URL 파라미터 파싱 실패" }
  }
}

export async function fetchBoreholesByBbox(
  bbox: [number, number, number, number],
  polygon?: LngLat[],
  boreholeIds?: number[]
): Promise<Borehole[]> {
  const [minLng, minLat, maxLng, maxLat] = bbox
  const url = `/api/v1/boreholes?bbox=${minLng},${minLat},${maxLng},${maxLat}&limit=5000&include_strata=true`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`시추공 API 오류: HTTP ${r.status}`)
  const data = await r.json()
  return data.boreholes ?? []
}
