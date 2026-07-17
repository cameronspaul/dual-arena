/**
 * Triangle-mesh player collision via ray probes against map GLB meshes.
 *
 * Why not AABB-only: exported FPS maps are arbitrary triangle soups. Bounding
 * boxes of whole objects are useless for floors, ramps, and corridors.
 *
 * Perf strategy (marketplace GLBs without COL_ hulls):
 * - Walk set is filtered + capped (see filterWalkCollisionMeshes).
 * - Cached world spheres + spatial hash for nearby queries.
 * - Nearby ranked by *surface* distance so large floors under the player
 *   are never dropped for closer prop centers.
 * - Adaptive probe LOD + hard cap on meshes tested per ray.
 * - Crude mesh AABBs are NOT used as walls (they eject you from buildings).
 */
import * as THREE from 'three'
import type { AABB, PlayerBody, Vec3 } from '../core/types'

const _ray = new THREE.Raycaster()
const _origin = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _down = new THREE.Vector3(0, -1, 0)
const _up = new THREE.Vector3(0, 1, 0)
const _n = new THREE.Vector3()
const _sphere = new THREE.Sphere()
const _box = new THREE.Box3()
const _size = new THREE.Vector3()

/** Cached world-space sphere (static map after fit). */
type WorldSphere = { x: number; y: number; z: number; r: number }

type SpatialGrid = {
  cell: number
  /** cellKey → mesh indices into `meshes` */
  cells: Map<string, number[]>
}

/** Nearby solid meshes used for probes this frame. */
export type MeshWorld = {
  /** Walk / movement probes (preferably filtered or COL_ only). */
  meshes: THREE.Object3D[]
  /**
   * Optional AABB walls from extractColliders — used for XZ so we don't
   * fire dozens of triangle wall rays while walking.
   */
  wallAabbs?: AABB[]
  grid?: SpatialGrid
}

const WALL_DIRS_FULL = 8
const WALL_DIRS_LITE = 4
const WALL_HEIGHTS_FULL = [0.35, 0.9, 1.35]
const WALL_HEIGHTS_LITE = [0.5, 1.15]
/** How far above the feet we start the down-ray (must clear thin floors). */
const GROUND_PROBE = 0.55
/** Max step-up / slope stick while already grounded. */
const STEP_HEIGHT = 0.4
/**
 * While airborne, only land when feet are this close *above* the floor.
 * Larger values feel like a gravity magnet onto crates/ledges mid-jump.
 */
const AIR_LAND_SNAP = 0.1
const SKIN = 0.02
/** Walkable if surface normal points mostly up (after ray-facing fix). */
const WALKABLE_NY = 0.45

/** Horizontal offsets for multi-foot ground probes (× radius). */
const GROUND_PROBE_XZ: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.55, 0],
  [-0.55, 0],
  [0, 0.55],
  [0, -0.55],
  [0.4, 0.4],
  [-0.4, 0.4],
  [0.4, -0.4],
  [-0.4, -0.4],
]
const GROUND_PROBE_XZ_LITE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.55, 0],
  [-0.55, 0],
  [0, 0.55],
  [0, -0.55],
]
const GROUND_PROBE_XZ_MOVE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.5, 0],
  [-0.5, 0],
]
const GROUND_PROBE_XZ_IDLE: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.5, 0],
  [-0.5, 0],
  [0, 0.5],
  [0, -0.5],
]

/**
 * Cap on meshes tested per resolve. Ranked by *surface* distance so huge
 * floors (center far away, player on the pad) are never dropped for props.
 */
const MAX_NEARBY_MESH = 28
/** Grid cell size (meters). */
const GRID_CELL = 10

type RankedMesh = { mesh: THREE.Object3D; bound: number }
const _ranked: RankedMesh[] = []
const _nearbyBuf: THREE.Object3D[] = []
/** surfaceDist = max(0, distToCenter − radius); 0 means player inside sphere. */
const _nearDist: { m: THREE.Object3D; surface: number; r: number }[] = []

function isDedicatedCollisionName(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n.includes('collision') ||
    n.includes('collider') ||
    n.startsWith('col_') ||
    n.startsWith('ucx_')
  )
}

