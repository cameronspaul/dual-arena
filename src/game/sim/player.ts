import { MOVE, PLAYER } from '../core/config'
import { clamp, facingXZ, lenXZ, lerp, wishDir } from '../core/math'
import type { AABB, Hitbox, HitVolumes, PlayerBody, PlayerInput, Vec3 } from '../core/types'
import {
  resolveMeshCollisions,
  type MeshWorld,
} from '../maps/meshCollision'

export function volumesToHitboxes(ownerId: string, v: HitVolumes): Hitbox[] {
  const boxes: Hitbox[] = [
    {
      id: `${ownerId}-head`,
      ownerId,
      zone: 'head',
      ellipsoid: {
        center: { ...v.headCenter },
        radii: { ...v.headRadii },
      },
    },
  ]
  for (let i = 0; i < v.capsules.length; i++) {
    const c = v.capsules[i]
    boxes.push({
      id: `${ownerId}-cap-${i}`,
      ownerId,
      zone: 'chest',
      capsule: {
        a: { ...c.a },
        b: { ...c.b },
        radius: c.radius,
      },
    })
  }
  if (v.bodySpheres) {
    for (let i = 0; i < v.bodySpheres.length; i++) {
      const s = v.bodySpheres[i]
      boxes.push({
        id: `${ownerId}-bs-${i}`,
        ownerId,
        zone: 'chest',
        sphere: { center: { ...s.center }, radius: s.radius },
      })
    }
  }
  return boxes
}

export function createPlayer(
  spawn: { x: number; y: number; z: number } = PLAYER.spawn,
): PlayerBody {
  return {
    position: { x: spawn.x, y: spawn.y, z: spawn.z },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    state: 'idle',
    grounded: true,
    height: MOVE.standingHeight,
    eyeHeight: MOVE.eyeStanding,
    radius: MOVE.radius,
    slideTimer: 0,
    slideCd: 0,
    slideSpeed: 0,
  }
}

function horizSpeed(p: PlayerBody): number {
  return lenXZ(p.velocity)
}

function accelerate(
  vel: Vec3,
  wish: Vec3,
  wishSpeed: number,
  accel: number,
  dt: number,
) {
  const current = vel.x * wish.x + vel.z * wish.z
  const addSpeed = wishSpeed - current
  if (addSpeed <= 0) return
  let accelSpeed = accel * dt * wishSpeed
  if (accelSpeed > addSpeed) accelSpeed = addSpeed
  vel.x += wish.x * accelSpeed
  vel.z += wish.z * accelSpeed
}

function applyFriction(vel: Vec3, amount: number, dt: number, stopSpeed: number) {
  const speed = lenXZ(vel)
  if (speed < 1e-4) {
    vel.x = 0
    vel.z = 0
    return
  }
  const control = speed < stopSpeed ? stopSpeed : speed
  const drop = control * amount * dt
  const newSpeed = Math.max(speed - drop, 0) / speed
  vel.x *= newSpeed
  vel.z *= newSpeed
}

function targetHeight(state: PlayerBody['state']): number {
  if (state === 'crouch' || state === 'slide') return MOVE.crouchHeight
  return MOVE.standingHeight
}

function targetEye(state: PlayerBody['state']): number {
  if (state === 'slide') return MOVE.eyeSlide
  if (state === 'crouch') return MOVE.eyeCrouch
  return MOVE.eyeStanding
}

function canStartSlide(p: PlayerBody, input: PlayerInput): boolean {
  if (!p.grounded) return false
  if (p.slideCd > 0) return false
  if (p.state === 'slide') return false
  if (!input.crouch) return false
  // sprint + crouch, or already fast enough
  const speed = horizSpeed(p)
  if (input.sprint && speed >= MOVE.walkSpeed * 0.85) return true
  return speed >= MOVE.slideSpeedMin
}

/**
 * Pose after a slide finishes.
 * Hold crouch → stay crouched; release → stand up automatically.
 */
function stateAfterSlide(
  input: PlayerInput,
  wishLen: boolean,
): PlayerBody['state'] {
  if (input.crouch) return 'crouch'
  if (!wishLen) return 'idle'
  if (input.sprint && !input.ads) return 'run'
  return 'walk'
}

/**
 * Axis-separated capsule vs world AABBs (no position integration).
 * Used after mesh resolve for editor barrier walls on GLB maps.
 */
