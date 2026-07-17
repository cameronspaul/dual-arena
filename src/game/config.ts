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
  headDamage: 100,
  bodyDamage: 45,
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
  viewmodelRecoil: 0.06,
} as const

export const PLAYER = {
  maxHp: 100,
  spawn: { x: 0, y: 0, z: 8 },
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
  bodyHalfW: 0.32,
  bodyHalfD: 0.22,
  bodyHeight: 1.15,
  headRadius: 0.18,
  headOffsetY: 1.42,
  bodyOffsetY: 0.55,
  respawnTime: 2.5,
} as const
