import {
  DUMMY,
  MOVE,
  RANGE,
  WORLD,
  type DummyBehaviorMode,
} from '../core/config'
import { aabbFromCenter, clamp, lenXZ, normalizeXZ } from '../core/math'
import type { AABB, DummyMoveState, DummyTarget, Vec3 } from '../core/types'
import type { MapDummyDef } from '../maps/catalog'
import { buildRangeDummyHomes } from '../core/config'

export function buildWorldColliders(): AABB[] {
  return WORLD.coverBoxes.map((b) =>
    aabbFromCenter(b.x, b.y, b.z, b.w / 2, b.h / 2, b.d / 2),
  )
}

/** How many nearest horizontal distance rows are live (1 … RANGE.rowDist.length). */
export type DummyActiveRows = number

/** Runtime practice-range AI mode (control wall). */
let behaviorMode: DummyBehaviorMode = DUMMY.defaultMode
/** How many nearest distance bands are live (1 = closest only). */
let activeRows: DummyActiveRows = DUMMY.defaultRows

export function getDummyBehaviorMode(): DummyBehaviorMode {
  return behaviorMode
}

export function setDummyBehaviorMode(mode: DummyBehaviorMode) {
  behaviorMode = mode
}

export function getDummyActiveRows(): DummyActiveRows {
  return activeRows
}

export function setDummyActiveRows(rows: DummyActiveRows) {
  activeRows = rows
}

function randRange(lo: number, hi: number) {
  return lo + Math.random() * (hi - lo)
}

/** Row half-width for wander / strafe along X when column is set. */
function rowInnerHalf(): number {
  return RANGE.rowInnerHalf
}