function resolveAabbOverlaps(
  p: PlayerBody,
  world: AABB[],
  opts: { infiniteFloor?: boolean; integrate?: boolean } = {},
  dt = 0,
) {
  const infiniteFloor = opts.infiniteFloor ?? false
  const integrate = opts.integrate ?? false
  const vel = p.velocity
  const pos = p.position
  const r = p.radius
  const h = p.height

  if (integrate) {
    pos.x += vel.x * dt
  }
  for (const box of world) {
    if (overlapsCapsule(pos, r, h, box)) {
      const cx = (box.min.x + box.max.x) * 0.5
      if (pos.x < cx) pos.x = box.min.x - r - 1e-4
      else pos.x = box.max.x + r + 1e-4
      vel.x = 0
    }
  }

  if (integrate) {
    pos.z += vel.z * dt
  }
  for (const box of world) {
    if (overlapsCapsule(pos, r, h, box)) {
      const cz = (box.min.z + box.max.z) * 0.5
      if (pos.z < cz) pos.z = box.min.z - r - 1e-4
      else pos.z = box.max.z + r + 1e-4
      vel.z = 0
    }
  }

  const wasGrounded = p.grounded
  if (integrate) {
    pos.y += vel.y * dt
    p.grounded = false
  }

  if (infiniteFloor && pos.y < 0) {
    pos.y = 0
    vel.y = 0
    p.grounded = true
  }

  const landSnap = wasGrounded ? 0.4 : 0.1
  const penMax = wasGrounded
    ? 0.45
    : Math.max(0.22, Math.max(0, -vel.y * (integrate ? dt : 0)) + 0.08)

  for (const box of world) {
    if (!overlapsCapsule(pos, r, h, box)) continue
    const feet = pos.y
    const head = pos.y + h
    if (vel.y <= 0.05 && head > box.max.y) {
      const gap = feet - box.max.y
      if (gap <= landSnap && gap >= -penMax) {
        pos.y = box.max.y
        vel.y = 0
        p.grounded = true
        continue
      }
    }
    if (vel.y > 0 && head >= box.min.y && feet < box.min.y) {
      pos.y = box.min.y - h - 1e-4
      vel.y = 0
      continue
    }
    // side shove already handled on XZ; residual Y unstick only when not rising
    if (vel.y <= 0.05 && feet < box.max.y && head > box.min.y) {
      const up = box.max.y - feet
      const down = head - box.min.y
      if (up < down && up <= penMax) {
        pos.y = box.max.y
        vel.y = 0
        p.grounded = true
      }
    }
  }
}

/**
 * Axis-separated capsule (as vertical segment + radius) vs world AABBs.
 * Simplified: treat as cylinder-ish AABB with radius expansion.
 */
function resolveCollisions(p: PlayerBody, world: AABB[], dt: number) {
  resolveAabbOverlaps(p, world, { infiniteFloor: true, integrate: true }, dt)
}

/**
 * Barrier / extra AABB resolve using **minimum penetration** on XZ.
 *
 * The older center-based shove (push to min or max of the long axis) was
 * catastrophic for long or "infinite" walls: walking into the thin face
 * teleported the player thousands of metres to an end-cap, then fall-death
 * killed them.
 *
 * Rules:
 * - Always unstick on the shallowest horizontal axis (thin face of a wall).
 * - Only land on top when the top face is clearly the nearest (short pen-up).
 * - Never "ceiling" launch onto the roof of a multi-km tall infinite wall.
 */
export function resolveExtraAabbColliders(p: PlayerBody, walls: AABB[]) {
  if (!walls.length) return
  const pos = p.position
  const vel = p.velocity
  const r = p.radius
  const h = p.height

  for (const box of walls) {
    const pMinX = pos.x - r
    const pMaxX = pos.x + r
    const pMinY = pos.y
    const pMaxY = pos.y + h
    const pMinZ = pos.z - r
    const pMaxZ = pos.z + r

    if (pMaxX <= box.min.x || pMinX >= box.max.x) continue
    if (pMaxY <= box.min.y || pMinY >= box.max.y) continue
    if (pMaxZ <= box.min.z || pMinZ >= box.max.z) continue

    const penPosX = pMaxX - box.min.x // push −X
    const penNegX = box.max.x - pMinX // push +X
    const penPosY = pMaxY - box.min.y // push −Y (ceiling)
    const penNegY = box.max.y - pMinY // push +Y (stand on top)
    const penPosZ = pMaxZ - box.min.z // push −Z
    const penNegZ = box.max.z - pMinZ // push +Z

    const px = Math.min(penPosX, penNegX)
    const pz = Math.min(penPosZ, penNegZ)

    // Stand on top only for short tops (cover crates), never for sky-high walls
    const topIsShallow =
      penNegY <= penPosY &&
      penNegY <= 0.55 &&
      penNegY <= px + 1e-4 &&
      penNegY <= pz + 1e-4
    if (topIsShallow && vel.y <= 0.05) {
      pos.y = box.max.y
      vel.y = 0
      p.grounded = true
      continue
    }

    // Prefer horizontal unstick; ignore deep Y (player is "inside" a tall slab)
    if (px <= pz) {
      if (penPosX < penNegX) pos.x = box.min.x - r - 1e-4
      else pos.x = box.max.x + r + 1e-4
      vel.x = 0
    } else {
      if (penPosZ < penNegZ) pos.z = box.min.z - r - 1e-4
      else pos.z = box.max.z + r + 1e-4
      vel.z = 0
    }
  }
}

