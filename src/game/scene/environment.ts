/**
 * Practice range geometry, lights, and Kenney env textures.
 */
import * as THREE from 'three'
import type { AABB } from '../core/types'
import {
  isSkyboxId,
  skyboxUrl,
  SKYBOX_FOG,
  type SkyboxId,
} from './skyboxes'

export type { SkyboxId, SkyboxPreference } from './skyboxes'
export {
  SKYBOX_IDS,
  SKYBOX_LABELS,
  resolveSkyboxId,
  normalizeSkyboxPreference,
  isSkyboxId,
  isSkyboxPreference,
} from './skyboxes'

export type RangeBuildResult = {
  floorMat: THREE.MeshStandardMaterial
  coverMat: THREE.MeshStandardMaterial
  coverMeshes: THREE.Mesh[]
  /** Extra colliders added for walls (e.g. far backstop). */
  extraColliders: AABB[]
}

/** Lights, floor, cover boxes, backstop wall, spawn pad. */
export function buildRange(
  scene: THREE.Scene,
  colliders: AABB[],
): RangeBuildResult {
  const hemi = new THREE.HemisphereLight(0xb8d0e8, 0x3a3028, 0.85)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.15)
  sun.position.set(20, 30, 10)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 80
  sun.shadow.camera.left = -40
  sun.shadow.camera.right = 40
  sun.shadow.camera.top = 40
  sun.shadow.camera.bottom = -40
  scene.add(sun)

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x6a6a6a,
    roughness: 0.92,
    metalness: 0.05,
  })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

  const coverMat = new THREE.MeshStandardMaterial({
    color: 0x8a8a8a,
    roughness: 0.88,
    metalness: 0.05,
  })
  const coverMeshes: THREE.Mesh[] = []
  for (const c of colliders) {
    const w = c.max.x - c.min.x
    const h = c.max.y - c.min.y
    const d = c.max.z - c.min.z
    const b = {
      x: (c.min.x + c.max.x) / 2,
      y: (c.min.y + c.max.y) / 2,
      z: (c.min.z + c.max.z) / 2,
      w,
      h,
      d,
    }
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(b.w, b.h, b.d),
      coverMat,
    )
    mesh.position.set(b.x, b.y, b.z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
    coverMeshes.push(mesh)
  }

  // far backstop wall
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(30, 4, 0.5),
    coverMat,
  )
  wall.position.set(0, 2, -36)
  wall.castShadow = true
  wall.receiveShadow = true
  scene.add(wall)

  const extraColliders: AABB[] = [
    {
      min: { x: -15, y: 0, z: -36.25 },
      max: { x: 15, y: 4, z: -35.75 },
    },
  ]

  // spawn pad
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.2, 0.08, 24),
    new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.6 }),
  )
  pad.position.set(0, 0.04, 8)
  pad.receiveShadow = true
  scene.add(pad)

  return { floorMat, coverMat, coverMeshes, extraColliders }
}

/**
 * Kenney CC0 sky (equirect) + optional prototype floor/cover textures.
 * Falls back silently to solid materials if assets fail to load.
 *
 * @param skybox Concrete skybox for this match (default day). Resolve
 *   `"random"` once at session start so every client shares the same id.
 * @param loadFloorTextures Range-only grid/check materials; skip on GLB maps.
 */
export async function loadEnvironmentTextures(opts: {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  floorMat: THREE.MeshStandardMaterial | null
  coverMat: THREE.MeshStandardMaterial | null
  skybox?: SkyboxId
  loadFloorTextures?: boolean
}): Promise<THREE.Texture[]> {
  const {
    scene,
    renderer,
    floorMat,
    coverMat,
    skybox = 'day',
    loadFloorTextures = true,
  } = opts
  const loaded: THREE.Texture[] = []
  const loader = new THREE.TextureLoader()
  const skyId: SkyboxId = isSkyboxId(skybox) ? skybox : 'day'

  const loadTex = (url: string) =>
    new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(url, resolve, undefined, reject)
    })

  try {
    const sky = await loadTex(skyboxUrl(skyId))
    sky.mapping = THREE.EquirectangularReflectionMapping
    sky.colorSpace = THREE.SRGBColorSpace
    scene.background = sky
    // Soft fog under the equirect so horizon edges blend a bit
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.setHex(SKYBOX_FOG[skyId])
    }
    loaded.push(sky)
  } catch {
    // keep solid background
  }

  if (!loadFloorTextures) return loaded

  try {
    const floorMap = await loadTex('/env/floor/grid.png')
    floorMap.wrapS = THREE.RepeatWrapping
    floorMap.wrapT = THREE.RepeatWrapping
    floorMap.repeat.set(20, 20)
    floorMap.anisotropy = Math.min(
      8,
      renderer.capabilities.getMaxAnisotropy(),
    )
    floorMap.colorSpace = THREE.SRGBColorSpace
    if (floorMat) {
      floorMat.map = floorMap
      floorMat.color.set(0xffffff)
      floorMat.needsUpdate = true
    }
    loaded.push(floorMap)
  } catch {
    // keep solid floor
  }

  try {
    const coverMap = await loadTex('/env/floor/check.png')
    coverMap.wrapS = THREE.RepeatWrapping
    coverMap.wrapT = THREE.RepeatWrapping
    coverMap.repeat.set(2, 2)
    coverMap.colorSpace = THREE.SRGBColorSpace
    if (coverMat) {
      coverMat.map = coverMap
      coverMat.color.set(0xffffff)
      coverMat.needsUpdate = true
    }
    loaded.push(coverMap)
  } catch {
    // keep solid cover
  }

  return loaded
}
