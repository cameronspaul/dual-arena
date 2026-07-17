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
  /** Torso only */
  chestDamage: 50,
  /** Arms / hands */
  armDamage: 25,
  /** Legs / feet */
  legDamage: 25,
  /** Tuned near DJMaesen sniper_animated bolt segment (~1.6s raw). */
  boltTime: 1.2,
  fireAnimTime: 0.12,
  /** Tuned near DJMaesen reload segment (~1.8s raw). */
  reloadTime: 1.9,
  maxRange: 400,
  recoilKick: 0.045,
  recoilDecay: 8,
  viewmodelRecoil: 0.05,

  /**
   * COD-style accuracy cone (half-angle, radians).
   * Hipfire is intentionally loose on a sniper; ADS is near-laser.
   */
  hipSpread: 0.055,
  adsSpread: 0.0012,
  /** Multipliers stacked on top of the ADS-blended base. */
  standSpreadMul: 1,
  walkSpreadMul: 1.35,
  moveSpreadMul: 1.75,
  crouchSpreadMul: 0.72,
  airSpreadMul: 2.1,
  slideSpreadMul: 2.4,
  /** Extra cone while recoil kick is active. */
  recoilSpreadMul: 0.55,
  /** Brief bloom after each shot (radians added, decays with recoil). */
  fireBloom: 0.018,
} as const

/**
 * First-person sniper pose (camera-local space).
 * Live-tune with the in-game Viewmodel Editor (button on /play), then paste the
 * exported JSON back into this object (or hand the file to an agent).
 */
export const VIEWMODEL = {
  /**
   * Target longest axis after normalize (world units).
   * sniper_animated.glb includes arms + gun as one FPS viewmodel.
   * Tuned via viewmodel editor 2026-07-17.
   */
  scale: 1.82,
  /**
   * Model-local basis correction. Sketchfab/FBX often needs a yaw flip —
   * tweak in the viewmodel editor if the muzzle points the wrong way.
   */
  modelRot: { x: -0.03490658503988659, y: Math.PI, z: 0 },
  /** Post-center local offset (nudge in camera space after normalize). */
  gunOffset: { x: 0.175, y: -0.16, z: -0.185 },
  /** Bottom-right hip hold. */
  hipPos: { x: 0.05, y: -0.12, z: -0.28 },
  hipRot: { x: 0.02, y: 0.04, z: 0.02 },
  adsPos: { x: -0.14, y: -0.025, z: -0.14 },
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

/** Walk cycle gun bob (viewmodel only — camera stays on true eye). */
export const VIEW_BOB = {
  /**
   * Cycle rate (rad/s) at walk. Sprint does NOT fully scale this —
   * frequency is soft-capped so the rifle stays heavy instead of buzzing.
   */
  frequency: 8.2,
  freqSpeedRef: 4.5,
  /** Max phase-rate multiplier vs walk (sprint was ~1.64× without a cap) */
  freqSpeedCap: 1.12,
  /**
   * Amplitude scale as speed goes walk → run. Heavier = deeper dips,
   * not faster chatter.
   */
  sprintHeavyMul: 1.4,
  /** Viewmodel local amplitude (walk / hip) */
  gunY: 0.012,
  gunX: 0.0055,
  gunZ: 0.0035,
  gunPitch: 0.014,
  gunRoll: 0.01,
  /** Multipliers by state (ADS blends toward adsMul) */
  adsMul: 0.06,
  crouchMul: 0.4,
  slideMul: 0.12,
  airMul: 0.15,
  minSpeed: 0.35,
  fullSpeed: 7.4,
  /** Slightly slower ease so the gun settles with weight */
  amountLerp: 7.5,
  /**
   * Landing kick — viewmodel only (camera stays on true eye).
   * Values are camera-local units; keep near walk-bob scale so it settles
   * instead of a big jolt + crawl-up.
   */
  landKick: 0.012,
  /** Extra dip from fall speed (× |vy| on impact) */
  landImpactScale: 0.0025,
  landMax: 0.028,
  /** Exp decay rate — snappy return to rest */
  landDecay: 16,
  /** Pitch (rad) per unit of landOffset */
  landPitch: 0.55,
} as const

/**
 * Subtle continuous viewmodel sway (gun only — never the camera).
 * Amplitudes are intentionally tiny so the rifle feels alive, not floaty.
 */
export const GUN_SWAY = {
  /** Primary / secondary cycle rates (rad/s) */
  freqYaw: 1.35,
  freqPitch: 1.05,
  freqRoll: 0.85,
  /** Position (local units) */
  posX: 0.0016,
  posY: 0.0011,
  /** Rotation (radians) */
  yaw: 0.004,
  pitch: 0.0032,
  roll: 0.0025,
  /** ADS almost freezes sway */
  adsMul: 0.08,
  /** Slight extra while moving */
  moveMul: 1.35,
} as const

/**
 * Apex-style slide cant — viewmodel only (camera stays level).
 * Positive roll banks the rifle top-left in camera space (model-facing).
 */
export const SLIDE_GUN = {
  /** Full-slide roll / yaw / pitch (radians) */
  roll: 0.48,
  yaw: -0.1,
  pitch: 0.05,
  /** Local position shift at full cant */
  posX: 0.045,
  posY: -0.018,
  posZ: 0.02,
  /** Blend speed into / out of slide */
  lerp: 14,
  /** ADS damps the cant (still a hint while sliding scoped) */
  adsMul: 0.12,
  /** Extra degrees of FOV at full hip slide (fades with ADS via slide blend) */
  fovBoost: 6,
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
  /**
   * Locomotion demo: dummies cycle walk / run / crouch / slide so we can
   * judge man.glb clips in motion. man.glb has no crouch clip — crouch uses
   * Walk at lower speed + slight squash. Slide uses Roll (one-shot).
   */
  moveEnabled: true,
  /** Max distance from home while wandering */
  wanderRadius: 7,
  /** Keep dummies on the range floor (half floorSize with margin) */
  bounds: 20,
  /** Seconds spent in each state (min, max) before AI picks next */
  stateDuration: {
    idle: [1.2, 2.4],
    walk: [2.8, 4.5],
    run: [2.2, 3.6],
    crouch: [2.4, 3.8],
    slide: [0.55, 0.55],
  } as const,
  /** Ordered demo loop so every state shows up regularly */
  stateCycle: [
    'idle',
    'walk',
    'run',
    'slide',
    'run',
    'crouch',
    'walk',
    'idle',
    'run',
    'slide',
  ] as const,
  /** Reach distance to pick a new wander point */
  arriveDist: 0.55,
  /** Yaw turn rate (rad/s) toward move direction */
  turnSpeed: 10,
  /** Visual squash for crouch (no crouch clip in man.glb) */
  crouchScaleY: 0.78,
  /** Label height above feet */
  labelY: 2.05,
} as const

/** Dev / tuning overlays */
export const DEBUG = {
  /**
   * Hitscan uses the real character meshes. When true, zone wireframes draw on
   * top of the skin: red head / cyan chest / orange arms / yellow legs.
   * (Arms are split from Suit_Body by skin weights when the mesh has no separate arm part.)
   */
  showHitboxes: true,
} as const
