import { useCallback, useEffect, useRef, type RefObject } from "react"
// @ts-ignore
import * as THREE from "three"
// @ts-ignore
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { buildAreaCanvas } from "@/lib/terrain"
import { buildBoxesMesh, buildSurfaceMesh } from "../lib/geoGeometry"
import type { Borehole } from "@/lib/types"

const LAYER_COLOR: Record<string, number> = {
  soil: 0x8b7355,
  weathered_rock: 0xc4a57b,
  soft_rock: 0x6b8e5a,
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
  renderMode: "smooth" | "voxel" | "rbf"
  selectedBh: number | null
  setSelectedBh: (id: number | null) => void
  setStatus: (msg: string) => void
  bhPosRef: RefObject<Record<number, { x: number; y: number; z: number }>>
  showPhantoms?: boolean
  showConfidence?: boolean
}

const LAYER_STACK = ["soil", "weathered_rock", "soft_rock", "hard_rock", "unknown"]
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
  settings: GeoModelSettings,
) {
  const dimsRef = useRef({ boxW: 2, boxD: 2, lngWidthM: 1, latWidthM: 1, mScale: 1 })
  const smoothMeshRef = useRef<Record<string, THREE.Mesh>>({})
  const voxelMeshRef = useRef<Record<string, THREE.Mesh>>({})
  const drapeRef = useRef<THREE.Mesh | null>(null)
  const drapeMatRef = useRef<THREE.MeshStandardMaterial | null>(null)
  const bhGroupRef = useRef<THREE.Group | null>(null)
  const markerRef = useRef<THREE.Mesh | null>(null)
  const stratumGroupRef = useRef<THREE.Group | null>(null)
  const drapeTextureSeqRef = useRef(0)
  const workerRef = useRef<Worker | null>(null)
  const phantomGroupRef = useRef<THREE.Group | null>(null)
  const confGroupRef = useRef<THREE.Group | null>(null)

  const {
    verticalExag,
    depthBelowMSL,
    basemap,
    visibility,
    showColumns,
    showDrape,
    renderMode,
    selectedBh,
    setSelectedBh,
    setStatus,
    bhPosRef,
    showPhantoms = true,
    showConfidence = true,
  } = settings

  const visibilityRef = useRef(visibility)
  const showColumnsRef = useRef(showColumns)
  const showDrapeRef = useRef(showDrape)
  const renderModeRef = useRef(renderMode)
  const basemapRef = useRef(basemap)
  const verticalExagRef = useRef(verticalExag)
  const showPhantomsRef = useRef(showPhantoms)
  const showConfidenceRef = useRef(showConfidence)

  visibilityRef.current = visibility
  showColumnsRef.current = showColumns
  showDrapeRef.current = showDrape
  renderModeRef.current = renderMode
  basemapRef.current = basemap
  verticalExagRef.current = verticalExag
  showPhantomsRef.current = showPhantoms
  showConfidenceRef.current = showConfidence

  const applyDrapeTexture = useCallback(
    (targetBasemap: GeoModelSettings["basemap"], targetBbox: number[]) => {
      const drapeMat = drapeMatRef.current
      if (!drapeMat || targetBbox.length !== 4) return

      const seq = ++drapeTextureSeqRef.current
      buildAreaCanvas(targetBbox as [number, number, number, number], LAYER_SETS[targetBasemap])
        .then((drapeCanvas) => {
          if (seq !== drapeTextureSeqRef.current || drapeMatRef.current !== drapeMat) return
          const loadedTex = new THREE.CanvasTexture(drapeCanvas)
          loadedTex.colorSpace = THREE.SRGBColorSpace
          loadedTex.wrapS = THREE.ClampToEdgeWrapping
          loadedTex.wrapT = THREE.ClampToEdgeWrapping
          loadedTex.anisotropy = 4
          loadedTex.needsUpdate = true

          if (drapeMat.map) drapeMat.map.dispose()
          drapeMat.color.setHex(0xffffff)
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

    const [minLng, minLat, maxLng, maxLat] = bbox
    const midLat = (minLat + maxLat) / 2
    const lngWidthM = (maxLng - minLng) * 111320 * Math.cos((midLat * Math.PI) / 180)
    const latWidthM = (maxLat - minLat) * 110540
    const ratio = lngWidthM / latWidthM
    const boxW = 2
    const boxD = boxW / ratio
    const mScale = boxW / lngWidthM
    dimsRef.current = { boxW, boxD, lngWidthM, latWidthM, mScale }

    const lngToX = (lng: number) => -boxW / 2 + (boxW * (lng - minLng)) / (maxLng - minLng)
    const latToZ = (lat: number) => boxD / 2 - (boxD * (lat - minLat)) / (maxLat - minLat)

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

    const N = 48
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
        rbfSurfaceMeshData,
        voxelCells,
        dz,
        MZ,
        confRadiusM,
        lngWidthM: resultLngWidthM,
        latWidthM: resultLatWidthM,
        phantomPoints,
      } = msg

      const drapeGeo = buildSurfaceMesh(elevGrid, boxW, boxD, mScale)
      const drapeMat = new THREE.MeshStandardMaterial({
        color: 0x4e6e58,
        roughness: 0.85,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
      drapeMatRef.current = drapeMat
      const drape = new THREE.Mesh(drapeGeo, drapeMat)
      drape.visible = showDrapeRef.current
      stratumGroup.add(drape)
      drapeRef.current = drape

      if (drapeMat && bbox.length === 4) {
        const drapeSeq = ++drapeTextureSeqRef.current
        const drapeCanvasPromise = buildAreaCanvas(bbox as [number, number, number, number], LAYER_SETS[basemapRef.current])
        drapeCanvasPromise.then((loadedTex) => {
          if (!active || drapeSeq !== drapeTextureSeqRef.current) return
          if (!loadedTex) return
          if (drapeMat.map) drapeMat.map.dispose()
          drapeMat.color.setHex(0xffffff)
          drapeMat.map = loadedTex
          drapeMat.needsUpdate = true
        })
      }

      const smoothMeshes: Record<string, THREE.Mesh> = {}

      // RBF 직접 레이어 메시 (마칭큐브 우회) — rbfSurfaceMeshData가 있으면 우선 사용
      const activeSmoothData: Record<string, any> =
        rbfSurfaceMeshData && Object.keys(rbfSurfaceMeshData).length > 0
          ? rbfSurfaceMeshData
          : smoothMeshData

      for (const [type, data] of Object.entries(activeSmoothData)) {
        const { positions, normals, indices } = data as any
        const geo = new THREE.BufferGeometry()
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
        geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3))
        // rbfSurfaceMeshData는 Uint32Array 인덱스를 포함한다
        if (indices) {
          geo.setIndex(new THREE.BufferAttribute(indices, 1))
        }
        // 마칭큐브 결과에는 인덱스가 없으므로 분기 처리
        if (!indices) geo.computeVertexNormals()
        const mat = new THREE.MeshStandardMaterial({
          color: LAYER_COLOR[type] ?? LAYER_COLOR.unknown,
          roughness: 0.92,
          side: THREE.DoubleSide,
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.userData.layerType = type
        stratumGroup.add(mesh)
        smoothMeshes[type] = mesh
      }
      smoothMeshRef.current = smoothMeshes

      const voxelMeshes: Record<string, THREE.Mesh> = {}
      for (const type of LAYER_STACK) {
        const cells = voxelCells[type]
        if (!cells?.length) continue
        const mat = new THREE.MeshStandardMaterial({
          color: LAYER_COLOR[type] ?? LAYER_COLOR.unknown,
          roughness: 0.92,
          side: THREE.DoubleSide,
        })
        const mesh = new THREE.Mesh(buildBoxesMesh(cells), mat)
        mesh.userData.layerType = type
        stratumGroup.add(mesh)
        voxelMeshes[type] = mesh
      }
      voxelMeshRef.current = voxelMeshes

      const applyVis = (meshes: Record<string, THREE.Mesh>, activeMode: boolean) => {
        for (const [type, mesh] of Object.entries(meshes)) {
          mesh.visible = activeMode && (visibilityRef.current[type] ?? true)
        }
      }
      applyVis(smoothMeshes, renderModeRef.current === "smooth" || renderModeRef.current === "rbf")
      applyVis(voxelMeshes, renderModeRef.current === "voxel")

      const colRadius = Math.max(boxW, boxD) * 0.003
      const bhGroup = new THREE.Group()
      const posMap: Record<number, { x: number; y: number; z: number }> = {}
      for (const b of boreholes) {
        if (!Number.isFinite(b.longitude) || !Number.isFinite(b.latitude) || !Number.isFinite(b.elevation)) continue
        const bx = lngToX(b.longitude)
        const bz = latToZ(b.latitude)
        posMap[b.id] = { x: bx, y: b.elevation * mScale * verticalExagRef.current, z: bz }

        for (const seg of b.strata || []) {
          if (!Number.isFinite(seg.depth_top) || !Number.isFinite(seg.depth_bottom)) continue
          const yTop = (b.elevation - seg.depth_top) * mScale
          const yBot = (b.elevation - seg.depth_bottom) * mScale
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
          bhGroup.add(cyl)
        }
      }
      bhGroup.visible = showColumnsRef.current
      stratumGroup.add(bhGroup)
      bhGroupRef.current = bhGroup

      // 3D 가상 시추공 (Phantom Points) 시각화
      const phantomGroup = new THREE.Group()
      const phantomRadius = colRadius * 0.95
      if (phantomPoints && Array.isArray(phantomPoints)) {
        for (const p of phantomPoints) {
          if (!Number.isFinite(p.longitude) || !Number.isFinite(p.latitude) || !Number.isFinite(p.elevation)) continue
          const bx = lngToX(p.longitude)
          const bz = latToZ(p.latitude)

          for (const seg of p.strata || []) {
            if (!Number.isFinite(seg.depth_top) || !Number.isFinite(seg.depth_bottom)) continue
            const yTop = (p.elevation - seg.depth_top) * mScale
            const yBot = (p.elevation - seg.depth_bottom) * mScale
            const h = Math.max(yTop - yBot, 1e-5)
            const geo = new THREE.CylinderGeometry(phantomRadius, phantomRadius, h, 10)
            const layerType = seg.strata_group ?? "unknown"
            const mat = new THREE.MeshStandardMaterial({
              color: 0x3b82f6, // 네온 푸른색
              roughness: 0.5,
              transparent: true,
              opacity: 0.45,
            })
            const cyl = new THREE.Mesh(geo, mat)
            cyl.position.set(bx, (yTop + yBot) / 2, bz)
            cyl.userData.layerType = layerType
            phantomGroup.add(cyl)
          }
        }
      }
      phantomGroup.visible = showPhantomsRef.current && renderModeRef.current === "rbf"
      stratumGroup.add(phantomGroup)
      phantomGroupRef.current = phantomGroup

      // Convex 신뢰도 가이드 링 (Confidence Rings) 시각화
      const confGroup = new THREE.Group()
      const ringRadius = confRadiusM * mScale
      if (renderModeRef.current === "rbf") {
        for (const b of boreholes) {
          if (!Number.isFinite(b.longitude) || !Number.isFinite(b.latitude) || !Number.isFinite(b.elevation)) continue
          const bx = lngToX(b.longitude)
          const bz = latToZ(b.latitude)
          const yBase = -depthBelowMSL * mScale

          const geo = new THREE.RingGeometry(ringRadius - 0.015, ringRadius + 0.015, 32)
          const mat = new THREE.MeshBasicMaterial({
            color: 0x2473bd,
            transparent: true,
            opacity: 0.28,
            side: THREE.DoubleSide,
          })
          const ring = new THREE.Mesh(geo, mat)
          ring.rotation.x = Math.PI / 2
          ring.position.set(bx, yBase + 0.01, bz)
          confGroup.add(ring)
        }
      }
      confGroup.visible = showConfidenceRef.current && renderModeRef.current === "rbf"
      stratumGroup.add(confGroup)
      confGroupRef.current = confGroup

      bhPosRef.current = posMap
      fitCamera()
      setStatus(
        `완료 · 시추공 ${boreholes.length}개 · 격자 ${N}x${N}x${MZ} (dz ${dz.toFixed(1)}m) · ` +
          `유효 반경 ${confRadiusM.toFixed(0)}m · 영역 ${resultLngWidthM.toFixed(0)}m x ${resultLatWidthM.toFixed(0)}m`,
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
        mesh.visible = activeMode && (visibility[type] ?? true)
      }
    }
    apply(smoothMeshRef.current, renderMode === "smooth" || renderMode === "rbf")
    apply(voxelMeshRef.current, renderMode === "voxel")

    // 시추공 기둥 개별 세그먼트에 레이어 visibility 적용
    // bhGroup 전체 토글과 별개로, 각 cylinder의 layerType에 따라 show/hide
    const bhGroup = bhGroupRef.current
    if (bhGroup) {
      for (const child of bhGroup.children) {
        const layerType = (child as THREE.Mesh).userData.layerType as string
        if (layerType) {
          child.visible = visibility[layerType] ?? true
        }
      }
    }
  }, [visibility, renderMode])

  useEffect(() => {
    if (phantomGroupRef.current) {
      phantomGroupRef.current.visible = !!showPhantoms && renderMode === "rbf"
    }
  }, [showPhantoms, renderMode])

  useEffect(() => {
    if (confGroupRef.current) {
      confGroupRef.current.visible = !!showConfidence && renderMode === "rbf"
    }
  }, [showConfidence, renderMode])

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
    if (selectedBh === null) {
      marker.visible = false
      return
    }
    const b = boreholes.find((h) => h.id === selectedBh)
    if (!b) {
      marker.visible = false
      return
    }
    const { boxW, boxD, mScale } = dimsRef.current
    const bx = -boxW / 2 + (boxW * (b.longitude - bbox[0])) / (bbox[2] - bbox[0])
    const bz = boxD / 2 - (boxD * (b.latitude - bbox[1])) / (bbox[3] - bbox[1])
    const by = (b.elevation || 0) * mScale * verticalExag
    marker.position.set(bx, by + 0.05, bz)
    marker.visible = true
  }, [selectedBh, boreholes, bbox, verticalExag])

  const focusBorehole = (id: number) => {
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
  }

  return {
    focusBorehole,
    dimsRef,
  }
}
