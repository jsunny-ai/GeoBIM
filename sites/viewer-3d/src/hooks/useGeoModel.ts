import { useCallback, useEffect, useRef, type RefObject } from "react"
// @ts-ignore
import * as THREE from "three"
// @ts-ignore
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { buildAreaCanvas } from "@/lib/terrain"
import { buildBoxesMesh, buildSurfaceMesh } from "../lib/geoGeometry"
import { createLocalProjection, type Bbox } from "@/lib/projection"
import type { Borehole } from "@/lib/types"

const LAYER_COLOR: Record<string, number> = {
  soil: 0x8b7355,
  weathered_rock: 0xc4a57b,
  soft_rock: 0x6b8e5a,
  normal_rock: 0x5f6552,
  hard_rock: 0x3d3d3d,
  unknown: 0xb4b4b4,
}

export interface GeoModelSettings {
  verticalExag: number
  depthBelowMSL: number
  basemap: "Satellite" | "Hybrid" | "Base"
  visibility: Record<string, boolean>
  showColumns: boolean
  showDrape: boolean
  renderMode: "smooth" | "voxel"
  basementMode: "extend" | "unknown"
  selectedBh: string | null
  setSelectedBh: (id: string | null) => void
  setStatus: (msg: string) => void
  bhPosRef: RefObject<Record<string, { x: number; y: number; z: number }>>
}

const LAYER_STACK = ["soil", "weathered_rock", "soft_rock", "normal_rock", "hard_rock", "unknown"]

// [v4] 표시 규칙 — 미분류 구간 처리 세그먼트 토글:
//   연장 모드("extend")   → "@ext" 메쉬 5개만 표시 (연장분이 흡수된 단일 솔리드)
//   미분류 유지("unknown") → 관측 메쉬 5개 + 미분류 회색 솔리드 표시
const layerVisible = (type: string, vis: Record<string, boolean>, mode: "extend" | "unknown") => {
  const isExt = type.endsWith("@ext")
  const base = isExt ? type.slice(0, -4) : type
  if (mode === "extend") return isExt && (vis[base] ?? true)
  return !isExt && (vis[type] ?? true)
}
const LAYER_SETS: Record<GeoModelSettings["basemap"], string[]> = {
  Base: ["Base"],
  Satellite: ["Satellite"],
  Hybrid: ["Satellite", "Hybrid"],
}

