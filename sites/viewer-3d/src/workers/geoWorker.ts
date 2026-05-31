import { buildElevationGrid, idwGrid } from "@/lib/terrain"
import { marchingCubes, smooth3D, type VoxelCell } from "../lib/geoGeometry"

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
      const residuals = pts.map((p) => ({
        x: p.x,
        y: p.y,
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

    // ── 3. Smooth / Voxel 모드: IDW 투표 기반 3D 지층 분류 ────────────────
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
          x: b.longitude,
          y: b.latitude,
          elev: b.elevation,
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

    // ── 4. 마칭큐브 (smooth 모드) ─────────────────────────────────────────
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
      occ[c] = smooth3D(f, NX, NX, MZ, 3)
    }

    const smoothMeshData: Record<string, { positions: Float32Array; normals: Float32Array }> = {}
    for (let s = 0; s < LAYER_STACK.length; s++) {
      const type = LAYER_STACK[s]
      const code = s + 1
      const fL   = occ[code]
      let any = false
      for (let n = 0; n < fL.length; n++) {
        if (fL[n] > 0.15) { any = true; break }
      }
      if (!any) continue
      const { positions, normals } = marchingCubes(fL, NX, NX, MZ, 0.15, nodeWorld)
      if (!positions.length) continue
      smoothMeshData[type] = {
        positions: new Float32Array(positions),
        normals:   new Float32Array(normals),
      }
    }

    // ── 5. 복셀 셀 (voxel 모드) ──────────────────────────────────────────
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
        voxelCells,
        dz, yBotM, gTop, MZ, confRadiusM, lngWidthM, latWidthM,
      },
      transferBuffers,
    )
  } catch (err: any) {
    ;(self as any).postMessage({ type: "error", error: err?.message || String(err) })
  }
}
