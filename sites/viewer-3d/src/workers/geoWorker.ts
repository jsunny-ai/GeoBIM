// =============================================================================
// geoWorker.ts — 옵션 A: 두께 기반 2.5D 구조층서 모델 (2026-06-10 전면 개편)
//
// Leapfrog의 층서(deposit) 모델과 동등한 결과를 내기 위한 3원칙:
//   ① 정확보간: TPS RBF λ≈0 → 시추공 위치에서 실측 두께를 그대로 통과
//      지표면은 DEM 스무딩 후 Wendland 커널 '잔차 재스냅'(Snap to data 동등)
//   ② 층서 순서의 구조적 보장: 경계면 = 지표면 − Σ두께 (두께 ≥ 0)
//      → Math.max 클램프 체인 불필요, 역전·수직 절벽 원천 차단
//   ③ 부재 데이터의 적극 활용 — Leapfrog Vein 'Pinch out' 등가 구현:
//      Leapfrog는 층이 없는 시추공에 'outside' 구간을 만들고 벽면을 반전시켜
//      HW/FW가 교차(두께<0)하도록 강제한 뒤 교차 영역을 제거한다.
//      여기서는 부재공에 음수 더미 두께(−0.75×최근접 보유공 두께)를 부여해
//      두께장이 부재공에서 확실히 음수가 되도록 하고, max(T,0) 클램프로
//      보유공 주변 물방울(렌즈) 형성 후 부재공 '앞'에서 소멸시킨다.
// =============================================================================
import { buildElevationGrid, idwGrid } from "@/lib/terrain"
import { buildLayerSolidGeometryData, type VoxelCell } from "../lib/geoGeometry"

const LAYER_STACK = ["soil", "weathered_rock", "soft_rock", "normal_rock", "hard_rock", "unknown"] as const
const STRATA_KEYS = ["soil", "weathered_rock", "soft_rock", "normal_rock", "hard_rock"] as const
type StrataKey = (typeof STRATA_KEYS)[number]

type GridPoint = { x: number; y: number; z: number }

const M_PER_DEG_LAT = 110540
const mPerDegLng = (cosLat: number) => 111320 * cosLat

// ── Thin Plate Spline 커널 ───────────────────────────────────────────────────
function thinPlateKernel(r: number) {
  if (r <= 1e-9) return 0
  return r * r * Math.log(r)
}

// ── Wendland C2 컴팩트 서포트 커널 (잔차 재스냅용) ──────────────────────────
function wendlandC2(r: number, R: number) {
  if (r >= R) return 0
  const q = r / R
  const t = 1 - q
  return t * t * t * t * (4 * q + 1)
}

function solveLinearSystem(matrix: number[][], rhs: number[]) {
  const n = rhs.length
  const a = matrix.map((row, i) => [...row, rhs[i]])

  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
    }
    if (Math.abs(a[pivot][col]) < 1e-10) return null
    if (pivot !== col) {
      const tmp = a[col]
      a[col] = a[pivot]
      a[pivot] = tmp
    }

    const div = a[col][col]
    for (let c = col; c <= n; c++) a[col][c] /= div

    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = a[r][col]
      if (Math.abs(factor) < 1e-14) continue
      for (let c = col; c <= n; c++) a[r][c] -= factor * a[col][c]
    }
  }

  return a.map((row) => row[n])
}

