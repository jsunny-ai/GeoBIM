import { buildElevationGrid, idwGrid } from "@/lib/terrain"
import { marchingCubes, smooth3D, type VoxelCell } from "../lib/geoGeometry"

// ── RBF 그리드로 지층 상/하면 메시를 직접 생성 (마칭큐브 우회) ──────────────
// 마칭큐브+smooth3D 방식은 얇은 지층을 블러로 소멸시키는 문제가 있다.
// 이 함수는 RBF 격자 값을 직접 사용해 top/bottom face + 경계 측벽으로 메시를 만든다.
function buildLayerSurface(
  topAt: (j: number, i: number) => number,
  botAt: (j: number, i: number) => number,
  NX: number,
  boxW: number,
  boxD: number,
  mScale: number,
  minThickness = 0.1, // 미터 단위 최소 두께 임계값
): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } | null {
  const xAt = (i: number) => -boxW / 2 + (boxW * i) / (NX - 1)
  const zAt = (j: number) => boxD / 2 - (boxD * j) / (NX - 1)

  const pos: number[] = []
  const nor: number[] = []
  const idx: number[] = []

  // 버텍스 레이아웃: [0, NX²) = top 면,  [NX², 2·NX²) = bottom 면
  for (let j = 0; j < NX; j++)
    for (let i = 0; i < NX; i++) {
      pos.push(xAt(i), topAt(j, i) * mScale, zAt(j))
      nor.push(0, 1, 0)
    }
  for (let j = 0; j < NX; j++)
    for (let i = 0; i < NX; i++) {
      pos.push(xAt(i), botAt(j, i) * mScale, zAt(j))
      nor.push(0, -1, 0)
    }

  const V = NX * NX
  let hasAny = false

  const cellThick = (j: number, i: number) => topAt(j, i) - botAt(j, i)
  const isActive = (j: number, i: number) =>
    j >= 0 && j < NX && i >= 0 && i < NX && cellThick(j, i) >= minThickness

  for (let j = 0; j < NX - 1; j++) {
    for (let i = 0; i < NX - 1; i++) {
      // 쿼드의 네 꼭짓점 중 하나라도 최소 두께 이상이면 셀 렌더링
      const thick = Math.max(
        cellThick(j, i),
        cellThick(j, i + 1),
        cellThick(j + 1, i),
        cellThick(j + 1, i + 1),
      )
      if (thick < minThickness) continue
      hasAny = true

      const a = j * NX + i,     b = j * NX + i + 1
      const c = (j + 1) * NX + i, d = (j + 1) * NX + i + 1

      // top face (법선 위쪽, CCW from above)
      idx.push(a, b, d, a, d, c)
      // bottom face (법선 아래쪽, 와인딩 반전)
      idx.push(V + a, V + d, V + b, V + a, V + c, V + d)

      // ── 경계 측벽: 이웃 셀이 비활성이거나 격자 경계일 때만 벽 추가 ──
      // +j 방향 벽 (j+1 이웃)
      if (!isActive(j + 1, i) || !isActive(j + 1, i + 1)) {
        idx.push(c, d, V + d, c, V + d, V + c)
      }
      // -j 방향 벽 (j-1 이웃)
      if (!isActive(j - 1, i) || !isActive(j - 1, i + 1)) {
        idx.push(b, a, V + a, b, V + a, V + b)
      }
      // +i 방향 벽 (i+1 이웃)
      if (!isActive(j, i + 1) || !isActive(j + 1, i + 1)) {
        idx.push(b, d, V + d, b, V + d, V + b)
      }
      // -i 방향 벽 (i-1 이웃)
      if (!isActive(j, i - 1) || !isActive(j + 1, i - 1)) {
        idx.push(a, V + a, V + c, a, V + c, c)
      }
    }
  }

  if (!hasAny) return null
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    indices: new Uint32Array(idx),
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const LAYER_STACK = ["soil", "weathered_rock", "soft_rock", "hard_rock", "unknown"] as const

self.onmessage = async (e: MessageEvent) => {
  const { boreholes, bbox, N, depthBelowMSL, mScale, boxW, boxD, renderMode } = e.data as {
    boreholes: any[]
    bbox: [number, number, number, number]
    N: number
    depthBelowMSL: number
    mScale: number
    boxW: number
    boxD: number
    renderMode: "smooth" | "voxel" | "rbf"
  }

  try {
    let rbfPhantoms: any[] = []

    // ── 1. 지표면 고도 격자 ───────────────────────────────────────────────
    ;(self as any).postMessage({ type: "progress", step: "지표면(AWS Terrain) 계산 중..." })
    const terr = await buildElevationGrid(bbox, N)

    let elevGrid = terr.elevGrid
    const pts = boreholes
      .map((b) => ({ x: b.longitude, y: b.latitude, z: b.elevation }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && p.z < 2000 && p.z > -200)

    if (pts.length >= 1) {
      const residuals = pts.map((p) => ({
        x: p.x, y: p.y,
        z: p.z - terr.terrainElevAt(p.x, p.y),
      }))
      const resGrid = idwGrid(residuals, terr.gx, terr.gy, 2)
      elevGrid = terr.elevGrid.map((row: number[], j: number) =>
        row.map((v: number, i: number) => v + resGrid[j][i]),
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

    // ── 3. RBF 모드: 백엔드 보간 → 직접 메시 생성 ─────────────────────────
    if (renderMode === "rbf") {
      ;(self as any).postMessage({ type: "progress", step: "백엔드 SciPy RBF 다중 지층 보간 연산 중..." })

      const origin = self.location.origin
      const res = await fetch(`${origin}/api/v1/rbf/interpolate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          bbox,
          grid_res: NX,
          boreholes: boreholes.map((b) => ({
            id: b.id, name: b.name,
            longitude: b.longitude, latitude: b.latitude,
            elevation: b.elevation, strata: b.strata,
          })),
        }),
      })
      if (!res.ok) throw new Error(`RBF API 연동 실패: ${res.statusText}`)

      const rbfData = await res.json()
      const grids = rbfData.grids
      rbfPhantoms = rbfData.phantom_points

      ;(self as any).postMessage({ type: "progress", step: "RBF 지층 경계면 클램핑 중..." })

      // TPS overshoot 방지: 각 경계면 ≤ 상위 경계면
      // meshSurfGrid: elevGrid 복사본 — 실제 시추공 표고를 최근접 격자에 스탬핑한 별도 그리드.
      // drape(지표면 텍스처)는 원본 elevGrid를 유지하고,
      // 지질 메시의 토사 상면만 시추공 데이터에 정확히 맞춘다.
      const meshSurfGrid: number[][] = elevGrid.map((row: number[]) => [...row])
      for (const bh of boreholes) {
        if (!Number.isFinite(bh.longitude) || !Number.isFinite(bh.latitude) || !Number.isFinite(bh.elevation)) continue
        const ni = Math.round((bh.longitude - minLng) / (maxLng - minLng) * (NX - 1))
        const nj = Math.round((bh.latitude  - minLat) / (maxLat - minLat) * (NX - 1))
        if (ni >= 0 && ni < NX && nj >= 0 && nj < NX) {
          meshSurfGrid[nj][ni] = bh.elevation
        }
      }

      const soilBotGrid:  number[][] = []
      const weathBotGrid: number[][] = []
      const softBotGrid:  number[][] = []
      const hardBotGrid:  number[][] = []

      for (let j = 0; j < NX; j++) {
        soilBotGrid.push([]);  weathBotGrid.push([])
        softBotGrid.push([]); hardBotGrid.push([])
        for (let i = 0; i < NX; i++) {
          const surf  = meshSurfGrid[j][i]          // ← DEM 대신 스탬핑된 표면 사용
          const soil  = Math.min(grids["soil"]?.[j]?.[i]          ?? surf,  surf)
          const weath = Math.min(grids["weathered_rock"]?.[j]?.[i] ?? soil,  soil)
          const soft  = Math.min(grids["soft_rock"]?.[j]?.[i]      ?? weath, weath)
          const hard  = Math.min(grids["hard_rock"]?.[j]?.[i]      ?? soft,  soft)
          soilBotGrid[j].push(soil);  weathBotGrid[j].push(weath)
          softBotGrid[j].push(soft);  hardBotGrid[j].push(hard)
        }
      }

      // ── 실제 시추공 값 스탬핑 ─────────────────────────────────────────────
      // TPS는 시추공 좌표에서만 정확히 통과하고, 48×48 격자점은 시추공 위치와
      // 정확히 일치하지 않으므로 메시와 기둥이 어긋난다.
      // 각 시추공의 실제 경계면 값을 최근접 격자 셀에 덮어써서 정렬한다.
      for (const bh of boreholes) {
        if (!Number.isFinite(bh.longitude) || !Number.isFinite(bh.latitude) || !Number.isFinite(bh.elevation)) continue
        const strata: any[] = bh.strata || []

        // 최근접 격자 인덱스
        const ni = Math.round((bh.longitude - minLng) / (maxLng - minLng) * (NX - 1))
        const nj = Math.round((bh.latitude  - minLat) / (maxLat - minLat) * (NX - 1))
        if (ni < 0 || ni >= NX || nj < 0 || nj >= NX) continue

        // 각 지층 바닥 절대 표고를 실제 시추공 데이터에서 계산
        const getLayerBot = (layerName: string): number | null => {
          for (const s of strata) {
            if (s.strata_group === layerName && Number.isFinite(s.depth_bottom)) {
              return bh.elevation - s.depth_bottom
            }
          }
          return null
        }

        const surf  = elevGrid[nj][ni]
        const soil  = getLayerBot("soil")
        const weath = getLayerBot("weathered_rock")
        const soft  = getLayerBot("soft_rock")
        const hard  = getLayerBot("hard_rock")

        // 클램핑 후 격자에 스탬핑
        if (soil  !== null) soilBotGrid[nj][ni]  = Math.min(soil,  surf)
        const s0 = soilBotGrid[nj][ni]
        if (weath !== null) weathBotGrid[nj][ni] = Math.min(weath, s0)
        const w0 = weathBotGrid[nj][ni]
        if (soft  !== null) softBotGrid[nj][ni]  = Math.min(soft,  w0)
        const f0 = softBotGrid[nj][ni]
        if (hard  !== null) hardBotGrid[nj][ni]  = Math.min(hard,  f0)
      }

      ;(self as any).postMessage({ type: "progress", step: "RBF 직접 레이어 메시 생성 중..." })

      const rbfLayerDefs = [
        { type: "soil",           top: (j: number, i: number) => meshSurfGrid[j][i],  bot: (j: number, i: number) => soilBotGrid[j][i] },
        { type: "weathered_rock", top: (j: number, i: number) => soilBotGrid[j][i],   bot: (j: number, i: number) => weathBotGrid[j][i] },
        { type: "soft_rock",      top: (j: number, i: number) => weathBotGrid[j][i],  bot: (j: number, i: number) => softBotGrid[j][i] },
        { type: "hard_rock",      top: (j: number, i: number) => softBotGrid[j][i],   bot: (j: number, i: number) => hardBotGrid[j][i] },
      ]

      const rbfSurfaceMeshData: Record<string, any> = {}
      for (const def of rbfLayerDefs) {
        const result = buildLayerSurface(def.top, def.bot, NX, boxW, boxD, mScale)
        if (result) rbfSurfaceMeshData[def.type] = result
      }

      ;(self as any).postMessage(
        {
          type: "done",
          elevGrid,
          smoothMeshData: {},
          rbfSurfaceMeshData,
          voxelCells: { soil: [], weathered_rock: [], soft_rock: [], hard_rock: [], unknown: [] },
          dz, yBotM, gTop, MZ, confRadiusM, lngWidthM, latWidthM,
          phantomPoints: rbfPhantoms,
        },
        Object.values(rbfSurfaceMeshData).flatMap((d: any) => [
          d.positions.buffer,
          d.normals.buffer,
          d.indices.buffer,
        ]),
      )
      return
    }

    // ── 4. Smooth / Voxel 모드: IDW 투표 기반 3D 지층 분류 ────────────────
    ;(self as any).postMessage({ type: "progress", step: "시추공 거리 가중 투표 기반 3D 지층 분류 중..." })

    const rank: Record<string, number> = {
      soil: 0, weathered_rock: 1, soft_rock: 2, hard_rock: 3, unknown: 4,
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
          x: b.longitude, y: b.latitude, elev: b.elevation,
          maxDepth: segs.reduce((max: number, s: any) => Math.max(max, s.to), 0),
          segs,
        }
      })
      .filter((p) => p.segs.length > 0)

    const layerAtDepth = (profile: any, depth: number) => {
      const d = Math.max(0, depth)
      for (const seg of profile.segs) {
        if (d >= seg.from && d < seg.to) return seg.type
      }
      const last = profile.segs[profile.segs.length - 1]
      if (d <= last.to + 1e-6) return last.type
      return null
    }

    const MIN_K = 4, MAX_K = 24
    const nearByCol: { p: any; w: number }[][] = new Array(NX * NX)
    for (let j = 0; j < NX; j++) {
      for (let i = 0; i < NX; i++) {
        const lng = minLng + (maxLng - minLng) * (i / (NX - 1))
        const lat = minLat + (maxLat - minLat) * (j / (NX - 1))
        const all = profiles.map((p) => {
          const dxm = (lng - p.x) * 111320 * cosLat
          const dym = (lat - p.y) * 110540
          const d2  = dxm * dxm + dym * dym
          return { p, w: 1 / Math.max(d2, 1), d2 }
        }).sort((a, b) => a.d2 - b.d2)

        const near: { p: any; w: number }[] = []
        for (const item of all) {
          if (item.d2 <= confRadiusM * confRadiusM || near.length < MIN_K) {
            near.push({ p: item.p, w: item.w })
          }
          if (near.length >= MAX_K) break
        }
        nearByCol[j * NX + i] = near
      }
    }

    for (let j = 0; j < NX; j++) {
      for (let i = 0; i < NX; i++) {
        const near      = nearByCol[j * NX + i]
        const surfElev  = elevGrid[j][i]
        for (let l = 0; l < MZ; l++) {
          const elev  = yBotM + dz * l
          const index = idx3(i, j, l)
          if (elev > surfElev) { label[index] = 0; continue }
          if (!near.length)    { label[index] = 5; continue }

          const votes: Record<string, number> = {}
          for (const { p, w } of near) {
            const depth = p.elev - elev
            if (depth > p.maxDepth + dz * 0.5) continue
            const type = layerAtDepth(p, depth)
            if (!type) continue
            votes[type] = (votes[type] || 0) + w
          }
          let best = "unknown", bestW = 0
          for (const key in votes) if (votes[key] > bestW) { bestW = votes[key]; best = key }
          label[index] = LAYER_STACK.indexOf(best as any) + 1
        }
      }
    }

    // ── 5. 마칭큐브 (smooth 모드) ─────────────────────────────────────────
    const nodeWorld = (i: number, j: number, l: number): [number, number, number] => [
      -boxW / 2 + (boxW * i) / (NX - 1),
      (yBotM + dz * l) * mScale,
      boxD / 2 - (boxD * j) / (NX - 1),
    ]

    ;(self as any).postMessage({ type: "progress", step: "지층면 메쉬 추출 중..." })
    const occ: Float32Array[] = []
    for (let c = 0; c <= 5; c++) {
      const f = new Float32Array(label.length)
      for (let n = 0; n < label.length; n++) if (label[n] === c) f[n] = 1
      occ[c] = smooth3D(f, NX, NX, MZ, 2)
    }

    const smoothMeshData: Record<string, { positions: Float32Array; normals: Float32Array }> = {}
    for (let s = 0; s < LAYER_STACK.length; s++) {
      const type = LAYER_STACK[s]
      const code = s + 1
      const fL   = occ[code]
      const field = new Float32Array(label.length)
      let any = false
      for (let n = 0; n < field.length; n++) {
        let maxOther = 0
        for (let c = 0; c <= 5; c++) if (c !== code && occ[c][n] > maxOther) maxOther = occ[c][n]
        field[n] = fL[n] - maxOther
        if (field[n] > 0) any = true
      }
      if (!any) continue
      const { positions, normals } = marchingCubes(field, NX, NX, MZ, 0, nodeWorld)
      if (!positions.length) continue
      smoothMeshData[type] = {
        positions: new Float32Array(positions),
        normals:   new Float32Array(normals),
      }
    }

    // ── 6. 복셀 셀 (voxel 모드) ──────────────────────────────────────────
    const cellW = boxW / (NX - 1)
    const cellD = boxD / (NX - 1)
    const voxelCells: Record<string, VoxelCell[]> = {
      soil: [], weathered_rock: [], soft_rock: [], hard_rock: [], unknown: [],
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
      transferBuffers.push(smoothMeshData[type].normals.buffer   as ArrayBuffer)
    }

    ;(self as any).postMessage(
      {
        type: "done",
        elevGrid,
        smoothMeshData,
        rbfSurfaceMeshData: {},
        voxelCells,
        dz, yBotM, gTop, MZ, confRadiusM, lngWidthM, latWidthM,
        phantomPoints: rbfPhantoms,
      },
      transferBuffers,
    )
  } catch (err: any) {
    ;(self as any).postMessage({ type: "error", error: err?.message || String(err) })
  }
}