function pickWanderPoint(d: DummyTarget, bounds: number = DUMMY.bounds): Vec3 {
  const home = d.home
  if (d.lane != null || d.row != null) {
    // Stay on the horizontal row band around home
    const halfX = rowInnerHalf()
    const halfZ = RANGE.rowWanderZ
    return {
      x: clamp(
        home.x + (Math.random() * 2 - 1) * halfX,
        home.x - halfX,
        home.x + halfX,
      ),
      y: home.y,
      z: clamp(
        home.z + (Math.random() * 2 - 1) * halfZ,
        home.z - halfZ,
        home.z + halfZ,
      ),
    }
  }
  const ang = Math.random() * Math.PI * 2
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

/** Parse col/row from practice-range ids (`d-c0-r2` or legacy `d-l0-r2`). */
function parseLaneRow(
  id: string,
  def?: MapDummyDef & { lane?: number; row?: number },
): { lane?: number; row?: number } {
  if (def && (typeof def.lane === 'number' || typeof def.row === 'number')) {
    return { lane: def.lane, row: def.row }
  }
  const m =
    /^d-c(\d+)-r(\d+)$/.exec(id) ?? /^d-l(\d+)-r(\d+)$/.exec(id)
  if (m) return { lane: Number(m[1]), row: Number(m[2]) }
  const home = buildRangeDummyHomes().find((h) => h.id === id)
  if (home) return { lane: home.lane, row: home.row }
  return {}
}

export type CreateDummiesOpts = {
  defs?: MapDummyDef[]
  /** Half-extent for wander clamp (defaults to DUMMY.bounds) */
  bounds?: number
  /**
   * Practice-range control defaults. When true, start stationary with all rows
   * active. GLB arena maps omit this so dummies keep the classic wander demo.
   */
  practiceRange?: boolean
}

export function createDummies(opts: CreateDummiesOpts = {}): DummyTarget[] {
  const defs = opts.defs ?? WORLD.dummies
  const bounds = opts.bounds ?? DUMMY.bounds
  if (opts.practiceRange) {
    behaviorMode = DUMMY.defaultMode
    activeRows = DUMMY.defaultRows
  } else {
    // Arena / free maps: classic locomotion demo
    behaviorMode = 'moving'
    activeRows = 3
  }

  return defs.map((d, i) => {
    const y = 'y' in d && typeof d.y === 'number' ? d.y : 0
    const home = { x: d.x, y, z: d.z }
    const { lane, row } = parseLaneRow(d.id, d as MapDummyDef & {
      lane?: number
      row?: number
    })
    const rowIdx = row ?? 0
    // Row parking only applies on the practice range
    const isActive = opts.practiceRange ? rowIdx < activeRows : true
    const dummy: DummyTarget = {
      id: d.id,
      position: { x: d.x, y, z: d.z },
      velocity: { x: 0, y: 0, z: 0 },
      hp: DUMMY.maxHp,
      maxHp: DUMMY.maxHp,
      alive: isActive,
      yaw: d.yaw,
      state: 'idle',
      home,
      stateTimer: stateDuration('idle') + i * 0.35,
      slideTimer: 0,
      target: { x: d.x, y, z: d.z },
      cycleIdx: i % DUMMY.stateCycle.length,
      wanderBounds: bounds,
      lane,
      row: rowIdx,
      active: isActive,
    }
    if (isActive) {
      dummy.target = pickWanderPoint(dummy, bounds)
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
  if (!d || !d.alive || d.active === false) return { killed: false, hp: 0 }
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
    if (d && d.active !== false) {
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
      d.target = pickWanderPoint(d, d.wanderBounds)
    }
    timers.splice(i, 1)
  }
}

export function queueRespawn(timers: RespawnTimer[], id: string) {
  if (timers.some((t) => t.id === id)) return
  timers.push({ id, remaining: DUMMY.respawnTime })
}

/**
 * Snap every active dummy home, full HP, clear respawn timers.
 * Inactive (parked) dummies stay parked.
 */
export function resetRangeDummies(
  dummies: DummyTarget[],
  timers: RespawnTimer[],
): void {
  timers.length = 0
  for (const d of dummies) {
    if (d.active === false) {
      d.alive = false
      d.velocity.x = 0
      d.velocity.z = 0
      continue
    }
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
    d.yaw = 0
    d.target = pickWanderPoint(d, d.wanderBounds)
  }
}

/**
 * Show rows `[0 .. rows)` and park the rest. Clears respawn timers for
 * parked dummies and heals newly activated ones.
 */
export function applyDummyRowCount(
  dummies: DummyTarget[],
  timers: RespawnTimer[],
  rows: DummyActiveRows,
): void {
  activeRows = rows
  for (const d of dummies) {
    const row = d.row ?? 0
    const on = row < rows
    d.active = on
    if (!on) {
      d.alive = false
      d.velocity.x = 0
      d.velocity.z = 0
      // Drop pending respawns for parked targets
      for (let i = timers.length - 1; i >= 0; i--) {
        if (timers[i].id === d.id) timers.splice(i, 1)
      }
    } else if (!d.alive) {
      // Leave dead active dummies to their respawn timer if any; otherwise revive
      const pending = timers.some((t) => t.id === d.id)
      if (!pending) {
        d.alive = true
        d.hp = d.maxHp
        d.position.x = d.home.x
        d.position.y = d.home.y
        d.position.z = d.home.z
        d.state = 'idle'
        d.stateTimer = stateDuration('idle')
        d.target = pickWanderPoint(d, d.wanderBounds)
      }
    }
  }
}

function clampToRow(d: DummyTarget) {
  if (d.lane == null && d.row == null) return
  const halfX = rowInnerHalf()
  const halfZ = RANGE.rowWanderZ * 1.2
  d.position.x = clamp(d.position.x, d.home.x - halfX, d.home.x + halfX)
  d.position.z = clamp(d.position.z, d.home.z - halfZ, d.home.z + halfZ)
}

/**
 * Patrol / demo locomotion. Practice range honors DummyBehaviorMode:
 *  - stationary: idle at home
 *  - moving: wander within lane (or free wander on non-range maps)
 *  - strafing: walk left/right along home Z inside the lane
 */
export function stepDummies(dummies: DummyTarget[], dt: number): void {
  if (!DUMMY.moveEnabled) return

  const mode = behaviorMode

  for (const d of dummies) {
    if (!d.alive || d.active === false) continue

    // ── Stationary: freeze at home ───────────────────────────────────────
    if (mode === 'stationary') {
      d.position.x = d.home.x
      d.position.y = d.home.y
      d.position.z = d.home.z
      d.velocity.x = 0
      d.velocity.z = 0
      d.state = 'idle'
      // Face the firing line (+Z)
      const want = 0
      let diff = want - d.yaw
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      d.yaw += clamp(diff, -DUMMY.turnSpeed * dt, DUMMY.turnSpeed * dt)
      continue
    }

    // ── Strafing: side-to-side along the horizontal row ──────────────────
    if (mode === 'strafing') {
      d.state = 'walk'
      const halfX = rowInnerHalf()
      const left = d.home.x - halfX
      const right = d.home.x + halfX
      if (
        Math.abs(d.target.x - d.position.x) < DUMMY.arriveDist ||
        d.stateTimer <= 0
      ) {
        const atLeft = d.position.x <= d.home.x
        d.target.x = atLeft ? right : left
        d.target.z = d.home.z
        d.stateTimer = 4
      }
      d.stateTimer -= dt
      const sp = RANGE.strafeSpeed
      const dir = d.target.x >= d.position.x ? 1 : -1
      d.velocity.x = dir * sp
      d.velocity.z = 0
      d.position.x += d.velocity.x * dt
      d.position.z = d.home.z
      d.position.y = d.home.y
      clampToRow(d)
      const want = Math.atan2(d.velocity.x, 0.001)
      let diff = want - d.yaw
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      d.yaw += clamp(diff, -DUMMY.turnSpeed * dt, DUMMY.turnSpeed * dt)
      continue
    }

    // ── Moving: wander (row-clamped on practice range) ───────────────────
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

    const dx = d.target.x - d.position.x
    const dz = d.target.z - d.position.z
    if (Math.hypot(dx, dz) < DUMMY.arriveDist) {
      d.target = pickWanderPoint(d, bounds)
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
    d.position.y = d.home.y

    if (d.lane != null || d.row != null) {
      clampToRow(d)
    } else {
      const b = bounds
      if (d.position.x < -b || d.position.x > b) {
        d.position.x = clamp(d.position.x, -b, b)
        d.velocity.x *= -1
        d.target = pickWanderPoint(d, bounds)
      }
      if (d.position.z < -b || d.position.z > b) {
        d.position.z = clamp(d.position.z, -b, b)
        d.velocity.z *= -1
        d.target = pickWanderPoint(d, bounds)
      }
      const fromHome = Math.hypot(
        d.position.x - d.home.x,
        d.position.z - d.home.z,
      )
      if (fromHome > Math.min(DUMMY.wanderRadius * 1.15, bounds * 0.5)) {
        d.target = pickWanderPoint(d, bounds)
      }
    }

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
    const to = normalizeXZ({
      x: d.target.x - d.position.x,
      y: 0,
      z: d.target.z - d.position.z,
    })
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
    d.target = pickWanderPoint(d, d.wanderBounds)
  }
}

export function dummyBodyCenter(d: DummyTarget): Vec3 {
  return {
    x: d.position.x,
    y: d.position.y + DUMMY.bodyOffsetY,
    z: d.position.z,
  }
}
