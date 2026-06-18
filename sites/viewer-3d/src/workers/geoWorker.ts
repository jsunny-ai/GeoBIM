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
import { createLocalProjection } from "@/lib/projection"

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
    const projection = createLocalProjection(bbox, boxW)
    const midLat = (minLat + maxLat) / 2
    const cosLat = Math.cos((midLat * Math.PI) / 180)
    const lngWidthM = projection.widthM
    const latWidthM = projection.heightM
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
    const label = new Int8Array(NX * NX * MZ)    // 미분류 유지 모드
    const labelExt = new Int8Array(NX * NX * MZ) // 연장 모드 (v4)

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
        return {
          x: b.longitude, y: b.latitude, elev: b.elevation, thick, deepestRank, segs,
          warn: Boolean(b.depth_warning), // [v4.2] 이상 심도 의심 (클라이언트 판정)
        }
      })
      .filter((p) => p.segs.length > 0 && p.deepestRank >= 0)

    // [v4.2] 이상 심도 시추공은 두께·연장 제어점에서 제외 (검토 전 안전장치).
    // 표고(지표면 보정)에는 계속 사용한다. PDF 대조로 수정·저장되면 자동 복귀.
    const okProfiles = profiles.filter((p) => !p.warn)
    const skippedDeep = profiles.length - okProfiles.length
    const EXT_EPS = 0.001
    const isContinuousLayer = (key: StrataKey) =>
      okProfiles.length > 0 && okProfiles.every((p) => p.thick[key] > EXT_EPS)

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
      const present = okProfiles.filter((p) => p.thick[key] > 0)
      if (present.length === 0) continue // 어떤 시추공에도 없는 층 → 두께장 생성 안 함
      for (const p of okProfiles) {
        const t = p.thick[key]
        if (t > 0) {
          thickPts[key].push({ x: p.x, y: p.y, z: t })
        } else {
          // 벽면 반전 등가: 최근접 보유공 두께 기준 음수 더미
          let bestD2 = Infinity
          let refT = 0
          for (const q of present) {
            const d = projection.distanceMeters({ lng: p.x, lat: p.y }, { lng: q.x, lat: q.y })
            const d2 = d * d
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
    // raw(클램프 전, 외곽 음수) 함께 반환: 메쉬 경계의 서브셀 등고선 보간용
    const buildThicknessGrid = (points: GridPoint[], continuous = false): { grid: number[][]; raw: number[][] } => {
      if (points.length === 0 || points.every((p) => p.z <= 0)) {
        return {
          grid: Array.from({ length: NX }, () => Array(NX).fill(0)),
          raw: Array.from({ length: NX }, () => Array(NX).fill(-1)),
        }
      }
      const raw = rbfGrid(points, gx, gy, 1)
      const floorGrid = continuous ? idwGrid(points.filter((p) => p.z > 0), gx, gy, 1) : null
      const tMax = points.reduce((m, p) => Math.max(m, p.z), 0)
      const minPositive = points.reduce((m, p) => p.z > 0 ? Math.min(m, p.z) : m, Infinity)
      const minContinuousThickness = continuous
        ? Math.max(EXT_EPS * 10, Number.isFinite(minPositive) ? minPositive * 0.1 : EXT_EPS * 10)
        : 0
      const cap = tMax * 2
      return {
        grid: raw.map((row, j) => row.map((v, i) => {
          const interpolatedFloor = floorGrid ? floorGrid[j][i] * 0.1 : minContinuousThickness
          const lower = Math.max(minContinuousThickness, interpolatedFloor)
          return Math.max(continuous ? lower : 0, Math.min(v, cap))
        })),
        raw,
      }
    }

    const thickRes = {
      soil: buildThicknessGrid(thickPts.soil, isContinuousLayer("soil")),
      weathered_rock: buildThicknessGrid(thickPts.weathered_rock, isContinuousLayer("weathered_rock")),
      soft_rock: buildThicknessGrid(thickPts.soft_rock, isContinuousLayer("soft_rock")),
      normal_rock: buildThicknessGrid(thickPts.normal_rock, isContinuousLayer("normal_rock")),
      hard_rock: buildThicknessGrid(thickPts.hard_rock, isContinuousLayer("hard_rock")),
    }
    const thickGrids: Record<StrataKey, number[][]> = {
      soil: thickRes.soil.grid, weathered_rock: thickRes.weathered_rock.grid,
      soft_rock: thickRes.soft_rock.grid, normal_rock: thickRes.normal_rock.grid,
      hard_rock: thickRes.hard_rock.grid,
    }
    const rawThick: Record<StrataKey, number[][]> = {
      soil: thickRes.soil.raw, weathered_rock: thickRes.weathered_rock.raw,
      soft_rock: thickRes.soft_rock.raw, normal_rock: thickRes.normal_rock.raw,
      hard_rock: thickRes.hard_rock.raw,
    }

    // ── 3b. [v4] 연장 두께장 E_k — 기존 기법의 재귀 적용 (구현계획서 §2.2) ──
    // Leapfrog Background lithology: 최심부는 최심 관측 지층이 모델 바닥까지
    // 채운다. 이를 시추공 지점 단위 제어점으로 표현:
    //   · 최심 관측층이 k인 시추공 → E_k = max(0, 층 k 하단 고도 − 모델 바닥)
    //   · 그 외 시추공            → 음수 더미 −EXT_PINCH × 최근접 양수 E_k
    //     (더 깊은 층이 관측된 영역으로 연장이 침범하지 않도록 차단 — 핀치아웃과 동일)
    // 보간·클램프는 관측 두께와 완전히 동일 (TPS λ≈0 + buildThicknessGrid)
    //
    // EXT_PINCH = 0.3 (관측 두께의 0.75보다 약하게): 연장 깊이(G, 수십 m)는
    // 관측 두께(수 m)보다 한 자릿수 크므로, 같은 강도의 음수 더미는 전이폭을
    // 과도하게 좁혀 급경사(≈18 m/m)를 만든다. 0.3으로 완화 시 E장들이 넓게
    // 겹치며 비례 분배가 점진 전환 → 최대 경사 2.8 m/m (수치 실험 tune.mjs)
    const EXT_PINCH = 0.3
    const extAnchors = okProfiles.map((pr) => {
      let cum = 0
      for (let k = 0; k <= pr.deepestRank; k++) cum += pr.thick[STRATA_KEYS[k]]
      return { x: pr.x, y: pr.y, deepest: pr.deepestRank, e: Math.max(0, pr.elev - cum - yBotM) }
    })
    // [옵션 B] 배경 외삽 앵커에서 '암반 미도달 얕은공' 제외.
    // 토사·풍화암(rank<2)에서 멈춘 공은 단지 깊이 안 뚫었을 뿐 그 아래 암반이
    // 있을 가능성이 크다. 이를 배경 앵커로 쓰면 '풍화암이 바닥까지' 가정이
    // 빈 영역으로 외삽돼 상단층이 풍선처럼 부풀고 수직 절벽을 만든다.
    // 따라서 암반(연암 이상) 도달공만 배경을 정의하게 한다. 단, 암반 도달공이
    // 하나도 없으면(전 부지 천층) 정보 손실을 막기 위해 기존 동작으로 폴백.
    const ROCK_RANK = 2 // soft_rock 이상 = 암반
    const anyRockReached = extAnchors.some((q) => q.deepest >= ROCK_RANK)
    const extEligible = (q: { deepest: number; e: number }) =>
      q.e > 0 && (!anyRockReached || q.deepest >= ROCK_RANK)
    // [배경암상] 전역 배경암 rank = 관측된 가장 깊은 암반층(연암 이상).
    // 암반 미관측 부지면 전역 최심 관측층으로 폴백.
    let bgRank = -1
    for (const q of extAnchors) if (q.deepest >= ROCK_RANK) bgRank = Math.max(bgRank, q.deepest)
    if (bgRank < 0) for (const q of extAnchors) bgRank = Math.max(bgRank, q.deepest)
    if (bgRank < 0) bgRank = 4
    // [진단] 시추공 최심 관측층 분포 + 옵션 B로 배경에서 제외된 공 수
    const diagBhByDeepest = [0, 0, 0, 0, 0]
    for (const q of extAnchors) if (q.deepest >= 0 && q.deepest < 5) diagBhByDeepest[q.deepest]++
    const diagExtExcluded = anyRockReached
      ? extAnchors.filter((q) => q.deepest >= 0 && q.deepest < ROCK_RANK).length
      : 0
    const extPts: Record<StrataKey, GridPoint[]> = {
      soil: [], weathered_rock: [], soft_rock: [], normal_rock: [], hard_rock: [],
    }
    for (let k = 0; k < STRATA_KEYS.length; k++) {
      const key = STRATA_KEYS[k]
      const present = extAnchors.filter((q) => q.deepest === k && extEligible(q))
      if (present.length === 0) continue
      for (const q of extAnchors) {
        if (q.deepest === k && extEligible(q)) {
          extPts[key].push({ x: q.x, y: q.y, z: q.e })
        } else {
          let bestD2 = Infinity
          let refE = 0
          for (const r of present) {
            const d = projection.distanceMeters({ lng: q.x, lat: q.y }, { lng: r.x, lat: r.y })
            const d2 = d * d
            if (d2 < bestD2) { bestD2 = d2; refE = r.e }
          }
          extPts[key].push({ x: q.x, y: q.y, z: -EXT_PINCH * refE })
        }
      }
    }
    const extRes = {
      soil: buildThicknessGrid(extPts.soil),
      weathered_rock: buildThicknessGrid(extPts.weathered_rock),
      soft_rock: buildThicknessGrid(extPts.soft_rock),
      normal_rock: buildThicknessGrid(extPts.normal_rock),
      hard_rock: buildThicknessGrid(extPts.hard_rock),
    }
    const extGrids: Record<StrataKey, number[][]> = {
      soil: extRes.soil.grid, weathered_rock: extRes.weathered_rock.grid,
      soft_rock: extRes.soft_rock.grid, normal_rock: extRes.normal_rock.grid,
      hard_rock: extRes.hard_rock.grid,
    }
    // 연장 모드 메쉬의 경계 보간용 signed장: 관측 + 연장 원시장의 합
    // (τ = t + fill 의 소멸 경계와 부호 전환 위치가 일치)
    const signedExt: Record<StrataKey, number[][]> = {} as any
    for (const key of STRATA_KEYS) {
      signedExt[key] = Array.from({ length: NX }, (_, j) =>
        Array.from({ length: NX }, (__, i) => rawThick[key][j][i] + extRes[key].raw[j][i]),
      )
    }

    // ── 4. 격자별 지층 경계 절대 고도 — 두 모드 동시 계산 (v4) ──────────
    // 두께 ≥ 0이 구조적으로 보장되므로 층 역전·수직 절벽이 발생할 수 없음
    //   · 미분류 유지 모드: 경계면 = 지표면 − Σt, 시추 한계선 아래 = unknown
    //   · 연장 모드: 유효 두께 τ = t + fill. fill = 잔여 깊이 G(시추 한계면 −
    //     모델 바닥)를 연장 가중치 E_k 비례 분배 → Σfill = G 로 최하 경계가
    //     정확히 모델 바닥(워터타이트). 모든 장이 연속 함수라 절벽 불가,
    //     최심층 전이부는 교차 테이퍼(인터핑거링)로 이어짐 (구현계획서 §2.3)
    ;(self as any).postMessage({ type: "progress", step: "지층 경계면 고도 격자 계산 중..." })

    const mkGrid = () => Array.from({ length: NX }, () => Array(NX).fill(0))
    const soilBottomGrid = mkGrid(), weatheredBottomGrid = mkGrid(), softBottomGrid = mkGrid()
    const normalBottomGrid = mkGrid(), hardBottomGrid = mkGrid(), boreholeBottomGrid = mkGrid()
    const soilBottomExt = mkGrid(), weatheredBottomExt = mkGrid(), softBottomExt = mkGrid()
    const normalBottomExt = mkGrid(), hardBottomExt = mkGrid()
    const rawGGrid = mkGrid() // 미분류 두께(클램프 전) — wedge 경계 보간용

    // [진단] 연장 모드 거동 추적용 누적기
    let diagSumWZero = 0                       // sumW≈0(폴백 발동) 셀 수
    const diagBottomFill = [0, 0, 0, 0, 0]     // 모델 바닥을 점유한 지층 분포(τ>0 최하층)

    for (let j = 0; j < NX; j++) {
      for (let i = 0; i < NX; i++) {
        const surfElev = elevGrid[j][i]
        const tArr = STRATA_KEYS.map((key) => thickGrids[key][j][i])

        // ── 미분류 유지 모드 경계면 ──
        // [v4.2] 모델 바닥(yBot) 클램프: 두께 합이 슬리브 깊이를 초과해도
        // 경계면이 바닥을 관통하지 못하게 차단. max()는 단조 비증가 순서를
        // 보존하므로 층 역전이 생기지 않고, 잘린 단면은 바닥 평면과 일치한다.
        const soilB      = Math.max(surfElev - tArr[0], yBotM)
        const weatheredB = Math.max(soilB - tArr[1], yBotM)
        const softB      = Math.max(weatheredB - tArr[2], yBotM)
        const normalB    = Math.max(softB - tArr[3], yBotM)
        const hardB      = Math.max(normalB - tArr[4], yBotM)
        const boreholeB  = hardB
        soilBottomGrid[j][i] = soilB
        weatheredBottomGrid[j][i] = weatheredB
        softBottomGrid[j][i] = softB
        normalBottomGrid[j][i] = normalB
        hardBottomGrid[j][i] = hardB
        boreholeBottomGrid[j][i] = boreholeB

        // ── 연장 모드(배경암상 / Leapfrog background lithology) ──
        // 기존 '각 공의 최심 관측층을 모델 바닥까지 연장' 방식은, 암반 미도달
        // 시추공이 많은 부지에서 풍화암이 바닥까지 부풀어(balloon) 인접 암반과
        // 충돌하며 수직 절벽을 만들었다(GitHub 버전에도 있던 설계적 한계).
        // 대신 관측 경계(soilB..hardB)는 그대로 두고, 모델 하부 전체를 전역
        // 배경암(bgRank, 보통 경암)으로 채운다:
        //   · k < bgRank  : 경계 = 관측 경계 (관측 두께만큼만 존재)
        //   · k ≥ bgRank  : 경계 = 모델 바닥(yBot) → 배경암이 바닥까지 점유
        // 풍화암 등 상부층은 관측 두께를 못 넘어가므로 풍선이 원천 차단되고,
        // 모든 경계가 관측 RBF면(연속)이라 수직 절벽도 생기지 않는다.
        // 배경암 윗면 = bExt[bgRank-1](관측 경계)라 단면 전환이 매끄럽다.
        rawGGrid[j][i] = boreholeB - yBotM
        const obsB = [soilB, weatheredB, softB, normalB, hardB]
        const bExt: number[] = obsB.map((b, k) => (k < bgRank ? b : yBotM))
        soilBottomExt[j][i] = bExt[0]
        weatheredBottomExt[j][i] = bExt[1]
        softBottomExt[j][i] = bExt[2]
        normalBottomExt[j][i] = bExt[3]
        hardBottomExt[j][i] = bExt[4]

        // 연장 모드에서 τ>0인 최하층 (모델 바닥 복셀 귀속용)
        let deepTau = 0
        let prevB = surfElev
        for (let k = 0; k < 5; k++) {
          if (prevB - bExt[k] > 1e-9) deepTau = k
          prevB = bExt[k]
        }
        diagBottomFill[deepTau]++ // [진단] 모델 바닥 점유 지층 분포

        // 복셀 라벨 (두 모드)
        for (let l = 0; l < MZ; l++) {
          const elev = yBotM + dz * l
          const index = idx3(i, j, l)
          if      (elev > surfElev)   label[index] = 0 // air
          else if (elev > soilB)      label[index] = 1
          else if (elev > weatheredB) label[index] = 2
          else if (elev > softB)      label[index] = 3
          else if (elev > normalB)    label[index] = 4
          else if (elev > hardB)      label[index] = 5
          else                        label[index] = 6 // unknown

          if (elev > surfElev) {
            labelExt[index] = 0
          } else {
            let codeE = deepTau + 1
            for (let k = 0; k < 5; k++) {
              if (elev > bExt[k]) { codeE = k + 1; break }
            }
            labelExt[index] = codeE
          }
        }
      }
    }

    // ── 5. 스무드 모드: 수밀 솔리드 지층 메쉬 빌드 ────────────────────────
    // 두께 0 영역은 top==bottom 퇴화 → buildLayerSolidGeometryData가
    // 두께 임계(0.001m) 미만 셀의 인덱스를 생략하므로 렌즈 가장자리가 자연 소멸
    ;(self as any).postMessage({ type: "progress", step: "수밀 지층 메쉬 생성 중..." })
    const smoothMeshData: Record<string, { positions: Float32Array; indices: Uint32Array }> = {}

    const flatBottomGrid = Array.from({ length: NX }, () => Array(NX).fill(yBotM))
    const observedSignedFor = (key: StrataKey) => (isContinuousLayer(key) ? null : rawThick[key])
    // [배경암상] 연장 메쉬 carving 부호장:
    //   · 배경암(rank ≥ bgRank): 모델 전역에 존재하므로 carving 생략(null) → 빈 공간 없음
    //   · 상부층(rank < bgRank): 관측 메쉬와 동일하게 미관측 영역만 깎는다(rawThick),
    //     단 모든 공에 존재하는 연속층은 carving 불필요(null)
    const extSignedFor = (key: StrataKey) =>
      rank[key] >= bgRank ? null : isContinuousLayer(key) ? null : rawThick[key]

    const layerPairs: [string, number[][], number[][], number[][] | null][] = [
      ["soil",           elevGrid,            soilBottomGrid,      observedSignedFor("soil")],
      ["weathered_rock", soilBottomGrid,      weatheredBottomGrid, observedSignedFor("weathered_rock")],
      ["soft_rock",      weatheredBottomGrid, softBottomGrid,      observedSignedFor("soft_rock")],
      ["normal_rock",    softBottomGrid,      normalBottomGrid,    observedSignedFor("normal_rock")],
      ["hard_rock",      normalBottomGrid,    hardBottomGrid,      observedSignedFor("hard_rock")],
      ["unknown",        boreholeBottomGrid,  flatBottomGrid,      rawGGrid],
    ]
    for (const [name, topGrid, bottomGrid, signed] of layerPairs) {
      const mesh = buildLayerSolidGeometryData(topGrid, bottomGrid, boxW, boxD, mScale, signed)
      smoothMeshData[name] = {
        positions: new Float32Array(mesh.positions),
        indices: new Uint32Array(mesh.indices),
      }
    }

    // ── 5b. [v4] 연장 모드 메쉬 — 동일 지층 단일 솔리드 (키: "<layer>@ext") ──
    // 연장분이 유효 두께 τ에 흡수되어 있으므로 관측+연장이 한 덩어리이며,
    // 색·재질도 관측 메쉬와 동일하게 렌더링된다 (뷰어에서 "@ext" → 원본 색 매핑)
    const layerPairsExt: [string, number[][], number[][], number[][] | null][] = [
      ["soil@ext",           elevGrid,           soilBottomExt,      extSignedFor("soil")],
      ["weathered_rock@ext", soilBottomExt,      weatheredBottomExt, extSignedFor("weathered_rock")],
      ["soft_rock@ext",      weatheredBottomExt, softBottomExt,      extSignedFor("soft_rock")],
      ["normal_rock@ext",    softBottomExt,      normalBottomExt,    extSignedFor("normal_rock")],
      ["hard_rock@ext",      normalBottomExt,    hardBottomExt,      extSignedFor("hard_rock")],
    ]
    for (const [name, topGrid, bottomGrid, signed] of layerPairsExt) {
      const mesh = buildLayerSolidGeometryData(topGrid, bottomGrid, boxW, boxD, mScale, signed)
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

    // [v4] 연장 모드 복셀 (labelExt RLE → "<layer>@ext" 키)
    for (let j = 0; j < NX; j++) {
      for (let i = 0; i < NX; i++) {
        const cx = -boxW / 2 + (boxW * i) / (NX - 1)
        const cz = boxD / 2 - (boxD * j) / (NX - 1)
        let l = 0
        while (l < MZ) {
          const code = labelExt[idx3(i, j, l)]
          if (code === 0) { l++; continue }
          let l2 = l
          while (l2 < MZ && labelExt[idx3(i, j, l2)] === code) l2++
          const extKey = `${LAYER_STACK[code - 1]}@ext`
          if (!voxelCells[extKey]) voxelCells[extKey] = []
          voxelCells[extKey].push({
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

    // [진단] 연장 경계면 최대 인접-셀 경사(m/m)와 발생 지층
    const dxM = lngWidthM / (NX - 1), dyM = latWidthM / (NX - 1)
    const extBottoms = [soilBottomExt, weatheredBottomExt, softBottomExt, normalBottomExt, hardBottomExt]
    let diagMaxSlope = 0, diagMaxSlopeLayer = -1
    for (let k = 0; k < 5; k++) {
      const g = extBottoms[k]
      for (let j = 0; j < NX; j++) for (let i = 0; i < NX; i++) {
        if (i + 1 < NX) { const s = Math.abs(g[j][i + 1] - g[j][i]) / dxM; if (s > diagMaxSlope) { diagMaxSlope = s; diagMaxSlopeLayer = k } }
        if (j + 1 < NX) { const s = Math.abs(g[j + 1][i] - g[j][i]) / dyM; if (s > diagMaxSlope) { diagMaxSlope = s; diagMaxSlopeLayer = k } }
      }
    }
    const nCells = NX * NX
    const diag = {
      bhByDeepest: diagBhByDeepest,          // [soil,weath,soft,normal,hard] 최심관측층 공 수
      extExcluded: diagExtExcluded,          // 옵션 B로 배경앵커서 제외된 얕은공 수
      anyRockReached,
      bgRank,                                // [배경암상] 모델 바닥을 채우는 전역 배경암 rank
      bottomFill: diagBottomFill,            // 모델 바닥 점유 지층 분포(셀 수)
      maxSlope: Math.round(diagMaxSlope * 10) / 10,
      maxSlopeLayer: diagMaxSlopeLayer,      // 0=soil..4=hard
    }
    try { console.warn("[geoWorker diag]", JSON.stringify(diag)) } catch {}

    ;(self as any).postMessage(
      {
        type: "done",
        elevGrid,
        smoothMeshData,
        voxelCells,
        dz, yBotM, gTop, MZ, confRadiusM, lngWidthM, latWidthM,
        skippedDeep, // [v4.2] 이상 심도로 제어점에서 제외된 시추공 수
        diag,        // [진단] 연장 모드 거동 지표
      },
      transferBuffers,
    )
  } catch (err: any) {
    ;(self as any).postMessage({ type: "error", error: err?.message || String(err) })
  }
}
