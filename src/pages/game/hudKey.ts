import { HITMARKER_DURATION } from '@/components/game/GameHud'
import type { HudSnapshot } from '@/game/types'

/** Stable key for throttling React HUD re-renders from engine snapshots. */
export function hudKey(s: HudSnapshot): string {
  return [
    s.ammo,
    s.phase,
    // Reload line progress (~20 ticks over full mag change)
    Math.round(s.phaseTimer * 10),
    s.ads ? 1 : 0,
    Math.round(s.adsBlend * 10),
    // Scoped reload reticle jiggle (~px-level updates while mag changing)
    Math.round(s.reloadJiggleX * 40),
    Math.round(s.reloadJiggleY * 40),
    // Quantize so the dynamic reticle updates as the cone opens/closes
    Math.round(s.aimSpread * 400),
    s.moveState,
    Math.round(s.speed * 2),
    s.sprintHeld ? 1 : 0,
    s.crouchHeld ? 1 : 0,
    s.moving ? 1 : 0,
    s.pointerLocked ? 1 : 0,
    s.kills,
    // Serial id so consecutive same-zone hits still re-render the hitmarker
    s.lastHitId,
    s.lastHitAge < HITMARKER_DURATION ? 1 : 0,
    s.hp,
    s.alive ? 1 : 0,
    s.spectating ? 1 : 0,
    // Whole-second ticks for death countdown UI
    Math.ceil(s.respawnIn),
    s.deathReason ?? '',
    s.fps,
    s.ping ?? -1,
    s.matchTimeLeft != null ? Math.ceil(s.matchTimeLeft) : '',
    s.matchWinnerId ?? '',
    s.matchEndReason ?? '',
    s.pendingDrawFromId ?? '',
    s.matchWaiting ? 1 : 0,
    s.matchPhase ?? '',
    Math.ceil(s.matchPhaseTimer ?? 0),
    s.matchFirstTo ?? 0,
    s.localReady ? 1 : 0,
    s.enemyReady ? 1 : 0,
    s.localRematchReady ? 1 : 0,
    s.enemyRematchReady ? 1 : 0,
    s.rematchAvailable ? 1 : 0,
    s.enemyKills ?? 0,
    s.teamColor ?? '',
    // Throttle perf panel: ~4 Hz on timings, integer draw/col counts
    s.perf
      ? [
          Math.round(s.perf.frameMs * 4),
          Math.round(s.perf.simMs * 4),
          Math.round(s.perf.renderMs * 4),
          s.perf.draws,
          Math.round(s.perf.triangles / 500),
          s.perf.nearbyCollision,
          s.perf.bottleneck,
        ].join(',')
      : '',
  ].join('|')
}
