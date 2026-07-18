import {
  DUMMY,
  MOVE,
  RANGE,
  WORLD,
  rangeColX,
  rangeRowZ,
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

/**
 * Current distance-band index for the practice-range squad (0 = closest).
 * Kept as `DummyActiveRows` name for RangeControls display field.
 */
export type DummyActiveRows = number

/** Runtime practice-range AI mode (control wall). */
let behaviorMode: DummyBehaviorMode = DUMMY.defaultMode
/** Which distance band the squad stands on (0 = closest). */
let activeRowIndex: DummyActiveRows = DUMMY.defaultRowIndex

export function getDummyBehaviorMode(): DummyBehaviorMode {
  return behaviorMode
}

/**
 * Switch AI mode. When `dummies` is provided, every live dummy is snapped
 * into that mode immediately (no leftover idle timers from STILL / RESET).
 */
export function setDummyBehaviorMode(
  mode: DummyBehaviorMode,
  dummies?: DummyTarget[],
) {
  behaviorMode = mode
  if (dummies) snapDummiesToMode(dummies, mode)
}

/**
 * Apply mode instantly so MOVE / STRAFE read as immediate, not after a
 * multi-second idle timer from the previous state.
 */
export function snapDummiesToMode(
  dummies: DummyTarget[],
  mode: DummyBehaviorMode,
): void {
  for (const d of dummies) {
    if (!d.alive || d.active === false) continue

    if (mode === 'stationary') {
      d.position.x = d.home.x
      d.position.y = d.home.y
      d.position.z = d.home.z
      d.velocity.x = 0
      d.velocity.z = 0
      d.state = 'idle'
      d.stateTimer = 99
      d.slideTimer = 0
      d.yaw = 0
      d.target = { x: d.home.x, y: d.home.y, z: d.home.z }
      continue
    }

    if (mode === 'strafing') {
      const halfX = rowInnerHalf()
      const left = d.home.x - halfX
      const right = d.home.x + halfX
      // Stagger start time + direction so the squad isn't lockstep
      const col = d.lane ?? 0
      const startDelay = col * 0.55 + Math.random() * 0.4
      // Alternate preferred first edge by column, with a bit of randomness
      const preferRight =
        col % 2 === 0 ? Math.random() > 0.35 : Math.random() > 0.65
      d.target.x = preferRight ? right : left
      d.target.y = d.home.y
      d.target.z = d.home.z
      d.slideTimer = 0
      d.velocity.x = 0
      d.velocity.z = 0
      if (startDelay < 0.08) {
        d.state = 'walk'
        d.stateTimer = 2.8 + Math.random() * 2.2
        const dir = d.target.x >= d.position.x ? 1 : -1
        d.velocity.x = dir * RANGE.strafeSpeed
      } else {
        // Idle briefly, then stepDummies will kick into walk
        d.state = 'idle'
        d.stateTimer = startDelay
      }
      continue
    }

    // moving — start walking to a new point immediately (never linger in idle)
    d.state = 'walk'
    d.stateTimer = stateDuration('walk')
    d.slideTimer = 0
    d.target = pickWanderPoint(d, d.wanderBounds)
    // Guarantee the target is far enough that we don't re-pick next frame
    const dist = Math.hypot(d.target.x - d.position.x, d.target.z - d.position.z)
    if (dist < DUMMY.arriveDist * 2) {
      const halfX = rowInnerHalf()
      d.target.x = d.home.x + (Math.random() > 0.5 ? halfX : -halfX)
      d.target.z = d.home.z + (Math.random() * 2 - 1) * RANGE.rowWanderZ
    }
    const to = normalizeXZ({
      x: d.target.x - d.position.x,
      y: 0,
      z: d.target.z - d.position.z,
    })
    const sp = MOVE.walkSpeed
    d.velocity.x = to.x * sp
    d.velocity.z = to.z * sp
  }
}

export function getDummyActiveRows(): DummyActiveRows {
  return activeRowIndex
}

export function getDummyActiveRowIndex(): number {
  return activeRowIndex
}

/** Distance in meters for the squad's current band (for UI). */
export function getDummyActiveRowDist(): number {
  return (
    RANGE.rowDist[activeRowIndex] ??
    RANGE.rowDist[RANGE.rowDist.length - 1]
  )
}

export function setDummyActiveRows(rowIndex: DummyActiveRows) {
  activeRowIndex = clampRowIndex(rowIndex)
}

function clampRowIndex(i: number): number {
  const max = Math.max(0, RANGE.rowDist.length - 1)
  return Math.max(0, Math.min(max, Math.floor(i)))
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

/** Parse col/row from practice-range ids (`d-c0`, `d-c0-r2`, or legacy `d-l0-r2`). */
function parseLaneRow(
  id: string,
  def?: MapDummyDef & { lane?: number; row?: number },
): { lane?: number; row?: number } {
  if (def && (typeof def.lane === 'number' || typeof def.row === 'number')) {
    return { lane: def.lane, row: def.row ?? activeRowIndex }
  }
  const simple = /^d-c(\d+)$/.exec(id)
  if (simple) return { lane: Number(simple[1]), row: activeRowIndex }
  const m =
    /^d-c(\d+)-r(\d+)$/.exec(id) ?? /^d-l(\d+)-r(\d+)$/.exec(id)
  if (m) return { lane: Number(m[1]), row: Number(m[2]) }
  const home = buildRangeDummyHomes(activeRowIndex).find((h) => h.id === id)
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
    activeRowIndex = DUMMY.defaultRowIndex
  } else {
    // Arena / free maps: classic locomotion demo
    behaviorMode = 'moving'
    activeRowIndex = 0
  }

  return defs.map((d, i) => {
    const y = 'y' in d && typeof d.y === 'number' ? d.y : 0
    const home = { x: d.x, y, z: d.z }
    const { lane, row } = parseLaneRow(d.id, d as MapDummyDef & {
      lane?: number
      row?: number
    })
    const rowIdx = row ?? activeRowIndex
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
      target: { x: d.x, y, z: d.z },
      cycleIdx: i % DUMMY.stateCycle.length,
      wanderBounds: bounds,
      lane,
      row: rowIdx,
      active: true,
    }
    dummy.target = pickWanderPoint(dummy, bounds)
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
      d.slideTimer = 0
      // Resume whatever the control wall is set to (still / move / strafe)
      // instead of always coming back idle.
      snapDummiesToMode([d], behaviorMode)
    }
    timers.splice(i, 1)
  }
}

