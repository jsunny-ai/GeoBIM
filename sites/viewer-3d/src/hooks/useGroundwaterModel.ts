import { useEffect, useMemo, useRef, type RefObject } from "react"
import * as THREE from "three"
import type { Borehole } from "@/lib/types"
import { groundwaterObservationsFromBoreholes } from "@/lib/groundwaterData"
import { buildGroundwaterGeometry } from "@/lib/groundwaterGeometry"
import { createLocalProjection, type Bbox } from "@/lib/projection"

interface GroundwaterSettings {
  visible: boolean
  showMarkers: boolean
  opacity: number
  verticalExag: number
  depthBelowMSL: number
}

export function useGroundwaterModel(
  sceneRef: RefObject<THREE.Scene | null>, boreholes: readonly Borehole[], bbox: Bbox | null, settings: GroundwaterSettings,
) {
  const groupRef = useRef<THREE.Group | null>(null)
  const observations = useMemo(() => groundwaterObservationsFromBoreholes(boreholes), [boreholes])
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !bbox) return
    const group = new THREE.Group()
    group.name = "groundwaterGroup"; group.scale.y = settings.verticalExag; scene.add(group); groupRef.current = group
    const projection = createLocalProjection(bbox)
    const geometryData = buildGroundwaterGeometry(
      observations,
      bbox,
      2,
      42,
      settings.depthBelowMSL,
    )
    if (geometryData) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute("position", new THREE.BufferAttribute(geometryData.positions, 3))
      geometry.setIndex(new THREE.BufferAttribute(geometryData.indices, 1)); geometry.computeVertexNormals()
      const material = new THREE.MeshStandardMaterial({
        color: 0x22b8cf, emissive: 0x063d48, emissiveIntensity: 0.16, transparent: true,
        opacity: settings.opacity, depthWrite: false, side: THREE.DoubleSide, roughness: 0.35,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = "groundwaterSolid"; mesh.renderOrder = 900; mesh.userData.constraintDiagnostic = geometryData.diagnostic
      group.add(mesh)
    }
    for (const observation of observations) {
      const p = projection.lngLatToModel(observation.x, observation.y)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(Math.max(projection.metersToModel * 2.2, 0.008), Math.max(projection.metersToModel * 0.5, 0.002), 8, 28),
        new THREE.MeshBasicMaterial({ color: 0x0284c7, depthTest: false }),
      )
      ring.rotation.x = Math.PI / 2
      ring.position.set(p.x, observation.headElevationM * projection.metersToModel, p.z)
      ring.renderOrder = 905; ring.name = `groundwaterObservation:${observation.boreholeId}`
      ring.userData = { ...observation, kind: "groundwater-observation" }; ring.visible = settings.showMarkers
      group.add(ring)
    }
    group.visible = settings.visible
    return () => {
      scene.remove(group)
      group.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
        if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose()); else mesh.material?.dispose()
      })
      if (groupRef.current === group) groupRef.current = null
    }
  }, [bbox, observations, sceneRef, settings.depthBelowMSL, settings.opacity, settings.showMarkers, settings.verticalExag, settings.visible])
  return { groundwaterGroupRef: groupRef, observationCount: observations.length, canBuildSurface: observations.length >= 3 }
}
