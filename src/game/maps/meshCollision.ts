/**
 * Triangle-mesh player collision via ray probes against map GLB meshes.
 *
 * Why not AABB-only: exported FPS maps are arbitrary triangle soups. Bounding
 * boxes of whole objects are useless for floors, ramps, and corridors.
 *
 * Format: keep **glTF binary (.glb)** — Three.js loads it natively. USDZ is
 * for Apple AR and is a poor fit for this stack.
 *
 * Caveats (tunnels / marketplace GLBs):
 * - Materials are DoubleSide so thin shells work, but face normals are *not*
 *   flipped by Three.js for backfaces. Always re-orient against the ray.
 * - Floors often have inverted or mixed winding; skip non-walkable hits and
 *   keep scanning down the ray for a real floor.
 * - Single center probes fall through mesh seams — use multi-point feet.
 */
import * as THREE from 'three'
import type { PlayerBody, Vec3 } from '../core/types'

const _ray = new THREE.Raycaster()
const _origin = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _down = new THREE.Vector3(0, -1, 0)
const _up = new THREE.Vector3(0, 1, 0)
const _n = new THREE.Vector3()
const _sphere = new THREE.Sphere()
const _box = new THREE.Box3()

/** Nearby solid meshes used for probes this frame. */
export type MeshWorld = {
  meshes: THREE.Object3D[]
}

const WALL_DIRS = 8
const WALL_HEIGHTS = [0.35, 0.9, 1.35]
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

/**
 * Prepare loaded map meshes for collision/hitscan raycasts.
 * - DoubleSide so probes work when standing inside thin shells
 * - Cached bounding spheres for proximity culling
 */
export function prepareCollisionMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return

    // Prefer dedicated collision children if the artist named them.
    const name = (obj.name || obj.parent?.name || '').toLowerCase()
    const isCol =
      name.includes('collision') ||
      name.includes('collider') ||
      name.startsWith('col_') ||
      name.startsWith('ucx_') // Unreal collision prefix

    if (obj.geometry.boundingSphere == null) {
      obj.geometry.computeBoundingSphere()
    }
    if (obj.geometry.boundingBox == null) {
      obj.geometry.computeBoundingBox()
    }

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m) continue
      // Hits from both sides of thin walls / floors
      if ('side' in m) m.side = THREE.DoubleSide
    }

    obj.userData.collision = isCol
    out.push(obj)
  })

  // If the file has any explicit collision meshes, use *only* those
  // (common export pattern: high-poly visual + low-poly COL_*).
  const dedicated = out.filter((m) => {
    const name = (m.name || m.parent?.name || '').toLowerCase()
    return (
      name.includes('collision') ||
      name.includes('collider') ||
      name.startsWith('col_') ||
      name.startsWith('ucx_')
    )
  })
  return dedicated.length > 0 ? dedicated : out
}

function nearbyMeshes(
  meshes: THREE.Object3D[],
  pos: Vec3,
  radius: number,
): THREE.Object3D[] {
  if (meshes.length === 0) return meshes
  const cx = pos.x
  const cy = pos.y + 1
  const cz = pos.z
  const out: THREE.Object3D[] = []

  for (const obj of meshes) {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry?.boundingSphere) {
      out.push(obj)
      continue
    }
    _sphere.copy(obj.geometry.boundingSphere)
    _sphere.applyMatrix4(obj.matrixWorld)
    const dx = _sphere.center.x - cx
    const dy = _sphere.center.y - cy
    const dz = _sphere.center.z - cz
    const reach = radius + _sphere.radius
    if (dx * dx + dy * dy + dz * dz <= reach * reach) {
      out.push(obj)
    }
  }
  // Safety: if culling removed everything (bad bounds), fall back to all
  return out.length > 0 ? out : meshes
}

/** Count meshes inside the same proximity cull walk probes use (perf HUD). */
export function countNearbyCollisionMeshes(
  meshWorld: MeshWorld | null | undefined,
  pos: Vec3,
  radius = 8,
): number {
  if (!meshWorld || meshWorld.meshes.length === 0) return 0
  return nearbyMeshes(meshWorld.meshes, pos, radius).length
}

function allHits(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  meshes: THREE.Object3D[],
  maxDist: number,
  minDist = 0,
): THREE.Intersection[] {
  if (meshes.length === 0) return []
  _ray.set(origin, dir)
  _ray.near = Math.max(0, minDist)
  _ray.far = maxDist
  const hits = _ray.intersectObjects(meshes, false)
  if (minDist <= 0) return hits
  return hits.filter((h) => h.distance >= minDist)
}

function firstHit(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  meshes: THREE.Object3D[],
  maxDist: number,
  /** Ignore hits closer than this (standing inside thin floors / self) */
  minDist = 0,
): THREE.Intersection | null {
  const hits = allHits(origin, dir, meshes, maxDist, minDist)
  return hits.length > 0 ? hits[0] : null
}

/**
 * World-space face normal oriented to face *against* the ray (toward origin).
 * Required because DoubleSide hits still report the geometric (possibly inverted)
 * winding — without this, tunnel floors look non-walkable and walls eject you.
 */
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

/**
 * First walkable floor along a down-ray (skips debris / inverted / steep hits).
 */
function firstWalkableDown(
  origin: THREE.Vector3,
  meshes: THREE.Object3D[],
  maxDist: number,
): { pointY: number; ny: number; distance: number } | null {
  const hits = allHits(origin, _down, meshes, maxDist)
  for (const h of hits) {
    const n = hitNormalFacingRay(h, _down)
    if (n.y > WALKABLE_NY) {
      return { pointY: h.point.y, ny: n.y, distance: h.distance }
    }
  }
  return null
}

