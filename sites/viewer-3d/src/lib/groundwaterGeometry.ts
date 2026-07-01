import { createExactGroundwaterSurface, type GroundwaterAnchor } from "./groundwaterSurface.ts"
import { createLocalProjection, type Bbox } from "./projection.ts"

export interface GroundwaterGeometryData {
  positions: Float32Array
  indices: Uint32Array
  diagnostic: ReturnType<ReturnType<typeof createExactGroundwaterSurface>["diagnose"]>
}
type Point2 = { x: number; y: number }
const cross = (o: Point2, a: Point2, b: Point2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

export function convexHull(points: readonly Point2[]): Point2[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length <= 1) return sorted
  const lower: Point2[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: Point2[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i]
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop()
    upper.push(point)
  }
  lower.pop(); upper.pop()
  return [...lower, ...upper]
}

function insideConvex(point: Point2, hull: readonly Point2[]) {
  if (hull.length < 3) return false
  let sign = 0
  for (let i = 0; i < hull.length; i++) {
    const value = cross(hull[i], hull[(i + 1) % hull.length], point)
    if (Math.abs(value) < 1e-14) continue
    const current = Math.sign(value)
    if (sign && current !== sign) return false
    sign = current
  }
  return true
}

function constrainedAxis(min: number, max: number, count: number, anchors: number[]) {
  const values = [...Array.from({ length: count }, (_, i) => min + ((max - min) * i) / (count - 1)), ...anchors].sort((a, b) => a - b)
  const epsilon = Math.max(Math.abs(max - min) * 1e-12, 1e-14)
  return values.filter((value, index) => index === 0 || Math.abs(value - values[index - 1]) > epsilon)
}

export function buildGroundwaterGeometry(
  anchors: readonly GroundwaterAnchor[],
  bbox: Bbox,
  modelWidth = 2,
  resolution = 42,
  depthBelowMSL = 50,
): GroundwaterGeometryData | null {
  if (anchors.length < 3) return null
  const surface = createExactGroundwaterSurface(anchors)
  const hull = convexHull(anchors)
  if (hull.length < 3) return null
  const gx = constrainedAxis(bbox[0], bbox[2], resolution, anchors.map((a) => a.x))
  const gy = constrainedAxis(bbox[1], bbox[3], resolution, anchors.map((a) => a.y))
  const projection = createLocalProjection(bbox, modelWidth)
  const positions: number[] = []
  const vertexIndex = new Map<string, number>()
  const getVertex = (i: number, j: number) => {
    const key = `${i}:${j}`, existing = vertexIndex.get(key)
    if (existing !== undefined) return existing
    const lng = gx[i], lat = gy[j], model = projection.lngLatToModel(lng, lat)
    const index = positions.length / 3
    positions.push(model.x, surface.evaluate(lng, lat) * projection.metersToModel, model.z)
    vertexIndex.set(key, index)
    return index
  }
  const indices: number[] = []
  for (let j = 0; j < gy.length - 1; j++) for (let i = 0; i < gx.length - 1; i++) {
    const samplePoints = [
      { x: (gx[i] + gx[i + 1]) / 2, y: (gy[j] + gy[j + 1]) / 2 },
      { x: gx[i], y: gy[j] }, { x: gx[i + 1], y: gy[j] },
      { x: gx[i], y: gy[j + 1] }, { x: gx[i + 1], y: gy[j + 1] },
    ]
    // Include boundary-touching cells so each observation XY is an explicit
    // rendered mesh vertex, even at an acute convex-hull corner.
    if (!samplePoints.some((point) => insideConvex(point, hull))) continue
    const a = getVertex(i, j), b = getVertex(i + 1, j), c = getVertex(i, j + 1), d = getVertex(i + 1, j + 1)
    indices.push(a, c, b, b, c, d)
  }

  // Turn the interpolated water table into a closed saturated-zone solid.
  // Its bottom follows the viewer's model depth below mean sea level.
  const topVertexCount = positions.length / 3
  if (topVertexCount === 0 || indices.length === 0) return null
  const minimumTopY = Math.min(...Array.from({ length: topVertexCount }, (_, i) => positions[i * 3 + 1]))
  const bottomY = Math.min(
    -Math.abs(depthBelowMSL) * projection.metersToModel,
    minimumTopY - Math.max(projection.metersToModel * 0.1, 1e-6),
  )
  for (let i = 0; i < topVertexCount; i++) {
    positions.push(positions[i * 3], bottomY, positions[i * 3 + 2])
  }

  const topIndices = [...indices]
  const solidIndices = [...topIndices]
  for (let i = 0; i < topIndices.length; i += 3) {
    solidIndices.push(
      topIndices[i] + topVertexCount,
      topIndices[i + 2] + topVertexCount,
      topIndices[i + 1] + topVertexCount,
    )
  }

  const boundaryEdges = new Map<string, { a: number; b: number; count: number }>()
  const addEdge = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    const edge = boundaryEdges.get(key)
    if (edge) edge.count += 1
    else boundaryEdges.set(key, { a, b, count: 1 })
  }
  for (let i = 0; i < topIndices.length; i += 3) {
    const a = topIndices[i], b = topIndices[i + 1], c = topIndices[i + 2]
    addEdge(a, b); addEdge(b, c); addEdge(c, a)
  }
  for (const edge of boundaryEdges.values()) {
    if (edge.count !== 1) continue
    const { a, b } = edge
    solidIndices.push(
      a, b, b + topVertexCount,
      a, b + topVertexCount, a + topVertexCount,
    )
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(solidIndices),
    diagnostic: surface.diagnose(),
  }
}