function triangleCount(geo: THREE.BufferGeometry): number {
  const index = geo.index
  if (index) return Math.floor(index.count / 3)
  const pos = geo.getAttribute('position')
  return pos ? Math.floor(pos.count / 3) : 0
}

function cellKey(ix: number, iz: number): string {
  return `${ix},${iz}`
}

/** Bake world-space bounding spheres for static map collision meshes. */
export function cacheWalkMeshBounds(meshes: THREE.Object3D[]): void {
  for (const obj of meshes) {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) continue
    if (!obj.geometry.boundingSphere) obj.geometry.computeBoundingSphere()
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox()
    obj.updateMatrixWorld(true)
    _sphere.copy(obj.geometry.boundingSphere!)
    _sphere.applyMatrix4(obj.matrixWorld)
    const ws: WorldSphere = {
      x: _sphere.center.x,
      y: _sphere.center.y,
      z: _sphere.center.z,
      r: _sphere.radius,
    }
    obj.userData.worldSphere = ws
  }
}

function buildSpatialGrid(meshes: THREE.Object3D[], cell = GRID_CELL): SpatialGrid {
  const cells = new Map<string, number[]>()
  for (let i = 0; i < meshes.length; i++) {
    const obj = meshes[i]
    const ws = obj.userData.worldSphere as WorldSphere | undefined
    if (!ws) {
      // Put unbounded into every query via sentinel — skip grid for this mesh
      continue
    }
    const minIx = Math.floor((ws.x - ws.r) / cell)
    const maxIx = Math.floor((ws.x + ws.r) / cell)
    const minIz = Math.floor((ws.z - ws.r) / cell)
    const maxIz = Math.floor((ws.z + ws.r) / cell)
    for (let ix = minIx; ix <= maxIx; ix++) {
      for (let iz = minIz; iz <= maxIz; iz++) {
        const k = cellKey(ix, iz)
        let list = cells.get(k)
        if (!list) {
          list = []
          cells.set(k, list)
        }
        list.push(i)
      }
    }
  }
  return { cell, cells }
}

/**
 * Build a MeshWorld with spatial index + optional AABB walls for hybrid XZ.
 */
export function buildMeshWorld(
  meshes: THREE.Object3D[],
  wallAabbs?: AABB[] | null,
): MeshWorld {
  cacheWalkMeshBounds(meshes)
  return {
    meshes,
    wallAabbs: wallAabbs && wallAabbs.length > 0 ? wallAabbs : undefined,
    grid: meshes.length > 24 ? buildSpatialGrid(meshes) : undefined,
  }
}

/**
 * Prepare loaded map meshes for collision/hitscan raycasts.
 * - DoubleSide so probes work when standing inside thin shells
 * - Cached bounding spheres for proximity culling
 */
export function prepareCollisionMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return

    const name = (obj.name || obj.parent?.name || '').toLowerCase()
    const isCol = isDedicatedCollisionName(name)

    if (obj.geometry.boundingSphere == null) {
      obj.geometry.computeBoundingSphere()
    }
    if (obj.geometry.boundingBox == null) {
      obj.geometry.computeBoundingBox()
    }

    // DoubleSide only on thin shells — forcing it on every visual material
    // doubled fill-rate cost on dense GLBs.
    const bb = obj.geometry.boundingBox
    let thin = true
    if (bb) {
      const sx = bb.max.x - bb.min.x
      const sy = bb.max.y - bb.min.y
      const sz = bb.max.z - bb.min.z
      const minAxis = Math.min(sx, sy, sz)
      thin = minAxis < 0.35 || Math.min(sx, sz) < 0.2
    }
    if (thin || isCol) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of mats) {
        if (!m) continue
        if ('side' in m) m.side = THREE.DoubleSide
      }
    }

    obj.userData.collision = isCol
    out.push(obj)
  })

  const dedicated = out.filter((m) =>
    isDedicatedCollisionName(`${m.name || ''} ${m.parent?.name || ''}`),
  )
  return dedicated.length > 0 ? dedicated : out
}

/**
 * Build a cheaper walk-collision set from visual meshes when no COL_ hull exists.
 */
