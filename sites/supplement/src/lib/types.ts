// 3단계(supplement) 전용 타입 정의

export interface Stratum {
  id?: number
  order: number
  depth_top: number
  depth_bottom: number
  soil_type: string
  strata_group?: string
}

export interface Borehole {
  id: number
  project_id?: number
  name: string
  longitude: number
  latitude: number
  elevation: number | null
  strata: Stratum[]
  isNew?: boolean   // 신규 추가 시추공 플래그
}

// RBF 보간 결과 그리드
export interface RBFGrids {
  soil: number[][]
  weathered_rock: number[][]
  soft_rock: number[][]
  hard_rock: number[][]
  [key: string]: number[][]
}

// LandXML 내보내기 옵션
export type InterpolationMode = "merge" | "new_only"

export interface ExportOptions {
  mode: InterpolationMode
  layers: string[]
  gridRes: number
}

// URL 파라미터
export interface ParsedParams {
  bbox: [number, number, number, number] | null
  polygon: { lng: number; lat: number }[] | null
  projectId: number | null
  boreholeIds: number[]
  error: string | null
}