// ── TPS RBF 격자 보간 ───────────────────────────────────────────────────────
// lambda=1e-8: 수치 안정용 미세 릿지(사실상 정확보간).
// 기존 λ=0.02(평활 스플라인)는 시추공 값 이탈의 원인이므로 사용하지 않는다.
function rbfGrid(points: GridPoint[], gx: number[], gy: number[], powerFallback = 1, lambda = 1e-8): number[][] {
  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))
  if (valid.length < 3) return idwGrid(valid, gx, gy, powerFallback)

  const midLat = valid.reduce((sum, p) => sum + p.y, 0) / valid.length
  const cosLat = Math.cos((midLat * Math.PI) / 180)
  const mx = valid.reduce((sum, p) => sum + p.x * mPerDegLng(cosLat), 0) / valid.length
  const my = valid.reduce((sum, p) => sum + p.y * M_PER_DEG_LAT, 0) / valid.length
  const xy = valid.map((p) => ({
    x: p.x * mPerDegLng(cosLat) - mx,
    y: p.y * M_PER_DEG_LAT - my,
    z: p.z,
  }))

  let meanDist = 0
  let pairCount = 0
  for (let i = 0; i < xy.length; i++) {
    for (let j = i + 1; j < xy.length; j++) {
      meanDist += Math.hypot(xy[i].x - xy[j].x, xy[i].y - xy[j].y)
      pairCount++
    }
  }
  const scale = pairCount > 0 ? Math.max(meanDist / pairCount, 1) : 1
  const normalized = xy.map((p) => ({ x: p.x / scale, y: p.y / scale, z: p.z }))

  const n = normalized.length
  const size = n + 3
  const matrix = Array.from({ length: size }, () => Array(size).fill(0))
  const rhs = Array(size).fill(0)

  for (let i = 0; i < n; i++) {
    rhs[i] = normalized[i].z
    for (let j = 0; j < n; j++) {
      const r = Math.hypot(normalized[i].x - normalized[j].x, normalized[i].y - normalized[j].y)
      matrix[i][j] = thinPlateKernel(r)
    }
    matrix[i][i] += lambda
    matrix[i][n] = 1
    matrix[i][n + 1] = normalized[i].x
    matrix[i][n + 2] = normalized[i].y
    matrix[n][i] = 1
    matrix[n + 1][i] = normalized[i].x
    matrix[n + 2][i] = normalized[i].y
  }

  const solution = solveLinearSystem(matrix, rhs)
  if (!solution) return idwGrid(valid, gx, gy, powerFallback)

  const out: number[][] = []
  for (let j = 0; j < gy.length; j++) {
    const row: number[] = []
    for (let i = 0; i < gx.length; i++) {
      const x = (gx[i] * mPerDegLng(cosLat) - mx) / scale
      const y = (gy[j] * M_PER_DEG_LAT - my) / scale
      let value = solution[n] + solution[n + 1] * x + solution[n + 2] * y
      for (let p = 0; p < n; p++) {
        value += solution[p] * thinPlateKernel(Math.hypot(x - normalized[p].x, y - normalized[p].y))
      }
      row.push(value)
    }
    out.push(row)
  }
  return out
}

// ── 격자 쌍선형 샘플링 ──────────────────────────────────────────────────────
function sampleGridBilinear(grid: number[][], gx: number[], gy: number[], x: number, y: number) {
  const nx = gx.length, ny = gy.length
  const fx = ((x - gx[0]) / (gx[nx - 1] - gx[0])) * (nx - 1)
  const fy = ((y - gy[0]) / (gy[ny - 1] - gy[0])) * (ny - 1)
  const i0 = Math.max(0, Math.min(nx - 2, Math.floor(fx)))
  const j0 = Math.max(0, Math.min(ny - 2, Math.floor(fy)))
  const tx = Math.max(0, Math.min(1, fx - i0))
  const ty = Math.max(0, Math.min(1, fy - j0))
  const v00 = grid[j0][i0], v10 = grid[j0][i0 + 1]
  const v01 = grid[j0 + 1][i0], v11 = grid[j0 + 1][i0 + 1]
  return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty
}

// ── 잔차 재스냅 (Leapfrog 'Snap to data' 동등) ──────────────────────────────
// 스무딩으로 이탈한 격자를 제어점 목표값에 정확히 통과하도록 국소 보정.
// Wendland 커널은 radiusM 밖에서 0이므로 DEM의 전체 형상은 보존된다.
function snapGridToPoints(
  grid: number[][],
  gx: number[],
  gy: number[],
  targets: GridPoint[],
  radiusM: number,
): number[][] {
  const n = targets.length
  if (n === 0) return grid

  const midLat = (gy[0] + gy[gy.length - 1]) / 2
  const cosLat = Math.cos((midLat * Math.PI) / 180)
  const toMX = (lng: number) => lng * mPerDegLng(cosLat)
  const toMY = (lat: number) => lat * M_PER_DEG_LAT

  // 목표값 − 현재 격자값 = 잔차
  const residuals = targets.map((t) => t.z - sampleGridBilinear(grid, gx, gy, t.x, t.y))

  // Wendland 커널 행렬(SPD) 해 → 정확 통과 보장 (서포트 중첩도 자동 처리)
  const A = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const d = Math.hypot(toMX(targets[i].x) - toMX(targets[j].x), toMY(targets[i].y) - toMY(targets[j].y))
      return wendlandC2(d, radiusM) + (i === j ? 1e-9 : 0)
    }),
  )
  const w = solveLinearSystem(A, residuals)
  if (!w) return grid

  return grid.map((row, j) =>
    row.map((v, i) => {
      let s = v
      for (let p = 0; p < n; p++) {
        const d = Math.hypot(toMX(gx[i]) - toMX(targets[p].x), toMY(gy[j]) - toMY(targets[p].y))
        if (d < radiusM) s += w[p] * wendlandC2(d, radiusM)
      }
      return s
    }),
  )
}