export function filterWalkCollisionMeshes(
  meshes: THREE.Object3D[],
): THREE.Object3D[] {
  if (meshes.length === 0) return meshes

  const dedicated = meshes.every((m) =>
    isDedicatedCollisionName(`${m.name || ''} ${m.parent?.name || ''}`),
  )
  if (dedicated) return meshes

  const kept: THREE.Object3D[] = []
  for (const obj of meshes) {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) {
      kept.push(obj)
      continue
    }
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox()
    const bb = obj.geometry.boundingBox
    if (!bb) {
      kept.push(obj)
      continue
    }
    _box.copy(bb).applyMatrix4(obj.matrixWorld)
    _box.getSize(_size)
    const sx = _size.x
    const sy = _size.y
    const sz = _size.z
    if (!Number.isFinite(sx + sy + sz)) continue

    const maxDim = Math.max(sx, sy, sz)
    const foot = Math.max(sx, sz)
    const vol = sx * sy * sz
    const tris = triangleCount(obj.geometry)

    if (maxDim < 0.08) continue
    if (sy < 0.06 && foot < 1.2) continue
    if (maxDim < 0.35 && vol < 0.04) continue
    if (tris > 800 && maxDim < 0.9 && vol < 0.35) continue
    if (foot < 0.12 && sy < 0.5 && tris > 200) continue
    if (maxDim < 0.55 && vol < 0.12 && tris > 100) continue

    kept.push(obj)
  }

  // Cap — but *boost* large floors so they never lose to mid props
  if (kept.length > 120) {
    const scored = kept
      .filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && !!o.geometry)
      .map((m) => {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
        _box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld)
        _box.getSize(_size)
        const foot = Math.max(_size.x, _size.z)
        const sy = _size.y
        let score =
          foot * Math.max(sy, 0.2) + triangleCount(m.geometry) * 0.0001
        // Walkable slabs / terrain chunks — must stay in the walk set
        if (sy < 1.2 && foot > 4) score += foot * 2
        if (sy < 0.5 && foot > 10) score += foot * 4
        return { m, score }
      })
      .sort((a, b) => b.score - a.score)
    return scored.slice(0, 120).map((s) => s.m)
  }

  if (kept.length < 8 && meshes.length >= 8) {
    const scored = meshes
      .filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && !!o.geometry)
      .map((m) => {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
        _box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld)
        _box.getSize(_size)
        const score = Math.max(_size.x, _size.z) * Math.max(_size.y, 0.2)
        return { m, score }
      })
      .sort((a, b) => b.score - a.score)
    const n = Math.min(80, Math.max(24, Math.floor(meshes.length * 0.3)))
    return scored.slice(0, n).map((s) => s.m)
  }

  return kept.length > 0 ? kept : meshes
}

function getWorldSphere(obj: THREE.Object3D): WorldSphere | null {
  const cached = obj.userData.worldSphere as WorldSphere | undefined
  if (cached) return cached
  if (!(obj instanceof THREE.Mesh) || !obj.geometry?.boundingSphere) return null
  _sphere.copy(obj.geometry.boundingSphere)
  _sphere.applyMatrix4(obj.matrixWorld)
  return {
    x: _sphere.center.x,
    y: _sphere.center.y,
    z: _sphere.center.z,
    r: _sphere.radius,
  }
}

function considerNearby(
  obj: THREE.Object3D,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
): void {
  const ws = getWorldSphere(obj)
  if (!ws) {
    // Unknown bounds — always keep (rare)
    _nearDist.push({ m: obj, surface: 0, r: 999 })
    return
  }
  const dx = ws.x - cx
  const dy = ws.y - cy
  const dz = ws.z - cz
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const surface = Math.max(0, dist - ws.r)
  // In range if probe sphere reaches the mesh sphere (incl. standing inside)
  if (surface <= radius) {
    _nearDist.push({ m: obj, surface, r: ws.r })
  }
}

