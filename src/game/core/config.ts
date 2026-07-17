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
  /** Extra degrees of FOV while sprinting (fades with ADS) */
  sprintFovBoost: 7,
  /** Ease into / out of sprint FOV (higher = snappier) */
  sprintFovLerp: 8,
} as const

/** Over-the-shoulder third-person camera (toggle in-game). */
export const THIRD_PERSON = {
  /** Distance behind the aim pivot */
  distance: 3.4,
  /** Aim pivot height as a fraction of live eye height */
  pivotEyeFrac: 0.82,
  /** Right-shoulder offset (world-horizontal, meters) */
  shoulder: 0.48,
  /** Keep the camera above the floor by this much */
  minHeight: 0.35,
  /** Slight FOV bump vs first-person hip FOV */
  fovBoost: 4,
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
  /** Tuned near DJMaesen bolt segment frames 12–49 @30fps (~1.23s raw). */
  boltTime: 1.15,
  fireAnimTime: 0.12,
  /** Mag + chamber frames 49–148 @30fps (~3.3s raw); sped up for game feel. */
  reloadTime: 2.1,
  maxRange: 400,
  /** Camera pitch punch (rad) at full recoil — aim kick, not gun mesh */
  recoilKick: 0.045,
  recoilDecay: 8,

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
  /** Sprint — looser than walk/move; crosshair opens with this. */
  runSpreadMul: 2.55,
  crouchSpreadMul: 0.72,
  airSpreadMul: 3.4,
  slideSpreadMul: 3.8,
  /** Extra cone while recoil kick is active. */
  recoilSpreadMul: 0.55,
  /** Brief bloom after each shot (radians added, decays with recoil). */
  fireBloom: 0.018,
} as const

/**
 * First-person sniper pose (camera-local space).
 * Live-tune with the in-game Viewmodel Editor (button during a match), then paste the
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
  gunOffset: { x: 0.085, y: -0.16, z: -0.185 },
  /** Bottom-right hip hold. */
  hipPos: { x: 0.05, y: -0.12, z: -0.28 },
  hipRot: { x: 0.02, y: 0.04, z: 0.02 },
  adsPos: { x: -0.075, y: -0.04, z: -0.14 },
  adsRot: { x: 0.0, y: 0.0, z: 0.0 },
  /** Sprint hold — tuned via viewmodel editor 2026-07-17. */
  runPos: { x: -0.005, y: -0.14, z: -0.185 },
  runRot: {
    x: -0.2530727415391778,
    y: 0.5585053606381855,
    z: 0.02,
  },
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
   * Spring-impulse (not an instant offset snap) so the gun dips and
   * recovers without a hard jolt. landKick / landImpactScale are the
   * desired peak dip in camera-local units; converted to velocity on impact.
   */
  landKick: 0.011,
  /** Extra peak dip from fall speed (× |vy| on impact) */
  landImpactScale: 0.0022,
  landMax: 0.026,
  /**
   * Spring natural frequency (rad/s). Higher = snappier return.
   * Slightly overdamped (landDamp > 1) avoids a bounce at rest.
   */
  landOmega: 13,
  landDamp: 1.2,
  /** Pitch (rad) per unit of landOffset — keep modest vs. position dip */
  landPitch: 0.4,
  /**
   * Airborne float — gun lifts while falling (weightless arms).
   * Scales with fall speed; eases out on land so the land kick can settle.
   */
  airRise: 0.02,
  /** Extra lift × |vy| while falling (capped by airRiseMax) */
  airRiseFallScale: 0.0018,
  airRiseMax: 0.038,
  /** |vy| (m/s) at which fall-speed term is fully blended in */
  airRiseFallRef: 10,
  /** Soft pitch (rad) at full rise — muzzle lifts slightly with the gun */
  airRisePitch: -0.028,
  /** Ease in while falling / out when grounded (higher = snappier settle) */
  airRiseLerpIn: 5.5,
  airRiseLerpOut: 11,
  /** ADS almost freezes air float */
  airRiseAdsMul: 0.12,
  /** Ease hip → run pose (higher = snappier raise/lower) */
  runPoseLerp: 9,
} as const

/**
 * Shot feel — viewmodel kick + camera screen-shake (visual only).
 * Timed envelopes are independent of combat `sniper.recoil` so the gun can
 * settle slowly without stretching aim-spread bloom.
 * Amplitudes are peak values at hip (adsBlend=0) right after the shot.
 */
export const VIEW_RECOIL = {
  /**
   * How long the gun takes to fully settle (seconds).
   * Longer = weightier; combat recoil can still be snappy.
   */
  duration: 0.72,
  /**
   * Ease-out power on the main kick envelope: higher = hangs near peak
   * then drops (massy), lower = more linear return.
   */
  kickEase: 2.6,
  /** Shake envelope power — usually dies a bit sooner than the main kick */
  shakeEase: 2.0,

  /** Primary kick — muzzle climb + shoulder push-back */
  pitch: 0.17,
  yaw: 0.04,
  roll: 0.08,
  posX: 0.014,
  posY: 0.022,
  /** Kick toward camera (local +Z) */
  posZ: 0.06,
  /**
   * Residual rattle while settling — multi-axis mass, not high-freq buzz.
   * Frequencies are rad/s (lower = weightier).
   */
  shakePos: 0.01,
  shakePitch: 0.032,
  shakeYaw: 0.024,
  shakeRoll: 0.04,
  shakeFreq: 13,
  thumpFreq: 5.5,
  thumpPos: 0.012,
  thumpPitch: 0.028,
  /** ADS multiplies viewmodel kick (mesh nearly gone under scope) */
  adsMul: 0.12,

  /**
   * Camera screen-shake (does not affect hitscan / aim).
   * Modest — enough to sell the blast without making aim feel broken.
   */
  screenDuration: 0.48,
  screenEase: 2.2,
  screenPosX: 0.007,
  screenPosY: 0.009,
  screenPosZ: 0.0035,
  screenPitch: 0.012,
  screenYaw: 0.008,
  /** Camera bank on fire — primary “weight” of the screen shake */
  screenRoll: 0.042,
  screenFreq: 15,
  screenThumpFreq: 6.5,
  /** ADS still gets some camera shake (scope kick) */
  screenAdsMul: 0.55,
} as const

