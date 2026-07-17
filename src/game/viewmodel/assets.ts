/**
 * Viewmodel asset prep: materials, unit measure, clip map, arm bone types.
 */
import * as THREE from 'three'
import type { FingerId } from './config'

export type ArmLimbKey = 'shoulder' | 'bicep' | 'forearm' | 'wrist'

export type ArmBoneRest = {
  bone: THREE.Object3D
  pos: THREE.Vector3
  quat: THREE.Quaternion
  scale: THREE.Vector3
}

export type ArmSideBones = {
  limb: Record<ArmLimbKey, ArmBoneRest | null>
  fingers: Record<
    FingerId,
    [ArmBoneRest | null, ArmBoneRest | null, ArmBoneRest | null]
  >
}

export function emptyArmSideBones(): ArmSideBones {
  return {
    limb: {
      shoulder: null,
      bicep: null,
      forearm: null,
      wrist: null,
    },
    fingers: {
      thumb: [null, null, null],
      index: [null, null, null],
      middle: [null, null, null],
      ring: [null, null, null],
      pinky: [null, null, null],
    },
  }
}

/** Disable shadows / frustum cull on viewmodel meshes. */
export function prepareViewmesh(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.SkinnedMesh) {
      o.castShadow = false
      o.receiveShadow = false
      o.frustumCulled = false
    }
  })
}

/** Pale sky-blue frosted glass for the optic lens only (opaque). */
function makeOpticGlassMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xc8e4f5,
    transparent: false,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: true,
    metalness: 0.08,
    roughness: 0.22,
    emissive: new THREE.Color(0x6a9ec4),
    emissiveIntensity: 0.2,
    flatShading: true,
  })
}

function isOpticLensMesh(o: THREE.Mesh | THREE.SkinnedMesh): boolean {
  const name = o.name.toLowerCase()
  if (name.includes('glass') || name.includes('lens')) return true
  const mats = Array.isArray(o.material) ? o.material : [o.material]
  return mats.some((m) => (m?.name ?? '').toLowerCase() === 'lens')
}

/**
 * The brown “lens” is a painted end-cap on the scope mesh sitting under the
 * thin glass disc. Re-material only those disc faces; leave the tube metal.
 */
function restyleScopeLensCaps(
  scope: THREE.Mesh | THREE.SkinnedMesh,
  lensMeshes: THREE.Object3D[],
  glassMat: THREE.MeshStandardMaterial,
) {
  if (lensMeshes.length === 0) return

  scope.updateWorldMatrix(true, false)
  for (const L of lensMeshes) L.updateWorldMatrix(true, false)

  type LensPlane = {
    center: THREE.Vector3
    normal: THREE.Vector3
    radius: number
  }
  const planes: LensPlane[] = []

  for (const L of lensMeshes) {
    if (!(L instanceof THREE.Mesh) && !(L instanceof THREE.SkinnedMesh)) continue
    const geom = L.geometry
    geom.computeBoundingBox()
    const bb = geom.boundingBox
    if (!bb) continue
    const center = bb.getCenter(new THREE.Vector3()).applyMatrix4(L.matrixWorld)
    const size = bb.getSize(new THREE.Vector3())
    // Thinnest local axis ≈ glass normal.
    const localN = new THREE.Vector3(0, 0, 1)
    if (size.x <= size.y && size.x <= size.z) localN.set(1, 0, 0)
    else if (size.y <= size.x && size.y <= size.z) localN.set(0, 1, 0)
    const normal = localN
      .clone()
      .transformDirection(L.matrixWorld)
      .normalize()
    const scale = new THREE.Vector3()
    L.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale)
    const radius =
      Math.max(size.x, size.y, size.z) * 0.55 * Math.max(scale.x, scale.y, scale.z)
    planes.push({ center, normal, radius: Math.max(radius, 1e-4) })
  }
  if (planes.length === 0) return

  const geom = scope.geometry
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  if (!pos) return
  const index = geom.getIndex()
  const triCount = index ? index.count / 3 : pos.count / 3

  const bodyIdx: number[] = []
  const glassIdx: number[] = []
  const vA = new THREE.Vector3()
  const vB = new THREE.Vector3()
  const vC = new THREE.Vector3()
  const centroid = new THREE.Vector3()
  const faceN = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const toC = new THREE.Vector3()

  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
    vA.fromBufferAttribute(pos, i0).applyMatrix4(scope.matrixWorld)
    vB.fromBufferAttribute(pos, i1).applyMatrix4(scope.matrixWorld)
    vC.fromBufferAttribute(pos, i2).applyMatrix4(scope.matrixWorld)
    centroid.copy(vA).add(vB).add(vC).multiplyScalar(1 / 3)
    ab.subVectors(vB, vA)
    ac.subVectors(vC, vA)
    faceN.crossVectors(ab, ac).normalize()

    let isCap = false
    for (const p of planes) {
      toC.subVectors(centroid, p.center)
      const planar = toC.dot(p.normal)
      const radial = Math.sqrt(Math.max(0, toC.lengthSq() - planar * planar))
      const facing = Math.abs(faceN.dot(p.normal))
      // Inner optic disc only — stay clear of the metal rim/bevel.
      if (
        Math.abs(planar) < p.radius * 0.22 &&
        radial < p.radius * 0.78 &&
        facing > 0.9
      ) {
        isCap = true
        break
      }
    }

    if (isCap) glassIdx.push(i0, i1, i2)
    else bodyIdx.push(i0, i1, i2)
  }

  if (glassIdx.length === 0) return

  const merged = new Uint32Array(bodyIdx.length + glassIdx.length)
  merged.set(bodyIdx, 0)
  merged.set(glassIdx, bodyIdx.length)
  geom.setIndex(new THREE.BufferAttribute(merged, 1))
  geom.clearGroups()
  geom.addGroup(0, bodyIdx.length, 0)
  geom.addGroup(bodyIdx.length, glassIdx.length, 1)

  const bodyMat = Array.isArray(scope.material)
    ? scope.material[0]
    : scope.material
  scope.material = [bodyMat, glassMat.clone()]
}