function nearbyMeshes(
  meshWorld: MeshWorld,
  pos: Vec3,
  radius: number,
): THREE.Object3D[] {
  const meshes = meshWorld.meshes
  if (meshes.length === 0) return meshes

  // Feet + torso sample points — floors under you must stay in the set
  const cx = pos.x
  const cy = pos.y + 0.5
  const cz = pos.z

  _nearbyBuf.length = 0
  _nearDist.length = 0

  if (meshWorld.grid && meshes.length > 24) {
    const { cell, cells } = meshWorld.grid
    const minIx = Math.floor((cx - radius) / cell)
    const maxIx = Math.floor((cx + radius) / cell)
    const minIz = Math.floor((cz - radius) / cell)
    const maxIz = Math.floor((cz + radius) / cell)
    const seen = new Set<number>()
    for (let ix = minIx; ix <= maxIx; ix++) {
      for (let iz = minIz; iz <= maxIz; iz++) {
        const list = cells.get(cellKey(ix, iz))
        if (!list) continue
        for (const i of list) {
          if (seen.has(i)) continue
          seen.add(i)
          considerNearby(meshes[i], cx, cy, cz, radius)
        }
      }
    }
    // Large floors may live in many cells but miss the probe ring if grid
    // insertion used a too-small sphere — sweep all oversized spheres.
    for (let i = 0; i < meshes.length; i++) {
      if (seen.has(i)) continue
      const ws = getWorldSphere(meshes[i])
      if (ws && ws.r >= radius * 1.5) {
        considerNearby(meshes[i], cx, cy, cz, radius)
      }
    }
  } else {
    for (const obj of meshes) {
      considerNearby(obj, cx, cy, cz, radius)
    }
  }

  if (_nearDist.length === 0) {
    return meshes.length <= MAX_NEARBY_MESH
      ? meshes
      : meshes.slice(0, MAX_NEARBY_MESH)
  }

  // Prefer meshes that contain the player (surface≈0), then larger spheres
  // (terrain), then nearer props. Never drop "I'm inside this sphere" floors.
  _nearDist.sort((a, b) => {
    if (a.surface !== b.surface) return a.surface - b.surface
    return b.r - a.r
  })

  const must: THREE.Object3D[] = []
  const rest: THREE.Object3D[] = []
  for (const e of _nearDist) {
    if (e.surface <= 0.05) must.push(e.m)
    else rest.push(e.m)
  }
  // Always keep every containing mesh (floors / building volumes under feet)
  for (const m of must) _nearbyBuf.push(m)
  const room = Math.max(0, MAX_NEARBY_MESH - _nearbyBuf.length)
  for (let i = 0; i < rest.length && i < room; i++) {
    _nearbyBuf.push(rest[i])
  }
  // If still empty somehow, fall back
  if (_nearbyBuf.length === 0) {
    for (let i = 0; i < Math.min(MAX_NEARBY_MESH, _nearDist.length); i++) {
      _nearbyBuf.push(_nearDist[i].m)
    }
  }
  return _nearbyBuf
}

/** Count meshes inside the same proximity cull walk probes use (perf HUD). */
export function countNearbyCollisionMeshes(
  meshWorld: MeshWorld | null | undefined,
  pos: Vec3,
  radius = 8,
): number {
  if (!meshWorld || meshWorld.meshes.length === 0) return 0
  return nearbyMeshes(meshWorld, pos, radius).length
}

function rankMeshesAlongRay(
  origin: THREE.Vector3,
  meshes: THREE.Object3D[],
  maxDist: number,
): RankedMesh[] {
  _ranked.length = 0
  for (const obj of meshes) {
    const ws = getWorldSphere(obj)
    if (!ws) {
      _ranked.push({ mesh: obj, bound: 0 })
      continue
    }
    const dx = ws.x - origin.x
    const dy = ws.y - origin.y
    const dz = ws.z - origin.z
    const distCenter = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const bound = Math.max(0, distCenter - ws.r)
    if (bound > maxDist) continue
    _ranked.push({ mesh: obj, bound })
  }
  _ranked.sort((a, b) => a.bound - b.bound)
  return _ranked
}

function allHits(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  meshes: THREE.Object3D[],
  maxDist: number,
  minDist = 0,
): THREE.Intersection[] {
  if (meshes.length === 0) return []
  if (meshes.length <= 4) {
    _ray.set(origin, dir)
    _ray.near = Math.max(0, minDist)
    _ray.far = maxDist
    const hits = _ray.intersectObjects(meshes, false)
    if (minDist <= 0) return hits
    return hits.filter((h) => h.distance >= minDist)
  }

  const ranked = rankMeshesAlongRay(origin, meshes, maxDist)
  _ray.set(origin, dir)
  _ray.near = Math.max(0, minDist)
  _ray.far = maxDist
  const out: THREE.Intersection[] = []
  for (const { mesh } of ranked) {
    const part = _ray.intersectObject(mesh, false)
    for (const h of part) {
      if (h.distance >= minDist && h.distance <= maxDist) out.push(h)
    }
  }
  out.sort((a, b) => a.distance - b.distance)
  return out
}

