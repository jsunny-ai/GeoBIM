import type { ParsedParams } from "./types"

export function parseUrlParams(): ParsedParams {
  const sp = new URLSearchParams(window.location.search)
  const bboxStr = sp.get("bbox")
  const polyStr = sp.get("polygon")
  const projStr = sp.get("projectId")
  const bhIdsStr = sp.get("boreholeIds")

  if (!bboxStr) {
    return { bbox: null, polygon: null, projectId: null, boreholeIds: [], error: "bbox 파라미터 없음 - 1단계(지도)부터 시작하세요." }
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
  polygon: { lng: number; lat: number }[] | null = null,
): Promise<any[]> {
  const ids = boreholeIds.filter((n) => Number.isFinite(n))
  if (ids.length > 0) {
    let url = `/api/v1/boreholes/?ids=${ids.join(",")}&limit=${Math.max(ids.length, 1)}&include_strata=true`
    if (projectId) url += `&project_id=${projectId}`
    const r = await fetch(url)
    if (!r.ok) throw new Error(`시추공 API 오류: HTTP ${r.status}`)
    const data = await r.json()
    return data.boreholes ?? []
  }

  const [minLng, minLat, maxLng, maxLat] = bbox
  const ring = polygon && polygon.length >= 3
    ? polygon
    : [
        { lng: minLng, lat: minLat },
        { lng: maxLng, lat: minLat },
        { lng: maxLng, lat: maxLat },
        { lng: minLng, lat: maxLat },
      ]
  const closedRing = [...ring]
  const first = closedRing[0]
  const last = closedRing[closedRing.length - 1]
  if (first && last && (first.lng !== last.lng || first.lat !== last.lat)) {
    closedRing.push(first)
  }

  const r = await fetch("/api/v1/boreholes/by-area", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      polygon: {
        type: "Polygon",
        coordinates: [closedRing.map((p) => [p.lng, p.lat])],
      },
      project_id: projectId,
      include_strata: true,
    }),
  })
  if (!r.ok) throw new Error(`시추공 API 오류: HTTP ${r.status}`)
  const data = await r.json()
  return data.boreholes ?? []
}
