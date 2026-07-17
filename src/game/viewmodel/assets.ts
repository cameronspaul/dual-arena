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

/**
 * Restyle sniper_animated.glb toward man.glb's low-poly look while
 * keeping albedo color: flat shading + baseColor map, drop detail maps.
 */
export function styleViewmodelLowPoly(root: THREE.Object3D) {
  const seenMats = new Set<THREE.Material>()
  const dropTex = new Set<THREE.Texture>()
  const oldMats: THREE.Material[] = []

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

      const name = o.name.toLowerCase()
      // Optic glass only (not the metal scope housing).
      if (name.includes('glass') || name.includes('lens')) {
        if (mat.map) {
          // Shared atlas may still be used by other meshes; do not dispose.
          mat.map = null
        }
        mat.color.set(0xc8e4f5) // whitey sky blue
        mat.transparent = true
        mat.opacity = 0.32
        mat.side = THREE.DoubleSide
        mat.depthWrite = false
        mat.metalness = 0.05
        mat.roughness = 0.18
        mat.emissive.set(0x6a9ec4)
        mat.emissiveIntensity = 0.22
        mat.envMapIntensity = 1.2
      }

      mat.needsUpdate = true
      return mat
    })

    o.material = Array.isArray(o.material) ? nextList : nextList[0]
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