function firstHit(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  meshes: THREE.Object3D[],
  maxDist: number,
  minDist = 0,
): THREE.Intersection | null {
  if (meshes.length === 0) return null
  if (meshes.length <= 4) {
    const hits = allHits(origin, dir, meshes, maxDist, minDist)
    return hits.length > 0 ? hits[0] : null
  }

  const ranked = rankMeshesAlongRay(origin, meshes, maxDist)
  _ray.set(origin, dir)
  _ray.near = Math.max(0, minDist)

  let best: THREE.Intersection | null = null
  let bestDist = maxDist
  for (const { mesh, bound } of ranked) {
    if (bound > bestDist) break
    _ray.far = bestDist
    const hits = _ray.intersectObject(mesh, false)
    for (const h of hits) {
      if (h.distance < minDist) continue
      if (h.distance < bestDist) {
        best = h
        bestDist = h.distance
      }
    }
  }
  return best
}

function hitNormalFacingRay(
  h: THREE.Intersection,
  rayDir: THREE.Vector3,
): THREE.Vector3 {
  if (h.face) {
    _n.copy(h.face.normal).transformDirection(h.object.matrixWorld).normalize()
  } else {
    _n.set(0, 1, 0)
  }
  if (_n.dot(rayDir) > 0) {
    _n.negate()
  }
  return _n
}

function firstWalkableDown(
  origin: THREE.Vector3,
  meshes: THREE.Object3D[],
  maxDist: number,
): { pointY: number; ny: number; distance: number } | null {
  if (meshes.length === 0) return null

  if (meshes.length <= 4) {
    const hits = allHits(origin, _down, meshes, maxDist)
    for (const h of hits) {
      const n = hitNormalFacingRay(h, _down)
      if (n.y > WALKABLE_NY) {
        return { pointY: h.point.y, ny: n.y, distance: h.distance }
      }
    }
    return null
  }

  const ranked = rankMeshesAlongRay(origin, meshes, maxDist)
  _ray.set(origin, _down)
  _ray.near = 0

  let best: { pointY: number; ny: number; distance: number } | null = null
  let bestDist = maxDist
  for (const { mesh, bound } of ranked) {
    if (bound > bestDist) break
    _ray.far = bestDist
    const hits = _ray.intersectObject(mesh, false)
    for (const h of hits) {
      if (h.distance > bestDist) continue
      const n = hitNormalFacingRay(h, _down)
      if (n.y > WALKABLE_NY) {
        best = { pointY: h.point.y, ny: n.y, distance: h.distance }
        bestDist = h.distance
        break
      }
    }
  }
  return best
}

function sampleGround(
  pos: Vec3,
  radius: number,
  probeStartY: number,
  maxDown: number,
  meshes: THREE.Object3D[],
  probes: ReadonlyArray<readonly [number, number]>,
): { floorY: number; ny: number } | null {
  let bestY = -Infinity
  let bestNy = 0
  let found = false

  for (const [ox, oz] of probes) {
    _origin.set(pos.x + ox * radius, probeStartY, pos.z + oz * radius)
    const hit = firstWalkableDown(_origin, meshes, maxDown)
    if (!hit) continue
    if (hit.pointY > bestY) {
      bestY = hit.pointY
      bestNy = hit.ny
      found = true
    }
  }

  return found ? { floorY: bestY, ny: bestNy } : null
}

/**
 * Integrate player motion against triangle meshes (ground + walls).
 *
 * Note: wallAabbs are intentionally NOT used for XZ — extractColliders boxes
 * are mesh AABBs that often fill whole buildings and *eject* the player from
 * the playable space (spawn / mid-map shove). Mesh wall rays stay authoritative.
 */