/**
 * Viewmodel sway (gun only — never the camera).
 * Idle micro-sway + procedural lean into local move direction (strafe / forward).
 */
export const GUN_SWAY = {
  /** Primary / secondary cycle rates (rad/s) */
  freqYaw: 1.35,
  freqPitch: 1.05,
  freqRoll: 0.85,
  /** Idle position (local units) */
  posX: 0.0016,
  posY: 0.0011,
  /** Idle rotation (radians) */
  yaw: 0.004,
  pitch: 0.0032,
  roll: 0.0025,
  /** ADS almost freezes sway */
  adsMul: 0.08,
  /** Slight extra idle sway while moving */
  moveMul: 1.35,
  /**
   * Procedural lean into velocity (camera-local).
   * Positive local-right → gun banks right; forward → slight pitch / push-back.
   * Strongest while running; ADS heavily damps via adsMul above.
   */
  leanLerp: 10,
  /** |local speed| / this → full lean (matches MOVE.runSpeed) */
  leanSpeedRef: 7.4,
  /** Position lean at full strafe / forward (local units) */
  leanPosX: 0.014,
  leanPosY: -0.004,
  leanPosZ: 0.01,
  /** Rotation lean at full strafe / forward (radians) */
  leanYaw: 0.028,
  leanPitch: 0.022,
  leanRoll: 0.055,
  /** Multiplier on lean amplitudes while sprinting (state === run) */
  runLeanMul: 1.55,
  /** Extra idle-oscillation amp scale at full sprint */
  sprintOscMul: 0.55,
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
  spawn: { x: 0, y: 0, z: 8.4 },
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

/**
 * Player death / fall kill / free-cam spectate (round restart loop).
 * Fall death is opt-in per map via MapDef.fallDeath.
 */
export const DEATH = {
  /** Free-cam spectate duration before the round restarts (seconds). */
  spectateDuration: 5,
  /**
   * Kill when feet drop this many meters below the lowest spawn pad Y
   * (or catalog spawn Y when no team pads exist).
   */
  fallKillDepth: 12,
  /** Free-cam fly speed (m/s). */
  freeCamSpeed: 14,
  /** Sprint multiplier while free-camming. */
  freeCamSprintMul: 2.2,
} as const

export const WORLD = {
  floorSize: 48,
  /**
   * Practice-range dummy homes (facing +Z toward the firing line at z=6).
   * Distances from fire line ≈ 12 / 18 / 18 / 28 / 35 m.
   */
  dummies: [
    { id: 'd0', x: 0, z: -6, yaw: 0 },
    { id: 'd1', x: -5.5, z: -12, yaw: 0.15 },
    { id: 'd2', x: 5.5, z: -12, yaw: -0.15 },
    { id: 'd3', x: -3.5, z: -22, yaw: 0.08 },
    { id: 'd4', x: 4, z: -29, yaw: -0.05 },
  ],
  /**
   * Mid-lane peek cover on the practice range (meshed in buildRange).
   * Facility walls / berm / bays are built procedurally with their own colliders.
   */
  coverBoxes: [
    // Near crate left of center lane
    { x: -3.2, y: 0.55, z: -2, w: 1.1, h: 1.1, d: 1.1 },
    // Low wall right
    { x: 4.5, y: 0.5, z: -5, w: 2.2, h: 1.0, d: 0.55 },
    // Mid crate stack
    { x: -5.5, y: 0.65, z: -16, w: 1.3, h: 1.3, d: 1.3 },
    // Long low barricade
    { x: 2.5, y: 0.4, z: -18, w: 2.8, h: 0.8, d: 0.55 },
    // Far wide wall (peek edge)
    { x: 0, y: 1.0, z: -32, w: 3.6, h: 2.0, d: 0.55 },
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
  /**
   * Absolute wander clamp half-extent from world origin (XZ).
   * Practice range is long in -Z (~40 m to berm) — keep this generous;
   * DUMMY.wanderRadius still keeps each dummy near its home.
   */
  bounds: 36,
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
  /**
   * On kill: re-yaw so man.glb Death (falls backward in local -Z) lands
   * along the bullet. Set false to keep pre-death facing.
   */
  deathAlignToShot: true,
  /** Horizontal meters the corpse is pushed along the shot on kill. */
  deathKnockback: 0.45,
} as const

/** Dev / tuning overlays */
export const DEBUG = {
  /**
   * Hitscan uses the real character meshes. When true, zone wireframes draw on
   * top of the skin: red head / cyan chest / orange arms / yellow legs.
   * (Arms are split from Suit_Body by skin weights when the mesh has no separate arm part.)
   */
  showHitboxes: true,
  /**
   * Expanded perf panel (FPS, sim/render ms, draws, tris, collision counts)
   * + detailed `[map-perf]` console dump on map load.
   */
  showPerf: true,
} as const
