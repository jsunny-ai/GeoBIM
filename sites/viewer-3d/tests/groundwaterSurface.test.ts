import assert from "node:assert/strict"
import test from "node:test"

import {
  createExactGroundwaterSurface,
  groundwaterHeadElevation,
} from "../src/lib/groundwaterSurface.ts"
import { groundwaterObservationsFromBoreholes } from "../src/lib/groundwaterData.ts"
import { buildGroundwaterGeometry } from "../src/lib/groundwaterGeometry.ts"
import { createLocalProjection } from "../src/lib/projection.ts"

test("groundwater head elevation uses collar elevation minus measured depth", () => {
  assert.equal(groundwaterHeadElevation(107.35, 4.2), 103.14999999999999)
})

test("authoritative surface passes exactly through every off-grid observation", () => {
  const anchors = [
    { x: 127.00123, y: 37.50117, headElevationM: 101.25 },
    { x: 127.00491, y: 37.50283, headElevationM: 97.8 },
    { x: 127.00307, y: 37.50649, headElevationM: 104.125 },
    { x: 127.00813, y: 37.50431, headElevationM: 99.45 },
  ]
  const surface = createExactGroundwaterSurface(anchors)

  for (const anchor of anchors) {
    assert.equal(surface.evaluate(anchor.x, anchor.y), anchor.headElevationM)
  }
  assert.deepEqual(surface.diagnose(), {
    observationCount: 4,
    maxAbsObservationErrorM: 0,
    meanAbsObservationErrorM: 0,
    constraintPassed: true,
    toleranceM: 1e-6,
  })
})

test("changing interpolation power never changes observation elevations", () => {
  const anchors = [
    { x: 0.13, y: 0.27, headElevationM: 12 },
    { x: 0.71, y: 0.62, headElevationM: 30 },
    { x: 0.46, y: 0.89, headElevationM: -4 },
  ]
  for (const power of [0.5, 1, 2, 4, 8]) {
    const surface = createExactGroundwaterSurface(anchors, power)
    for (const anchor of anchors) {
      assert.equal(surface.evaluate(anchor.x, anchor.y), anchor.headElevationM)
    }
  }
})

test("equal duplicate XY is deduplicated without changing its hard value", () => {
  const surface = createExactGroundwaterSurface([
    { x: 1, y: 2, headElevationM: 3, observationId: 10 },
    { x: 1, y: 2, headElevationM: 3, observationId: 11 },
  ])
  assert.equal(surface.anchors.length, 1)
  assert.equal(surface.evaluate(1, 2), 3)
})

test("conflicting values at the same XY are rejected instead of averaged", () => {
  assert.throws(
    () => createExactGroundwaterSurface([
      { x: 1, y: 2, headElevationM: 3 },
      { x: 1, y: 2, headElevationM: 4 },
    ]),
    /Conflicting groundwater observations/,
  )
})

test("missing groundwater remains unobserved and never becomes a zero anchor", () => {
  const observations = groundwaterObservationsFromBoreholes([
    {
      id: "missing", project_id: "1", name: "BH-1", longitude: 127, latitude: 37,
      elevation: 100, strata: [{ soil_type: "soil", depth_top: 0, depth_bottom: 10, raw_text: "{'지하수위': 'N/A'}" }],
    },
    {
      id: "observed", project_id: "1", name: "BH-2", longitude: 127.1, latitude: 37.1,
      elevation: 105, groundwater_depth_bgl_m: 4,
      strata: [{ soil_type: "soil", depth_top: 0, depth_bottom: 10 }],
    },
  ])
  assert.equal(observations.length, 1)
  assert.equal(observations[0].boreholeId, "observed")
  assert.equal(observations[0].headElevationM, 101)
})

test("groundwater mesh reports zero anchor error and embeds anchor axes", () => {
  const anchors = [
    { x: 127.00123, y: 37.50117, headElevationM: 101.25 },
    { x: 127.00491, y: 37.50283, headElevationM: 97.8 },
    { x: 127.00307, y: 37.50649, headElevationM: 104.125 },
  ]
  const geometry = buildGroundwaterGeometry(anchors, [127, 37.5, 127.01, 37.51], 2, 12)
  assert.ok(geometry)
  assert.equal(geometry.diagnostic.maxAbsObservationErrorM, 0)
  assert.equal(geometry.diagnostic.constraintPassed, true)
  assert.ok(geometry.indices.length > 0)
  const projection = createLocalProjection([127, 37.5, 127.01, 37.51], 2)
  for (const anchor of anchors) {
    const expected = projection.lngLatToModel(anchor.x, anchor.y)
    let embedded = false
    for (let index = 0; index < geometry.positions.length; index += 3) {
      if (
        Math.abs(geometry.positions[index] - expected.x) < 1e-5 &&
        Math.abs(geometry.positions[index + 1] - anchor.headElevationM * projection.metersToModel) < 1e-5 &&
        Math.abs(geometry.positions[index + 2] - expected.z) < 1e-5
      ) {
        embedded = true
        break
      }
    }
    assert.equal(embedded, true, "every observation must be an explicit rendered mesh vertex")
  }
})

test("groundwater geometry is a closed solid down to the model base", () => {
  const anchors = [
    { x: 127.001, y: 37.501, headElevationM: 100 },
    { x: 127.009, y: 37.501, headElevationM: 102 },
    { x: 127.005, y: 37.509, headElevationM: 98 },
  ]
  const bbox: [number, number, number, number] = [127, 37.5, 127.01, 37.51]
  const depthBelowMSL = 60
  const geometry = buildGroundwaterGeometry(anchors, bbox, 2, 12, depthBelowMSL)
  assert.ok(geometry)

  const projection = createLocalProjection(bbox, 2)
  const bottomY = -depthBelowMSL * projection.metersToModel
  const yValues = Array.from(
    { length: geometry.positions.length / 3 },
    (_, index) => geometry.positions[index * 3 + 1],
  )
  const bottomVertices = yValues.filter((y) => Math.abs(y - bottomY) < 1e-5)

  assert.ok(bottomVertices.length > 2, "solid must contain a bottom cap")
  assert.ok(
    geometry.indices.length > bottomVertices.length * 3,
    "solid must contain top, bottom and boundary-side triangles",
  )
})