function overlapsCapsule(pos: Vec3, r: number, h: number, box: AABB): boolean {
  // closest point on capsule segment (feet to head-r) to box
  const feetY = pos.y
  const headY = pos.y + h
  const closestY = clamp(
    (box.min.y + box.max.y) * 0.5,
    feetY + r * 0.2,
    headY - r * 0.2,
  )
  const cx = clamp(pos.x, box.min.x, box.max.x)
  const cy = clamp(closestY, box.min.y, box.max.y)
  const cz = clamp(pos.z, box.min.z, box.max.z)
  const dx = pos.x - cx
  const dy = closestY - cy
  const dz = pos.z - cz
  return dx * dx + dy * dy + dz * dz < r * r
}

export function stepPlayer(
  p: PlayerBody,
  input: PlayerInput,
  dt: number,
  worldColliders: AABB[],
  /** When set (GLB maps), walk on real triangle floors/walls instead of y=0 + AABBs. */
  meshWorld?: MeshWorld | null,
  /**
   * Extra AABB blockers (editor barrier walls). Always applied:
   * after mesh resolve on GLB maps, or merged into AABB resolve on range.
   */
  extraColliders?: AABB[] | null,
) {
  p.yaw = input.yaw
  p.pitch = input.pitch
  p.slideCd = Math.max(0, p.slideCd - dt)

  const wish = wishDir(input.forward, input.right, input.yaw)
  const wishLen = lenXZ(wish) > 0.01
  const adsMul = input.ads ? MOVE.adsSpeedMul : 1

  // --- state transitions ---
  if (!p.grounded) {
    p.state = 'jump'
  } else if (p.state === 'slide') {
    p.slideTimer -= dt
    // End when duration expires, or when momentum dies out.
    // Crouch hold only decides the exit pose — not whether the slide continues.
    const done =
      p.slideTimer <= 0 || horizSpeed(p) < MOVE.walkSpeed * 0.95
    if (done) {
      p.slideTimer = 0
      p.slideCd = MOVE.slideCooldown
      p.state = stateAfterSlide(input, wishLen)
    }
  } else if (canStartSlide(p, input)) {
    p.state = 'slide'
    p.slideTimer = MOVE.slideDuration
    p.slideSpeed = horizSpeed(p)
    // impulse along wish or camera facing (same basis as movement)
    const dir = wishLen ? wish : facingXZ(p.yaw)
    p.velocity.x += dir.x * MOVE.slideImpulse
    p.velocity.z += dir.z * MOVE.slideImpulse
    // clamp max
    const sp = horizSpeed(p)
    if (sp > MOVE.slideMaxSpeed) {
      const s = MOVE.slideMaxSpeed / sp
      p.velocity.x *= s
      p.velocity.z *= s
    }
  } else if (input.crouch) {
    p.state = 'crouch'
  } else if (wishLen) {
    p.state = input.sprint && !input.ads ? 'run' : 'walk'
  } else {
    p.state = 'idle'
  }

  // --- max speed ---
  let maxSp =
    p.state === 'slide'
      ? MOVE.slideMaxSpeed
      : p.state === 'crouch'
        ? MOVE.crouchSpeed
        : p.state === 'run'
          ? MOVE.runSpeed
          : MOVE.walkSpeed
  maxSp *= adsMul

  // --- accelerate ---
  if (p.state === 'slide') {
    // weak steer while sliding
    if (wishLen) {
      accelerate(p.velocity, wish, maxSp * 0.85, MOVE.groundAccel * 0.35, dt)
    }
    applyFriction(p.velocity, MOVE.slideFriction, dt, MOVE.stopSpeed)
  } else if (p.grounded) {
    if (wishLen) {
      accelerate(p.velocity, wish, maxSp, MOVE.groundAccel, dt)
    } else {
      applyFriction(p.velocity, MOVE.groundFriction, dt, MOVE.stopSpeed)
    }
    // extra friction when over max (e.g. leaving slide)
    const sp = horizSpeed(p)
    if (sp > maxSp + 0.1) {
      applyFriction(p.velocity, MOVE.groundFriction * 0.5, dt, MOVE.stopSpeed)
    }
  } else {
    // air
    if (wishLen) {
      accelerate(p.velocity, wish, maxSp, MOVE.airAccel, dt)
    }
    applyFriction(p.velocity, MOVE.airFriction, dt, 0)
  }

  // --- jump ---
  if (input.jump && p.grounded && p.state !== 'crouch') {
    const retain = p.state === 'slide' ? MOVE.slideJumpRetain : 1
    p.velocity.x *= retain
    p.velocity.z *= retain
    p.velocity.y = MOVE.jumpSpeed
    p.grounded = false
    p.state = 'jump'
    if (p.slideTimer > 0) {
      p.slideTimer = 0
      p.slideCd = MOVE.slideCooldown * 0.5
    }
  }

  // gravity
  p.velocity.y += MOVE.gravity * dt

  // collide + integrate
  // Barriers always use min-penetration resolve (never merged into center-shove AABBs).
  const extras = extraColliders?.length ? extraColliders : null
  if (meshWorld && meshWorld.meshes.length > 0) {
    // Real map geometry (floors, walls, ramps)
    resolveMeshCollisions(p, meshWorld, dt)
  } else {
    // Procedural range: infinite floor + cover AABBs
    resolveCollisions(p, worldColliders, dt)
  }
  if (extras) resolveExtraAabbColliders(p, extras)

  // height / eye lerp — stand up faster when recovering from slide/crouch
  const th = targetHeight(p.state)
  const te = targetEye(p.state)
  const standing =
    p.state === 'idle' || p.state === 'walk' || p.state === 'run' || p.state === 'jump'
  const recoveringStand =
    standing && (p.height < th - 0.06 || p.eyeHeight < te - 0.06)
  const lerpRate = recoveringStand ? MOVE.heightLerp * 1.9 : MOVE.heightLerp
  const k = 1 - Math.exp(-lerpRate * dt)
  p.height = lerp(p.height, th, k)
  p.eyeHeight = lerp(p.eyeHeight, te, k)
}

