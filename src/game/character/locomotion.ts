/**
 * Shared locomotion animation helpers for man.glb (player + dummies).
 */
import * as THREE from 'three'

export type DummyActions = {
  idle: THREE.AnimationAction
  walk: THREE.AnimationAction | null
  /** Forward run (CharacterArmature|Run) */
  run: THREE.AnimationAction | null
  runBack: THREE.AnimationAction | null
  runLeft: THREE.AnimationAction | null
  runRight: THREE.AnimationAction | null
  slide: THREE.AnimationAction | null
  hit: THREE.AnimationAction | null
  hitAlt: THREE.AnimationAction | null
  death: THREE.AnimationAction | null
}

/** Local move octant relative to facing (for man.glb Run_* clips). */
export type LocoDir = 'forward' | 'back' | 'left' | 'right'

export function locoLoopActions(
  actions: DummyActions,
): (THREE.AnimationAction | null)[] {
  return [
    actions.idle,
    actions.walk,
    actions.run,
    actions.runBack,
    actions.runLeft,
    actions.runRight,
  ]
}

export function resolveLocoDir(
  forward: number,
  right: number,
  velX: number,
  velZ: number,
  yaw: number,
  skip: boolean,
): LocoDir {
  if (skip) return 'forward'
  let f = forward
  let r = right
  if (Math.abs(f) < 0.01 && Math.abs(r) < 0.01) {
    // No keys (air / friction): project velocity onto facing basis
    const sin = Math.sin(yaw)
    const cos = Math.cos(yaw)
    // facing (-sin, -cos), right (cos, -sin) — same as wishDir
    f = -velX * sin - velZ * cos
    r = velX * cos - velZ * sin
    if (Math.hypot(f, r) < 0.15) return 'forward'
  }
  if (Math.abs(f) >= Math.abs(r)) {
    return f >= 0 ? 'forward' : 'back'
  }
  return r >= 0 ? 'right' : 'left'
}

export function pickDirectionalRun(
  actions: DummyActions,
  dir: LocoDir,
): THREE.AnimationAction | null {
  switch (dir) {
    case 'back':
      return actions.runBack ?? actions.run
    case 'left':
      return actions.runLeft ?? actions.run
    case 'right':
      return actions.runRight ?? actions.run
    default:
      return actions.run
  }
}

/**
 * man.glb only has a single Walk clip — reverse it for backpedal; use
 * Run_Left / Run_Right at a reduced rate for strafe walk.
 */
export function pickWalkAction(
  actions: DummyActions,
  dir: LocoDir,
  baseScale: number,
): { action: THREE.AnimationAction | null; timeScale: number } {
  if (dir === 'left' && actions.runLeft) {
    return { action: actions.runLeft, timeScale: baseScale * 0.62 }
  }
  if (dir === 'right' && actions.runRight) {
    return { action: actions.runRight, timeScale: baseScale * 0.62 }
  }
  if (dir === 'back' && actions.runBack) {
    return { action: actions.runBack, timeScale: baseScale * 0.62 }
  }
  const walk = actions.walk ?? actions.idle
  if (dir === 'back' && walk && walk !== actions.idle) {
    return { action: walk, timeScale: -baseScale }
  }
  return { action: walk, timeScale: baseScale }
}

/** Match clip by exact name or trailing `|Name` (Quaternius-style). */
export function findClip(
  clips: THREE.AnimationClip[],
  ...names: string[]
): THREE.AnimationClip | undefined {
  for (const name of names) {
    const hit = clips.find(
      (c) => c.name === name || c.name.endsWith(`|${name}`),
    )
    if (hit) return hit
  }
  return undefined
}
