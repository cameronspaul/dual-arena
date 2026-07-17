import { DUMMY, MOVE, WORLD } from '../core/config'
import { aabbFromCenter, clamp, lenXZ, normalizeXZ } from '../core/math'
import type { AABB, DummyMoveState, DummyTarget, Vec3 } from '../core/types'
import type { MapDummyDef } from '../maps/catalog'

export function buildWorldColliders(): AABB[] {
  return WORLD.coverBoxes.map((b) =>
    aabbFromCenter(b.x, b.y, b.z, b.w / 2, b.h / 2, b.d / 2),
  )
}

function randRange(lo: number, hi: number) {
  return lo + Math.random() * (hi - lo)
}

function pickWanderPoint(home: Vec3, bounds: number = DUMMY.bounds): Vec3 {
  const ang = Math.random() * Math.PI * 2
  // Stay near home so mesh-map dummies don't wander off walkable pads
  const maxR = Math.min(DUMMY.wanderRadius, Math.max(2.5, bounds * 0.35))
  const r = Math.sqrt(Math.random()) * maxR
  const b = bounds
  return {
    x: clamp(home.x + Math.cos(ang) * r, -b, b),
    y: home.y,
    z: clamp(home.z + Math.sin(ang) * r, -b, b),
  }
}

function stateDuration(state: DummyMoveState): number {
  const [lo, hi] = DUMMY.stateDuration[state]
  return randRange(lo, hi)
}

function nextState(d: DummyTarget): DummyMoveState {
  const cycle = DUMMY.stateCycle
  const idx = d.cycleIdx % cycle.length
  const state = cycle[idx] as DummyMoveState
  d.cycleIdx = idx + 1
  return state
}

function speedForState(state: DummyMoveState): number {
  switch (state) {
    case 'run':
      return MOVE.runSpeed
    case 'crouch':
      return MOVE.crouchSpeed
    case 'slide':
      return MOVE.slideMaxSpeed * 0.85
    case 'walk':
      return MOVE.walkSpeed
    default:
      return 0
  }
}

export type CreateDummiesOpts = {
  defs?: MapDummyDef[]
  /** Half-extent for wander clamp (defaults to DUMMY.bounds) */
  bounds?: number
}

export function createDummies(opts: CreateDummiesOpts = {}): DummyTarget[] {
  const defs = opts.defs ?? WORLD.dummies
  const bounds = opts.bounds ?? DUMMY.bounds
  return defs.map((d, i) => {
    const y = 'y' in d && typeof d.y === 'number' ? d.y : 0
    const home = { x: d.x, y, z: d.z }
    const dummy: DummyTarget = {
      id: d.id,
      position: { x: d.x, y, z: d.z },
      velocity: { x: 0, y: 0, z: 0 },
      hp: DUMMY.maxHp,
      maxHp: DUMMY.maxHp,
      alive: true,
      yaw: d.yaw,
      state: 'idle',
      home,
      stateTimer: stateDuration('idle') + i * 0.35,
      slideTimer: 0,
      target: pickWanderPoint(home, bounds),
      // Stagger cycle so they aren't all in the same anim
      cycleIdx: i % DUMMY.stateCycle.length,
      wanderBounds: bounds,
    }
    return dummy
  })
}

export interface RespawnTimer {
  id: string
  remaining: number
}

export function damageDummy(
  dummies: DummyTarget[],
  id: string,
  damage: number,
): { killed: boolean; hp: number } {
  const d = dummies.find((x) => x.id === id)
  if (!d || !d.alive) return { killed: false, hp: 0 }
  d.hp = Math.max(0, d.hp - damage)
  if (d.hp <= 0) {
    d.alive = false
    d.velocity.x = 0
    d.velocity.z = 0
    return { killed: true, hp: 0 }
  }
  return { killed: false, hp: d.hp }
}

export function stepRespawns(
  dummies: DummyTarget[],
  timers: RespawnTimer[],
  dt: number,
): void {
  for (const t of timers) {
    t.remaining -= dt
  }
  for (let i = timers.length - 1; i >= 0; i--) {
    if (timers[i].remaining > 0) continue
    const d = dummies.find((x) => x.id === timers[i].id)
    if (d) {
      d.alive = true
      d.hp = d.maxHp
      d.position.x = d.home.x
      d.position.y = d.home.y
      d.position.z = d.home.z
      d.velocity.x = 0
      d.velocity.z = 0
      d.state = 'idle'
      d.stateTimer = stateDuration('idle')
      d.slideTimer = 0
      d.target = pickWanderPoint(d.home, d.wanderBounds)
    }
    timers.splice(i, 1)
  }
}