export function resolveMeshCollisions(
  p: PlayerBody,
  meshWorld: MeshWorld | null | undefined,
  dt: number,
): void {
  if (!meshWorld || meshWorld.meshes.length === 0) return

  const vel = p.velocity
  const pos = p.position
  const r = p.radius
  const h = p.height

  // Slightly larger probe so terrain under feet stays in the nearby set
  const probeR = Math.max(8, r + 4)
  const meshes = nearbyMeshes(meshWorld, pos, probeR)
  const nearbyN = meshes.length
  const horizSp = Math.hypot(vel.x, vel.z)
  const idleGrounded = p.grounded && horizSp < 0.4
  const moving = horizSp >= 0.4

  // Wall probe LOD (mesh only — safe vs crude AABB walls)
  const wallDirs = moving
    ? WALL_DIRS_LITE
    : idleGrounded
      ? WALL_DIRS_LITE
      : nearbyN >= 20
        ? WALL_DIRS_LITE
        : WALL_DIRS_FULL
  const wallHeights = moving || idleGrounded
    ? WALL_HEIGHTS_LITE
    : WALL_HEIGHTS_FULL

  // --- X then Z with mesh wall probes ---
  pos.x += vel.x * dt
  resolveWalls(pos, vel, r, h, meshes, 'x', wallDirs, wallHeights)
  pos.z += vel.z * dt
  resolveWalls(pos, vel, r, h, meshes, 'z', wallDirs, wallHeights)

  // --- Y: ground / ceiling ---
  const wasGrounded = p.grounded
  pos.y += vel.y * dt
  p.grounded = false

  if (vel.y > 0.05) {
    _origin.set(pos.x, pos.y + h * 0.5, pos.z)
    const ceilHits = allHits(_origin, _up, meshes, h * 0.55 + 0.15)
    for (const ceil of ceilHits) {
      const cn = hitNormalFacingRay(ceil, _up)
      if (cn.y > -0.2) continue
      pos.y = ceil.point.y - h - SKIN
      vel.y = 0
      break
    }
  }

  const probeStartY = pos.y + GROUND_PROBE + STEP_HEIGHT
  const fallStep = Math.max(0, -vel.y * dt)
  const maxDown =
    GROUND_PROBE + STEP_HEIGHT + fallStep + (wasGrounded ? 0.5 : 0.28)

  // Always multi-foot when airborne; grounded can use lite/move sets
  let groundProbes: ReadonlyArray<readonly [number, number]> =
    GROUND_PROBE_XZ_LITE
  if (!wasGrounded) groundProbes = GROUND_PROBE_XZ_LITE
  else if (idleGrounded) groundProbes = GROUND_PROBE_XZ_IDLE
  else if (moving) groundProbes = GROUND_PROBE_XZ_MOVE
  else if (nearbyN < 12) groundProbes = GROUND_PROBE_XZ

  const ground = sampleGround(
    pos,
    r,
    probeStartY,
    maxDown,
    meshes,
    groundProbes,
  )

  if (ground) {
    const floorY = ground.floorY
    const feet = pos.y
    const gap = feet - floorY
    if (vel.y <= 0.05) {
      if (wasGrounded) {
        if (gap <= STEP_HEIGHT + 0.05 && gap >= -(STEP_HEIGHT + 0.2)) {
          pos.y = floorY
          if (vel.y < 0) vel.y = 0
          p.grounded = true
        }
      } else {
        const penMax = Math.max(0.35, fallStep + 0.12)
        if (gap <= AIR_LAND_SNAP && gap >= -penMax) {
          pos.y = floorY
          if (vel.y < 0) vel.y = 0
          p.grounded = true
        }
      }
    }
  } else {
    _origin.set(pos.x, pos.y + GROUND_PROBE, pos.z)
    const steep = firstHit(_origin, _down, meshes, GROUND_PROBE + r)
    if (steep) {
      const n = hitNormalFacingRay(steep, _down)
      if (n.y < 0.2 && steep.distance < r + 0.15) {
        pos.x += n.x * (r * 0.25)
        pos.z += n.z * (r * 0.25)
      }
    }
  }

  if (pos.y < -50) {
    pos.y = 0
    vel.y = 0
    p.grounded = true
  }
}