export function eyePosition(p: PlayerBody): Vec3 {
  return {
    x: p.position.x,
    y: p.position.y + p.eyeHeight,
    z: p.position.z,
  }
}

/**
 * Integrate velocity against world colliders only (no gravity / wish).
 * Used by the level editor fly mode so free-look still rests on floors.
 */
export function resolvePlayerWorldCollisions(
  p: PlayerBody,
  worldColliders: AABB[],
  meshWorld?: MeshWorld | null,
  dt = 1 / 60,
  extraColliders?: AABB[] | null,
) {
  const extras = extraColliders?.length ? extraColliders : null
  if (meshWorld && meshWorld.meshes.length > 0) {
    resolveMeshCollisions(p, meshWorld, dt)
  } else {
    resolveCollisions(p, worldColliders, dt)
  }
  if (extras) resolveExtraAabbColliders(p, extras)
}

/**
 * Pose-driven damage volumes from live height / eye height.
 * Body is a vertical capsule (not a box) so crouch/slide shrink it cleanly.
 */
export function playerVolumes(p: PlayerBody): HitVolumes {
  const { x, y, z } = p.position
  const headRadii = {
    x: PLAYER.headRadius * PLAYER.headEgg.x,
    y: PLAYER.headRadius * PLAYER.headEgg.y,
    z: PLAYER.headRadius * PLAYER.headEgg.z,
  }
  const headCenter = {
    x,
    y: y + p.eyeHeight + PLAYER.headAboveEye,
    z,
  }
  const bodyBottom = y + PLAYER.bodyBottom
  const bodyTop = Math.max(
    bodyBottom + 0.2,
    headCenter.y - headRadii.y - PLAYER.bodyHeadClearance,
  )
  const radius = p.radius * PLAYER.bodyRadiusScale
  return {
    headCenter,
    headRadii,
    capsules: [
      {
        a: { x, y: bodyBottom, z },
        b: { x, y: bodyTop, z },
        radius,
      },
    ],
  }
}

/** Hitscan hitboxes for a player body (multiplayer / self-damage debug). */
export function playerHitboxes(p: PlayerBody, ownerId: string): Hitbox[] {
  return volumesToHitboxes(ownerId, playerVolumes(p))
}
