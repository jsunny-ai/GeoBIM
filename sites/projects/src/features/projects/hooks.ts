import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { MOCK_PROJECTS } from "@/lib/mock"
import type { Project } from "@/lib/types"

async function fetchProjects(): Promise<Project[]> {
  try {
    const res = await api.get<Project[]>("/projects")
    return res.data
  } catch {
    // 백엔드 없을 때 mock 반환
    return MOCK_PROJECTS
  }
}

async function fetchProject(id: number): Promise<Project> {
  try {
    const res = await api.get<Project>(`/projects/${id}`)
    return res.data
  } catch {
    const found = MOCK_PROJECTS.find((p) => p.id === id)
    if (!found) throw new Error("프로젝트를 찾을 수 없습니다.")
    return found
  }
}

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: fetchProjects })
}

export function useProject(id: number) {
  return useQuery({
    queryKey: ["projects", id],
    queryFn: () => fetchProject(id),
    enabled: !!id,
  })
}
