/**
 * Loads a map definition into the Three scene and produces colliders / mesh hitscan.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { AABB, RayHit, Vec3 } from '../core/types'
import { WORLD } from '../core/config'
import { aabbFromCenter } from '../core/math'
import {
  buildRange as buildRangeScene,
  loadEnvironmentTextures,
} from '../scene/environment'
import type { MapDef, MapDummyDef } from './catalog'
import {
  castMeshWorldHitscan,
  prepareCollisionMeshes,
} from './meshCollision'

export type MapBounds = {
  min: Vec3
  max: Vec3
  size: Vec3
  center: Vec3
}

export type MapLoadResult = {
  root: THREE.Object3D | null
  colliders: AABB[]
  floorMat: THREE.MeshStandardMaterial | null
  coverMat: THREE.MeshStandardMaterial | null
  envTextures: THREE.Texture[]
  /** Meshes used for accurate bullet hitscan (GLB maps). */
  hitMeshes: THREE.Object3D[]
  /** World-space spawn after fit (feet on floor). */
  spawn: Vec3
  spawnYaw: number
  /** Dummy placements snapped onto the fitted map. */
  dummies: MapDummyDef[]
  /** Wander half-extent from origin, derived from map size. */
  dummyBounds: number
  bounds: MapBounds | null
}

const _ray = new THREE.Raycaster()
const _origin = new THREE.Vector3()
const _down = new THREE.Vector3(0, -1, 0)
const _up = new THREE.Vector3(0, 1, 0)

/**
 * Build the procedural practice range (existing geometry + cover AABBs).
 */
export function buildProceduralRange(scene: THREE.Scene): MapLoadResult {
  const colliders = WORLD.coverBoxes.map((b) =>
    aabbFromCenter(b.x, b.y, b.z, b.w / 2, b.h / 2, b.d / 2),
  )
  const built = buildRangeScene(scene, colliders)
  colliders.push(...built.extraColliders)
  return {
    root: null,
    colliders,
    floorMat: built.floorMat,
    coverMat: built.coverMat,
    envTextures: [],
    hitMeshes: [],
    spawn: { x: 0, y: 0, z: 8 },
    spawnYaw: 0,
    dummies: WORLD.dummies.map((d) => ({
      id: d.id,
      x: d.x,
      z: d.z,
      yaw: d.yaw,
    })),
    dummyBounds: 20,
    bounds: {
      min: { x: -40, y: 0, z: -40 },
      max: { x: 40, y: 8, z: 40 },
      size: { x: 80, y: 8, z: 80 },
      center: { x: 0, y: 4, z: 0 },
    },
  }
}

export async function loadEnvForMap(
  map: MapDef,
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  floorMat: THREE.MeshStandardMaterial | null,
  coverMat: THREE.MeshStandardMaterial | null,
): Promise<THREE.Texture[]> {
  if (!map.loadEnvTextures) {
    scene.background = new THREE.Color(map.bgColor)
    return []
  }
  return loadEnvironmentTextures({ scene, renderer, floorMat, coverMat })
}

/**
 * Load a GLB arena: scale, sit floor on y=0, center XZ, extract AABBs + hit meshes.
 * Spawn / dummies are resolved from the *fitted* world bounds so we always start inside.
 */
