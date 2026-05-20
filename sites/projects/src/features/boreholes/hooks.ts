import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { MOCK_BOREHOLES } from "@/lib/mock"
import type { Borehole, Stratum } from "@/lib/types"

async function fetchBoreholes(projectId: number): Promise<Borehole[]> {
  try {
    const res = await api.get<Borehole[]>(`/boreholes?project_id=${projectId}`)
    return res.data
  } catch {
    return MOCK_BOREHOLES[projectId] ?? []
  }
}

async function fetchBorehole(id: number): Promise<Borehole> {
  try {
    const res = await api.get<Borehole>(`/boreholes/${id}`)
    return res.data
  } catch {
    for (const list of Object.values(MOCK_BOREHOLES)) {
      const found = list.find((b) => b.id === id)
      if (found) return found
    }
    throw new Error("시추공을 찾을 수 없습니다.")
  }
}

export function useBoreholes(projectId: number) {
  return useQuery({
    queryKey: ["boreholes", projectId],
    queryFn: () => fetchBoreholes(projectId),
    enabled: !!projectId,
  })
}

export function useBorehole(id: number) {
  return useQuery({
    queryKey: ["borehole", id],
    queryFn: () => fetchBorehole(id),
    enabled: !!id,
  })
}

interface UpdateBoreholePayload {
  longitude?: number
  latitude?: number
  elevation?: number
  strata?: Omit<Stratum, "id">[]
}

export function useUpdateBorehole(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: UpdateBoreholePayload) => {
      const { strata, ...coords } = payload
      if (Object.keys(coords).length > 0) {
        await api.patch(`/boreholes/${id}`, coords)
      }
      if (strata !== undefined) {
        await api.put(`/boreholes/${id}/strata`, { strata })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["borehole", id] })
      qc.invalidateQueries({ queryKey: ["boreholes"] })
    },
  })
}
