/** All balance / feel tunables in one place. */

export const MOVE = {
  walkSpeed: 4.5,
  runSpeed: 7.4,
  crouchSpeed: 2.4,
  adsSpeedMul: 0.42,
  airControl: 0.38,
  jumpSpeed: 7.2,
  gravity: -24,
  groundAccel: 48,
  airAccel: 12,
  groundFriction: 14,
  airFriction: 0.6,
  stopSpeed: 1.2,

  slideSpeedMin: 5.2,
  slideImpulse: 3.2,
  slideMaxSpeed: 11.5,
  slideDuration: 0.55,
  slideFriction: 3.8,
  slideCooldown: 0.32,
  slideJumpRetain: 0.92,

  radius: 0.35,
  standingHeight: 1.72,
  crouchHeight: 1.05,
  eyeStanding: 1.58,
  eyeCrouch: 0.92,
  eyeSlide: 0.68,

  heightLerp: 14,
  maxPitch: Math.PI / 2 - 0.05,
} as const

export const LOOK = {
  hipSensitivity: 0.0022,
  adsSensitivity: 0.0009,
  adsFov: 28,
  hipFov: 75,
  adsBlendSpeed: 10,
} as const

export const SNIPER = {
  magSize: 5,
  reserve: 30,
  /** One-tap */
  headDamage: 100,
  /** Torso / chest */
  chestDamage: 50,
  /** Arms + legs */
  limbDamage: 25,
  boltTime: 0.7,
  fireAnimTime: 0.08,
  reloadTime: 2.0,
  maxRange: 400,
  hipSwayAmp: 0.012,
  adsSwayAmp: 0.0025,
  moveSwayMul: 2.2,
  airSwayMul: 3.5,
  slideSwayMul: 4,
  recoilKick: 0.045,
  recoilDecay: 8,
  viewmodelRecoil: 0.05,
} as const

/**
 * First-person sniper pose (camera-local space).
 * Live-tune with the in-game Viewmodel Editor (button on /play), then paste the
 * exported JSON back into this object (or hand the file to an agent).
 */
export const VIEWMODEL = {
  /** Target longest axis length after normalize (world units). */
  scale: 0.48,
  /**
   * Model-local basis correction applied before hip/ADS pose.
   * Quaternius sniper is already barrel→-Z / scope→+Y — leave at identity.
   * Only change if a different glTF needs a flip.
   */
  modelRot: { x: 0, y: 0, z: 0 },
  /** Post-center local offset on the gun (toward grip). */
  gunOffset: { x: 0, y: 0.0096, z: 0.0384 },
  /** Bottom-right hip hold; muzzle tips left toward screen center. */
  hipPos: { x: 0.22, y: -0.18, z: -0.42 },
  hipRot: { x: 0.06, y: 0.22, z: 0.04 },
  adsPos: { x: 0.0, y: -0.14, z: -0.28 },
  adsRot: { x: 0.0, y: 0.0, z: 0.0 },
  /** Hide mesh when ADS blend exceeds this (scope overlay takes over). */
  hideAds: 0.92,
  /**
   * FPS arms (public/models/arms.glb) — offsets relative to viewmodel root
   * (same space as the sniper after normalize).
   */
  arms: {
    /** Longest-axis target after normalize (world units). */
    scale: 0.72,
    pos: { x: 0.02, y: -0.12, z: 0.08 },
    rot: { x: 0, y: 0, z: 0 },
    /**
     * Per-arm bone additives (radians / local units), relative to rest pose.
     * Matches arms.glb: shoulder → bicep → forearm → wrist + fingers.
     */
    left: {
      shoulder: { rot: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 } },
      bicep: { rot: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 } },
      forearm: { rot: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 } },
      wrist: { rot: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 } },
      fingers: {
        thumb: { curl: 0, spread: 0 },
        index: { curl: 0, spread: 0 },
        middle: { curl: 0, spread: 0 },
        ring: { curl: 0, spread: 0 },
        pinky: { curl: 0, spread: 0 },
      },
    },
    right: {
      shoulder: { rot: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 } },
      bicep: { rot: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 } },
      forearm: { rot: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 } },
      wrist: { rot: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 } },
      fingers: {
        thumb: { curl: 0, spread: 0 },
        index: { curl: 0, spread: 0 },
        middle: { curl: 0, spread: 0 },
        ring: { curl: 0, spread: 0 },
        pinky: { curl: 0, spread: 0 },
      },
    },
  },
} as const

