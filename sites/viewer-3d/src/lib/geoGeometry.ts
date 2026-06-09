import * as THREE from 'three'

// ── 마칭큐브 삼각형 테이블 (표준 256 케이스) ──────────────────────
const TRI_TABLE: number[][] = [
  [],[0,8,3],[0,1,9],[1,8,3,9,8,1],[1,2,10],[0,8,3,1,2,10],[9,2,10,0,2,9],
  [2,8,3,2,10,8,10,9,8],[3,11,2],[0,11,2,8,11,0],[1,9,0,2,3,11],
  [1,11,2,1,9,11,9,8,11],[3,10,1,11,10,3],[0,10,1,0,8,10,8,11,10],
  [3,9,0,3,11,9,11,10,9],[9,8,10,10,8,11],[4,7,8],[4,3,0,7,3,4],
  [0,1,9,8,4,7],[4,1,9,4,7,1,7,3,1],[1,2,10,8,4,7],[3,4,7,3,0,4,1,2,10],
  [9,2,10,9,0,2,8,4,7],[2,10,9,2,9,7,2,7,3,7,9,4],[8,4,7,3,11,2],
  [11,4,7,11,2,4,2,0,4],[9,0,1,8,4,7,2,3,11],[4,7,11,9,4,11,9,11,2,9,2,1],
  [3,10,1,3,11,10,7,8,4],[1,11,10,1,4,11,1,0,4,7,11,4],
  [4,7,8,9,0,11,9,11,10,11,0,3],[4,7,11,4,11,9,9,11,10],[9,5,4],
  [9,5,4,0,8,3],[0,5,4,1,5,0],[8,5,4,8,3,5,3,1,5],[1,2,10,9,5,4],
  [3,0,8,1,2,10,4,9,5],[5,2,10,5,4,2,4,0,2],[2,10,5,3,2,5,3,5,4,3,4,8],
  [9,5,4,2,3,11],[0,11,2,0,8,11,4,9,5],[0,5,4,0,1,5,2,3,11],
  [2,1,5,2,5,8,2,8,11,4,8,5],[10,3,11,10,1,3,9,5,4],
  [4,9,5,0,8,1,8,10,1,8,11,10],[5,4,0,5,0,11,5,11,10,11,0,3],
  [5,4,8,5,8,10,10,8,11],[9,7,8,5,7,9],[9,3,0,9,5,3,5,7,3],
  [0,7,8,0,1,7,1,5,7],[1,5,3,3,5,7],[9,7,8,9,5,7,10,1,2],
  [10,1,2,9,5,0,5,3,0,5,7,3],[8,0,2,8,2,5,8,5,7,10,5,2],
  [2,10,5,2,5,3,3,5,7],[7,9,5,7,8,9,3,11,2],[9,5,7,9,7,2,9,2,0,2,7,11],
  [2,3,11,0,1,8,1,7,8,1,5,7],[11,2,1,11,1,7,7,1,5],
  [9,5,8,8,5,7,10,1,3,10,3,11],[5,7,0,5,0,9,7,11,0,1,0,10,11,10,0],
  [11,10,0,11,0,3,10,5,0,8,0,7,5,7,0],[11,10,5,7,11,5],[10,6,5],
  [0,8,3,5,10,6],[9,0,1,5,10,6],[1,8,3,1,9,8,5,10,6],[1,6,5,2,6,1],
  [1,6,5,1,2,6,3,0,8],[9,6,5,9,0,6,0,2,6],[5,9,8,5,8,2,5,2,6,3,2,8],
  [2,3,11,10,6,5],[11,0,8,11,2,0,10,6,5],[0,1,9,2,3,11,5,10,6],
  [5,10,6,1,9,2,9,11,2,9,8,11],[6,3,11,6,5,3,5,1,3],
  [0,8,11,0,11,5,0,5,1,5,11,6],[3,11,6,0,3,6,0,6,5,0,5,9],
  [6,5,9,6,9,11,11,9,8],[5,10,6,4,7,8],[4,3,0,4,7,3,6,5,10],
  [1,9,0,5,10,6,8,4,7],[10,6,5,1,9,7,1,7,3,7,9,4],[6,1,2,6,5,1,4,7,8],
  [1,2,5,5,2,6,3,0,4,3,4,7],[8,4,7,9,0,5,0,6,5,0,2,6],
  [7,3,9,7,9,4,3,2,9,5,9,6,2,6,9],[3,11,2,7,8,4,10,6,5],
  [5,10,6,4,7,2,4,2,0,2,7,11],[0,1,9,4,7,8,2,3,11,5,10,6],
  [9,2,1,9,11,2,9,4,11,7,11,4,5,10,6],[8,4,7,3,11,5,3,5,1,5,11,6],
  [5,1,11,5,11,6,1,0,11,7,11,4,0,4,11],
  [0,5,9,0,6,5,0,3,6,11,6,3,8,4,7],[6,5,9,6,9,11,4,7,9,7,11,9],
  [10,4,9,6,4,10],[4,10,6,4,9,10,0,8,3],[10,0,1,10,6,0,6,4,0],
  [8,3,1,8,1,6,8,6,4,6,1,10],[1,4,9,1,2,4,2,6,4],
  [3,0,8,1,2,9,2,4,9,2,6,4],[0,2,4,4,2,6],[8,3,2,8,2,4,4,2,6],
  [10,4,9,10,6,4,11,2,3],[0,8,2,2,8,11,4,9,10,4,10,6],
  [3,11,2,0,1,6,0,6,4,6,1,10],[6,4,1,6,1,10,4,8,1,2,1,11,8,11,1],
  [9,6,4,9,3,6,9,1,3,11,6,3],[8,11,1,8,1,0,11,6,1,9,1,4,6,4,1],
  [3,11,6,3,6,0,0,6,4],[6,4,8,11,6,8],[7,10,6,7,8,10,8,9,10],
  [0,7,3,0,10,7,0,9,10,6,7,10],[10,6,7,1,10,7,1,7,8,1,8,0],
  [10,6,7,10,7,1,1,7,3],[1,2,6,1,6,8,1,8,9,8,6,7],
  [2,6,9,2,9,1,6,7,9,0,9,3,7,3,9],[7,8,0,7,0,6,6,0,2],[7,3,2,6,7,2],
  [2,3,11,10,6,8,10,8,9,8,6,7],[2,0,7,2,7,11,0,9,7,6,7,10,9,10,7],
  [1,8,0,1,7,8,1,10,7,6,7,10,2,3,11],[11,2,1,11,1,7,10,6,1,6,7,1],
  [8,9,6,8,6,7,9,1,6,11,6,3,1,3,6],[0,9,1,11,6,7],
  [7,8,0,7,0,6,3,11,0,11,6,0],[7,11,6],[7,6,11],[3,0,8,11,7,6],
  [0,1,9,11,7,6],[8,1,9,8,3,1,11,7,6],[10,1,2,6,11,7],
  [1,2,10,3,0,8,6,11,7],[2,9,0,2,10,9,6,11,7],
  [6,11,7,2,10,3,10,8,3,10,9,8],[7,2,3,6,2,7],[7,0,8,7,6,0,6,2,0],
  [2,7,6,2,3,7,0,1,9],[1,6,2,1,8,6,1,9,8,8,7,6],[10,7,6,10,1,7,1,3,7],
  [10,7,6,1,7,10,1,8,7,1,0,8],[0,3,7,0,7,10,0,10,9,6,10,7],
  [7,6,10,7,10,8,8,10,9],[6,8,4,11,8,6],[3,6,11,3,0,6,0,4,6],
  [8,6,11,8,4,6,9,0,1],[9,4,6,9,6,3,9,3,1,11,3,6],[6,8,4,6,11,8,2,10,1],
  [1,2,10,3,0,11,0,6,11,0,4,6],[4,11,8,4,6,11,0,2,9,2,10,9],
  [10,9,3,10,3,2,9,4,3,11,3,6,4,6,3],[8,2,3,8,4,2,4,6,2],[0,4,2,4,6,2],
  [1,9,0,2,3,4,2,4,6,4,3,8],[1,9,4,1,4,2,2,4,6],
  [8,1,3,8,6,1,8,4,6,6,10,1],[10,1,0,10,0,6,6,0,4],
  [4,6,3,4,3,8,6,10,3,0,3,9,10,9,3],[10,9,4,6,10,4],[4,9,5,7,6,11],
  [0,8,3,4,9,5,11,7,6],[5,0,1,5,4,0,7,6,11],
  [11,7,6,8,3,4,3,5,4,3,1,5],[9,5,4,10,1,2,7,6,11],
  [6,11,7,1,2,10,0,8,3,4,9,5],[7,6,11,5,4,10,4,2,10,4,0,2],
  [3,4,8,3,5,4,3,2,5,10,5,2,11,7,6],[7,2,3,7,6,2,5,4,9],
  [9,5,4,0,8,6,0,6,2,6,8,7],[3,6,2,3,7,6,1,5,0,5,4,0],
  [6,2,8,6,8,7,2,1,8,4,8,5,1,5,8],[9,5,4,10,1,6,1,7,6,1,3,7],
  [1,6,10,1,7,6,1,0,7,8,7,0,9,5,4],
  [4,0,10,4,10,5,0,3,10,6,10,7,3,7,10],
  [7,6,10,7,10,8,5,4,10,4,8,10],[6,9,5,6,11,9,11,8,9],
  [3,6,11,0,6,3,0,5,6,0,9,5],[0,11,8,0,5,11,0,1,5,5,6,11],
  [6,11,3,6,3,5,5,3,1],[1,2,10,9,5,11,9,11,8,11,5,6],
  [0,11,3,0,6,11,0,9,6,5,6,9,1,2,10],
  [11,8,5,11,5,6,8,0,5,10,5,2,0,2,5],[6,11,3,6,3,5,2,10,3,10,5,3],
  [5,8,9,5,2,8,5,6,2,3,8,2],[9,5,6,9,6,0,0,6,2],
  [1,5,8,1,8,0,5,6,8,3,8,2,6,2,8],[1,5,6,2,1,6],
  [1,3,6,1,6,10,3,8,6,5,6,9,8,9,6],[10,1,0,10,0,6,9,5,0,5,6,0],
  [0,3,8,5,6,10],[10,5,6],[11,5,10,7,5,11],[11,5,10,11,7,5,8,3,0],
  [5,11,7,5,10,11,1,9,0],[10,7,5,10,11,7,9,8,1,8,3,1],
  [11,1,2,11,7,1,7,5,1],[0,8,3,1,2,7,1,7,5,7,2,11],
  [9,7,5,9,2,7,9,0,2,2,11,7],[7,5,2,7,2,11,5,9,2,3,2,8,9,8,2],
  [2,5,10,2,3,5,3,7,5],[8,2,0,8,5,2,8,7,5,10,2,5],
  [9,0,1,5,10,3,5,3,7,3,10,2],[9,8,2,9,2,1,8,7,2,10,2,5,7,5,2],
  [1,3,5,3,7,5],[0,8,7,0,7,1,1,7,5],[9,0,3,9,3,5,5,3,7],[9,8,7,5,9,7],
  [5,8,4,5,10,8,10,11,8],[5,0,4,5,11,0,5,10,11,11,3,0],
  [0,1,9,8,4,10,8,10,11,10,4,5],[10,11,4,10,4,5,11,3,4,9,4,1,3,1,4],
  [2,5,1,2,8,5,2,11,8,4,5,8],[0,4,11,0,11,3,4,5,11,2,11,1,5,1,11],
  [0,2,5,0,5,9,2,11,5,4,5,8,11,8,5],[9,4,5,2,11,3],
  [2,5,10,3,5,2,3,4,5,3,8,4],[5,10,2,5,2,4,4,2,0],
  [3,10,2,3,5,10,3,8,5,4,5,8,0,1,9],[5,10,2,5,2,4,1,9,2,9,4,2],
  [8,4,5,8,5,3,3,5,1],[0,4,5,1,0,5],[8,4,5,8,5,3,9,0,5,0,3,5],[9,4,5],
  [4,11,7,4,9,11,9,10,11],[0,8,3,4,9,7,9,11,7,9,10,11],
  [1,10,11,1,11,4,1,4,0,7,4,11],[3,1,4,3,4,8,1,10,4,7,4,11,10,11,4],
  [4,11,7,9,11,4,9,2,11,9,1,2],[9,7,4,9,11,7,9,1,11,2,11,1,0,8,3],
  [11,7,4,11,4,2,2,4,0],[11,7,4,11,4,2,8,3,4,3,2,4],
  [2,9,10,2,7,9,2,3,7,7,4,9],[9,10,7,9,7,4,10,2,7,8,7,0,2,0,7],
  [3,7,10,3,10,2,7,4,10,1,10,0,4,0,10],[1,10,2,8,7,4],
  [4,9,1,4,1,7,7,1,3],[4,9,1,4,1,7,0,8,1,8,7,1],[4,0,3,7,4,3],
  [4,8,7],[9,10,8,10,11,8],[3,0,9,3,9,11,11,9,10],
  [0,1,10,0,10,8,8,10,11],[3,1,10,11,3,10],[1,2,11,1,11,9,9,11,8],
  [3,0,9,3,9,11,1,2,9,2,11,9],[0,2,11,8,0,11],[3,2,11],
  [2,3,8,2,8,10,10,8,9],[9,10,2,0,9,2],[2,3,8,2,8,10,0,1,8,1,10,8],
  [1,10,2],[1,3,8,9,1,8],[0,9,1],[0,3,8],[],
]

