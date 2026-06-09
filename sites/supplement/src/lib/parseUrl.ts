import type { ParsedParams } from "./types"

export function parseUrlParams(): ParsedParams {
  const sp = new URLSearchParams(window.location.search)
  const bboxStr  = sp.get("bbox")
  const polyStr  = sp.get("polygon")
  const projStr  = sp.get("projectId")
  const bhIdsStr = sp.get("boreholeIds")

  if (!bboxStr) {
    return { bbox: null, polygon: null, projectId: null, boreholeIds: [], error: "bbox 파라미터 없음 — 1단계(지도)부터 시작하세요." }
  }

  try {
    const bbox = bboxStr.split(",").map(Number) as [number, number, number, number]
    if (bbox.length !== 4 || bbox.some(isNaN)) {
      return { bbox: null, polygon: null, projectId: null, boreholeIds: [], error: "잘못된 bbox 형식" }
    }

    const polygon = polyStr
      ? (JSON.parse(decodeURIComponent(polyStr)) as { lng: number; lat: number }[])
      : null

    const projectId = projStr ? Number(projStr) : null

    const boreholeIds = bhIdsStr
      ? bhIdsStr.split(",").map(Number).filter((n) => !isNaN(n))
      : []

    return { bbox, polygon, projectId, boreholeIds, error: null }
  } catch {
    return { bbox: null, polygon: null, projectId: null, boreholeIds: [], error: "URL 파라미터 파싱 실패" }
  }
}

export async function fetchBoreholes(
  bbox: [number, number, number, number],
  projectId: number | null,
  boreholeIds: number[] = [],
): Promise<any[]> {
  const [minLng, minLat, maxLng, maxLat] = bbox
  let url = `/api/v1/boreholes/?bbox=${minLng},${minLat},${maxLng},${maxLat}&limit=5000&include_strata=true`
  if (projectId) url += `&project_id=${projectId}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`시추공 API 오류: HTTP ${r.status}`)
  const data = await r.json()
  const all: any[] = data.boreholes ?? []
  if (boreholeIds.length === 0) return all
  const idSet = new Set(boreholeIds)
  return all.filter((b) => idSet.has(b.id))
}
