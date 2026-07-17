import { MOVE, PLAYER } from '../core/config'
import { clamp, facingXZ, lenXZ, lerp, wishDir } from '../core/math'
import type { AABB, Hitbox, HitVolumes, PlayerBody, PlayerInput, Vec3 } from '../core/types'

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

export function createPlayer(spawn = PLAYER.spawn): PlayerBody {
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
 * Axis-separated capsule (as vertical segment + radius) vs world AABBs.
 * Simplified: treat as cylinder-ish AABB with radius expansion.
 */
function resolveCollisions(p: PlayerBody, world: AABB[], dt: number) {
  const vel = p.velocity
  const pos = p.position
  const r = p.radius
  const h = p.height

  // integrate X
  pos.x += vel.x * dt
  for (const box of world) {
    if (overlapsCapsule(pos, r, h, box)) {
      // push out on X
      const cx = (box.min.x + box.max.x) * 0.5
      if (pos.x < cx) pos.x = box.min.x - r - 1e-4
      else pos.x = box.max.x + r + 1e-4
      vel.x = 0
    }
  }

  // integrate Z
  pos.z += vel.z * dt
  for (const box of world) {
    if (overlapsCapsule(pos, r, h, box)) {
      const cz = (box.min.z + box.max.z) * 0.5
      if (pos.z < cz) pos.z = box.min.z - r - 1e-4
      else pos.z = box.max.z + r + 1e-4
      vel.z = 0
    }
  }

  // integrate Y
  pos.y += vel.y * dt
  p.grounded = false

  // floor at y=0
  if (pos.y < 0) {
    pos.y = 0
    vel.y = 0
    p.grounded = true
  }

  for (const box of world) {
    if (!overlapsCapsule(pos, r, h, box)) continue
    // top of box (standing on)
    const feet = pos.y
    const head = pos.y + h
    if (vel.y <= 0 && feet <= box.max.y && head > box.max.y && pos.y + vel.y * dt <= box.max.y + 0.2) {
      // if mostly above
      if (pos.y + 0.35 >= box.max.y) {
        pos.y = box.max.y
        vel.y = 0
        p.grounded = true
        continue
      }
    }
    // ceiling
    if (vel.y > 0 && head >= box.min.y && feet < box.min.y) {
      pos.y = box.min.y - h - 1e-4
      vel.y = 0
      continue
    }
    // side shove already handled on XZ; residual push Y out of deep embed
    if (feet < box.max.y && head > box.min.y) {
      const up = box.max.y - feet
      const down = head - box.min.y
      if (up < down && up < 0.5) {
        pos.y = box.max.y
        vel.y = 0
        p.grounded = true
      }
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
    const done =
      p.slideTimer <= 0 ||
      (!input.crouch && horizSpeed(p) < MOVE.walkSpeed * 1.1)
    if (done) {
      p.state = input.crouch ? 'crouch' : wishLen ? (input.sprint ? 'run' : 'walk') : 'idle'
      p.slideCd = MOVE.slideCooldown
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
  resolveCollisions(p, worldColliders, dt)

  // height / eye lerp
  const th = targetHeight(p.state)
  const te = targetEye(p.state)
  const k = 1 - Math.exp(-MOVE.heightLerp * dt)
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
