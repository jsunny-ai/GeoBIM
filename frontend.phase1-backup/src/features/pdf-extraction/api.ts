import api from "@/lib/api"

// TODO(Phase 2): PDF 추출 관련 API 호출 구현

export async function uploadPdf(_projectId: string, _file: File): Promise<void> {
  // POST /api/v1/projects/{projectId}/pdf-extraction
  throw new Error("Not implemented")
}

export async function getExtractionJobs(_projectId: string): Promise<unknown[]> {
  // GET /api/v1/projects/{projectId}/pdf-extraction
  void api
  throw new Error("Not implemented")
}

export async function getTemplates(): Promise<unknown[]> {
  // GET /api/v1/templates
  throw new Error("Not implemented")
}