export async function loadGltfMap(
  scene: THREE.Scene,
  map: MapDef,
): Promise<MapLoadResult> {
  if (!map.url) {
    throw new Error(`Map ${map.id} has no url`)
  }

  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(map.url)
  const root = gltf.scene

  root.scale.setScalar(map.scale)
  root.rotation.y = map.rotateY
  root.updateMatrixWorld(true)

  // Fit: floor at y=0, center on XZ
  const preBox = new THREE.Box3().setFromObject(root)
  const preCenter = new THREE.Vector3()
  preBox.getCenter(preCenter)

  root.position.x += -preCenter.x + map.offset.x
  root.position.y += -preBox.min.y + map.offset.y
  root.position.z += -preCenter.z + map.offset.z
  root.updateMatrixWorld(true)

  // Visual setup
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.castShadow = true
    obj.receiveShadow = true
  })

  scene.add(root)
  root.updateMatrixWorld(true)

  // Collision + hitscan use prepared meshes (DoubleSide, optional COL_* only)
  const hitMeshes: THREE.Object3D[] = prepareCollisionMeshes(root)

  const bounds = measureBounds(root)
  const size = bounds.size

  // Soft ground plane under the map (visual only — not a collider).
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(
      Math.max(size.x, size.z) * 1.4 + 40,
      Math.max(size.x, size.z) * 1.4 + 40,
    ),
    new THREE.MeshStandardMaterial({
      color: map.bgColor,
      roughness: 0.95,
      metalness: 0.02,
      transparent: true,
      opacity: 0.35,
    }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.02
  ground.receiveShadow = true
  ground.name = 'map-ground-pad'
  scene.add(ground)

  const colliders = extractColliders(root, map, bounds)

  addMapLights(scene, map, bounds)

  scene.background = new THREE.Color(map.bgColor)
  // Fog scales with map size so small arenas aren't fogged out
  const fogFar = Math.max(
    map.fogFar,
    Math.hypot(size.x, size.z) * 0.9 + 20,
  )
  const fogNear = Math.min(map.fogNear, fogFar * 0.35)
  scene.fog = new THREE.Fog(map.fogColor, fogNear, fogFar)

  const dummyBounds = Math.max(
    4,
    Math.min(map.dummyBounds, Math.min(size.x, size.z) * 0.42),
  )

  const { spawn, spawnYaw, dummies } = placeActors(
    map,
    hitMeshes,
    bounds,
    dummyBounds,
  )

  return {
    root,
    colliders,
    floorMat: null,
    coverMat: null,
    envTextures: [],
    hitMeshes,
    spawn,
    spawnYaw,
    dummies,
    dummyBounds,
    bounds,
  }
}

function measureBounds(root: THREE.Object3D): MapBounds {
  const box = new THREE.Box3().setFromObject(root)
  const sizeV = new THREE.Vector3()
  const centerV = new THREE.Vector3()
  box.getSize(sizeV)
  box.getCenter(centerV)
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
    size: { x: sizeV.x, y: sizeV.y, z: sizeV.z },
    center: { x: centerV.x, y: centerV.y, z: centerV.z },
  }
}

/**
 * Pick feet positions inside the fitted AABB via downward mesh raycasts.
 * Catalog spawn/dummies are treated as *preferred offsets from center*, then
 * clamped into the real map footprint (fixes desert z=40 etc.).
 */
function placeActors(
  map: MapDef,
  hitMeshes: THREE.Object3D[],
  bounds: MapBounds,
  dummyBounds: number,
): { spawn: Vec3; spawnYaw: number; dummies: MapDummyDef[] } {
  const halfX = bounds.size.x * 0.5
  const halfZ = bounds.size.z * 0.5
  // Keep a margin so we don't spawn inside outer walls
  const margin = Math.min(2.5, Math.min(halfX, halfZ) * 0.12)
  const maxX = Math.max(0.5, halfX - margin)
  const maxZ = Math.max(0.5, halfZ - margin)

  // Catalog spawn is preferred offset from map center (post-fit origin ≈ center).
  // Clamp hard so we never start outside the footprint.
  const prefX = clamp(map.spawn.x, -maxX, maxX)
  const prefZ = clamp(map.spawn.z, -maxZ, maxZ)

  const spawnXZ = findOpenPoint(hitMeshes, bounds, prefX, prefZ, maxX, maxZ)
  const spawnY = sampleFloorY(hitMeshes, bounds, spawnXZ.x, spawnXZ.z)
  const spawn: Vec3 = { x: spawnXZ.x, y: spawnY, z: spawnXZ.z }

  // Face toward map center (or catalog yaw if already near center)
  let spawnYaw = map.spawnYaw
  const toCenterX = bounds.center.x - spawn.x
  const toCenterZ = bounds.center.z - spawn.z
  if (Math.hypot(toCenterX, toCenterZ) > 1.5) {
    // Player look uses yaw where forward is -Z at yaw 0 → atan2(-x, -z)
    spawnYaw = Math.atan2(-toCenterX, -toCenterZ)
  }

  const dummies = placeDummies(
    map,
    hitMeshes,
    bounds,
    dummyBounds,
    spawn,
    maxX,
    maxZ,
  )

  return { spawn, spawnYaw, dummies }
}