export function queueRespawn(timers: RespawnTimer[], id: string) {
  if (timers.some((t) => t.id === id)) return
  timers.push({ id, remaining: DUMMY.respawnTime })
}

/**
 * Patrol / demo locomotion so walk, run, crouch, and slide clips can be
 * reviewed in motion. Skips dead dummies; disabled via DUMMY.moveEnabled.
 */
export function stepDummies(dummies: DummyTarget[], dt: number): void {
  if (!DUMMY.moveEnabled) return

  for (const d of dummies) {
    if (!d.alive) continue

    d.stateTimer -= dt

    if (d.state === 'slide') {
      d.slideTimer -= dt
      if (d.slideTimer <= 0 || d.stateTimer <= 0) {
        enterState(d, 'run')
      }
    } else if (d.stateTimer <= 0) {
      enterState(d, nextState(d))
    }

    const bounds = d.wanderBounds ?? DUMMY.bounds

    // New wander point when close
    const dx = d.target.x - d.position.x
    const dz = d.target.z - d.position.z
    if (Math.hypot(dx, dz) < DUMMY.arriveDist) {
      d.target = pickWanderPoint(d.home, bounds)
    }

    const sp = speedForState(d.state)
    if (sp <= 0.01) {
      d.velocity.x = 0
      d.velocity.z = 0
    } else {
      const to = normalizeXZ({
        x: d.target.x - d.position.x,
        y: 0,
        z: d.target.z - d.position.z,
      })
      // Slide keeps forward momentum; weak steer toward target
      if (d.state === 'slide') {
        const cur = normalizeXZ(d.velocity)
        const face =
          lenXZ(cur) > 0.05
            ? {
                x: cur.x * 0.85 + to.x * 0.15,
                y: 0,
                z: cur.z * 0.85 + to.z * 0.15,
              }
            : to
        const f = normalizeXZ(face)
        d.velocity.x = f.x * sp
        d.velocity.z = f.z * sp
      } else {
        d.velocity.x = to.x * sp
        d.velocity.z = to.z * sp
      }
    }

    d.position.x += d.velocity.x * dt
    d.position.z += d.velocity.z * dt
    // Keep feet on the home floor height (mesh maps)
    d.position.y = d.home.y

    // Soft bounds around map + pull back toward home if too far
    const b = bounds
    if (d.position.x < -b || d.position.x > b) {
      d.position.x = clamp(d.position.x, -b, b)
      d.velocity.x *= -1
      d.target = pickWanderPoint(d.home, bounds)
    }
    if (d.position.z < -b || d.position.z > b) {
      d.position.z = clamp(d.position.z, -b, b)
      d.velocity.z *= -1
      d.target = pickWanderPoint(d.home, bounds)
    }
    const fromHome = Math.hypot(
      d.position.x - d.home.x,
      d.position.z - d.home.z,
    )
    if (fromHome > Math.min(DUMMY.wanderRadius * 1.15, bounds * 0.5)) {
      d.target = pickWanderPoint(d.home, bounds)
    }

    // Face velocity — man.glb faces +Z at yaw 0 (not player -Z convention)
    const hsp = lenXZ(d.velocity)
    if (hsp > 0.15) {
      const want = Math.atan2(d.velocity.x, d.velocity.z)
      let diff = want - d.yaw
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      const maxStep = DUMMY.turnSpeed * dt
      d.yaw += clamp(diff, -maxStep, maxStep)
    }
  }
}

function enterState(d: DummyTarget, state: DummyMoveState) {
  d.state = state
  d.stateTimer = stateDuration(state)
  if (state === 'slide') {
    d.slideTimer = MOVE.slideDuration
    d.stateTimer = MOVE.slideDuration
    // Burst in current facing / toward target
    const to = normalizeXZ({
      x: d.target.x - d.position.x,
      y: 0,
      z: d.target.z - d.position.z,
    })
    // man.glb rest faces +Z; root.rotation.y = yaw maps local +Z → world
    const face =
      lenXZ(to) > 0.01
        ? to
        : { x: Math.sin(d.yaw), y: 0, z: Math.cos(d.yaw) }
    const sp = MOVE.slideMaxSpeed * 0.9
    d.velocity.x = face.x * sp
    d.velocity.z = face.z * sp
  } else if (state === 'idle') {
    d.velocity.x = 0
    d.velocity.z = 0
  } else {
    d.target = pickWanderPoint(d.home, d.wanderBounds)
  }
}

export function dummyBodyCenter(d: DummyTarget): Vec3 {
  return {
    x: d.position.x,
    y: d.position.y + DUMMY.bodyOffsetY,
    z: d.position.z,
  }
}