export function useGeoModel(
  sceneRef: RefObject<THREE.Scene | null>,
  cameraRef: RefObject<THREE.PerspectiveCamera | null>,
  controlsRef: RefObject<OrbitControls | null>,
  boreholes: Borehole[],
  bbox: number[] | null,
  polygon: { lng: number; lat: number }[] | null,
  settings: GeoModelSettings,
  containerRef: RefObject<HTMLDivElement | null>,
) {
  const dimsRef = useRef({ boxW: 2, boxD: 2, lngWidthM: 1, latWidthM: 1, mScale: 1 })
  const smoothMeshRef = useRef<Record<string, THREE.Mesh>>({})
  const voxelMeshRef = useRef<Record<string, THREE.Mesh>>({})
  const drapeRef = useRef<THREE.Mesh | null>(null)
  const drapeMatRef = useRef<THREE.MeshBasicMaterial | null>(null)
  const bhGroupRef = useRef<THREE.Group | null>(null)
  const markerRef = useRef<THREE.Mesh | null>(null)
  const stratumGroupRef = useRef<THREE.Group | null>(null)
  const drapeTextureSeqRef = useRef(0)
  const workerRef = useRef<Worker | null>(null)
  const polygonRef = useRef(polygon)
  polygonRef.current = polygon

  const {
    verticalExag,
    depthBelowMSL,
    basemap,
    visibility,
    showColumns,
    showDrape,
    renderMode,
    basementMode,
    selectedBh,
    setSelectedBh,
    setStatus,
    bhPosRef,
  } = settings

  const visibilityRef = useRef(visibility)
  const showColumnsRef = useRef(showColumns)
  const showDrapeRef = useRef(showDrape)
  const renderModeRef = useRef(renderMode)
  const basementModeRef = useRef(basementMode)
  const basemapRef = useRef(basemap)
  const verticalExagRef = useRef(verticalExag)

  visibilityRef.current = visibility
  showColumnsRef.current = showColumns
  showDrapeRef.current = showDrape
  renderModeRef.current = renderMode
  basementModeRef.current = basementMode
  basemapRef.current = basemap
  verticalExagRef.current = verticalExag

  const applyDrapeTexture = useCallback(
    (targetBasemap: GeoModelSettings["basemap"], targetBbox: number[]) => {
      const drapeMat = drapeMatRef.current
      if (!drapeMat || targetBbox.length !== 4) return

      const seq = ++drapeTextureSeqRef.current
      buildAreaCanvas(targetBbox as [number, number, number, number], LAYER_SETS[targetBasemap], polygonRef.current || undefined)
        .then((drapeCanvas) => {
          if (seq !== drapeTextureSeqRef.current || drapeMatRef.current !== drapeMat) return
          const loadedTex = new THREE.CanvasTexture(drapeCanvas)
          loadedTex.colorSpace = THREE.SRGBColorSpace
          loadedTex.wrapS = THREE.ClampToEdgeWrapping
          loadedTex.wrapT = THREE.ClampToEdgeWrapping
          loadedTex.anisotropy = 4
          loadedTex.needsUpdate = true

          if (drapeMat.map && typeof drapeMat.map.dispose === "function") drapeMat.map.dispose()
          drapeMat.color.setHex(0xffffff)
          drapeMat.transparent = false
          drapeMat.opacity = 1.0
          drapeMat.map = loadedTex
          drapeMat.needsUpdate = true
        })
        .catch((err) => {
          console.error("V-World texture load failed:", err)
        })
    },
    [],
  )

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !bbox || boreholes.length === 0) return

    let active = true

    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }

    let marker = markerRef.current
    if (!marker) {
      marker = new THREE.Mesh(
        new THREE.ConeGeometry(0.02, 0.05, 4),
        new THREE.MeshStandardMaterial({
          color: 0xffd24a,
          emissive: 0x6b5410,
          roughness: 0.4,
        }),
      )
      marker.rotation.x = Math.PI
      marker.visible = false
      scene.add(marker)
      markerRef.current = marker
    }

    let stratumGroup = stratumGroupRef.current
    if (!stratumGroup) {
      stratumGroup = new THREE.Group()
      scene.add(stratumGroup)
      stratumGroupRef.current = stratumGroup
    }
    stratumGroup.scale.set(1, verticalExagRef.current, 1)

    const projection = createLocalProjection(bbox as Bbox)
    const lngWidthM = projection.widthM
    const latWidthM = projection.heightM
    const boxW = projection.modelWidth
    const boxD = projection.modelDepth
    const mScale = projection.metersToModel
    dimsRef.current = { boxW, boxD, lngWidthM, latWidthM, mScale }

    const lngToX = (lng: number, lat: number) => projection.lngLatToModel(lng, lat).x
    const latToZ = (lng: number, lat: number) => projection.lngLatToModel(lng, lat).z

    const fitCamera = () => {
      const cam = cameraRef.current
      const ctr = controlsRef.current
      if (!cam || !ctr) return
      ctr.target.set(0, -0.1 * verticalExagRef.current, 0)
      cam.position.set(boxW * 1.0, boxW * 0.9, boxD * 1.1)
      ctr.update()
    }

    while (stratumGroup.children.length > 0) {
      const child = stratumGroup.children[0]
      stratumGroup.remove(child)
      if ((child as THREE.Mesh).isMesh) {
        ;(child as THREE.Mesh).geometry.dispose()
        const material = (child as THREE.Mesh).material
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material.dispose()
      }
    }

    setStatus("지표면 지도 텍스처 생성 중...")
    const drapeSeq = ++drapeTextureSeqRef.current
    const drapeCanvasPromise = buildAreaCanvas(bbox as [number, number, number, number], LAYER_SETS[basemapRef.current])
      .then((drapeCanvas) => {
        const loadedTex = new THREE.CanvasTexture(drapeCanvas)
        loadedTex.colorSpace = THREE.SRGBColorSpace
        loadedTex.wrapS = THREE.ClampToEdgeWrapping
        loadedTex.wrapT = THREE.ClampToEdgeWrapping
        loadedTex.anisotropy = 4
        loadedTex.needsUpdate = true
        return loadedTex
      })
      .catch((err) => {
        console.error("V-World texture load failed:", err)
        return null
      })

    setStatus("지층 구조 분석 Worker 생성 중...")
    const worker = new Worker(new URL("../workers/geoWorker.ts", import.meta.url), { type: "module" })
    workerRef.current = worker

    const N = 192
    worker.postMessage({
      boreholes,
      bbox,
      N,
      depthBelowMSL,
      mScale,
      boxW,
      boxD,
      renderMode,
    })

    worker.onmessage = (event) => {
      if (!active) return
      const msg = event.data

      if (msg.type === "progress") {
        setStatus(msg.step)
        return
      }

      if (msg.type === "error") {
        setStatus(`로드 실패: ${msg.error}`)
        return
      }

      if (msg.type !== "done") return

      const {
        elevGrid,
        smoothMeshData,
        voxelCells,
        dz,
        MZ,
        confRadiusM,
        lngWidthM: resultLngWidthM,
        latWidthM: resultLatWidthM,
        skippedDeep,
      } = msg

      const drapeGeo = buildSurfaceMesh(elevGrid, boxW, boxD, mScale)
      const drapeMat = new THREE.MeshBasicMaterial({
        color: 0x4e6e58,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        transparent: true,
        opacity: 0.55,
      })
      drapeMatRef.current = drapeMat
      const drape = new THREE.Mesh(drapeGeo, drapeMat)
      drape.position.y += 0.002
      drape.visible = showDrapeRef.current
      stratumGroup.add(drape)
      drapeRef.current = drape

      if (drapeMat && bbox.length === 4) {
        const drapeSeq = ++drapeTextureSeqRef.current
        const drapeCanvasPromise = buildAreaCanvas(bbox as [number, number, number, number], LAYER_SETS[basemapRef.current], polygonRef.current || undefined)
        drapeCanvasPromise.then((drapeCanvas) => {
          if (!active || drapeSeq !== drapeTextureSeqRef.current) return
          if (!drapeCanvas) return
          
          const loadedTex = new THREE.CanvasTexture(drapeCanvas)
          loadedTex.colorSpace = THREE.SRGBColorSpace
          loadedTex.wrapS = THREE.ClampToEdgeWrapping
          loadedTex.wrapT = THREE.ClampToEdgeWrapping
          loadedTex.anisotropy = 4
          loadedTex.needsUpdate = true

          if (drapeMat.map && typeof drapeMat.map.dispose === "function") drapeMat.map.dispose()
          drapeMat.color.setHex(0xffffff)
          drapeMat.transparent = false
          drapeMat.opacity = 1.0
          drapeMat.map = loadedTex
          drapeMat.needsUpdate = true
        })
      }

      const smoothMeshes: Record<string, THREE.Mesh> = {}
      for (const [type, data] of Object.entries(smoothMeshData)) {
        const { positions, normals, indices } = data as any
        const geo = new THREE.BufferGeometry()
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
        
        if (indices) {
          geo.setIndex(new THREE.BufferAttribute(indices, 1))
        } else if (normals) {
          geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3))
        }
        geo.computeVertexNormals()

        // 지층 퇴적 순서(s)에 따라 계단식 polygonOffset을 부여하여 겹치는 구역의 Z-Fighting을 원천 차단
        // "@ext" = 연장 모드 메쉬 — 연장분이 유효 두께에 흡수된 동일 지층이므로 관측 메쉬와 동일 재질
        const baseType = type.endsWith("@ext") ? type.slice(0, -4) : type
        const s = LAYER_STACK.indexOf(baseType as any)
        const baseOpacity = 0.68
        const mat = new THREE.MeshStandardMaterial({
          color: LAYER_COLOR[baseType] ?? LAYER_COLOR.unknown,
          roughness: 0.92,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: baseOpacity,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: (s >= 0 ? s + 1 : 1) * 1.5,
          polygonOffsetUnits: (s >= 0 ? s + 1 : 1) * 1.5,
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.userData.layerType = type
        mesh.userData.baseOpacity = baseOpacity
        stratumGroup.add(mesh)
        smoothMeshes[type] = mesh
      }
      smoothMeshRef.current = smoothMeshes

      const voxelMeshes: Record<string, THREE.Mesh> = {}
      for (const type of Object.keys(voxelCells)) {
        const cells = voxelCells[type]
        if (!cells?.length) continue
        const baseType = type.endsWith("@ext") ? type.slice(0, -4) : type
        const mat = new THREE.MeshStandardMaterial({
          color: LAYER_COLOR[baseType] ?? LAYER_COLOR.unknown,
          roughness: 0.92,
          side: THREE.DoubleSide,
        })
        const mesh = new THREE.Mesh(buildBoxesMesh(cells), mat)
        mesh.userData.layerType = type
        mesh.userData.baseOpacity = 1.0
        stratumGroup.add(mesh)
        voxelMeshes[type] = mesh
      }
      voxelMeshRef.current = voxelMeshes

      const applyVis = (meshes: Record<string, THREE.Mesh>, activeMode: boolean) => {
        for (const [type, mesh] of Object.entries(meshes)) {
          mesh.visible = activeMode && layerVisible(type, visibilityRef.current, basementModeRef.current)
        }
      }
      applyVis(smoothMeshes, renderModeRef.current === "smooth")
      applyVis(voxelMeshes, renderModeRef.current === "voxel")

      const colRadius = Math.max(boxW, boxD) * 0.003
      const bhGroup = new THREE.Group()
      const posMap: Record<string, { x: number; y: number; z: number }> = {}
      for (const b of boreholes) {
        if (!Number.isFinite(b.longitude) || !Number.isFinite(b.latitude) || !Number.isFinite(b.elevation)) continue
        const bx = lngToX(b.longitude, b.latitude)
        const bz = latToZ(b.longitude, b.latitude)

        // 쌍선형 보간(Bilinear Interpolation)을 통해 시추공 위치의 정밀 지표면 고도(surfElev) 계산
        const [minLng, minLat, maxLng, maxLat] = bbox
        const pctLng = (b.longitude - minLng) / (maxLng - minLng)
        const pctLat = (b.latitude - minLat) / (maxLat - minLat)
        
        const fi = pctLng * (N - 1)
        const fj = pctLat * (N - 1)
        
        const i0 = Math.max(0, Math.min(N - 1, Math.floor(fi)))
        const i1 = Math.max(0, Math.min(N - 1, Math.ceil(fi)))
        const j0 = Math.max(0, Math.min(N - 1, Math.floor(fj)))
        const j1 = Math.max(0, Math.min(N - 1, Math.ceil(fj)))
        
        const s = fi - i0
        const t = fj - j0
        
        const elev00 = elevGrid[j0][i0]
        const elev10 = elevGrid[j0][i1]
        const elev01 = elevGrid[j1][i0]
        const elev11 = elevGrid[j1][i1]
        
        const surfElev = (1 - s) * (1 - t) * elev00 + s * (1 - t) * elev10 + (1 - s) * t * elev01 + s * t * elev11

        posMap[b.id] = { x: bx, y: surfElev * mScale * verticalExagRef.current, z: bz }

        for (const seg of b.strata || []) {
          if (!Number.isFinite(seg.depth_top) || !Number.isFinite(seg.depth_bottom)) continue
          const yTop = (surfElev - seg.depth_top) * mScale
          const yBot = (surfElev - seg.depth_bottom) * mScale
          const h = Math.max(yTop - yBot, 1e-5)
          const geo = new THREE.CylinderGeometry(colRadius, colRadius, h, 10)
          const layerType = seg.strata_group ?? "unknown"
          const mat = new THREE.MeshStandardMaterial({
            color: LAYER_COLOR[layerType] ?? LAYER_COLOR.unknown,
            roughness: 0.7,
          })
          const cyl = new THREE.Mesh(geo, mat)
          cyl.position.set(bx, (yTop + yBot) / 2, bz)
          cyl.userData.layerType = layerType
          cyl.userData.bhId = b.id  // 클릭 감지용 시추공 ID 저장
          bhGroup.add(cyl)
        }
      }
      bhGroup.visible = showColumnsRef.current
      stratumGroup.add(bhGroup)
      bhGroupRef.current = bhGroup

      bhPosRef.current = posMap
      fitCamera()
      setStatus(
        `완료 · 시추공 ${boreholes.length}개 · 격자 ${N}x${N}x${MZ} (dz ${dz.toFixed(1)}m) · ` +
          `유효 반경 ${confRadiusM.toFixed(0)}m · 영역 ${resultLngWidthM.toFixed(0)}m x ${resultLatWidthM.toFixed(0)}m` +
          (skippedDeep > 0 ? ` · ⚠️ 심도 이상 ${skippedDeep}공 보간 제외 — 확인 필요` : ""),
      )
    }

    worker.onerror = (err) => {
      setStatus(`계산 오류: ${err.message}`)
    }

    return () => {
      active = false
      drapeTextureSeqRef.current += 1
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
  }, [bbox, boreholes, depthBelowMSL, sceneRef, cameraRef, controlsRef, setStatus, bhPosRef, renderMode])

  useEffect(() => {
    const apply = (meshes: Record<string, THREE.Mesh>, activeMode: boolean) => {
      for (const [type, mesh] of Object.entries(meshes)) {
        mesh.visible = activeMode && layerVisible(type, visibility, basementMode)
      }
    }
    apply(smoothMeshRef.current, renderMode === "smooth")
    apply(voxelMeshRef.current, renderMode === "voxel")

    const bhGroup = bhGroupRef.current
    if (bhGroup) {
      bhGroup.visible = showColumns
      for (const child of bhGroup.children) {
        child.visible = true
      }
    }

    const drape = drapeRef.current
    if (drape) {
      drape.visible = showDrape
    }
  }, [visibility, renderMode, showColumns, showDrape, basementMode])

  useEffect(() => {
    if (drapeRef.current) drapeRef.current.visible = showDrape
  }, [showDrape])

  useEffect(() => {
    if (!bbox || !drapeMatRef.current) return
    applyDrapeTexture(basemap, bbox)
  }, [basemap, bbox, applyDrapeTexture])

  useEffect(() => {
    if (bhGroupRef.current) bhGroupRef.current.visible = showColumns
  }, [showColumns])

  useEffect(() => {
    if (stratumGroupRef.current) {
      stratumGroupRef.current.scale.set(1, verticalExag, 1)
    }
  }, [verticalExag])

  useEffect(() => {
    const marker = markerRef.current
    if (!marker || !bbox) return

    // ── 지층 투명도: 선택 시 0.25, 해제 시 불투명 복원 ──────────────────
    const allLayerMeshes = [
      ...Object.values(smoothMeshRef.current),
      ...Object.values(voxelMeshRef.current),
    ]
    if (selectedBh === null) {
      marker.visible = false
      // 선택 해제 → 지층 불투명 복원
      for (const mesh of allLayerMeshes) {
        const mat = mesh.material as THREE.MeshStandardMaterial
        const base = (mesh.userData.baseOpacity as number) ?? 0.68
        mat.transparent = base < 1
        mat.opacity = base
        mat.depthWrite = base >= 1
        mat.needsUpdate = true
      }
      return
    }

    // 선택됨 → 지층 반투명 처리 (opacity 0.45: 어두운 배경에서도 지층 형태 인식 가능)
    for (const mesh of allLayerMeshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial
      mat.transparent = true
      mat.opacity = 0.36
      mat.depthWrite = false
      mat.needsUpdate = true
    }

    const b = boreholes.find((h) => h.id === selectedBh)
    if (!b) {
      marker.visible = false
      return
    }
    const { mScale } = dimsRef.current
    const pModel = createLocalProjection(bbox as Bbox).lngLatToModel(b.longitude, b.latitude)
    const bx = pModel.x
    const bz = pModel.z
    const p = bhPosRef.current?.[b.id]
    const by = p ? p.y : (b.elevation || 0) * mScale * verticalExag
    marker.position.set(bx, by + 0.05, bz)
    marker.visible = true
  }, [selectedBh, boreholes, bbox, verticalExag])

  const focusBorehole = useCallback((id: string) => {
    const p = bhPosRef.current?.[id]
    const cam = cameraRef.current
    const ctr = controlsRef.current
    if (!p || !cam || !ctr) return

    setSelectedBh(id)
    const dist = Math.max(dimsRef.current.boxW, dimsRef.current.boxD) * 0.55
    const startT = ctr.target.clone()
    const startP = cam.position.clone()
    const endT = new THREE.Vector3(p.x, p.y, p.z)
    const endP = new THREE.Vector3(p.x + dist, p.y + dist * 0.8, p.z + dist)
    let t = 0

    const step = () => {
      t += 0.055
      const e = t < 1 ? 1 - Math.pow(1 - t, 3) : 1
      ctr.target.lerpVectors(startT, endT, e)
      cam.position.lerpVectors(startP, endP, e)
      ctr.update()
      if (t < 1) requestAnimationFrame(step)
    }
    step()
  }, [setSelectedBh])

  // ── 3D 시추공 클릭 → 테이블 선택 동기화 ─────────────────────────────────
  // Raycaster로 클릭된 실린더의 userData.bhId를 읽어 focusBorehole 호출
  // 드래그(OrbitControls 회전)와 클릭을 구분하기 위해 pointerdown 위치 추적
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const raycaster = new THREE.Raycaster()
    let clickStart = { x: 0, y: 0 }

    const onPointerDown = (e: PointerEvent) => {
      clickStart = { x: e.clientX, y: e.clientY }
    }

    const onClick = (e: MouseEvent) => {
      // 3px 이상 이동했으면 드래그로 간주 → 클릭 무시
      const dx = e.clientX - clickStart.x
      const dy = e.clientY - clickStart.y
      if (dx * dx + dy * dy > 9) return

      const cam = cameraRef.current
      const bhGroup = bhGroupRef.current
      if (!cam || !bhGroup || !bhGroup.visible) return

      const rect = container.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width)  * 2 - 1
      const y = -((e.clientY - rect.top)  / rect.height) * 2 + 1

      raycaster.setFromCamera(new THREE.Vector2(x, y), cam)

      // bhGroup의 자식(실린더)만 대상으로 교차 검사
      const hits = raycaster.intersectObjects(bhGroup.children, false)
      if (hits.length > 0) {
        // userData.bhId는 b.id에서 복사 — 런타임에 string일 수 있음
        // Number() 변환으로 "10619"(string) → 10619(number) 처리
        const bhIdRaw = hits[0].object.userData.bhId
        const bhId = String(bhIdRaw)
        if (bhId) focusBorehole(bhId)
      } else {
        // 빈 공간 클릭 → 선택 해제 (지층 투명도 복원)
        setSelectedBh(null)
      }
    }

    container.addEventListener("pointerdown", onPointerDown)
    container.addEventListener("click", onClick)
    return () => {
      container.removeEventListener("pointerdown", onPointerDown)
      container.removeEventListener("click", onClick)
    }
  }, [containerRef, cameraRef, focusBorehole, setSelectedBh])

  return {
    focusBorehole,
    dimsRef,
  }
}
