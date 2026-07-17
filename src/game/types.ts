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

export type HitZone = 'head' | 'body'

export interface AABB {
  min: Vec3
  max: Vec3
}

export interface Hitbox {
  id: string
  zone: HitZone
  /** Sphere hitbox (head) */
  sphere?: { center: Vec3; radius: number }
  /** AABB hitbox (body / world) */
  aabb?: AABB
  /** Link to dummy/player owner */
  ownerId: string
}

export interface DummyTarget {
  id: string
  position: Vec3
  hp: number
  maxHp: number
  alive: boolean
  /** World yaw facing */
  yaw: number
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
  swayTime: number
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
  moveState: MoveState
  speed: number
  pointerLocked: boolean
  kills: number
  lastHit: HitEvent | null
  lastHitAge: number
}
