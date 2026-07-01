import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react"
import * as THREE from "three"
// @ts-ignore
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import {
  createVerticalPlane,
  getSectionAzimuth,
  getSectionDirection,
  getSectionLengthM,
  getSectionNormal,
  isValidSectionLine,
  modelOffsetFromMeters,
} from "@/lib/sectionPlane"
import type { SectionPoint, VerticalSectionState } from "@/lib/types"

interface SectionTargets {
  smoothMeshRef: RefObject<Record<string, THREE.Mesh>>
  voxelMeshRef: RefObject<Record<string, THREE.Mesh>>
  drapeRef: RefObject<THREE.Mesh | null>
  bhGroupRef: RefObject<THREE.Group | null>
  markerRef: RefObject<THREE.Mesh | null>
  stratumGroupRef: RefObject<THREE.Group | null>
  groundwaterGroupRef: RefObject<THREE.Group | null>
  dimsRef: RefObject<{ boxW: number; boxD: number; lngWidthM: number; latWidthM: number; mScale: number }>
}

interface UseSectionPlaneArgs {
  sceneRef: RefObject<THREE.Scene | null>
  cameraRef: RefObject<THREE.PerspectiveCamera | null>
  controlsRef: RefObject<OrbitControls | null>
  containerRef: RefObject<HTMLDivElement | null>
  targets: SectionTargets
  state: VerticalSectionState
  setState: React.Dispatch<React.SetStateAction<VerticalSectionState>>
  verticalExag: number
  setStatus: (message: string) => void
}

const setObjectClipping = (object: THREE.Object3D | null, planes: THREE.Plane[] | null) => {
  object?.traverse((child) => {
    const renderable = child as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }
    if (!renderable.material) return
    const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material]
    for (const material of materials) {
      const currentPlane = material.clippingPlanes?.[0] ?? null
      const nextPlane = planes?.[0] ?? null
      if (currentPlane === nextPlane && Boolean(material.clippingPlanes) === Boolean(planes)) continue
      material.clippingPlanes = planes
      material.clipIntersection = false
      material.needsUpdate = true
    }
  })
}