/** Walk cycle head + gun bob (visual only — hitscan stays on true eye). */
export const VIEW_BOB = {
  /** Cycle rate (rad/s) at walkSpeed */
  frequency: 9.5,
  freqSpeedRef: 4.5,
  /** Camera translation amplitude (world units) */
  camY: 0.028,
  camX: 0.014,
  /** Viewmodel local amplitude */
  gunY: 0.01,
  gunX: 0.007,
  gunZ: 0.004,
  gunPitch: 0.01,
  gunRoll: 0.014,
  /** Multipliers by state (ADS blends toward adsMul) */
  adsMul: 0.06,
  crouchMul: 0.4,
  slideMul: 0.12,
  airMul: 0.15,
  minSpeed: 0.35,
  fullSpeed: 7.4,
  amountLerp: 10,
  /** Landing dip */
  landKick: 0.05,
  landDecay: 9,
  landGunMul: 0.55,
} as const

export const PLAYER = {
  maxHp: 100,
  spawn: { x: 0, y: 0, z: 8 },
  /**
   * Damage hitboxes (pose-driven each frame from live height / eyeHeight).
   * Body is a vertical capsule — not a box.
   */
  headRadius: 0.15,
  /** Egg head scale vs headRadius: X width, Y height, Z depth */
  headEgg: { x: 0.88, y: 1.18, z: 0.95 },
  /** Head sphere center Y = feet + eyeHeight + this */
  headAboveEye: 0.05,
  /** Body capsule radius = movement radius * this */
  bodyRadiusScale: 0.88,
  /** Body capsule bottom above feet */
  bodyBottom: 0.08,
  /** Gap under head sphere so capsule doesn't fully swallow the head */
  bodyHeadClearance: 0.1,
} as const

export const WORLD = {
  floorSize: 48,
  /** Dummy placements on the range */
  dummies: [
    { id: 'd0', x: 0, z: -6, yaw: 0 },
    { id: 'd1', x: -4, z: -12, yaw: 0.2 },
    { id: 'd2', x: 5, z: -14, yaw: -0.15 },
    { id: 'd3', x: -2, z: -22, yaw: 0.1 },
    { id: 'd4', x: 3, z: -28, yaw: -0.05 },
  ],
  coverBoxes: [
    { x: -3, y: 0.6, z: -4, w: 1.2, h: 1.2, d: 1.2 },
    { x: 4, y: 0.5, z: -9, w: 2, h: 1, d: 1 },
    { x: -5, y: 0.75, z: -18, w: 1.5, h: 1.5, d: 1.5 },
    { x: 2, y: 0.4, z: -20, w: 3, h: 0.8, d: 0.8 },
    { x: 0, y: 1, z: -32, w: 4, h: 2, d: 0.6 },
  ],
} as const

export const DUMMY = {
  maxHp: 100,
  /** Placeholder mesh sizes (used only if man.glb fails) */
  bodyHalfW: 0.28,
  bodyHalfD: 0.16,
  bodyHeight: 0.55,
  headRadius: 0.12,
  headEgg: { x: 0.82, y: 1.28, z: 0.94 },
  headOffsetY: 1.44,
  bodyOffsetY: 1.0,
  respawnTime: 2.5,
} as const

/** Dev / tuning overlays */
export const DEBUG = {
  /**
   * Hitscan uses the real character meshes. When true, zone wireframes draw on
   * top of the skin: red head / cyan chest / orange arms / yellow legs.
   */
  showHitboxes: true,
} as const
