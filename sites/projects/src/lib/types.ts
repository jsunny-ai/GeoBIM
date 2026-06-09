export interface Stratum {
  id: number
  order: number
  depth_top: number
  depth_bottom: number
  soil_type: string
  raw_text?: string
}

export interface Borehole {
  id: number
  project_id: number
  name: string
  longitude: number
  latitude: number
  elevation: number | null
  strata: Stratum[]
  is_supplementary: boolean   // false=원본 기존, true=신규 보완
  source_file?: string | null
  data_status?: "original" | "supplementary" | "modified_draft" | "modified_pending_review" | "modified_approved" | string
  source_borehole_id?: number | null
  override_id?: number | null
}

export interface Project {
  id: number
  name: string
  description: string | null
  region: string | null
  source_crs: string | null
  bbox?: {
    bbox?: number[]
    polygon?: Array<{ lng: number; lat: number }>
    borehole_ids?: number[]
  } | null
  borehole_count: number
  created_at: string
}
