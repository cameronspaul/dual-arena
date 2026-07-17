import { MOVE, SNIPER } from '../core/config'
import { clamp, lerp } from '../core/math'
import type { PlayerBody, PlayerInput, SniperState } from '../core/types'

export function createSniper(): SniperState {
  return {
    ammo: SNIPER.magSize,
    magSize: SNIPER.magSize,
    phase: 'ready',
    phaseTimer: 0,
    ads: false,
    adsBlend: 0,
    recoil: 0,
    fireBloom: 0,
    reloadQueued: false,
    reloadJiggleX: 0,
    reloadJiggleY: 0,
  }
}

/** Full mag / phase reset for round restart after death. */
export function resetSniper(s: SniperState) {
  s.ammo = SNIPER.magSize
  s.magSize = SNIPER.magSize
  s.phase = 'ready'
  s.phaseTimer = 0
  s.ads = false
  s.adsBlend = 0
  s.recoil = 0
  s.fireBloom = 0
  s.reloadQueued = false
  s.reloadJiggleX = 0
  s.reloadJiggleY = 0
}

function canReload(s: SniperState): boolean {
  return s.ammo < s.magSize
}

/** Start mag reload if allowed. Works while ADS / in the scope. */
function beginReload(s: SniperState): boolean {
  if (!canReload(s)) {
    s.reloadQueued = false
    return false
  }
  s.phase = 'reloading'
  s.phaseTimer = SNIPER.reloadTime
  s.reloadQueued = false
  return true
}

/**
 * Scope reticle kick while reloading in ADS — stays glass-on, crosshair
 * drifts and jitters so the mag change still reads.
 * Biased toward top-left (negative X/Y) like the gun is being worked on.
 */
function stepReloadJiggle(s: SniperState, dt: number) {
  if (s.phase === 'reloading') {
    const elapsed = Math.max(0, SNIPER.reloadTime - s.phaseTimer)
    // Strong throughout; slight peak mid-mag, still readable at ends.
    const u = clamp(elapsed / SNIPER.reloadTime, 0, 1)
    const envelope = 0.75 + Math.sin(u * Math.PI) * 0.45
    const t = elapsed
    // Base park: up and left of dead center, plus aggressive jiggle.
    const baseX = -1.15
    const baseY = -0.95
    s.reloadJiggleX =
      (baseX +
        Math.sin(t * 19.5) * 0.72 +
        Math.sin(t * 33.0) * 0.42 +
        Math.sin(t * 7.1 + 1.2) * 0.48 +
        Math.sin(t * 52) * 0.28 +
        Math.sin(t * 11.4) * 0.22) *
      envelope
    s.reloadJiggleY =
      (baseY +
        Math.cos(t * 16.2) * 0.65 +
        Math.sin(t * 27.4 + 0.7) * 0.4 +
        Math.cos(t * 9.3) * 0.45 +
        Math.sin(t * 44.5) * 0.26 +
        Math.cos(t * 13.8 + 0.4) * 0.2) *
      envelope
  } else {
    // Snap back clean when the chamber is ready.
    const k = 1 - Math.exp(-16 * dt)
    s.reloadJiggleX = lerp(s.reloadJiggleX, 0, k)
    s.reloadJiggleY = lerp(s.reloadJiggleY, 0, k)
  }
}

export function stepSniper(s: SniperState, input: PlayerInput, dt: number) {
  // Fire + bolt always leave ADS so the cock animation plays at hip.
  // Reload may stay scoped (glass up). Holding ADS re-enters once ready.
  const cocking = s.phase === 'firing' || s.phase === 'bolt'
  s.ads = input.ads && !cocking
  const target = s.ads ? 1 : 0
  const k = 1 - Math.exp(-10 * dt)
  s.adsBlend = lerp(s.adsBlend, target, k)

  s.recoil = Math.max(0, s.recoil - SNIPER.recoilDecay * dt)
  s.fireBloom = Math.max(0, s.fireBloom - SNIPER.recoilDecay * 1.2 * dt)

  // R is edge-triggered — queue it if pressed during bolt/fire so a reload
  // after the last scoped shot still lands once the gun is free.
  if (input.reload && canReload(s)) {
    if (s.phase === 'ready') {
      beginReload(s)
    } else if (s.phase !== 'reloading') {
      s.reloadQueued = true
    }
  }

  if (s.phase !== 'ready') {
    s.phaseTimer -= dt
    if (s.phaseTimer <= 0) {
      if (s.phase === 'firing') {
        // Empty chamber: skip bolt, reload right away.
        if (s.ammo <= 0 && canReload(s)) {
          beginReload(s)
        } else {
          s.phase = 'bolt'
          s.phaseTimer = SNIPER.boltTime
        }
      } else if (s.phase === 'bolt') {
        s.phase = 'ready'
        s.phaseTimer = 0
      } else if (s.phase === 'reloading') {
        s.ammo = s.magSize
        s.phase = 'ready'
        s.phaseTimer = 0
      }
    }
  }

  // Drain queued reload / empty-fire once ready (incl. still holding ADS).
  if (s.phase === 'ready' && s.reloadQueued) {
    beginReload(s)
  }

  stepReloadJiggle(s, dt)
}

export type FireResult = 'shot' | 'dry' | 'reload' | 'none'

/** Attempt a shot this frame. Returns what happened for SFX hooks. */
export function tryFire(s: SniperState, input: PlayerInput): FireResult {
  if (!input.fire) return 'none'
  if (s.phase !== 'ready') {
    // Empty click during bolt after the last round — still queue a reload
    // so scoped dry-fires aren't lost.
    if (s.ammo <= 0 && s.phase !== 'reloading') {
      s.reloadQueued = true
    }
    return 'none'
  }
  if (s.ammo <= 0) {
    // Dry-fire while ADS: start reload without leaving the ADS hold intent.
    if (beginReload(s)) return 'reload'
    return 'dry'
  }

  s.ammo -= 1
  // Last round: skip fire→bolt and start reload immediately (scoped ok).
  if (s.ammo <= 0 && canReload(s)) {
    beginReload(s)
  } else {
    s.phase = 'firing'
    s.phaseTimer = SNIPER.fireAnimTime
    // Leave ADS this frame so the cock cycle is visible at hip.
    s.ads = false
  }
  // Recoil is applied after the shot so the bullet still goes where the
  // crosshair was aiming this frame (kick affects subsequent frames).
  return 'shot'
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
  } else if (body.state === 'run') {
    mul *= SNIPER.runSpreadMul
  } else if (speed > MOVE.walkSpeed * 0.95) {
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
