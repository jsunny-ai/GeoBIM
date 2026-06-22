import { useEffect, useState } from "react"
import { fetchBoreholesByBbox } from "@/lib/parseUrl"
import type { Borehole } from "@/lib/types"
import { buildElevationGrid } from "../lib/terrain"
import { apiUrl } from "@shared/urls"

export function useBoreholeData(
  bbox: number[] | null,
  polygon: { lng: number; lat: number }[] | null,
  boreholeIds: number[],
  projectId?: number | null,
  reloadKey: number = 0, // [v4.2] 수정 저장 후 재조회 트리거
) {
  const [boreholes, setBoreholes] = useState<Borehole[]>([])
  const [fetchStatus, setFetchStatus] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [fetchErr, setFetchErr] = useState<string | null>(null)

  useEffect(() => {
    if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) return

    const [minLng, minLat, maxLng, maxLat] = bbox
    let cancelled = false
    setFetchStatus("loading")
    setFetchErr(null)

    const boreholePromise = projectId
      ? fetch(apiUrl(`/api/v1/projects/${projectId}/boreholes/effective`))
          .then(async (res) => {
            if (!res.ok) throw new Error(`프로젝트 시추공 API 오류: HTTP ${res.status}`)
            const data = await res.json()
            return (data.boreholes ?? []) as Borehole[]
          })
      : fetchBoreholesByBbox(bbox as [number, number, number, number], polygon || undefined, boreholeIds)

    boreholePromise
      .then(async (bhs) => {
        if (cancelled) return

        let terrainElevAt: ((lng: number, lat: number) => number) | null = null
        try {
          const dem = await buildElevationGrid(bbox as [number, number, number, number], 48)
          terrainElevAt = dem.terrainElevAt
        } catch (demErr) {
          console.error("DEM 로드 실패 (기본 고도 사용):", demErr)
        }

        let filtered = bhs
          .filter((b) => Number.isFinite(b.longitude) && Number.isFinite(b.latitude))
          .filter((b) => Number.isFinite(b.elevation))

        if (boreholeIds.length > 0) {
          const selectedIds = new Set(boreholeIds.map(Number))
          filtered = filtered.filter((b) => selectedIds.has(Number(b.id)))
        } else {
          if (polygon && polygon.length > 0) {
            filtered = filtered.filter((b) => isInsidePolygon(b.longitude, b.latitude, polygon))
          }
          filtered = filtered.filter(
            (b) =>
              b.longitude >= minLng &&
              b.longitude <= maxLng &&
              b.latitude >= minLat &&
              b.latitude <= maxLat,
          )
        }

        const normalized = filtered
          .filter((b) => b.strata && b.strata.length > 0)
          .map((b) => {
            const norm = normalizeBorehole(b)
            return {
              ...norm,
              dem_elevation: terrainElevAt ? terrainElevAt(b.longitude, b.latitude) : b.elevation,
            }
          })

        // [v4.2] 이상 심도 판정: 최대심도 > max(전체 중앙값×5, 100m)
        // 판정된 시추공은 워커에서 두께 제어점 제외 + 경고 모달/배지 표시
        const DEPTH_WARN_RATIO = 5
        const DEPTH_WARN_MIN_M = 100
        const depths = normalized.map((bb: any) =>
          (bb.strata || []).reduce((m: number, st: any) => Math.max(m, st.depth_bottom || 0), 0),
        )
        const sortedDepths = [...depths].sort((x, y) => x - y)
        const medianDepth = sortedDepths.length ? sortedDepths[Math.floor(sortedDepths.length / 2)] : 0
        const depthLimit = Math.max(medianDepth * DEPTH_WARN_RATIO, DEPTH_WARN_MIN_M)
        const flagged = normalized.map((bb: any, i: number) => ({
          ...bb,
          max_depth: depths[i],
          depth_warning: depths[i] > depthLimit,
        }))

        setBoreholes(flagged)
        setFetchStatus("done")
      })
      .catch((e) => {
        if (cancelled) return
        setFetchErr(e?.message ?? String(e))
        setFetchStatus("error")
      })

    return () => {
      cancelled = true
    }
  }, [bbox, polygon, boreholeIds, projectId, reloadKey])

  return {
    boreholes,
    fetchStatus,
    fetchErr,
  }
}

function normalizeBorehole(b: Borehole): Borehole {
  const strata = [...(b.strata || [])]
    .filter((s) => Number.isFinite(s.depth_top) && Number.isFinite(s.depth_bottom))
    .sort((a, b) => a.depth_top - b.depth_top)
    .map((s) => ({ ...s }))

  for (let i = 0; i < strata.length; i += 1) {
    const prevBottom = i > 0 ? strata[i - 1].depth_bottom : 0
    strata[i].depth_top = Math.max(strata[i].depth_top || 0, prevBottom)
    if (strata[i].depth_bottom <= strata[i].depth_top) {
      strata[i].depth_bottom = strata[i].depth_top + 0.1
    }
  }

  return {
    ...b,
    elevation: Number.isFinite(b.elevation) ? b.elevation : 0,
    strata,
  }
}

function isInsidePolygon(lng: number, lat: number, polygon: { lng: number; lat: number }[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng
    const yi = polygon[i].lat
    const xj = polygon[j].lng
    const yj = polygon[j].lat
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1) + xi
    if (intersects) inside = !inside
  }
  return inside
}
