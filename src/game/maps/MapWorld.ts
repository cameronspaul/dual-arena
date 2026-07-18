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
  type RangeControlButton,
} from '../scene/environment'
import type { SkyboxId } from '../scene/skyboxes'
import type { MapDef, MapDummyDef } from './catalog'
import {
  castMeshWorldHitscan,
  filterWalkCollisionMeshes,
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
  /**
   * Cheaper subset for player walk probes (filtered visuals or COL_ hull).
   * Same as hitMeshes when the set is already small / dedicated.
   */
  walkMeshes: THREE.Object3D[]
  /** World-space spawn after fit (feet on floor). */
  spawn: Vec3
  spawnYaw: number
  /** Dummy placements snapped onto the fitted map. */
  dummies: MapDummyDef[]
  /** Wander half-extent from origin, derived from map size. */
  dummyBounds: number
  bounds: MapBounds | null
  /** Practice-range control wall buttons (absent on GLB maps). */
  controlButtons?: RangeControlButton[]
}

const _ray = new THREE.Raycaster()
const _origin = new THREE.Vector3()
const _down = new THREE.Vector3(0, -1, 0)
const _up = new THREE.Vector3(0, 1, 0)

/**
 * Build the procedural practice range (4 lanes + control wall).
 */
export function buildProceduralRange(scene: THREE.Scene): MapLoadResult {
  const colliders = WORLD.coverBoxes.map((b) =>
    aabbFromCenter(b.x, b.y, b.z, b.w / 2, b.h / 2, b.d / 2),
  )
  const built = buildRangeScene(scene, colliders)
  colliders.push(...built.extraColliders)
  // Enclosed corridor — keep in sync with RANGE in shared config
  const halfW = 7
  const rearZ = 11
  const bermZ = -44
  return {
    root: null,
    colliders,
    floorMat: built.floorMat,
    coverMat: built.coverMat,
    envTextures: [],
    hitMeshes: [],
    walkMeshes: [],
    spawn: built.spawn,
    spawnYaw: built.spawnYaw,
    dummies: WORLD.dummies.map((d) => ({
      id: d.id,
      x: d.x,
      z: d.z,
      yaw: d.yaw,
    })),
    // Long-axis clamp so far-row dummies aren't yanked to origin
    dummyBounds: 48,
    bounds: {
      min: { x: -halfW, y: 0, z: bermZ },
      max: { x: halfW, y: 6, z: rearZ },
      size: { x: halfW * 2, y: 6, z: rearZ - bermZ },
      center: { x: 0, y: 3, z: (rearZ + bermZ) / 2 },
    },
    controlButtons: built.controlButtons,
  }
}