/**
 * Spread dummies on walkable ground: far enough from the player and each
 * other, with floor snap + headroom, facing the player spawn.
 */
function placeDummies(
  map: MapDef,
  hitMeshes: THREE.Object3D[],
  bounds: MapBounds,
  dummyBounds: number,
  playerSpawn: Vec3,
  maxX: number,
  maxZ: number,
): MapDummyDef[] {
  const count = Math.max(3, Math.min(map.dummies.length || 5, 6))
  const minFromPlayer = Math.min(
    6,
    Math.max(3.5, Math.min(maxX, maxZ) * 0.35),
  )
  const minBetween = Math.min(
    4.5,
    Math.max(2.2, Math.min(maxX, maxZ) * 0.22),
  )
  const ringR = Math.min(
    dummyBounds * 0.75,
    Math.min(maxX, maxZ) * 0.72,
  )

  // Seed targets: catalog hints + even ring opposite/around the player
  const seeds: { x: number; z: number; id: string }[] = []
  for (let i = 0; i < count; i++) {
    const catalog = map.dummies[i]
    if (catalog) {
      seeds.push({
        id: catalog.id,
        x: clamp(catalog.x, -maxX, maxX),
        z: clamp(catalog.z, -maxZ, maxZ),
      })
    } else {
      // Fan in front of player look (roughly -Z from spawn toward center)
      const ang = -Math.PI * 0.5 + ((i + 0.5) / count) * Math.PI
      seeds.push({
        id: `d${i}`,
        x: clamp(Math.cos(ang) * ringR, -maxX, maxX),
        z: clamp(Math.sin(ang) * ringR, -maxZ, maxZ),
      })
    }
  }

  // Extra open candidates across the playable pad (grid)
  const grid: { x: number; z: number }[] = []
  const steps = 7
  const denom = steps - 1
  for (let ix = 0; ix < steps; ix++) {
    for (let iz = 0; iz < steps; iz++) {
      const u = ix / denom
      const v = iz / denom
      grid.push({
        x: -maxX + u * maxX * 2,
        z: -maxZ + v * maxZ * 2,
      })
    }
  }

  const placed: MapDummyDef[] = []

  for (let i = 0; i < count; i++) {
    const seed = seeds[i]
    let best: { x: number; z: number; y: number; score: number } | null =
      null

    const tryPoint = (x: number, z: number, bias = 0) => {
      const cx = clamp(x, -maxX, maxX)
      const cz = clamp(z, -maxZ, maxZ)
      const distP = Math.hypot(cx - playerSpawn.x, cz - playerSpawn.z)
      if (distP < minFromPlayer) return

      let nearOther = false
      for (const p of placed) {
        if (Math.hypot(cx - p.x, cz - p.z) < minBetween) {
          nearOther = true
          break
        }
      }
      if (nearOther) return

      const walk = scoreSpawn(hitMeshes, bounds, cx, cz)
      // Reject unwalkable (no floor / roof / no headroom)
      if (walk < 2) return

      const y = sampleFloorY(hitMeshes, bounds, cx, cz)
      // Prefer mid-range duel spacing (not jammed on player, not map edge)
      const spacing =
        distP > minFromPlayer * 1.4 && distP < minFromPlayer * 3.5 ? 1.5 : 0
      const edge =
        Math.min(maxX - Math.abs(cx), maxZ - Math.abs(cz)) > 1.2 ? 0.8 : -1
      const score = walk + spacing + edge + bias
      if (!best || score > best.score) {
        best = { x: cx, z: cz, y, score }
      }
    }

    // Prefer seed neighborhood, then ring, then whole grid
    tryPoint(seed.x, seed.z, 2)
    for (let ring = 1; ring <= 5; ring++) {
      const r = (ring / 5) * Math.min(maxX, maxZ) * 0.55
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 + i * 0.7
        tryPoint(seed.x + Math.cos(a) * r, seed.z + Math.sin(a) * r, 1)
      }
    }
    // Ring around player at duel distance
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + i * 0.9
      const r = minFromPlayer * (1.3 + (i % 3) * 0.35)
      tryPoint(
        playerSpawn.x + Math.cos(a) * r,
        playerSpawn.z + Math.sin(a) * r,
        0.5,
      )
    }
    for (const g of grid) tryPoint(g.x, g.z, 0)

    if (!best) {
      // Last resort: opposite side of map from player
      const fx = clamp(-playerSpawn.x * 0.6 + (i - count / 2) * 2.2, -maxX, maxX)
      const fz = clamp(-playerSpawn.z * 0.6 - 3, -maxZ, maxZ)
      const open = findOpenPoint(hitMeshes, bounds, fx, fz, maxX, maxZ)
      best = {
        x: open.x,
        z: open.z,
        y: sampleFloorY(hitMeshes, bounds, open.x, open.z),
        score: 0,
      }
    }

    // Face the player (man.glb forward is +Z → yaw = atan2(dx, dz) for look-at)
    const dx = playerSpawn.x - best.x
    const dz = playerSpawn.z - best.z
    const yaw = Math.hypot(dx, dz) > 0.1 ? Math.atan2(dx, dz) : 0

    placed.push({
      id: seed.id,
      x: best.x,
      y: best.y,
      z: best.z,
      yaw,
    })
  }

  return placed
}