/**
 * Multi-foot ground sample. Returns the *highest* walkable contact so a seam
 * under the capsule center cannot drop you through tunnel floors.
 */
function sampleGround(
  pos: Vec3,
  radius: number,
  probeStartY: number,
  maxDown: number,
  meshes: THREE.Object3D[],
): { floorY: number; ny: number } | null {
  let bestY = -Infinity
  let bestNy = 0
  let found = false

  for (const [ox, oz] of GROUND_PROBE_XZ) {
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
 * Call *instead of* or *after* AABB resolve when meshWorld is set.
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

  const probeR = Math.max(8, r + 4)
  const meshes = nearbyMeshes(meshWorld.meshes, pos, probeR)

  // --- X then Z with wall probes ---
  pos.x += vel.x * dt
  resolveWalls(pos, vel, r, h, meshes, 'x')
  pos.z += vel.z * dt
  resolveWalls(pos, vel, r, h, meshes, 'z')

  // --- Y: gravity already applied; land / stick to ground / ceilings ---
  // Remember pre-step grounded: step-up + slope stick only while walking.
  // Airborne must NOT use STEP_HEIGHT as a "pull down" magnet (jump-over feel).
  const wasGrounded = p.grounded
  pos.y += vel.y * dt
  p.grounded = false

  // Ceiling — normal faces the up-ray so inverted roof shells still stop you
  _origin.set(pos.x, pos.y + h * 0.5, pos.z)
  const ceilHits = allHits(_origin, _up, meshes, h * 0.55 + 0.15)
  for (const ceil of ceilHits) {
    const cn = hitNormalFacingRay(ceil, _up)
    // Ceiling-ish: mostly downward after facing the up-ray
    if (cn.y > -0.2) continue
    if (vel.y > 0) {
      pos.y = ceil.point.y - h - SKIN
      vel.y = 0
    }
    break
  }

  // Ground: multi-point casts from above the feet
  const probeStartY = pos.y + GROUND_PROBE + STEP_HEIGHT
  const fallStep = Math.max(0, -vel.y * dt)
  // Slightly longer grounded reach so tunnel lips / small drops don't unstick
  const maxDown =
    GROUND_PROBE + STEP_HEIGHT + fallStep + (wasGrounded ? 0.5 : 0.28)

  const ground = sampleGround(pos, r, probeStartY, maxDown, meshes)

  if (ground) {
    const floorY = ground.floorY
    const feet = pos.y
    // gap > 0 → feet above floor; gap < 0 → penetrated
    const gap = feet - floorY
    // Still rising hard: never stick (apex / launch)
    if (vel.y <= 0.05) {
      if (wasGrounded) {
        // Stick to slopes / small drops and allow step-up while walking.
        // Extra penetration allowance recovers thin-floor tunnel frames.
        if (gap <= STEP_HEIGHT + 0.05 && gap >= -(STEP_HEIGHT + 0.2)) {
          pos.y = floorY
          if (vel.y < 0) vel.y = 0
          p.grounded = true
        }
      } else {
        // Airborne: land only when we actually reach the surface.
        // Snap-up recovers tunneling; tiny snap-down is skin only.
        const penMax = Math.max(0.35, fallStep + 0.12)
        if (gap <= AIR_LAND_SNAP && gap >= -penMax) {
          pos.y = floorY
          if (vel.y < 0) vel.y = 0
          p.grounded = true
        }
      }
    }
  } else {
    // No walkable floor in range — still push off steep surfaces near feet
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

  // Absolute kill-plane under the map so we never free-fall forever
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
) {
  const reach = radius + SKIN
  // Extra probes along motion on this axis
  const motion =
    axis === 'x'
      ? Math.sign(vel.x) || 0
      : Math.sign(vel.z) || 0

  for (const hy of WALL_HEIGHTS) {
    const y = pos.y + Math.min(hy, height * 0.9)
    if (y <= pos.y + 0.05) continue

    for (let i = 0; i < WALL_DIRS; i++) {
      const a = (i / WALL_DIRS) * Math.PI * 2
      const dx = Math.cos(a)
      const dz = Math.sin(a)
      // Skip opposite-to-motion rays lightly (still test all for embedding)
      if (motion !== 0) {
        const along = axis === 'x' ? dx * motion : dz * motion
        if (along < -0.2 && i % 2 === 1) continue
      }

      _origin.set(pos.x, y, pos.z)
      _dir.set(dx, 0, dz)
      // Walk hits until we find a real wall (skip floors / walkable ramps)
      const hits = allHits(_origin, _dir, meshes, reach + 0.05)
      for (const hit of hits) {
        const n = hitNormalFacingRay(hit, _dir)
        // Ignore floor-ish hits for wall resolve
        if (n.y > 0.55) continue

        const pen = reach - hit.distance
        if (pen <= 0) continue

        // Push out along horizontal normal (faces player after ray fix)
        const nx = n.x
        const nz = n.z
        const nl = Math.hypot(nx, nz)
        if (nl < 1e-5) continue
        const inv = 1 / nl
        pos.x += nx * inv * (pen + SKIN)
        pos.z += nz * inv * (pen + SKIN)

        // Kill velocity into the wall
        const vdot = vel.x * (nx * inv) + vel.z * (nz * inv)
        if (vdot < 0) {
          vel.x -= nx * inv * vdot
          vel.z -= nz * inv * vdot
        }
        break
      }
    }
  }
}

/**
 * Debug: world AABB of all collision meshes (for spawn / far plane).
 */
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
  const near = nearbyMeshes(meshes, origin, maxRange)
  // Skin so eye rays that start in/near floor tris don't "hit world" at t≈0
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