export async function loadEnvForMap(
  map: MapDef,
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  floorMat: THREE.MeshStandardMaterial | null,
  coverMat: THREE.MeshStandardMaterial | null,
  /** Concrete session skybox (not `"random"`). Defaults to day. */
  skybox?: SkyboxId,
): Promise<THREE.Texture[]> {
  // Always load a Kenney skybox; floor/cover textures only on the procedural range.
  return loadEnvironmentTextures({
    scene,
    renderer,
    floorMat,
    coverMat,
    skybox: skybox ?? 'day',
    loadFloorTextures: map.loadEnvTextures,
  })
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

  // Fit using *robust* bounds so giant Sketchfab shells / far debris
  // don't yank the playable pad into empty space — that was spawning
  // the player with no floor underfoot.
  const preBox = robustMeshBounds(root)
  const preCenter = new THREE.Vector3()
  preBox.getCenter(preCenter)

  root.position.x += -preCenter.x + map.offset.x
  root.position.y += -preBox.min.y + map.offset.y
  root.position.z += -preCenter.z + map.offset.z
  root.updateMatrixWorld(true)

  scene.add(root)
  root.updateMatrixWorld(true)

  // Collision + hitscan use prepared meshes (DoubleSide, optional COL_* only)
  let hitMeshes: THREE.Object3D[] = prepareCollisionMeshes(root)

  // Playable footprint after robust fit (not the inflated full-scene AABB)
  const playBox = robustMeshBounds(root)
  const bounds = boxToMapBounds(playBox)
  const size = bounds.size

  // Drop absurd wrapper shells from collision (keeps bullets/walk sane)
  hitMeshes = filterPlayableCollisionMeshes(hitMeshes, playBox)
  // Walk probes are ~50 rays/frame — strip decorative props when no COL_ hull
  const walkMeshes = filterWalkCollisionMeshes(hitMeshes)

  // Shadows: only a capped set of large solids cast (full cast on every mesh
  // was the main GPU cost on dense marketplace maps).
  const shadowStats = configureMapMeshShadows(root)

  const colliders = extractColliders(root, map, bounds)

  addMapLights(scene, map, bounds, shadowStats.meshCount)

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

  // Spawn/floor sampling uses the fuller hit set — walk filter can drop large
  // flat floors (receive-only) and shove pads into bad Y / open air.
  const { spawn, spawnYaw, dummies } = placeActors(
    map,
    hitMeshes.length > 0 ? hitMeshes : walkMeshes,
    bounds,
    dummyBounds,
  )

  if (walkMeshes.length !== hitMeshes.length) {
    console.info(
      `[map] ${map.id} walk colliders ${walkMeshes.length}/${hitMeshes.length} (visual set filtered for CPU)`,
    )
  }
  console.info(
    `[map] ${map.id} shadows: ${shadowStats.casters} casters / ${shadowStats.receivers} receivers / ${shadowStats.meshCount} meshes`,
  )

  return {
    root,
    colliders,
    floorMat: null,
    coverMat: null,
    envTextures: [],
    hitMeshes,
    walkMeshes,
    spawn,
    spawnYaw,
    dummies,
    dummyBounds,
    bounds,
  }
}

function boxToMapBounds(box: THREE.Box3): MapBounds {
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

function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const t = clamp(p, 0, 1) * (sorted.length - 1)
  const lo = Math.floor(t)
  const hi = Math.ceil(t)
  if (lo === hi) return sorted[lo]
  const f = t - lo
  return sorted[lo] * (1 - f) + sorted[hi] * f
}

/**
 * World AABB of the *playable bulk* of a map.
 *
 * Full `Box3.setFromObject` fails on marketplace GLBs that include km-scale
 * backdrop shells, distant debris, or mis-scaled props — the true arena ends
 * up as a speck, and spawn/floor probes land in empty space.
 *
 * We drop extreme-extent meshes, then take per-mesh AABB percentiles so a few
 * outliers cannot dominate. Falls back to the full box if the sample is tiny.
 */
function robustMeshBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true)
  const tmp = new THREE.Box3()
  type MeshBox = { min: THREE.Vector3; max: THREE.Vector3; extent: number }
  const meshBoxes: MeshBox[] = []

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return
    tmp.setFromObject(obj)
    if (tmp.isEmpty()) return
    const sx = tmp.max.x - tmp.min.x
    const sy = tmp.max.y - tmp.min.y
    const sz = tmp.max.z - tmp.min.z
    if (!Number.isFinite(sx + sy + sz) || sx + sy + sz < 1e-5) return
    meshBoxes.push({
      min: tmp.min.clone(),
      max: tmp.max.clone(),
      extent: Math.max(sx, sy, sz),
    })
  })

  const full = new THREE.Box3().setFromObject(root)
  if (meshBoxes.length < 8) return full

  const sortNum = (a: number, b: number) => a - b
  const extents = meshBoxes.map((b) => b.extent).sort(sortNum)
  const p75 = percentileSorted(extents, 0.75)
  const p96 = percentileSorted(extents, 0.96)
  // Keep typical props + buildings; drop km-scale Sketchfab shells
  const maxExtentKeep = Math.max(p96, p75 * 3, 25)

  const kept = meshBoxes.filter((b) => b.extent <= maxExtentKeep)
  const sample = kept.length >= 6 ? kept : meshBoxes

  const minsX = sample.map((b) => b.min.x).sort(sortNum)
  const minsY = sample.map((b) => b.min.y).sort(sortNum)
  const minsZ = sample.map((b) => b.min.z).sort(sortNum)
  const maxsX = sample.map((b) => b.max.x).sort(sortNum)
  const maxsY = sample.map((b) => b.max.y).sort(sortNum)
  const maxsZ = sample.map((b) => b.max.z).sort(sortNum)

  // Percentile trim: ignore a few remaining far props for center/floor.
  const lo = 0.06
  const hi = 0.94
  const robust = new THREE.Box3(
    new THREE.Vector3(
      percentileSorted(minsX, lo),
      percentileSorted(minsY, lo),
      percentileSorted(minsZ, lo),
    ),
    new THREE.Vector3(
      percentileSorted(maxsX, hi),
      percentileSorted(maxsY, hi),
      percentileSorted(maxsZ, hi),
    ),
  )

  const sizeScratch = new THREE.Vector3()
  if (
    !Number.isFinite(robust.min.x + robust.max.x) ||
    robust.isEmpty() ||
    robust.getSize(sizeScratch).length() < 1
  ) {
    return full
  }

  // Clamp into the true full box and ensure a valid volume
  robust.min.max(full.min)
  robust.max.min(full.max)
  if (
    robust.min.x >= robust.max.x ||
    robust.min.y >= robust.max.y ||
    robust.min.z >= robust.max.z
  ) {
    return full
  }
  return robust
}