function findOpenPoint(
  hitMeshes: THREE.Object3D[],
  bounds: MapBounds,
  preferX: number,
  preferZ: number,
  maxX: number,
  maxZ: number,
): { x: number; z: number } {
  // Try preferred point, then spiral samples around center / preferred.
  const candidates: { x: number; z: number }[] = [
    { x: preferX, z: preferZ },
    { x: 0, z: 0 },
    { x: preferX * 0.5, z: preferZ * 0.5 },
  ]
  for (let ring = 1; ring <= 6; ring++) {
    const r = (ring / 6) * Math.min(maxX, maxZ)
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + ring * 0.35
      candidates.push({
        x: clamp(preferX + Math.cos(a) * r, -maxX, maxX),
        z: clamp(preferZ + Math.sin(a) * r, -maxZ, maxZ),
      })
    }
  }

  let best = candidates[0]
  let bestScore = -Infinity
  for (const c of candidates) {
    const score = scoreSpawn(hitMeshes, bounds, c.x, c.z)
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

/**
 * Higher is better. Prefers solid floor under feet + head clearance.
 */
function scoreSpawn(
  hitMeshes: THREE.Object3D[],
  bounds: MapBounds,
  x: number,
  z: number,
): number {
  const floorY = sampleFloorY(hitMeshes, bounds, x, z)
  let score = 1

  // Prefer lower floors (walkable ground, not rooftops)
  const heightNorm = (floorY - bounds.min.y) / Math.max(0.1, bounds.size.y)
  score += (1 - clamp(heightNorm, 0, 1)) * 3

  // Head clearance: ray up ~2m
  const headClear = sampleClearanceUp(hitMeshes, x, floorY + 0.1, z, 2.2)
  if (headClear < 1.6) score -= 8
  else score += 2

  // Floor hit near y=0 after fit is ideal
  if (floorY >= -0.05 && floorY < 1.5) score += 4
  if (floorY > 4) score -= 3

  return score
}

function sampleFloorY(
  hitMeshes: THREE.Object3D[],
  bounds: MapBounds,
  x: number,
  z: number,
): number {
  if (hitMeshes.length === 0) return 0

  const top = bounds.max.y + 5
  _origin.set(x, top, z)
  _ray.set(_origin, _down)
  _ray.near = 0
  _ray.far = top - bounds.min.y + 10

  const hits = _ray.intersectObjects(hitMeshes, false)
  for (const h of hits) {
    // Prefer upward-facing surfaces (floors)
    const n = h.face?.normal
    if (n) {
      const wn = n.clone().transformDirection(h.object.matrixWorld).normalize()
      if (wn.y < 0.35) continue
    }
    return Math.max(0, h.point.y)
  }
  return 0
}

function sampleClearanceUp(
  hitMeshes: THREE.Object3D[],
  x: number,
  y: number,
  z: number,
  maxDist: number,
): number {
  if (hitMeshes.length === 0) return maxDist
  _origin.set(x, y, z)
  _ray.set(_origin, _up)
  _ray.near = 0
  _ray.far = maxDist
  const hits = _ray.intersectObjects(hitMeshes, false)
  if (hits.length === 0) return maxDist
  return hits[0].distance
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function addMapLights(scene: THREE.Scene, _map: MapDef, bounds: MapBounds) {
  const hemi = new THREE.HemisphereLight(0xddeeff, 0x3a3028, 0.9)
  hemi.name = 'map-hemi'
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(0xfff2dd, 1.2)
  sun.name = 'map-sun'
  const ext = Math.max(bounds.size.x, bounds.size.z, 40) * 0.6
  sun.position.set(ext * 0.6, ext, ext * 0.4)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = ext * 5
  sun.shadow.camera.left = -ext
  sun.shadow.camera.right = ext
  sun.shadow.camera.top = ext
  sun.shadow.camera.bottom = -ext
  scene.add(sun)
}

/**
 * Approximate solid colliders from mesh world AABBs.
 * Filters out floors, tiny debris, and map-scale wrappers.
 */
function extractColliders(
  root: THREE.Object3D,
  _map: MapDef,
  bounds: MapBounds,
): AABB[] {
  const out: AABB[] = []
  const tmp = new THREE.Box3()
  const maxDim = Math.max(bounds.size.x, bounds.size.z) * 0.85

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox()
    tmp.copy(obj.geometry.boundingBox!).applyMatrix4(obj.matrixWorld)

    const sx = tmp.max.x - tmp.min.x
    const sy = tmp.max.y - tmp.min.y
    const sz = tmp.max.z - tmp.min.z
    if (!Number.isFinite(sx + sy + sz)) return

    // Tiny props
    if (sx < 0.2 && sy < 0.2 && sz < 0.2) return
    // Huge wrappers / whole-map shells
    if (sx > maxDim && sz > maxDim) return
    // Large flat floors — player uses floor ray / y=0
    if (sy < 0.18 && sx * sz > 40) return
    // Sky / ceiling slabs very high up with huge footprint
    if (tmp.min.y > bounds.min.y + 12 && sx * sz > 100) return

    out.push({
      min: { x: tmp.min.x, y: tmp.min.y, z: tmp.min.z },
      max: { x: tmp.max.x, y: tmp.max.y, z: tmp.max.z },
    })
  })

  // Cap count for performance on dense maps
  if (out.length > 400) {
    out.sort((a, b) => {
      const vol = (aabb: AABB) =>
        (aabb.max.x - aabb.min.x) *
        (aabb.max.y - aabb.min.y) *
        (aabb.max.z - aabb.min.z)
      const score = (aabb: AABB) => {
        const h = aabb.max.y - aabb.min.y
        const mid = (aabb.min.y + aabb.max.y) * 0.5
        const heightScore = h > 0.4 && h < 8 ? 2 : 0.5
        const groundScore = mid < bounds.min.y + 6 ? 1.5 : 0.3
        return vol(aabb) * heightScore * groundScore
      }
      return score(b) - score(a)
    })
    return out.slice(0, 400)
  }

  return out
}

/** Mesh raycast against map geometry for bullet impacts. */
export function castMapHitscan(
  hitMeshes: THREE.Object3D[],
  origin: Vec3,
  direction: Vec3,
  maxRange: number,
): RayHit | null {
  const hit = castMeshWorldHitscan(hitMeshes, origin, direction, maxRange)
  if (!hit) return null
  return {
    point: hit.point,
    distance: hit.distance,
    normal: hit.normal,
    world: true,
  }
}