export function useSectionPlane({
  sceneRef,
  cameraRef,
  controlsRef,
  containerRef,
  targets,
  state,
  setState,
  verticalExag,
  setStatus,
}: UseSectionPlaneArgs) {
  const planeRef = useRef<THREE.Plane | null>(null)
  const helperGroupRef = useRef<THREE.Group | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  const hasSection = state.enabled && isValidSectionLine(state.start, state.end)
  const metrics = useMemo(() => {
    if (!state.start || !state.end || !isValidSectionLine(state.start, state.end)) {
      return { azimuth: 0, lengthM: 0 }
    }
    return {
      azimuth: getSectionAzimuth(state.start, state.end),
      lengthM: getSectionLengthM(state.start, state.end, targets.dimsRef.current?.mScale || 1),
    }
  }, [state.start, state.end, targets.dimsRef])

  const clearHelper = useCallback(() => {
    const group = helperGroupRef.current
    if (!group) return
    group.parent?.remove(group)
    group.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material
      if (Array.isArray(material)) material.forEach((item) => item.dispose())
      else material?.dispose()
    })
    helperGroupRef.current = null
  }, [])

  const buildHelper = useCallback((start: SectionPoint, end: SectionPoint, plane: THREE.Plane) => {
    clearHelper()
    const scene = sceneRef.current
    if (!scene || !stateRef.current.showHelper) return

    const dims = targets.dimsRef.current
    const width = Math.max(Math.hypot(dims.boxW, dims.boxD) * 1.35, 1)
    const height = Math.max(dims.boxW, dims.boxD) * Math.max(1.5, verticalExag * 0.8)
    const center = new THREE.Vector3((start.x + end.x) / 2, 0, (start.z + end.z) / 2)
    const baseNormal = getSectionNormal(start, end, stateRef.current.flipped)
    center.addScaledVector(baseNormal, modelOffsetFromMeters(stateRef.current.offsetM, dims.mScale))

    const group = new THREE.Group()
    group.name = "vertical-section-helper"

    const planeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        color: 0x0891b2,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    planeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal)
    planeMesh.position.copy(center)
    planeMesh.renderOrder = 900
    group.add(planeMesh)

    const direction = getSectionDirection(start, end)
    const half = width / 2
    const lineY = height / 2
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      center.clone().addScaledVector(direction, -half).setY(lineY),
      center.clone().addScaledVector(direction, half).setY(lineY),
    ])
    const line = new THREE.Line(
      lineGeometry,
      new THREE.LineBasicMaterial({ color: 0x06b6d4, depthTest: false }),
    )
    line.renderOrder = 902
    group.add(line)

    const handleGeometry = new THREE.SphereGeometry(Math.max(width * 0.012, 0.018), 16, 12)
    const addHandle = (point: SectionPoint, color: number) => {
      const handle = new THREE.Mesh(
        handleGeometry.clone(),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      )
      handle.position.set(point.x, lineY, point.z)
      handle.position.addScaledVector(baseNormal, modelOffsetFromMeters(stateRef.current.offsetM, dims.mScale))
      handle.renderOrder = 903
      group.add(handle)
    }
    addHandle(start, 0x22d3ee)
    addHandle(end, 0xf59e0b)
    handleGeometry.dispose()

    const arrow = new THREE.ArrowHelper(
      plane.normal,
      center.clone().setY(0),
      Math.max(width * 0.12, 0.15),
      0xef4444,
      Math.max(width * 0.035, 0.04),
      Math.max(width * 0.02, 0.025),
    )
    arrow.renderOrder = 904
    group.add(arrow)

    scene.add(group)
    helperGroupRef.current = group
  }, [clearHelper, sceneRef, targets.dimsRef, verticalExag])

  useEffect(() => {
    const start = state.start
    const end = state.end
    let plane: THREE.Plane | null = null
    if (state.enabled && start && end && isValidSectionLine(start, end)) {
      plane = createVerticalPlane(
        start,
        end,
        modelOffsetFromMeters(state.offsetM, targets.dimsRef.current?.mScale || 1),
        state.flipped,
      )
    }
    planeRef.current = plane
    const planes = plane ? [plane] : null

    for (const mesh of Object.values(targets.smoothMeshRef.current ?? {})) setObjectClipping(mesh, planes)
    for (const mesh of Object.values(targets.voxelMeshRef.current ?? {})) setObjectClipping(mesh, planes)
    setObjectClipping(targets.drapeRef.current, state.clipDrape ? planes : null)
    setObjectClipping(targets.bhGroupRef.current, planes)
    setObjectClipping(targets.markerRef.current, planes)
    setObjectClipping(targets.groundwaterGroupRef.current, planes)

    if (plane && start && end) buildHelper(start, end, plane)
    else clearHelper()
  }, [
    buildHelper,
    clearHelper,
    state.clipDrape,
    state.enabled,
    state.end,
    state.flipped,
    state.offsetM,
    state.showHelper,
    state.start,
    targets.bhGroupRef,
    targets.drapeRef,
    targets.dimsRef,
    targets.groundwaterGroupRef,
    targets.markerRef,
    targets.smoothMeshRef,
    targets.voxelMeshRef,
  ])

  // Newly generated meshes need the current plane even if the section state itself did not change.
  useEffect(() => {
    if (!hasSection) return
    const timer = window.setInterval(() => {
      const plane = planeRef.current
      if (!plane) return
      const planes = [plane]
      for (const mesh of Object.values(targets.smoothMeshRef.current ?? {})) {
        const material = mesh.material as THREE.Material
        if (material.clippingPlanes?.[0] !== plane) setObjectClipping(mesh, planes)
      }
      for (const mesh of Object.values(targets.voxelMeshRef.current ?? {})) {
        const material = mesh.material as THREE.Material
        if (material.clippingPlanes?.[0] !== plane) setObjectClipping(mesh, planes)
      }
      if (stateRef.current.clipDrape) setObjectClipping(targets.drapeRef.current, planes)
      setObjectClipping(targets.bhGroupRef.current, planes)
      setObjectClipping(targets.markerRef.current, planes)
      setObjectClipping(targets.groundwaterGroupRef.current, planes)
    }, 500)
    return () => window.clearInterval(timer)
  }, [hasSection, targets.bhGroupRef, targets.drapeRef, targets.groundwaterGroupRef, targets.markerRef, targets.smoothMeshRef, targets.voxelMeshRef])

  useEffect(() => {
    if (!state.enabled || (state.interactionMode !== "placing-start" && state.interactionMode !== "placing-end")) return
    const container = containerRef.current
    if (!container) return
    const raycaster = new THREE.Raycaster()
    const fallbackPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    let pointerDown = { x: 0, y: 0, at: 0 }

    const onPointerDown = (event: PointerEvent) => {
      pointerDown = { x: event.clientX, y: event.clientY, at: performance.now() }
    }
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      const dx = event.clientX - pointerDown.x
      const dy = event.clientY - pointerDown.y
      if (dx * dx + dy * dy > 25 || performance.now() - pointerDown.at > 500) return
      const camera = cameraRef.current
      if (!camera) return
      const rect = container.getBoundingClientRect()
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(pointer, camera)

      const candidates: THREE.Object3D[] = []
      if (targets.drapeRef.current?.visible) candidates.push(targets.drapeRef.current)
      const activeMeshes = [
        ...Object.values(targets.smoothMeshRef.current ?? {}),
        ...Object.values(targets.voxelMeshRef.current ?? {}),
      ].filter((mesh) => mesh.visible)
      candidates.push(...activeMeshes)
      const hit = raycaster.intersectObjects(candidates, false)[0]
      const worldPoint = hit?.point ?? raycaster.ray.intersectPlane(fallbackPlane, new THREE.Vector3())
      if (!worldPoint) {
        setStatus("모델 영역 안에서 절단점을 선택하세요.")
        return
      }
      const point = { x: worldPoint.x, z: worldPoint.z }
      const current = stateRef.current
      if (current.interactionMode === "placing-start") {
        setState((previous) => ({
          ...previous,
          start: point,
          end: null,
          offsetM: 0,
          interactionMode: "placing-end",
        }))
        setStatus("절단선의 끝점을 선택하세요.")
        return
      }
      if (!current.start || !isValidSectionLine(current.start, point, targets.dimsRef.current.mScale)) {
        setStatus("두 점이 너무 가깝습니다. 1m 이상 떨어진 위치를 선택하세요.")
        return
      }
      setState((previous) => ({ ...previous, end: point, interactionMode: "editing" }))
      setStatus("수직 단면이 생성되었습니다.")
    }

    container.style.cursor = "crosshair"
    container.addEventListener("pointerdown", onPointerDown, true)
    container.addEventListener("pointerup", onPointerUp, true)
    return () => {
      container.style.cursor = ""
      container.removeEventListener("pointerdown", onPointerDown, true)
      container.removeEventListener("pointerup", onPointerUp, true)
    }
  }, [
    cameraRef,
    containerRef,
    setState,
    setStatus,
    state.enabled,
    state.interactionMode,
    targets.dimsRef,
    targets.drapeRef,
    targets.smoothMeshRef,
    targets.voxelMeshRef,
  ])

  const focusSection = useCallback(() => {
    const current = stateRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!current.start || !current.end || !camera || !controls || !isValidSectionLine(current.start, current.end)) return
    const dims = targets.dimsRef.current
    const normal = getSectionNormal(current.start, current.end, current.flipped)
    const center = new THREE.Vector3(
      (current.start.x + current.end.x) / 2,
      0,
      (current.start.z + current.end.z) / 2,
    )
    center.addScaledVector(normal, modelOffsetFromMeters(current.offsetM, dims.mScale))
    const distance = Math.max(dims.boxW, dims.boxD) * 1.35
    camera.up.set(0, 1, 0)
    camera.position.copy(center).addScaledVector(normal, distance)
    controls.target.copy(center)
    camera.lookAt(center)
    controls.update()
  }, [cameraRef, controlsRef, targets.dimsRef])

  const redrawSection = useCallback(() => {
    setState((previous) => ({
      ...previous,
      enabled: true,
      interactionMode: "placing-start",
      start: null,
      end: null,
      offsetM: 0,
    }))
    setStatus("절단선의 시작점을 선택하세요.")
  }, [setState, setStatus])

  const resetSection = useCallback(() => {
    setState((previous) => ({
      ...previous,
      enabled: false,
      interactionMode: "idle",
      start: null,
      end: null,
      offsetM: 0,
      flipped: false,
    }))
    setStatus("수직 단면을 종료했습니다.")
  }, [setState, setStatus])

  useEffect(() => {
    if (!state.enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT") return
      if (event.key === "Escape") {
        if (stateRef.current.interactionMode === "placing-end") {
          setState((previous) => ({ ...previous, start: null, interactionMode: "placing-start" }))
          setStatus("절단선의 시작점을 선택하세요.")
        } else {
          resetSection()
        }
      } else if (event.key.toLowerCase() === "f" && hasSection) {
        setState((previous) => ({ ...previous, flipped: !previous.flipped }))
      } else if (event.key.toLowerCase() === "c" && hasSection) {
        focusSection()
      } else if ((event.key === "[" || event.key === "]") && hasSection) {
        const step = event.shiftKey ? 10 : 1
        setState((previous) => ({
          ...previous,
          offsetM: previous.offsetM + (event.key === "]" ? step : -step),
        }))
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [focusSection, hasSection, resetSection, setState, setStatus, state.enabled])

  useEffect(() => () => {
    clearHelper()
    const allTargets: THREE.Object3D[] = [
      ...Object.values(targets.smoothMeshRef.current ?? {}),
      ...Object.values(targets.voxelMeshRef.current ?? {}),
    ]
    if (targets.drapeRef.current) allTargets.push(targets.drapeRef.current)
    if (targets.bhGroupRef.current) allTargets.push(targets.bhGroupRef.current)
    if (targets.markerRef.current) allTargets.push(targets.markerRef.current)
    if (targets.groundwaterGroupRef.current) allTargets.push(targets.groundwaterGroupRef.current)
    allTargets.forEach((object) => setObjectClipping(object, null))
  }, [clearHelper, targets.bhGroupRef, targets.drapeRef, targets.groundwaterGroupRef, targets.markerRef, targets.smoothMeshRef, targets.voxelMeshRef])

  return {
    hasSection,
    metrics,
    focusSection,
    redrawSection,
    resetSection,
  }
}