export interface VoxelCell {
  x0: number
  x1: number
  z0: number
  z1: number
  yTop: number
  yBot: number
}

export function buildBoxesMesh(cells: VoxelCell[]) {
  const positions: number[] = [], indices: number[] = []
  let vb = 0
  const quad = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dw: number) => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dw)
    indices.push(vb, vb + 1, vb + 2, vb, vb + 2, vb + 3); vb += 4
  }
  for (const c of cells) {
    const yt = c.yTop, yb = c.yBot
    if (yt - yb < 1e-7) continue
    const { x0, x1, z0, z1 } = c
    quad(x0, yt, z0, x1, yt, z0, x1, yt, z1, x0, yt, z1)
    quad(x0, yb, z1, x1, yb, z1, x1, yb, z0, x0, yb, z0)
    quad(x0, yb, z0, x1, yb, z0, x1, yt, z0, x0, yt, z0)
    quad(x1, yb, z1, x0, yb, z1, x0, yt, z1, x1, yt, z1)
    quad(x0, yb, z1, x0, yb, z0, x0, yt, z0, x0, yt, z1)
    quad(x1, yb, z0, x1, yb, z1, x1, yt, z1, x1, yt, z0)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices); geo.computeVertexNormals()
  return geo
}

export function smooth3D(src: Float32Array, nx: number, ny: number, nz: number, passes: number) {
  let a: any = src, b: any = new Float32Array(src.length)
  const at = (arr: Float32Array, i: number, j: number, k: number) => {
    // 경계 밖 → 가장 가까운 경계 복셀 값을 반사(clamp)하여 외곽/꼭지점 수축 방지
    const ci = i < 0 ? 0 : i >= nx ? nx - 1 : i
    const cj = j < 0 ? 0 : j >= ny ? ny - 1 : j
    const ck = k < 0 ? 0 : k >= nz ? nz - 1 : k
    return arr[(ck * ny + cj) * nx + ci]
  }
  for (let p = 0; p < passes; p++) {
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
      b[(k * ny + j) * nx + i] = (at(a, i - 1, j, k) + at(a, i, j, k) + at(a, i + 1, j, k)) / 3
    let temp = a; a = b; b = temp
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
      b[(k * ny + j) * nx + i] = (at(a, i, j - 1, k) + at(a, i, j, k) + at(a, i, j + 1, k)) / 3
    temp = a; a = b; b = temp
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
      b[(k * ny + j) * nx + i] = (at(a, i, j, k - 1) + at(a, i, j, k) + at(a, i, j, k + 1)) / 3
    temp = a; a = b; b = temp
  }
  return a
}