export function queueRespawn(timers: RespawnTimer[], id: string) {
  if (timers.some((t) => t.id === id)) return
  timers.push({ id, remaining: DUMMY.respawnTime })
}

/**
 * Snap every active dummy home, full HP, clear respawn timers, force idle.
 * Also switches AI to stationary so they stay idle (MOVE/STRAFE would
 * otherwise pick a new loco state next frame).
 * Inactive (parked) dummies stay parked.
 */
export function resetRangeDummies(
  dummies: DummyTarget[],
  timers: RespawnTimer[],
): void {
  timers.length = 0
  behaviorMode = 'stationary'
  for (const d of dummies) {
    if (d.active === false) {
      d.alive = false
      d.velocity.x = 0
      d.velocity.z = 0
      d.state = 'idle'
      d.slideTimer = 0
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
    d.cycleIdx = 0
    d.target = { x: d.home.x, y: d.home.y, z: d.home.z }
  }
}

/**
 * Move the existing dummy squad to the next distance band (wraps).
 * Does not spawn extra dummies — same left/middle/right set relocates.
 * Heals, clears respawns, updates homes, then re-applies current AI mode.
 */
export function advanceDummyDistanceRow(
  dummies: DummyTarget[],
  timers: RespawnTimer[],
): DummyActiveRows {
  const max = Math.max(1, RANGE.rowDist.length)
  activeRowIndex = (activeRowIndex + 1) % max
  relocateSquadToRow(dummies, timers, activeRowIndex)
  return activeRowIndex
}

/**
 * Place the squad on a specific distance band index.
 * @deprecated Prefer advanceDummyDistanceRow for the ROWS button.
 */
export function applyDummyRowCount(
  dummies: DummyTarget[],
  timers: RespawnTimer[],
  rowIndex: DummyActiveRows,
): void {
  activeRowIndex = clampRowIndex(rowIndex)
  relocateSquadToRow(dummies, timers, activeRowIndex)
}

function relocateSquadToRow(
  dummies: DummyTarget[],
  timers: RespawnTimer[],
  rowIndex: number,
): void {
  timers.length = 0
  const z = rangeRowZ(rowIndex)
  for (const d of dummies) {
    const col = d.lane ?? 0
    const x = rangeColX(col)
    d.row = rowIndex
    d.home = { x, y: d.home.y, z }
    d.position.x = x
    d.position.y = d.home.y
    d.position.z = z
    d.velocity.x = 0
    d.velocity.z = 0
    d.alive = true
    d.active = true
    d.hp = d.maxHp
    d.yaw = 0
    d.slideTimer = 0
    d.target = { x, y: d.home.y, z }
  }
  // Resume current mode immediately at the new band (walk/strafe/still)
  snapDummiesToMode(dummies, behaviorMode)
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
      const halfX = rowInnerHalf()
      const left = d.home.x - halfX
      const right = d.home.x + halfX

      // Staggered start: hold idle until stateTimer elapses
      if (d.state === 'idle') {
        d.stateTimer -= dt
        d.velocity.x = 0
        d.velocity.z = 0
        d.position.y = d.home.y
        d.position.z = d.home.z
        if (d.stateTimer > 0) {
          // Face fire line while waiting
          let diff = 0 - d.yaw
          while (diff > Math.PI) diff -= Math.PI * 2
          while (diff < -Math.PI) diff += Math.PI * 2
          d.yaw += clamp(diff, -DUMMY.turnSpeed * dt, DUMMY.turnSpeed * dt)
          continue
        }
        // Begin strafe toward pre-picked edge
        d.state = 'walk'
        d.stateTimer = 2.5 + Math.random() * 2.5
        if (
          Math.abs(d.target.z - d.home.z) > 0.5 ||
          (d.target.x > left - 0.1 && d.target.x < right + 0.1) === false
        ) {
          d.target.x = Math.random() > 0.5 ? right : left
          d.target.z = d.home.z
        }
      }

      // Retarget when near goal, timer elapsed, or target not on this row
      const nearGoal = Math.abs(d.target.x - d.position.x) < DUMMY.arriveDist
      const badTarget =
        Math.abs(d.target.z - d.home.z) > RANGE.rowWanderZ * 2 ||
        d.target.x < left - 0.5 ||
        d.target.x > right + 0.5
      if (nearGoal || d.stateTimer <= 0 || badTarget) {
        const goingRight = d.velocity.x > 0.05
        const goingLeft = d.velocity.x < -0.05
        if (goingRight) d.target.x = left
        else if (goingLeft) d.target.x = right
        else d.target.x = d.position.x <= d.home.x ? right : left
        d.target.z = d.home.z
        // Varied leg length so turnarounds don't sync
        d.stateTimer = 2.4 + Math.random() * 2.8
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
      d.yaw += clamp(
        diff,
        -DUMMY.turnSpeed * dt * 1.5,
        DUMMY.turnSpeed * dt * 1.5,
      )
      continue
    }

    // ── Moving: wander (row-clamped on practice range) ───────────────────
    // Practice range: never sit in long idle — MOVE should look busy.
    // Skip pure idle; if the demo cycle lands on idle, hop to walk.
    if (d.state === 'idle') {
      enterState(d, 'walk')
    }

    d.stateTimer -= dt

    if (d.state === 'slide') {
      d.slideTimer -= dt
      if (d.slideTimer <= 0 || d.stateTimer <= 0) {
        enterState(d, 'run')
      }
    } else if (d.stateTimer <= 0) {
      let next = nextState(d)
      // Avoid multi-second idle pauses while in MOVE mode
      if (next === 'idle') next = 'walk'
      enterState(d, next)
    }

    const bounds = d.wanderBounds ?? DUMMY.bounds

    const dx = d.target.x - d.position.x
    const dz = d.target.z - d.position.z
    if (Math.hypot(dx, dz) < DUMMY.arriveDist) {
      d.target = pickWanderPoint(d, bounds)
    }

    const sp = speedForState(d.state)
    if (sp <= 0.01) {
      // Idle should not stick while MOVE is selected
      if (d.state === 'idle') {
        enterState(d, 'walk')
      } else {
        d.velocity.x = 0
        d.velocity.z = 0
      }
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