function resolveWalls(
  pos: Vec3,
  vel: { x: number; y: number; z: number },
  radius: number,
  height: number,
  meshes: THREE.Object3D[],
  axis: 'x' | 'z',
  wallDirs: number,
  wallHeights: readonly number[],
) {
  const reach = radius + SKIN
  const motion =
    axis === 'x' ? Math.sign(vel.x) || 0 : Math.sign(vel.z) || 0

  for (const hy of wallHeights) {
    const y = pos.y + Math.min(hy, height * 0.9)
    if (y <= pos.y + 0.05) continue

    for (let i = 0; i < wallDirs; i++) {
      const a = (i / wallDirs) * Math.PI * 2
      const dx = Math.cos(a)
      const dz = Math.sin(a)
      if (motion !== 0) {
        const along = axis === 'x' ? dx * motion : dz * motion
        if (along < -0.2 && i % 2 === 1) continue
      }

      _origin.set(pos.x, y, pos.z)
      _dir.set(dx, 0, dz)
      const hit = firstWallHit(_origin, _dir, meshes, reach + 0.05)
      if (!hit) continue

      const n = hitNormalFacingRay(hit, _dir)
      const pen = reach - hit.distance
      if (pen <= 0) continue

      const nx = n.x
      const nz = n.z
      const nl = Math.hypot(nx, nz)
      if (nl < 1e-5) continue
      const inv = 1 / nl
      pos.x += nx * inv * (pen + SKIN)
      pos.z += nz * inv * (pen + SKIN)

      const vdot = vel.x * (nx * inv) + vel.z * (nz * inv)
      if (vdot < 0) {
        vel.x -= nx * inv * vdot
        vel.z -= nz * inv * vdot
      }
    }
  }
}

function firstWallHit(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  meshes: THREE.Object3D[],
  maxDist: number,
): THREE.Intersection | null {
  if (meshes.length === 0) return null
  if (meshes.length <= 4) {
    const hits = allHits(origin, dir, meshes, maxDist)
    for (const h of hits) {
      const n = hitNormalFacingRay(h, dir)
      if (n.y > 0.55) continue
      return h
    }
    return null
  }

  const ranked = rankMeshesAlongRay(origin, meshes, maxDist)
  _ray.set(origin, dir)
  _ray.near = 0

  let best: THREE.Intersection | null = null
  let bestDist = maxDist
  for (const { mesh, bound } of ranked) {
    if (bound > bestDist) break
    _ray.far = bestDist
    const hits = _ray.intersectObject(mesh, false)
    for (const h of hits) {
      if (h.distance > bestDist) continue
      const n = hitNormalFacingRay(h, dir)
      if (n.y > 0.55) continue
      best = h
      bestDist = h.distance
      break
    }
  }
  return best
}

export function meshWorldBounds(meshes: THREE.Object3D[]): THREE.Box3 {
  _box.makeEmpty()
  for (const m of meshes) {
    _box.expandByObject(m)
  }
  return _box.clone()
}

/** Shared hitscan against mesh world (bullets). */
export function castMeshWorldHitscan(
  meshes: THREE.Object3D[],
  origin: Vec3,
  direction: Vec3,
  maxRange: number,
): { point: Vec3; distance: number; normal: Vec3 } | null {
  if (meshes.length === 0) return null
  _origin.set(origin.x, origin.y, origin.z)
  _dir.set(direction.x, direction.y, direction.z).normalize()

  // Lightweight nearby cull (no grid rebuild on every shot)
  const cx = origin.x
  const cy = origin.y
  const cz = origin.z
  const near: THREE.Object3D[] = []
  for (const obj of meshes) {
    const ws = getWorldSphere(obj)
    if (!ws) {
      near.push(obj)
      continue
    }
    const dx = ws.x - cx
    const dy = ws.y - cy
    const dz = ws.z - cz
    const reach = maxRange + ws.r
    if (dx * dx + dy * dy + dz * dz <= reach * reach) near.push(obj)
  }

  const hit = firstHit(
    _origin,
    _dir,
    near.length ? near : meshes,
    maxRange,
    0.12,
  )
  if (!hit) return null
  const n = hitNormalFacingRay(hit, _dir)
  return {
    point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
    distance: hit.distance,
    normal: { x: n.x, y: n.y, z: n.z },
  }
}