export function marchingCubes(
  field: Float32Array,
  nx: number,
  ny: number,
  nz: number,
  iso: number,
  nodeWorld: (i: number, j: number, l: number) => [number, number, number]
) {
  const positions: number[] = [], normals: number[] = []
  const OUTSIDE = -1e3
  const at = (i: number, j: number, k: number) => i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? OUTSIDE : field[(k * ny + j) * nx + i]
  const CO = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]
  const EV = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
  for (let k = -1; k < nz; k++) for (let j = -1; j < ny; j++) for (let i = -1; i < nx; i++) {
    const cv: number[] = []; let ci = 0
    for (let c = 0; c < 8; c++) { const v = at(i + CO[c][0], j + CO[c][1], k + CO[c][2]); cv.push(v); if (v < iso) ci |= 1 << c }
    const tris = TRI_TABLE[ci]; if (!tris || !tris.length) continue
    const cache: Record<number, { p: number[]; n: number[] }> = {}
    const edgeVert = (e: number) => {
      if (cache[e]) return cache[e]
      const a0 = EV[e][0], b0 = EV[e][1], va = cv[a0], vb = cv[b0]
      let t = (iso - va) / ((vb - va) || 1e-9); if (t < 0) t = 0; else if (t > 1) t = 1
      const ca = CO[a0], cb = CO[b0], ai = i + ca[0], aj = j + ca[1], ak = k + ca[2], bi = i + cb[0], bj = j + cb[1], bk = k + cb[2]
      const pa = nodeWorld(ai, aj, ak), pb = nodeWorld(bi, bj, bk)
      const p = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t]
      const gax = at(ai - 1, aj, ak) - at(ai + 1, aj, ak), gay = at(ai, aj - 1, ak) - at(ai, aj + 1, ak), gaz = at(ai, aj, ak - 1) - at(ai, aj, ak + 1)
      const gbx = at(bi - 1, bj, bk) - at(bi + 1, bj, bk), gby = at(bi, bj - 1, bk) - at(bi, bj + 1, bk), gbz = at(bi, bj, bk - 1) - at(bi, bj, bk + 1)
      let nxv = gax + (gbx - gax) * t, nyv = gay + (gby - gay) * t, nzv = gaz + (gbz - gaz) * t
      const len = Math.hypot(nxv, nyv, nzv) || 1
      cache[e] = { p, n: [nxv / len, nyv / len, nzv / len] }; return cache[e]
    }
    for (let t = 0; t < tris.length; t += 3) {
      const v0 = edgeVert(tris[t]), v1 = edgeVert(tris[t + 1]), v2 = edgeVert(tris[t + 2])
      positions.push(v0.p[0], v0.p[1], v0.p[2], v1.p[0], v1.p[1], v1.p[2], v2.p[0], v2.p[1], v2.p[2])
      normals.push(v0.n[0], v0.n[1], v0.n[2], v1.n[0], v1.n[1], v1.n[2], v2.n[0], v2.n[1], v2.n[2])
    }
  }
  return { positions, normals }
}

