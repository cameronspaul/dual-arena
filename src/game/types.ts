/** Shared pure types — no Three.js deps (server-portable later). */

export type MoveState = 'idle' | 'walk' | 'run' | 'crouch' | 'slide' | 'jump'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface PlayerInput {
  /** -1..1 forward (W/S) */
  forward: number
  /** -1..1 right (D/A) */
  right: number
  jump: boolean
  crouch: boolean
  sprint: boolean
  yaw: number
  pitch: number
  ads: boolean
  fire: boolean
  reload: boolean
}

export interface PlayerBody {
  position: Vec3
  velocity: Vec3
  yaw: number
  pitch: number
  state: MoveState
  grounded: boolean
  height: number
  eyeHeight: number
  radius: number
  slideTimer: number
  slideCd: number
  /** Horizontal speed at slide start, used for animation feel */
  slideSpeed: number
}

/** Damage region on a character mesh. Chest = torso only; arms / legs are separate. */
export type HitZone = 'head' | 'chest' | 'arm' | 'leg'

export interface AABB {
  min: Vec3
  max: Vec3
}

/** Capsule = segment a→b with constant radius (torso, limbs). */
export interface HitCapsule {
  a: Vec3
  b: Vec3
  radius: number
}

export interface Hitbox {
  id: string
  zone: HitZone
  /** Sphere hitbox (shoulder blobs) */
  sphere?: { center: Vec3; radius: number }
  /** Axis-aligned ellipsoid (egg head) */
  ellipsoid?: { center: Vec3; radii: Vec3 }
  /** AABB hitbox (legacy body / world cover) */
  aabb?: AABB
  /** Capsule hitbox (pose-driven body) */
  capsule?: HitCapsule
  /** Link to dummy/player owner */
  ownerId: string
}

/** Live damage volumes — updated each frame from pose / bones. */
export interface HitVolumes {
  headCenter: Vec3
  /** Egg head: half-extents (X width, Y height, Z depth) */
  headRadii: Vec3
  /** Body / limb capsules along the skeleton */
  capsules: HitCapsule[]
  /** Extra body spheres (shoulders, etc.) */
  bodySpheres?: { center: Vec3; radius: number }[]
}

/** Locomotion demo states for range dummies (mirrors player MoveState, no jump). */
export type DummyMoveState = 'idle' | 'walk' | 'run' | 'crouch' | 'slide'

export interface DummyTarget {
  id: string
  position: Vec3
  /** Horizontal velocity (y unused; kept for parity) */
  velocity: Vec3
  hp: number
  maxHp: number
  alive: boolean
  /** World yaw facing */
  yaw: number
  /** Current locomotion for anim + AI */
  state: DummyMoveState
  /** Spawn / wander center */
  home: Vec3
  /** Seconds left in current AI state before next pick */
  stateTimer: number
  /** Active slide/roll duration remaining */
  slideTimer: number
  /** Wander destination on XZ plane (y ignored) */
  target: Vec3
  /** Index into DUMMY.stateCycle for demo sequencing */
  cycleIdx: number
}

export type SniperPhase = 'ready' | 'firing' | 'bolt' | 'reloading'

export interface SniperState {
  ammo: number
  magSize: number
  reserve: number
  phase: SniperPhase
  phaseTimer: number
  ads: boolean
  adsBlend: number
  /** 0..1 recoil kick that decays */
  recoil: number
  /** Extra cone bloom after firing (radians), decays quickly */
  fireBloom: number
}

export interface HitEvent {
  targetId: string
  zone: HitZone
  damage: number
  killed: boolean
  point: Vec3
}

export interface RayHit {
  point: Vec3
  distance: number
  normal: Vec3
  hitbox?: Hitbox
  world?: boolean
}

export interface HudSnapshot {
  hp: number
  ammo: number
  magSize: number
  reserve: number
  phase: SniperPhase
  ads: boolean
  adsBlend: number
  /** Current aim cone half-angle (radians) — drives dynamic crosshair */
  aimSpread: number
  moveState: MoveState
  speed: number
  pointerLocked: boolean
  kills: number
  lastHit: HitEvent | null
  lastHitAge: number
}