self.onmessage = async (e: MessageEvent) => {
  const { boreholes, bbox, N, depthBelowMSL, mScale, boxW, boxD } = e.data as {
    boreholes: any[]
    bbox: [number, number, number, number]
    N: number
    depthBelowMSL: number
    mScale: number
    boxW: number
    boxD: number
    renderMode: "smooth" | "voxel"
  }

  try {
    // ── 0. 공통 파라미터 ─────────────────────────────────────────────────
    const NX = N
    const [minLng, minLat, maxLng, maxLat] = bbox
    const midLat = (minLat + maxLat) / 2
    const cosLat = Math.cos((midLat * Math.PI) / 180)
    const lngWidthM = (maxLng - minLng) * mPerDegLng(cosLat)
    const latWidthM = (maxLat - minLat) * M_PER_DEG_LAT
    const confRadiusM = Math.max(150, Math.min(400, Math.min(lngWidthM, latWidthM) * 0.5))

    // ── 1. 지표면 고도 격자 ───────────────────────────────────────────────
    ;(self as any).postMessage({ type: "progress", step: "지표면(AWS Terrain) 계산 중..." })
    const terr = await buildElevationGrid(bbox, N)

    let elevGrid = terr.elevGrid
    const pts = boreholes
      .map((b) => ({ x: b.longitude, y: b.latitude, z: b.elevation }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && p.z < 2000 && p.z > -200)

    // 시추공 평균 간격 (제어 반경 산출용)
    const avgSpacing = pts.length > 1
      ? Math.sqrt((lngWidthM * latWidthM) / pts.length)
      : Math.max(lngWidthM, latWidthM) * 0.5

    let snapTargets: GridPoint[] = []
    if (pts.length >= 1) {
      // ── 지표면 표고 보정: 잔차 IDW(power=1) + Gaussian 스무딩 + 잔차 재스냅 ──
      // V-World DEM의 자연 경사·형상은 보존하면서 시추공 실측 표고를 '정확히' 통과
      //
      //   1) 잔차 = 시추공 표고 − DEM 표고 → IDW 보간 + 스무딩 (광역 오프셋 보정)
      //   2) 스무딩으로 생긴 시추공 위치 이탈을 Wendland 재스냅으로 제거
      //      → 부드러움(②요구)과 실측 일치(①요구)를 동시에 만족

      // 표고 오류 시추공 필터링: 잔차 중앙값 기준 ±15m 초과 시 제외
      const rawResiduals = pts.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z - terr.terrainElevAt(p.x, p.y),
      }))
      const sortedRes = rawResiduals.map((r) => r.z).sort((a, b) => a - b)
      const medianRes = sortedRes[Math.floor(sortedRes.length / 2)]
      const inlierIdx = rawResiduals.map((r, i) => (Math.abs(r.z - medianRes) < 15 ? i : -1)).filter((i) => i >= 0)
      const residuals = inlierIdx.map((i) => rawResiduals[i])
      snapTargets = inlierIdx.map((i) => pts[i]) // 재스냅 목표 = 필터 통과 시추공의 실측 표고

      // IDW power=1 (부드러운 감쇄)
      let resGrid = idwGrid(residuals, terr.gx, terr.gy, 1)

      // Gaussian 스무딩 4패스 (X→Y 교대, 경계 클램프)
      const Ny = resGrid.length, Nx = resGrid[0].length
      for (let pass = 0; pass < 4; pass++) {
        resGrid = resGrid.map((row, j) =>
          row.map((_, i) => {
            const l = i > 0 ? resGrid[j][i - 1] : resGrid[j][i]
            const r = i < Nx - 1 ? resGrid[j][i + 1] : resGrid[j][i]
            return (l + resGrid[j][i] + r) / 3
          })
        )
        resGrid = resGrid.map((_, j) =>
          Array.from({ length: Nx }, (__: unknown, i: number) => {
            const u = j > 0 ? resGrid[j - 1][i] : resGrid[j][i]
            const d = j < Ny - 1 ? resGrid[j + 1][i] : resGrid[j][i]
            return (u + resGrid[j][i] + d) / 3
          })
        )
      }

      elevGrid = terr.elevGrid.map((row: number[], j: number) =>
        row.map((v: number, i: number) => v + resGrid[j][i])
      )

      // [핵심] 잔차 재스냅: 스무딩 후에도 시추공 표고를 정확히 통과
      // 스냅 반경 = 평균 시추공 간격 × 1.5: 좁은 반경이 만들던 국소 혹(둔덕) 완화
      const snapRadiusM = Math.max(80, Math.min(avgSpacing * 1.5, confRadiusM))
      elevGrid = snapGridToPoints(elevGrid, terr.gx, terr.gy, snapTargets, snapRadiusM)
    }

    // ── 2. 수직 복셀 파라미터 ─────────────────────────────────────────────
    let gTop = -Infinity
    for (const row of elevGrid) for (const v of row) if (v > gTop) gTop = v
    const yBotM = -depthBelowMSL
    const vRange = Math.max(gTop - yBotM, 1)
    const MZ = Math.max(16, Math.min(96, Math.round(vRange / 1.2)))
    const dz = vRange / (MZ - 1)
    const idx3 = (i: number, j: number, l: number) => (l * NX + j) * NX + i
    const label = new Int8Array(NX * NX * MZ)

    // ── 3. 층별 '두께' 제어점 구성 (핀치아웃 처리 핵심) ──────────────────
    ;(self as any).postMessage({ type: "progress", step: "지층 두께 분석 및 2D 보간 중..." })

    const rank: Record<string, number> = {
      soil: 0, weathered_rock: 1, soft_rock: 2, normal_rock: 3, hard_rock: 4, unknown: 5,
    }
    const profiles = boreholes
      .filter((b) => Number.isFinite(b.longitude) && Number.isFinite(b.latitude) && Number.isFinite(b.elevation))
      .map((b) => {
        const segs = (b.strata || [])
          .filter((s: any) => Number.isFinite(s.depth_top) && Number.isFinite(s.depth_bottom) && s.depth_bottom > s.depth_top)
          .map((s: any) => ({
            from: s.depth_top,
            to: s.depth_bottom,
            type: rank[s.strata_group] !== undefined ? s.strata_group : "unknown",
          }))
          .sort((a: any, b: any) => a.from - b.from)

        // 층별 실측 두께 합산 (협재층도 두께로 병합)
        const thick: Record<StrataKey, number> = {
          soil: 0, weathered_rock: 0, soft_rock: 0, normal_rock: 0, hard_rock: 0,
        }
        let deepestRank = -1
        for (const seg of segs) {
          if (seg.type === "unknown") continue
          thick[seg.type as StrataKey] += seg.to - seg.from
          deepestRank = Math.max(deepestRank, rank[seg.type])
        }
        return { x: b.longitude, y: b.latitude, elev: b.elevation, thick, deepestRank, segs }
      })
      .filter((p) => p.segs.length > 0 && p.deepestRank >= 0)

    // 제어점 규칙 — Leapfrog Vein 'Pinch out' 방식 (outside interval 등가):
    //   Leapfrog: 층이 없는 시추공에 'outside' 구간 생성 → 벽면 반전(flip)
    //   → HW/FW 교차(두께<0) → 교차 영역 불리언 제거 = 핀치아웃
    //   (help.seequent.com > Geo > Veins > Pinch Outs)
    //   2.5D 두께장 등가:
    //    · 층 보유 시추공 → 실측 두께 +t (정확보간 → 주상도와 일치)
    //    · 층 부재 시추공 → 음수 더미 −PINCH_STRENGTH × (최근접 보유공 두께)
    //      → 0-등고선(소멸 경계)이 보유공·부재공 '사이'에 형성되어
    //        물방울(렌즈) 경계 보장 + 부재공 너머 리바운드 차단
    //    · max(T,0) 클램프 = Leapfrog의 벽면 교차 영역 제거와 등가
    const PINCH_STRENGTH = 0.75
    const thickPts: Record<StrataKey, GridPoint[]> = {
      soil: [], weathered_rock: [], soft_rock: [], normal_rock: [], hard_rock: [],
    }
    for (const key of STRATA_KEYS) {
      const present = profiles.filter((p) => p.thick[key] > 0)
      if (present.length === 0) continue // 어떤 시추공에도 없는 층 → 두께장 생성 안 함
      for (const p of profiles) {
        const t = p.thick[key]
        if (t > 0) {
          thickPts[key].push({ x: p.x, y: p.y, z: t })
        } else {
          // 벽면 반전 등가: 최근접 보유공 두께 기준 음수 더미
          let bestD2 = Infinity
          let refT = 0
          for (const q of present) {
            const dx = (p.x - q.x) * mPerDegLng(cosLat)
            const dy = (p.y - q.y) * M_PER_DEG_LAT
            const d2 = dx * dx + dy * dy
            if (d2 < bestD2) { bestD2 = d2; refT = q.thick[key] }
          }
          thickPts[key].push({ x: p.x, y: p.y, z: -PINCH_STRENGTH * refT })
        }
      }
    }

    const gx = terr.gx
    const gy = terr.gy

    // ── 두께 격자 보간: TPS 정확보간 → [0, 관측최대×2] 클램프 ──────────────
    //  · 음수 클램프  = 핀치아웃 (보유공 주변 물방울 형태 → 부재공 부근 소멸)
    //  · 상한 클램프  = 외삽 폭주 방지 (시추공 영역 밖 TPS 발산 가드)
    //  · 후처리 스무딩 없음: TPS 자체가 C¹ 연속(최소 굽힘 에너지)이라 불필요.
    //    기존 Gaussian 4패스가 시추공 값 이탈의 주범이었음
    const buildThicknessGrid = (points: GridPoint[]): number[][] => {
      if (points.length === 0 || points.every((p) => p.z <= 0)) {
        return Array.from({ length: NX }, () => Array(NX).fill(0))
      }
      const raw = rbfGrid(points, gx, gy, 1)
      const tMax = points.reduce((m, p) => Math.max(m, p.z), 0)
      const cap = tMax * 2
      return raw.map((row) => row.map((v) => Math.max(0, Math.min(v, cap))))
    }

    const thickGrids: Record<StrataKey, number[][]> = {
      soil: buildThicknessGrid(thickPts.soil),
      weathered_rock: buildThicknessGrid(thickPts.weathered_rock),
      soft_rock: buildThicknessGrid(thickPts.soft_rock),
      normal_rock: buildThicknessGrid(thickPts.normal_rock),
      hard_rock: buildThicknessGrid(thickPts.hard_rock),
    }

    // ── 4. 격자별 지층 경계 절대 고도 = 지표면 − Σ두께 ──────────────────
    // 두께 ≥ 0이 구조적으로 보장되므로 층 역전·수직 절벽이 발생할 수 없음
    ;(self as any).postMessage({ type: "progress", step: "지층 경계면 고도 격자 계산 중..." })

    const soilBottomGrid      = Array.from({ length: NX }, () => Array(NX).fill(0))
    const weatheredBottomGrid = Array.from({ length: NX }, () => Array(NX).fill(0))
    const softBottomGrid      = Array.from({ length: NX }, () => Array(NX).fill(0))
    const normalBottomGrid    = Array.from({ length: NX }, () => Array(NX).fill(0))
    const hardBottomGrid      = Array.from({ length: NX }, () => Array(NX).fill(0))
    const boreholeBottomGrid  = Array.from({ length: NX }, () => Array(NX).fill(0))

    for (let j = 0; j < NX; j++) {
      for (let i = 0; i < NX; i++) {
        const surfElev = elevGrid[j][i]

        const soilB      = surfElev - thickGrids.soil[j][i]
        const weatheredB = soilB - thickGrids.weathered_rock[j][i]
        const softB      = weatheredB - thickGrids.soft_rock[j][i]
        const normalB    = softB - thickGrids.normal_rock[j][i]
        const hardB      = normalB - thickGrids.hard_rock[j][i]
        const boreholeB  = hardB

        soilBottomGrid[j][i]      = soilB
        weatheredBottomGrid[j][i] = weatheredB
        softBottomGrid[j][i]      = softB
        normalBottomGrid[j][i]    = normalB
        hardBottomGrid[j][i]      = hardB
        boreholeBottomGrid[j][i]  = boreholeB

        // 복셀 라벨 배열
        for (let l = 0; l < MZ; l++) {
          const elev = yBotM + dz * l
          const index = idx3(i, j, l)
          if      (elev > surfElev)   label[index] = 0 // air
          else if (elev > soilB)      label[index] = 1 // soil
          else if (elev > weatheredB) label[index] = 2 // weathered_rock
          else if (elev > softB)      label[index] = 3 // soft_rock
          else if (elev > normalB)    label[index] = 4 // normal_rock
          else if (elev > hardB)      label[index] = 5 // hard_rock
          else                        label[index] = 6 // unknown
        }
      }
    }

    // ── 5. 스무드 모드: 수밀 솔리드 지층 메쉬 빌드 ────────────────────────
    // 두께 0 영역은 top==bottom 퇴화 → buildLayerSolidGeometryData가
    // 두께 임계(0.001m) 미만 셀의 인덱스를 생략하므로 렌즈 가장자리가 자연 소멸
    ;(self as any).postMessage({ type: "progress", step: "수밀 지층 메쉬 생성 중..." })
    const smoothMeshData: Record<string, { positions: Float32Array; indices: Uint32Array }> = {}

    const flatBottomGrid = Array.from({ length: NX }, () => Array(NX).fill(yBotM))

    const layerPairs: [string, number[][], number[][]][] = [
      ["soil",           elevGrid,            soilBottomGrid],
      ["weathered_rock", soilBottomGrid,      weatheredBottomGrid],
      ["soft_rock",      weatheredBottomGrid, softBottomGrid],
      ["normal_rock",    softBottomGrid,      normalBottomGrid],
      ["hard_rock",      normalBottomGrid,    hardBottomGrid],
      ["unknown",        boreholeBottomGrid,  flatBottomGrid],
    ]
    for (const [name, topGrid, bottomGrid] of layerPairs) {
      const mesh = buildLayerSolidGeometryData(topGrid, bottomGrid, boxW, boxD, mScale)
      smoothMeshData[name] = {
        positions: new Float32Array(mesh.positions),
        indices: new Uint32Array(mesh.indices),
      }
    }

    // ── 6. 복셀 셀 (voxel 모드 — RLE 압축) ───────────────────────────────
    const cellW = boxW / (NX - 1)
    const cellD = boxD / (NX - 1)
    const voxelCells: Record<string, VoxelCell[]> = {
      soil: [], weathered_rock: [], soft_rock: [], normal_rock: [], hard_rock: [], unknown: [],
    }
    for (let j = 0; j < NX; j++) {
      for (let i = 0; i < NX; i++) {
        const cx = -boxW / 2 + (boxW * i) / (NX - 1)
        const cz = boxD / 2 - (boxD * j) / (NX - 1)
        let l = 0
        while (l < MZ) {
          const code = label[idx3(i, j, l)]
          if (code === 0) { l++; continue }
          let l2 = l
          while (l2 < MZ && label[idx3(i, j, l2)] === code) l2++
          voxelCells[LAYER_STACK[code - 1]].push({
            x0: cx - cellW / 2, x1: cx + cellW / 2,
            z0: cz - cellD / 2, z1: cz + cellD / 2,
            yBot: (yBotM + dz * (l - 0.5)) * mScale,
            yTop: (yBotM + dz * (l2 - 0.5)) * mScale,
          })
          l = l2
        }
      }
    }

    const transferBuffers: ArrayBuffer[] = []
    for (const type of Object.keys(smoothMeshData)) {
      transferBuffers.push(smoothMeshData[type].positions.buffer as ArrayBuffer)
      transferBuffers.push(smoothMeshData[type].indices.buffer as ArrayBuffer)
    }

    ;(self as any).postMessage(
      {
        type: "done",
        elevGrid,
        smoothMeshData,
        voxelCells,
        dz, yBotM, gTop, MZ, confRadiusM, lngWidthM, latWidthM,
      },
      transferBuffers,
    )
  } catch (err: any) {
    ;(self as any).postMessage({ type: "error", error: err?.message || String(err) })
  }
}