export function buildSurfaceMesh(grid: number[][], boxW: number, boxD: number, mScale: number) {
  const Ny = grid.length, Nx = grid[0].length
  const xAt = (i: number) => -boxW / 2 + (boxW * i) / (Nx - 1)
  const zAt = (j: number) => boxD / 2 - (boxD * j) / (Ny - 1)
  const positions: number[] = [], uvs: number[] = [], indices: number[] = []
  for (let j = 0; j < Ny; j++) for (let i = 0; i < Nx; i++) {
    positions.push(xAt(i), grid[j][i] * mScale, zAt(j)); uvs.push(i / (Nx - 1), j / (Ny - 1))
  }
  for (let j = 0; j < Ny - 1; j++) for (let i = 0; i < Nx - 1; i++) {
    const a = j * Nx + i, b = j * Nx + i + 1, c = (j + 1) * Nx + i, d = (j + 1) * Nx + i + 1
    indices.push(a, b, d, a, d, c)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices); geo.computeVertexNormals()
  return geo
}

export function buildLayerSolidGeometryData(
  topGrid: number[][],
  bottomGrid: number[][],
  boxW: number,
  boxD: number,
  mScale: number,
  xGrid?: number[][] | Float32Array[] | any,
  zGrid?: number[][] | Float32Array[] | any
) {
  const Ny = topGrid.length, Nx = topGrid[0].length
  const xAt = (i: number, j: number) => {
    if (xGrid && xGrid[j]) return xGrid[j][i]
    return -boxW / 2 + (boxW * i) / (Nx - 1)
  }
  const zAt = (j: number, i: number) => {
    if (zGrid && zGrid[j]) return zGrid[j][i]
    return boxD / 2 - (boxD * j) / (Ny - 1)
  }

  const positions: number[] = [], indices: number[] = []

  // 1. 꼭지점(Vertices) 배열 구성
  // 상부면 꼭지점 (인덱스: 0 ~ Nx*Ny - 1)
  for (let j = 0; j < Ny; j++) {
    for (let i = 0; i < Nx; i++) {
      positions.push(xAt(i, j), topGrid[j][i] * mScale, zAt(j, i))
    }
  }
  // 하부면 꼭지점 (인덱스: Nx*Ny ~ 2*Nx*Ny - 1)
  for (let j = 0; j < Ny; j++) {
    for (let i = 0; i < Nx; i++) {
      positions.push(xAt(i, j), bottomGrid[j][i] * mScale, zAt(j, i))
    }
  }

  const offset = Nx * Ny

  // 각 격자 좌표별 실제 지층 두께 계산 헬퍼
  const getThick = (jj: number, ii: number) => topGrid[jj][ii] - bottomGrid[jj][ii]

  // 2. 상/하부면 인덱스(삼각형) 생성
  for (let j = 0; j < Ny - 1; j++) {
    for (let i = 0; i < Nx - 1; i++) {
      const a = j * Nx + i, b = j * Nx + i + 1, c = (j + 1) * Nx + i, d = (j + 1) * Nx + i + 1
      
      // 네 꼭짓점의 지층 두께
      const tA = getThick(j, i)
      const tB = getThick(j, i + 1)
      const tC = getThick(j + 1, i)
      const tD = getThick(j + 1, i + 1)
      
      // 윗면 (두께가 있는 지점의 삼각형만 인덱스 빌드)
      if (tA > 0.001 || tB > 0.001 || tD > 0.001) indices.push(a, b, d)
      if (tA > 0.001 || tD > 0.001 || tC > 0.001) indices.push(a, d, c)
      
      // 아랫면 (두께가 있는 지점의 삼각형만 인덱스 빌드)
      const ba = offset + a, bb = offset + b, bc = offset + c, bd = offset + d
      if (tA > 0.001 || tD > 0.001 || tB > 0.001) indices.push(ba, bd, bb)
      if (tA > 0.001 || tC > 0.001 || tD > 0.001) indices.push(ba, bc, bd)
    }
  }

  // 3. 측면 테두리 벽(Side Skirts) 생성 (CCW 방향 정렬 완료)
  // 상부 경계 (j = 0)
  for (let i = 0; i < Nx - 1; i++) {
    const tA = i, tB = i + 1
    const bA = offset + tA, bB = offset + tB
    if (getThick(0, i) > 0.001 || getThick(0, i + 1) > 0.001) {
      indices.push(tA, bA, bB, tA, bB, tB)
    }
  }
  // 하부 경계 (j = Ny - 1)
  for (let i = 0; i < Nx - 1; i++) {
    const tA = (Ny - 1) * Nx + i, tB = (Ny - 1) * Nx + i + 1
    const bA = offset + tA, bB = offset + tB
    if (getThick(Ny - 1, i) > 0.001 || getThick(Ny - 1, i + 1) > 0.001) {
      indices.push(tA, tB, bB, tA, bB, bA)
    }
  }
  // 좌측 경계 (i = 0)
  for (let j = 0; j < Ny - 1; j++) {
    const tA = j * Nx, tB = (j + 1) * Nx
    const bA = offset + tA, bB = offset + tB
    if (getThick(j, 0) > 0.001 || getThick(j + 1, 0) > 0.001) {
      indices.push(tA, tB, bB, tA, bB, bA)
    }
  }
  // 우측 경계 (i = Nx - 1)
  for (let j = 0; j < Ny - 1; j++) {
    const tA = j * Nx + Nx - 1, tB = (j + 1) * Nx + Nx - 1
    const bA = offset + tA, bB = offset + tB
    if (getThick(j, Nx - 1) > 0.001 || getThick(j + 1, Nx - 1) > 0.001) {
      indices.push(tA, bA, bB, tA, bB, tB)
    }
  }

  return { positions, indices }
}
