import { buildElevationGrid, idwGrid } from "@/lib/terrain"
import { marchingCubes, smooth3D, buildLayerSolidGeometryData, type VoxelCell } from "../lib/geoGeometry"

const LAYER_STACK = ["soil", "weathered_rock", "soft_rock", "normal_rock", "hard_rock", "unknown"] as const

type GridPoint = { x: number; y: number; z: number }

function thinPlateKernel(r: number) {
  if (r <= 1e-9) return 0
  return r * r * Math.log(r)
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

function rbfGrid(points: GridPoint[], gx: number[], gy: number[], powerFallback = 1): number[][] {
  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))
  if (valid.length < 3) return idwGrid(valid, gx, gy, powerFallback)

  const midLat = valid.reduce((sum, p) => sum + p.y, 0) / valid.length
  const cosLat = Math.cos((midLat * Math.PI) / 180)
  const mx = valid.reduce((sum, p) => sum + p.x * 111320 * cosLat, 0) / valid.length
  const my = valid.reduce((sum, p) => sum + p.y * 110540, 0) / valid.length
  const xy = valid.map((p) => ({
    x: p.x * 111320 * cosLat - mx,
    y: p.y * 110540 - my,
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
  const lambda = 0.02

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
      const x = (gx[i] * 111320 * cosLat - mx) / scale
      const y = (gy[j] * 110540 - my) / scale
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

self.onmessage = async (e: MessageEvent) => {
  const { boreholes, bbox, N, depthBelowMSL, mScale, boxW, boxD, renderMode } = e.data as {
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
    // ── 1. 지표면 고도 격자 ───────────────────────────────────────────────
    ;(self as any).postMessage({ type: "progress", step: "지표면(AWS Terrain) 계산 중..." })
    const terr = await buildElevationGrid(bbox, N)

    let elevGrid = terr.elevGrid
    const pts = boreholes
      .map((b) => ({ x: b.longitude, y: b.latitude, z: b.elevation }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && p.z < 2000 && p.z > -200)

    if (pts.length >= 1) {
      // ── 지표면 표고 보정: 잔차 IDW(power=1) + Gaussian 스무딩 ─────────────
      // V-World DEM의 자연 경사·형상을 보존하면서 시추공 실측 표고를 반영
      //
      // 핵심 원칙: DEM의 경사(gradient)는 건드리지 않고, 전체적인 오프셋만 보정
      //   잔차(residual) = 시추공 표고 - DEM 표고
      //   → 이 잔차를 부드럽게 보간해 DEM에 더함
      //   → 경사 형상은 V-World DEM 그대로, 표고값만 미세 조정
      //
      // IDW power=2 → 1: 1/d² 텐트 → 1/d 선형 감쇄로 스파이크 대폭 감소
      // Gaussian 스무딩 4패스: 남은 잔차 돌기까지 평활화

      // 표고 오류 시추공 필터링: 잔차 중앙값 기준 ±15m 초과 시 제외
      // (elevation=0 등 입력 오류 시추공이 지형 보정을 왜곡하는 것을 방지)
      const rawResiduals = pts.map((p) => ({
        x: p.x,
        y: p.y,
        z: p.z - terr.terrainElevAt(p.x, p.y),
      }))
      const sortedRes = rawResiduals.map((r) => r.z).sort((a, b) => a - b)
      const medianRes = sortedRes[Math.floor(sortedRes.length / 2)]
      const residuals = rawResiduals.filter((r) => Math.abs(r.z - medianRes) < 15)

      // IDW power=1 (부드러운 감쇄)
      let resGrid = idwGrid(residuals, terr.gx, terr.gy, 1)

      // Gaussian 스무딩 4패스 (X방향 → Y방향 교대, 경계는 클램프)
      const Ny = resGrid.length, Nx = resGrid[0].length
      for (let pass = 0; pass < 4; pass++) {
        resGrid = resGrid.map((row, j) =>
          row.map((_, i) => {
            const l = i > 0    ? resGrid[j][i - 1] : resGrid[j][i]
            const r = i < Nx-1 ? resGrid[j][i + 1] : resGrid[j][i]
            return (l + resGrid[j][i] + r) / 3
          })
        )
        resGrid = resGrid.map((_, j) =>
          Array.from({ length: Nx }, (__: unknown, i: number) => {
            const u = j > 0    ? resGrid[j - 1][i] : resGrid[j][i]
            const d = j < Ny-1 ? resGrid[j + 1][i] : resGrid[j][i]
            return (u + resGrid[j][i] + d) / 3
          })
        )
      }

      elevGrid = terr.elevGrid.map((row: number[], j: number) =>
        row.map((v: number, i: number) => v + resGrid[j][i])
      )
    }

    // ── 2. 공통 복셀 파라미터 ─────────────────────────────────────────────
    const NX = N
    const [minLng, minLat, maxLng, maxLat] = bbox
    const midLat  = (minLat + maxLat) / 2
    const cosLat  = Math.cos((midLat * Math.PI) / 180)
    const lngWidthM = (maxLng - minLng) * 111320 * cosLat
    const latWidthM = (maxLat - minLat) * 110540
    const confRadiusM = Math.max(150, Math.min(400, Math.min(lngWidthM, latWidthM) * 0.5))

    let gTop = -Infinity
    for (const row of elevGrid) for (const v of row) if (v > gTop) gTop = v
    const yBotM  = -depthBelowMSL
    const vRange = Math.max(gTop - yBotM, 1)
    const MZ  = Math.max(16, Math.min(96, Math.round(vRange / 1.2)))
    const dz  = vRange / (MZ - 1)
    const idx3 = (i: number, j: number, l: number) => (l * NX + j) * NX + i
    const label = new Int8Array(NX * NX * MZ)

    // ── 3. 지층 프로파일 구성 ─────────────────────────────────────────────
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
            to:   s.depth_bottom,
            type: rank[s.strata_group] !== undefined ? s.strata_group : "unknown",
          }))
          .sort((a: any, b: any) => a.from - b.from)
        return {
          x: b.longitude,
          y: b.latitude,
          elev: b.elevation,
          maxDepth: segs.reduce((max: number, s: any) => Math.max(max, s.to), 0),
          segs,
        }
      })
      .filter((p) => p.segs.length > 0)

    const ptsSoilDepth:      { x: number; y: number; z: number }[] = []
    const ptsWeatheredDepth: { x: number; y: number; z: number }[] = []
    const ptsSoftDepth:      { x: number; y: number; z: number }[] = []
    const ptsNormalDepth:    { x: number; y: number; z: number }[] = []
    const ptsHardDepth:      { x: number; y: number; z: number }[] = []

    for (const p of profiles) {
      let soilTo      = 0
      let weatheredTo = 0
      let softTo      = 0
      let normalTo    = 0
      let hardTo      = 0

      let hasSoil      = false
      let hasWeathered = false
      let hasSoft      = false
      let hasNormal    = false
      let hasHard      = false

      for (const seg of p.segs) {
        if      (seg.type === "soil")           { soilTo      = Math.max(soilTo,      seg.to); hasSoil      = true }
        else if (seg.type === "weathered_rock") { weatheredTo = Math.max(weatheredTo, seg.to); hasWeathered = true }
        else if (seg.type === "soft_rock")      { softTo      = Math.max(softTo,      seg.to); hasSoft      = true }
        else if (seg.type === "normal_rock")    { normalTo    = Math.max(normalTo,    seg.to); hasNormal    = true }
        else if (seg.type === "hard_rock")      { hardTo      = Math.max(hardTo,      seg.to); hasHard      = true }
      }

      // 누적 깊이 강제 정렬 (상위 층이 하위 층보다 얕게 위치 보장)
      weatheredTo = Math.max(weatheredTo, soilTo)
      softTo      = Math.max(softTo,      weatheredTo)
      normalTo    = Math.max(normalTo,    softTo)
      hardTo      = Math.max(hardTo,      normalTo)

      // [FIX 3] 해당 지층이 실제로 존재하는 시추공만 IDW 제어점에 포함
      // → 없는 지층의 z=0이 보간장을 왜곡하는 이상 형상(수직 절벽·역전 지층) 방지
      if (hasSoil)      ptsSoilDepth.push(     { x: p.x, y: p.y, z: soilTo })
      if (hasWeathered) ptsWeatheredDepth.push({ x: p.x, y: p.y, z: weatheredTo })
      if (hasSoft)      ptsSoftDepth.push(     { x: p.x, y: p.y, z: softTo })
      if (hasNormal)    ptsNormalDepth.push(   { x: p.x, y: p.y, z: normalTo })
      if (hasHard)      ptsHardDepth.push(     { x: p.x, y: p.y, z: hardTo })
    }

    const gx = terr.gx
    const gy = terr.gy

    // 절대 심도(m) 직접 IDW 보간 (power=1: 텐트 아티팩트 감소)
    const soilDepthGrid      = rbfGrid(ptsSoilDepth,      gx, gy, 1)
    const weatheredDepthGrid = rbfGrid(ptsWeatheredDepth, gx, gy, 1)
    const softDepthGrid      = rbfGrid(ptsSoftDepth,      gx, gy, 1)
    const normalDepthGrid    = rbfGrid(ptsNormalDepth,    gx, gy, 1)
    const hardDepthGrid      = rbfGrid(ptsHardDepth,      gx, gy, 1)

    // [FIX 2] 깊이 격자 Gaussian 스무딩 (4패스 X+Y 교대)
    // IDW 텐트 아티팩트(시추공 위치의 뾰족한 돌기) 평활화
    // 경계는 클램프(reflect) 처리하여 외곽 수축 방지
    const smoothDepthGrid = (grid: number[][]): number[][] => {
      const Ny = grid.length, Nx = grid[0].length
      let g = grid.map(row => row.slice())
      for (let pass = 0; pass < 4; pass++) {
        // X방향 스무딩
        g = g.map((row, j) => row.map((_, i) => {
          const l = i > 0      ? g[j][i - 1] : g[j][i]
          const r = i < Nx - 1 ? g[j][i + 1] : g[j][i]
          return (l + g[j][i] + r) / 3
        }))
        // Y방향 스무딩
        g = Array.from({ length: Ny }, (_, j) =>
          Array.from({ length: Nx }, (__, i) => {
            const u = j > 0      ? g[j - 1][i] : g[j][i]
            const d = j < Ny - 1 ? g[j + 1][i] : g[j][i]
            return (u + g[j][i] + d) / 3
          })
        )
      }
      return g
    }

    const smoothedSoilDepth      = ptsSoilDepth.length      > 1 ? smoothDepthGrid(soilDepthGrid)      : soilDepthGrid
    const smoothedWeatheredDepth = ptsWeatheredDepth.length  > 1 ? smoothDepthGrid(weatheredDepthGrid) : weatheredDepthGrid
    const smoothedSoftDepth      = ptsSoftDepth.length       > 1 ? smoothDepthGrid(softDepthGrid)      : softDepthGrid
    const smoothedNormalDepth    = ptsNormalDepth.length     > 1 ? smoothDepthGrid(normalDepthGrid)    : normalDepthGrid
    const smoothedHardDepth      = ptsHardDepth.length       > 1 ? smoothDepthGrid(hardDepthGrid)      : hardDepthGrid

    // [FIX 1] 데이터 기반 영향 반경: 시추공 평균 간격 × 1.2
    //   - 하드코딩된 30m/100m 대신 실제 시추공 배치 밀도에서 자동 산출
    //   - 시추공 1개면 영역 절반을 기본 반경으로 설정
    const avgSpacing = profiles.length > 1
      ? Math.sqrt((lngWidthM * latWidthM) / profiles.length)
      : Math.max(lngWidthM, latWidthM) * 0.5
    const softInfluenceRadius = avgSpacing * 1.2

    // ── 4. 격자별 지층 경계 절대 고도 계산 ───────────────────────────────
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

        // 순서 보장용 절대 심도 클램프 (스무딩된 grid 사용)
        const soilDepth      = Math.max(0, smoothedSoilDepth[j][i])
        const weatheredDepth = Math.max(soilDepth, smoothedWeatheredDepth[j][i])
        const softDepth      = Math.max(weatheredDepth, smoothedSoftDepth[j][i])
        const normalDepth    = Math.max(softDepth, smoothedNormalDepth[j][i])
        const hardDepth      = Math.max(normalDepth, smoothedHardDepth[j][i])

        const soilB      = surfElev - soilDepth
        const weatheredB = surfElev - weatheredDepth
        const softB      = surfElev - softDepth
        const normalB    = surfElev - normalDepth
        const hardB      = surfElev - hardDepth
        const boreholeB  = hardB

        soilBottomGrid[j][i]      = soilB
        weatheredBottomGrid[j][i] = weatheredB
        softBottomGrid[j][i]      = softB
        normalBottomGrid[j][i]    = normalB
        hardBottomGrid[j][i]      = hardB
        boreholeBottomGrid[j][i]  = boreholeB

        // 복셀 라벨 배열 재구성
        for (let l = 0; l < MZ; l++) {
          const elev  = yBotM + dz * l
          const index = idx3(i, j, l)
          if      (elev > surfElev)   label[index] = 0  // air
          else if (elev > soilB)      label[index] = 1  // soil
          else if (elev > weatheredB) label[index] = 2  // weathered_rock
          else if (elev > softB)      label[index] = 3  // soft_rock
          else if (elev > normalB)    label[index] = 4  // normal_rock
          else if (elev > hardB)      label[index] = 5  // hard_rock
          else                        label[index] = 6  // unknown
        }
      }
    }

    // ── 5. 스무드 모드: 수밀 솔리드 지층 메쉬 빌드 ────────────────────
    ;(self as any).postMessage({ type: "progress", step: "수밀 지층 메쉬 생성 중..." })
    const smoothMeshData: Record<string, { positions: Float32Array; indices: Uint32Array }> = {}

    const flatBottomGrid = Array.from({ length: NX }, () => Array(NX).fill(yBotM))

    // 1) 토사층
    const soilMesh = buildLayerSolidGeometryData(elevGrid, soilBottomGrid, boxW, boxD, mScale)
    smoothMeshData["soil"] = {
      positions: new Float32Array(soilMesh.positions),
      indices:   new Uint32Array(soilMesh.indices),
    }

    // 2) 풍화암층
    const weatheredMesh = buildLayerSolidGeometryData(soilBottomGrid, weatheredBottomGrid, boxW, boxD, mScale)
    smoothMeshData["weathered_rock"] = {
      positions: new Float32Array(weatheredMesh.positions),
      indices:   new Uint32Array(weatheredMesh.indices),
    }

    // 3) 연암층
    const softMesh = buildLayerSolidGeometryData(weatheredBottomGrid, softBottomGrid, boxW, boxD, mScale)
    smoothMeshData["soft_rock"] = {
      positions: new Float32Array(softMesh.positions),
      indices:   new Uint32Array(softMesh.indices),
    }

    // 4) 보통암층
    const normalMesh = buildLayerSolidGeometryData(softBottomGrid, normalBottomGrid, boxW, boxD, mScale)
    smoothMeshData["normal_rock"] = {
      positions: new Float32Array(normalMesh.positions),
      indices:   new Uint32Array(normalMesh.indices),
    }

    // 5) 경암층
    const hardMesh = buildLayerSolidGeometryData(normalBottomGrid, hardBottomGrid, boxW, boxD, mScale)
    smoothMeshData["hard_rock"] = {
      positions: new Float32Array(hardMesh.positions),
      indices:   new Uint32Array(hardMesh.indices),
    }

    // 6) 미분류층 (조사 한계선 ~ 모델 바닥)
    const unknownMesh = buildLayerSolidGeometryData(boreholeBottomGrid, flatBottomGrid, boxW, boxD, mScale)
    smoothMeshData["unknown"] = {
      positions: new Float32Array(unknownMesh.positions),
      indices:   new Uint32Array(unknownMesh.indices),
    }

    // ── 6. 복셀 셀 (voxel 모드 — RLE 압축) ──────────────────────────────
    const cellW = boxW / (NX - 1)
    const cellD = boxD / (NX - 1)
    const voxelCells: Record<string, VoxelCell[]> = {
      soil: [], weathered_rock: [], soft_rock: [], normal_rock: [], hard_rock: [], unknown: [],
    }
    for (let j = 0; j < NX; j++) {
      for (let i = 0; i < NX; i++) {
        const cx = -boxW / 2 + (boxW * i) / (NX - 1)
        const cz =  boxD / 2 - (boxD * j) / (NX - 1)
        let l = 0
        while (l < MZ) {
          const code = label[idx3(i, j, l)]
          if (code === 0) { l++; continue }
          let l2 = l
          while (l2 < MZ && label[idx3(i, j, l2)] === code) l2++
          voxelCells[LAYER_STACK[code - 1]].push({
            x0: cx - cellW / 2, x1: cx + cellW / 2,
            z0: cz - cellD / 2, z1: cz + cellD / 2,
            yBot: (yBotM + dz * (l  - 0.5)) * mScale,
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