/**
 * Remove map-wrapping backdrop shells from collision/hitscan.
 * Visuals stay; walk/bullet probes only see the playable bulk.
 */
function filterPlayableCollisionMeshes(
  meshes: THREE.Object3D[],
  playBox: THREE.Box3,
): THREE.Object3D[] {
  const playSize = new THREE.Vector3()
  playBox.getSize(playSize)
  const playFoot = Math.max(playSize.x, playSize.z, 1)
  const playHeight = Math.max(playSize.y, 1)
  // Shells that dwarf the playable pad in both horizontal axes
  const maxFoot = playFoot * 2.2
  const maxHeight = Math.max(playHeight * 3.5, playFoot * 1.5)

  const tmp = new THREE.Box3()
  const kept: THREE.Object3D[] = []
  for (const obj of meshes) {
    if (!(obj instanceof THREE.Mesh)) {
      kept.push(obj)
      continue
    }
    tmp.setFromObject(obj)
    if (tmp.isEmpty()) continue
    const sx = tmp.max.x - tmp.min.x
    const sy = tmp.max.y - tmp.min.y
    const sz = tmp.max.z - tmp.min.z
    const foot = Math.max(sx, sz)
    // Giant backdrop / inverted skybox hulls
    if (foot > maxFoot && sy > playHeight * 0.8) continue
    if (foot > maxFoot * 1.4) continue
    if (sy > maxHeight && foot > playFoot * 0.9) continue
    kept.push(obj)
  }
  // Safety: never return empty (would disable mesh collision entirely)
  return kept.length > 0 ? kept : meshes
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
  // Prefer offsets from the *playable* center (robust fit), not world 0 —
  // some maps still have a small residual offset after centering.
  const cx = bounds.center.x
  const cz = bounds.center.z

  // Catalog spawn is preferred offset from map center.
  // Clamp hard so we never start outside the footprint.
  const prefX = clamp(cx + map.spawn.x, cx - maxX, cx + maxX)
  const prefZ = clamp(cz + map.spawn.z, cz - maxZ, cz + maxZ)

  const spawnXZ = findOpenPoint(
    hitMeshes,
    bounds,
    prefX,
    prefZ,
    maxX,
    maxZ,
    cx,
    cz,
  )
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
    cx,
    cz,
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
  originX = 0,
  originZ = 0,
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
        x: clamp(originX + catalog.x, originX - maxX, originX + maxX),
        z: clamp(originZ + catalog.z, originZ - maxZ, originZ + maxZ),
      })
    } else {
      // Fan in front of player look (roughly -Z from spawn toward center)
      const ang = -Math.PI * 0.5 + ((i + 0.5) / count) * Math.PI
      seeds.push({
        id: `d${i}`,
        x: clamp(originX + Math.cos(ang) * ringR, originX - maxX, originX + maxX),
        z: clamp(originZ + Math.sin(ang) * ringR, originZ - maxZ, originZ + maxZ),
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
        x: originX - maxX + u * maxX * 2,
        z: originZ - maxZ + v * maxZ * 2,
      })
    }
  }

  const placed: MapDummyDef[] = []

  for (let i = 0; i < count; i++) {
    const seed = seeds[i]
    let best: { x: number; z: number; y: number; score: number } | null =
      null

    const tryPoint = (x: number, z: number, bias = 0) => {
      const px = clamp(x, originX - maxX, originX + maxX)
      const pz = clamp(z, originZ - maxZ, originZ + maxZ)
      const distP = Math.hypot(px - playerSpawn.x, pz - playerSpawn.z)
      if (distP < minFromPlayer) return

      let nearOther = false
      for (const p of placed) {
        if (Math.hypot(px - p.x, pz - p.z) < minBetween) {
          nearOther = true
          break
        }
      }
      if (nearOther) return

      const walk = scoreSpawn(hitMeshes, bounds, px, pz)
      // Reject unwalkable (no floor / roof / no headroom)
      if (walk < 2) return

      const y = sampleFloorY(hitMeshes, bounds, px, pz)
      // Prefer mid-range duel spacing (not jammed on player, not map edge)
      const spacing =
        distP > minFromPlayer * 1.4 && distP < minFromPlayer * 3.5 ? 1.5 : 0
      const edge =
        Math.min(maxX - Math.abs(px - originX), maxZ - Math.abs(pz - originZ)) >
        1.2
          ? 0.8
          : -1
      const score = walk + spacing + edge + bias
      if (!best || score > best.score) {
        best = { x: px, z: pz, y, score }
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
      const fx = clamp(
        originX - (playerSpawn.x - originX) * 0.6 + (i - count / 2) * 2.2,
        originX - maxX,
        originX + maxX,
      )
      const fz = clamp(
        originZ - (playerSpawn.z - originZ) * 0.6 - 3,
        originZ - maxZ,
        originZ + maxZ,
      )
      const open = findOpenPoint(
        hitMeshes,
        bounds,
        fx,
        fz,
        maxX,
        maxZ,
        originX,
        originZ,
      )
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
  originX = 0,
  originZ = 0,
): { x: number; z: number } {
  // Try preferred point, then spiral samples around center / preferred.
  const candidates: { x: number; z: number }[] = [
    { x: preferX, z: preferZ },
    { x: originX, z: originZ },
    {
      x: originX + (preferX - originX) * 0.5,
      z: originZ + (preferZ - originZ) * 0.5,
    },
  ]
  for (let ring = 1; ring <= 6; ring++) {
    const r = (ring / 6) * Math.min(maxX, maxZ)
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + ring * 0.35
      candidates.push({
        x: clamp(preferX + Math.cos(a) * r, originX - maxX, originX + maxX),
        z: clamp(preferZ + Math.sin(a) * r, originZ - maxZ, originZ + maxZ),
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
  const floor = sampleFloor(hitMeshes, bounds, x, z)
  if (!floor.hit) return -20

  const floorY = floor.y
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
  return sampleFloor(hitMeshes, bounds, x, z).y
}

function sampleFloor(
  hitMeshes: THREE.Object3D[],
  bounds: MapBounds,
  x: number,
  z: number,
): { y: number; hit: boolean } {
  if (hitMeshes.length === 0) return { y: 0, hit: false }

  const top = bounds.max.y + 5
  _origin.set(x, top, z)
  _ray.set(_origin, _down)
  _ray.near = 0
  _ray.far = top - bounds.min.y + 10

  const hits = _ray.intersectObjects(hitMeshes, false)
  for (const h of hits) {
    // Prefer upward-facing surfaces (floors). Face normals against the
    // down-ray so DoubleSide / inverted tunnel floors still count.
    const n = h.face?.normal
    if (n) {
      const wn = n.clone().transformDirection(h.object.matrixWorld).normalize()
      if (wn.dot(_down) > 0) wn.negate()
      if (wn.y < 0.35) continue
    }
    return { y: Math.max(0, h.point.y), hit: true }
  }
  return { y: 0, hit: false }
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

/**
 * Soft-cap shadow casters on dense marketplace GLBs.
 * Every mesh casting into a soft shadow map was the dominant GPU cost
 * on high-prop maps (~400+ casters).
 */
function configureMapMeshShadows(root: THREE.Object3D): {
  meshCount: number
  casters: number
  receivers: number
} {
  const tmp = new THREE.Box3()
  const size = new THREE.Vector3()
  type Cand = { mesh: THREE.Mesh; score: number; floorOnly: boolean }
  const cands: Cand[] = []
  let meshCount = 0

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return
    meshCount++
    // Default off — we opt a shortlist back on
    obj.castShadow = false
    obj.receiveShadow = false
    obj.frustumCulled = true

    tmp.setFromObject(obj)
    if (tmp.isEmpty()) return
    tmp.getSize(size)
    const sx = size.x
    const sy = size.y
    const sz = size.z
    if (!Number.isFinite(sx + sy + sz) || sx + sy + sz < 1e-4) return

    const foot = Math.max(sx, sz)
    const maxDim = Math.max(sx, sy, sz)
    // Large flat slabs: receive only (ground), never cast (huge shadow cost)
    const floorOnly = sy < 0.35 && foot > 4
    // Skip dust / pebbles entirely
    if (maxDim < 0.2) return

    // Prefer tall cover / walls / buildings for casting
    const score = foot * Math.max(sy, 0.15) * (floorOnly ? 0.15 : 1)
    cands.push({ mesh: obj, score, floorOnly })
  })

  cands.sort((a, b) => b.score - a.score)

  const maxCasters =
    meshCount > 300 ? 40 : meshCount > 150 ? 56 : meshCount > 80 ? 72 : 96
  const maxReceivers =
    meshCount > 300 ? 160 : meshCount > 150 ? 220 : meshCount > 80 ? 280 : 400

  let casters = 0
  let receivers = 0
  for (const c of cands) {
    if (receivers < maxReceivers) {
      c.mesh.receiveShadow = true
      receivers++
    }
    if (!c.floorOnly && casters < maxCasters) {
      c.mesh.castShadow = true
      casters++
    }
  }

  for (const c of cands) {
    if (c.floorOnly) {
      c.mesh.receiveShadow = true
      c.mesh.castShadow = false
    }
  }

  return { meshCount, casters, receivers }
}

function addMapLights(
  scene: THREE.Scene,
  _map: MapDef,
  bounds: MapBounds,
  meshCount = 0,
) {
  const hemi = new THREE.HemisphereLight(0xddeeff, 0x3a3028, 0.9)
  hemi.name = 'map-hemi'
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(0xfff2dd, 1.2)
  sun.name = 'map-sun'
  // Keep shadow ortho around the playable pad — huge frusta pull in every prop
  const span = Math.max(bounds.size.x, bounds.size.z, 24)
  const ext = Math.min(span * 0.55, 70)
  const elev = Math.min(Math.max(span * 0.7, 28), 90)
  sun.position.set(
    bounds.center.x + ext * 0.55,
    bounds.center.y + elev,
    bounds.center.z + ext * 0.35,
  )
  sun.target.position.set(bounds.center.x, bounds.center.y, bounds.center.z)
  sun.target.updateMatrixWorld()
  sun.castShadow = true

  const dense = meshCount > 150
  const mapRes = dense ? 1024 : 2048
  sun.shadow.mapSize.set(mapRes, mapRes)
  sun.shadow.bias = -0.00025
  sun.shadow.normalBias = 0.03
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = elev + ext * 2.2
  sun.shadow.camera.left = -ext
  sun.shadow.camera.right = ext
  sun.shadow.camera.top = ext
  sun.shadow.camera.bottom = -ext
  sun.shadow.camera.updateProjectionMatrix()
  scene.add(sun)
  scene.add(sun.target)
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
