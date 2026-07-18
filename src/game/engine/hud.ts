/**
 * HUD snapshot emission + perf overlay.
 */
import { DEBUG } from '../core/config'
import type { HudSnapshot, PlayerInput, SniperState } from '../core/types'
import type { HitEvent } from '../core/types'
import { aimSpread } from '../sim/sniper'
import type { PlayerBody } from '@glint/shared'
import { MATCH, type MatchEndMessage, type MatchPhase } from '@glint/shared'
import {
  inferBottleneck,
  type MapStaticPerf,
} from '../maps'
import type { FreeCamState } from '../sim/spectate'
import type { InputManager } from '../core/input'
import type { HudListener } from './types'
import type * as THREE from 'three'

export type HudHost = {
  freeCam: FreeCamState | null
  playerAlive: boolean
  player: PlayerBody
  playerHp: number
  sniper: SniperState
  lastInput: PlayerInput | null
  input: InputManager
  kills: number
  lastHit: HitEvent | null
  lastHitAge: number
  lastHitId: number
  isOnline: boolean
  serverRespawnIn: number
  spectateTimer: number
  deathReason: import('../core/types').DeathReason | null
  fps: number
  pingMs: number | null
  matchTimeLeft: number | null
  matchEnd: MatchEndMessage | null
  pendingDrawFromId: string | null
  matchWaiting: boolean
  matchPhase: MatchPhase | null
  matchPhaseTimer: number
  matchFirstTo: number
  localReady: boolean
  enemyReady: boolean
  localRematchReady: boolean
  enemyRematchReady: boolean
  rematchAvailable: boolean
  enemyKills: number
  teamColor: 'blue' | 'red' | null
  hudListeners: Set<HudListener>
  renderer: THREE.WebGLRenderer
  frameMsEma: number
  simMsEma: number
  renderMsEma: number
  nearbyCollision: number
  mapStaticPerf: MapStaticPerf | null
  mapHitMeshes: THREE.Object3D[]
}

export function emitHud(host: HudHost) {
  const freecam = host.freeCam !== null
  const speed =
    host.playerAlive && !freecam
      ? Math.hypot(host.player.velocity.x, host.player.velocity.z)
      : 0
  const snap: HudSnapshot = {
    hp: host.playerHp,
    ammo: host.sniper.ammo,
    magSize: host.sniper.magSize,
    phase: host.sniper.phase,
    phaseTimer: host.sniper.phaseTimer,
    ads: host.playerAlive && !freecam ? host.sniper.ads : false,
    adsBlend: host.playerAlive && !freecam ? host.sniper.adsBlend : 0,
    reloadJiggleX: host.sniper.reloadJiggleX,
    reloadJiggleY: host.sniper.reloadJiggleY,
    aimSpread:
      host.playerAlive && !freecam
        ? aimSpread(host.sniper, host.player)
        : 0,
    moveState: host.playerAlive && !freecam ? host.player.state : 'idle',
    speed,
    sprintHeld: Boolean(host.lastInput?.sprint),
    crouchHeld: Boolean(host.lastInput?.crouch),
    moving: Boolean(
      host.lastInput &&
        (Math.abs(host.lastInput.forward) > 0 ||
          Math.abs(host.lastInput.right) > 0),
    ),
    pointerLocked: host.input.isPointerLocked(),
    kills: host.kills,
    lastHit: host.lastHit,
    lastHitAge: host.lastHitAge,
    lastHitId: host.lastHitId,
    alive: host.playerAlive,
    spectating: freecam || (host.isOnline && !host.playerAlive),
    respawnIn: host.playerAlive
      ? 0
      : host.isOnline
        ? host.serverRespawnIn
        : host.spectateTimer,
    deathReason: host.deathReason,
    fps: host.fps,
    ping: host.pingMs,
    perf: buildPerfHud(host),
    matchTimeLeft: host.isOnline ? host.matchTimeLeft : null,
    matchWinnerId: host.matchEnd?.winnerId ?? null,
    matchEndReason: host.matchEnd?.reason ?? null,
    pendingDrawFromId: host.isOnline ? host.pendingDrawFromId : null,
    matchWaiting: host.isOnline && host.matchWaiting,
    matchPhase: host.isOnline ? host.matchPhase : null,
    matchPhaseTimer: host.isOnline ? host.matchPhaseTimer : 0,
    matchFirstTo: host.isOnline ? host.matchFirstTo : MATCH.firstTo,
    localReady: host.isOnline && host.localReady,
    enemyReady: host.isOnline && host.enemyReady,
    localRematchReady: host.isOnline && host.localRematchReady,
    enemyRematchReady: host.isOnline && host.enemyRematchReady,
    rematchAvailable:
      host.isOnline && Boolean(host.matchEnd) && host.rematchAvailable,
    enemyKills: host.isOnline ? host.enemyKills : 0,
    teamColor: host.isOnline ? host.teamColor : null,
  }
  for (const fn of host.hudListeners) fn(snap)
}

export function buildPerfHud(
  host: HudHost,
): import('../core/types').PerfHud | null {
  if (!DEBUG.showPerf) return null
  const info = host.renderer.info
  const staticP = host.mapStaticPerf
  const draws = info.render.calls
  const triangles = info.render.triangles
  const bottleneck = inferBottleneck({
    frameMs: host.frameMsEma,
    simMs: host.simMsEma,
    renderMs: host.renderMsEma,
    draws,
    triangles,
    nearbyCollision: host.nearbyCollision,
    collisionMeshes: staticP?.collisionMeshes ?? host.mapHitMeshes.length,
    dedicatedCollision: staticP?.dedicatedCollision ?? false,
    pixelRatio: host.renderer.getPixelRatio(),
    staticTriangles: staticP?.triangles ?? 0,
    shadowCasters: staticP?.shadowCasters ?? 0,
  })
  return {
    frameMs: host.frameMsEma,
    simMs: host.simMsEma,
    renderMs: host.renderMsEma,
    draws,
    triangles,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    collisionMeshes: staticP?.collisionMeshes ?? host.mapHitMeshes.length,
    nearbyCollision: host.nearbyCollision,
    pixelRatio: host.renderer.getPixelRatio(),
    bottleneck,
    map: staticP
      ? {
          id: staticP.mapId,
          meshes: staticP.meshes,
          triangles: staticP.triangles,
          materials: staticP.materials,
          shadowCasters: staticP.shadowCasters,
          dedicatedCollision: staticP.dedicatedCollision,
          notes: staticP.notes,
        }
      : null,
  }
}
