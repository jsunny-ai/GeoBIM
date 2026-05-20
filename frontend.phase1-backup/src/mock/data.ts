export interface Project {
  id: string
  name: string
  borehole_count: number
  region: string
  updated_at: string
}

export interface Stratum {
  soil_type: string
  depth_top: number
  depth_bottom: number
}

export interface Borehole {
  id: string
  project_id: string
  longitude: number
  latitude: number
  elevation: number
  strata: Stratum[]
}

export const MOCK_PROJECTS: Project[] = [
  { id: "1", name: "수원시 권선구", borehole_count: 42, region: "경기도 수원시", updated_at: "2026-05-01" },
  { id: "2", name: "수원시 장안구", borehole_count: 38, region: "경기도 수원시", updated_at: "2026-04-28" },
  { id: "3", name: "수원시 팔달구", borehole_count: 31, region: "경기도 수원시", updated_at: "2026-04-20" },
]

export const MOCK_BOREHOLES: Borehole[] = [
  {
    id: "BH-1", project_id: "1",
    longitude: 126.9897, latitude: 37.2636, elevation: 25.3,
    strata: [
      { soil_type: "토사",   depth_top: 0.0,  depth_bottom: 2.0  },
      { soil_type: "풍화토", depth_top: 2.0,  depth_bottom: 5.5  },
      { soil_type: "풍화암", depth_top: 5.5,  depth_bottom: 9.0  },
      { soil_type: "연암",   depth_top: 9.0,  depth_bottom: 15.0 },
    ],
  },
  {
    id: "BH-2", project_id: "1",
    longitude: 126.9923, latitude: 37.2601, elevation: 22.1,
    strata: [
      { soil_type: "매립토", depth_top: 0.0,  depth_bottom: 1.5  },
      { soil_type: "토사",   depth_top: 1.5,  depth_bottom: 4.0  },
      { soil_type: "풍화암", depth_top: 4.0,  depth_bottom: 8.5  },
      { soil_type: "경암",   depth_top: 8.5,  depth_bottom: 20.0 },
    ],
  },
  {
    id: "BH-3", project_id: "1",
    longitude: 126.9856, latitude: 37.2589, elevation: 28.7,
    strata: [
      { soil_type: "토사",   depth_top: 0.0,  depth_bottom: 3.0  },
      { soil_type: "풍화토", depth_top: 3.0,  depth_bottom: 6.0  },
      { soil_type: "풍화암", depth_top: 6.0,  depth_bottom: 11.0 },
      { soil_type: "연암",   depth_top: 11.0, depth_bottom: 18.0 },
      { soil_type: "경암",   depth_top: 18.0, depth_bottom: 25.0 },
    ],
  },
  {
    id: "BH-4", project_id: "2",
    longitude: 127.0089, latitude: 37.2942, elevation: 31.2,
    strata: [
      { soil_type: "매립토", depth_top: 0.0,  depth_bottom: 2.5  },
      { soil_type: "풍화토", depth_top: 2.5,  depth_bottom: 7.0  },
      { soil_type: "풍화암", depth_top: 7.0,  depth_bottom: 12.0 },
      { soil_type: "경암",   depth_top: 12.0, depth_bottom: 22.0 },
    ],
  },
  {
    id: "BH-5", project_id: "2",
    longitude: 127.0112, latitude: 37.2915, elevation: 29.8,
    strata: [
      { soil_type: "토사",   depth_top: 0.0,  depth_bottom: 1.0  },
      { soil_type: "풍화암", depth_top: 1.0,  depth_bottom: 6.5  },
      { soil_type: "연암",   depth_top: 6.5,  depth_bottom: 14.0 },
      { soil_type: "경암",   depth_top: 14.0, depth_bottom: 28.0 },
    ],
  },
]
