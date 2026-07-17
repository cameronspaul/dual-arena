import { MOVE, SNIPER } from './config'
import { clamp, lerp } from './math'
import type { PlayerBody, PlayerInput, SniperState } from './types'

export function createSniper(): SniperState {
  return {
    ammo: SNIPER.magSize,
    magSize: SNIPER.magSize,
    reserve: SNIPER.reserve,
    phase: 'ready',
    phaseTimer: 0,
    ads: false,
    adsBlend: 0,
    recoil: 0,
    fireBloom: 0,
  }
}

export function stepSniper(s: SniperState, input: PlayerInput, dt: number) {
  s.ads = input.ads
  const target = s.ads ? 1 : 0
  const k = 1 - Math.exp(-10 * dt)
  s.adsBlend = lerp(s.adsBlend, target, k)

  s.recoil = Math.max(0, s.recoil - SNIPER.recoilDecay * dt)
  s.fireBloom = Math.max(0, s.fireBloom - SNIPER.recoilDecay * 1.2 * dt)

  if (s.phase !== 'ready') {
    s.phaseTimer -= dt
    if (s.phaseTimer <= 0) {
      if (s.phase === 'firing') {
        s.phase = 'bolt'
        s.phaseTimer = SNIPER.boltTime
      } else if (s.phase === 'bolt') {
        s.phase = 'ready'
        s.phaseTimer = 0
      } else if (s.phase === 'reloading') {
        const need = s.magSize - s.ammo
        const take = Math.min(need, s.reserve)
        s.ammo += take
        s.reserve -= take
        s.phase = 'ready'
        s.phaseTimer = 0
      }
    }
  }

  // reload request
  if (
    input.reload &&
    s.phase === 'ready' &&
    s.ammo < s.magSize &&
    s.reserve > 0
  ) {
    s.phase = 'reloading'
    s.phaseTimer = SNIPER.reloadTime
  }

  // auto reload on empty fire attempt handled by caller wanting fire
}

/** Returns true if a shot was consumed this frame. */
export function tryFire(s: SniperState, input: PlayerInput): boolean {
  if (!input.fire) return false
  if (s.phase !== 'ready') return false
  if (s.ammo <= 0) {
    if (s.reserve > 0) {
      s.phase = 'reloading'
      s.phaseTimer = SNIPER.reloadTime
    }
    return false
  }

  s.ammo -= 1
  s.phase = 'firing'
  s.phaseTimer = SNIPER.fireAnimTime
  // Recoil is applied after the shot so the bullet still goes where the
  // crosshair was aiming this frame (kick affects subsequent frames).
  return true
}

export function applyRecoil(s: SniperState) {
  s.recoil = Math.min(1, s.recoil + 1)
  s.fireBloom = Math.min(0.08, s.fireBloom + SNIPER.fireBloom)
}

/**
 * Current hitscan cone half-angle (radians). COD logic:
 * hip = wide, ADS = tight, movement/air/slide open the cone further.
 */
export function aimSpread(s: SniperState, body: PlayerBody): number {
  const base = lerp(SNIPER.hipSpread, SNIPER.adsSpread, s.adsBlend)
  const speed = Math.hypot(body.velocity.x, body.velocity.z)
  let mul = SNIPER.standSpreadMul

  if (!body.grounded) {
    mul *= SNIPER.airSpreadMul
  } else if (body.state === 'slide') {
    mul *= SNIPER.slideSpreadMul
  } else if (body.state === 'crouch') {
    mul *= SNIPER.crouchSpreadMul
  } else if (body.state === 'run' || speed > MOVE.walkSpeed * 0.95) {
    mul *= SNIPER.moveSpreadMul
  } else if (speed > 0.6) {
    mul *= SNIPER.walkSpreadMul
  }

  mul *= 1 + s.recoil * SNIPER.recoilSpreadMul
  // Fire bloom mostly affects hipfire; ADS recovers almost immediately.
  return base * mul + s.fireBloom * (1 - s.adsBlend * 0.85)
}

/** Recoil kick only — no idle/move sway on the camera or hitscan. */
export function aimSway(
  s: SniperState,
  _body: PlayerBody,
): { yaw: number; pitch: number } {
  return {
    yaw: 0,
    pitch: s.recoil * SNIPER.recoilKick,
  }
}

export function effectiveLook(
  body: PlayerBody,
  s: SniperState,
): { yaw: number; pitch: number } {
  const sway = aimSway(s, body)
  return {
    yaw: body.yaw + sway.yaw,
    pitch: clamp(body.pitch + sway.pitch, -1.5, 1.5),
  }
}