/**
 * Restyle sniper_animated.glb toward man.glb's low-poly look while
 * keeping albedo color: flat shading + baseColor map, drop detail maps.
 */
export function styleViewmodelLowPoly(root: THREE.Object3D) {
  const seenMats = new Set<THREE.Material>()
  const dropTex = new Set<THREE.Texture>()
  const oldMats: THREE.Material[] = []
  const glassMat = makeOpticGlassMaterial()
  const lensMeshes: THREE.Object3D[] = []

  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.SkinnedMesh)) {
      return
    }

    const prevList = Array.isArray(o.material) ? o.material : [o.material]
    const nextList = prevList.map((raw) => {
      if (!seenMats.has(raw)) {
        seenMats.add(raw)
        oldMats.push(raw)
      }

      const src = raw as THREE.MeshStandardMaterial
      const mat = src.clone() as THREE.MeshStandardMaterial

      for (const key of [
        'normalMap',
        'roughnessMap',
        'metalnessMap',
        'aoMap',
        'emissiveMap',
        'bumpMap',
        'displacementMap',
      ] as const) {
        const tex = mat[key]
        if (tex) {
          dropTex.add(tex)
          mat[key] = null
        }
      }

      mat.flatShading = true
      if (mat.metalnessMap == null) mat.metalness = 0.2
      if (mat.roughnessMap == null) mat.roughness = 0.55

      if (isOpticLensMesh(o)) {
        // Replace with shared-style glass (no baked albedo).
        return glassMat.clone()
      }

      mat.needsUpdate = true
      return mat
    })

    o.material = Array.isArray(o.material) ? nextList : nextList[0]
    if (isOpticLensMesh(o)) {
      // Pull the glass disc in slightly so the metal rim stays dark.
      o.scale.set(0.82, 0.82, 1)
      lensMeshes.push(o)
    }
  })

  // Scope metal end-caps painted brown under the glass → sky glass too.
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.SkinnedMesh)) return
    const name = o.name.toLowerCase()
    if (!name.includes('scope')) return
    if (isOpticLensMesh(o)) return
    restyleScopeLensCaps(o, lensMeshes, glassMat)
  })

  const keepTex = new Set<THREE.Texture>()
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.SkinnedMesh)) {
      return
    }
    const list = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of list) {
      const std = m as THREE.MeshStandardMaterial
      if (std.map) keepTex.add(std.map)
    }
  })

  for (const tex of dropTex) {
    if (!keepTex.has(tex)) tex.dispose()
  }
  for (const m of oldMats) {
    m.dispose()
  }
}

/**
 * Bake model to unit scale (longest axis = 1) and capture center.
 * Live target scale / offsets are applied via applyViewmodelParts().
 */
export function measureUnitAsset(obj: THREE.Object3D): {
  unitScale: number
  center: THREE.Vector3
} {
  obj.scale.set(1, 1, 1)
  obj.position.set(0, 0, 0)
  obj.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(obj)
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const unitScale = 1 / maxDim
  obj.scale.setScalar(unitScale)
  obj.updateMatrixWorld(true)
  box.setFromObject(obj)
  const center = box.getCenter(new THREE.Vector3())
  obj.position.copy(center).multiplyScalar(-1)
  const storedCenter = obj.position.clone()
  return { unitScale, center: storedCenter }
}

/**
 * DJMaesen sniper_animated "allanims" frame map (30 fps).
 *  0–12   fire
 * 12–49   bolt
 * 49–148  reload
 * 148–160 ready
 */
export function buildViewmodelClips(master: THREE.AnimationClip) {
  const FPS = 30
  const sub = (name: string, start: number, end: number) =>
    THREE.AnimationUtils.subclip(master, name, start, end, FPS)

  return {
    fire: sub('fire', 0, 12),
    bolt: sub('bolt', 12, 49),
    reload: sub('reload', 49, 148),
    ready: sub('ready', 148, 160),
  }
}
