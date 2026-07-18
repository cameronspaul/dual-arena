/**
 * Apply authoritative net snapshots, shots, and hit events.
 */
import { gameAudio } from '../../core/audio'
import type { HitEvent, SniperState } from '../../core/types'
import type { InputManager } from '../../core/input'
import type { CombatFx } from '../../systems/CombatFx'
import type { ViewmodelSystem } from '../../viewmodel/ViewmodelSystem'
import type { Prediction, RemotePlayerSystem, VoicePeer } from '../../net'
import {
  eyePosition as eyePosShared,
  resetPlayerLocomotion,
  type MatchPhase,
  type NetHitEvent,
  type NetShotEvent,
  type PlayerBody,
  type SnapshotMessage,
} from '@glint/shared'
import type { FreeCamState } from '../../sim/spectate'
import {
  clearMatchEndForRematch,
  syncVoicePeerFromSnapshot,
  type OnlineSessionHost,
} from '../onlineSession'

export type NetApplyHost = OnlineSessionHost & {
  player: PlayerBody
  sniper: SniperState
  input: InputManager
  combatFx: CombatFx
  remotes: RemotePlayerSystem
  prediction: Prediction
  viewmodel: ViewmodelSystem
  thirdPerson: boolean
  lastHit: HitEvent | null
  lastHitAge: number
  lastHitId: number
  matchTimeLeft: number | null
  matchWaiting: boolean
  matchPhase: MatchPhase | null
  matchPhaseTimer: number
  lastMatchPhase: MatchPhase | null
  serverRespawnIn: number
  deathReason: import('../../core/types').DeathReason | null
  spectateTimer: number
  freeCam: FreeCamState | null
  voluntaryFreeCam: boolean
  voice: VoicePeer | null
}

export function flushNetSnapshots(host: NetApplyHost, _dt: number) {
  if (!host.pendingSnapshots.length) return
  const snaps = host.pendingSnapshots
  host.pendingSnapshots = []

  // Push EVERY snapshot into remote interp (dropping intermediates made
  // other players teleport / sit in wrong lobby poses).
  for (const snap of snaps) {
    for (const shot of snap.shots ?? []) applyNetShotEvent(host, shot)
    for (const ev of snap.events) applyNetHitEvent(host, ev)
    pushRemoteSnapshots(host, snap)
  }

  // Latest only for local combat HUD / respawn
  const latest = snaps[snaps.length - 1]
  applyLocalSnapshot(host, latest)
  syncVoicePeerFromSnapshot(host, latest)
}

export function pushRemoteSnapshots(host: NetApplyHost, snap: SnapshotMessage) {
  const selfId = host.localPlayerId
  for (const p of snap.players) {
    if (selfId && p.id === selfId) continue
    host.remotes.pushSnapshot(p.id, p, snap.tick, host.serverTickRate)
  }
}

export function applyLocalSnapshot(host: NetApplyHost, snap: SnapshotMessage) {
  const selfId = host.localPlayerId
  const seen = new Set<string>()
  const prevPhase = host.lastMatchPhase

  host.matchTimeLeft = snap.timeLeft ?? null
  host.matchWaiting = snap.phase === 'waiting'
  host.matchPhase = snap.phase
  host.matchPhaseTimer = snap.phaseTimer ?? 0
  host.matchFirstTo = snap.firstTo ?? host.matchFirstTo

  // Rematch restart: server returned to pregame after match_end
  if (
    host.matchEnd &&
    snap.phase === 'pregame' &&
    (prevPhase === 'ended' || prevPhase === null)
  ) {
    clearMatchEndForRematch(host)
  }

  // Post-match: rematch only if opponent seat still present
  if (host.matchEnd && snap.phase === 'ended') {
    const hasEnemy = snap.players.some((p) => !selfId || p.id !== selfId)
    host.rematchAvailable =
      hasEnemy && host.matchEnd.reason !== 'disconnect'
    if (!hasEnemy) {
      host.localRematchReady = false
      host.enemyRematchReady = false
    }
  }

  // Clear kill tracers + silhouettes when a new round starts
  if (
    snap.phase === 'countdown' &&
    (prevPhase === 'round_reset' || prevPhase === 'pregame')
  ) {
    host.combatFx.clearTracers()
  }

  // Full look+pose snap when first entering countdown / respawning
  const enteringCountdown =
    snap.phase === 'countdown' &&
    (prevPhase === 'round_reset' ||
      prevPhase === 'pregame' ||
      prevPhase === 'rejoin' ||
      prevPhase === null)

  host.lastMatchPhase = snap.phase

  for (const p of snap.players) {
    if (selfId && p.id === selfId) {
      const wasAlive = host.playerAlive
      // Authoritative combat state only — never local pose / ADS feel
      host.playerHp = p.hp
      host.playerAlive = p.alive
      host.kills = p.kills
      host.serverRespawnIn = p.respawnIn ?? 0
      host.localReady = p.ready === true
      host.sniper.ammo = p.ammo
      host.sniper.magSize = p.magSize
      if (p.phase !== host.sniper.phase) {
        host.sniper.phase = p.phase
        if (p.phase === 'ready') host.sniper.phaseTimer = 0
      }
      // ADS is pure local feel. Server ads lag RTT behind input and
      // overwriting every snapshot made zoom stutter (esp. after rejoin).

      const respawning = Boolean(wasAlive === false && p.alive)
      // Whole countdown: pin feet to server team pad (movement locked)
      const pinToPad = p.alive && snap.phase === 'countdown'
      const fullSnap = p.alive && (respawning || enteringCountdown)

      if (!p.alive) {
        host.deathReason = 'combat'
        host.spectateTimer = p.respawnIn ?? 0
      } else if (fullSnap || pinToPad) {
        host.deathReason = null
        host.spectateTimer = 0
        host.freeCam = null
        host.voluntaryFreeCam = false
        if (fullSnap) host.prediction.clear()
        // Always pin feet to server pad during countdown / respawn.
        // Full locomotion reset so mid-slide round resets don't keep slide
        // state, crouch height, or looping slide audio.
        host.player.position.x = p.x
        host.player.position.y = p.y
        host.player.position.z = p.z
        resetPlayerLocomotion(host.player)
        gameAudio.stopSlide()
        host.playSpawn = {
          spawn: { x: p.x, y: p.y, z: p.z },
          spawnYaw: p.yaw,
        }
        // Only force look on full snap so player can aim around during countdown
        if (fullSnap) {
          host.player.yaw = p.yaw
          host.player.pitch = p.pitch
          host.input.setLook(p.yaw, p.pitch)
        }
        if (host.viewmodel.root && !host.thirdPerson) {
          host.viewmodel.root.visible = true
        }
      }
    } else {
      seen.add(p.id)
      host.enemyKills = p.kills
      host.enemyReady = p.ready === true
    }
  }

  for (const id of host.remotes.ids()) {
    if (!seen.has(id)) host.remotes.remove(id)
  }
}

/**
 * Authoritative shot tracers for remotes. Non-kills blink; kills stay red
 * until round reset. Skip local shooter — optimistic tracer already drawn.
 */
export function applyNetShotEvent(host: NetApplyHost, shot: NetShotEvent) {
  if (shot.shooterId === host.localPlayerId) return
  const killed = shot.hit?.killed === true
  host.combatFx.showTracer(shot.origin, shot.dir, shot.end, {
    killed,
    permanent: killed,
  })
}

export function applyNetHitEvent(host: NetApplyHost, ev: NetHitEvent) {
  const hit: HitEvent = {
    targetId: ev.targetId,
    zone: ev.zone,
    damage: ev.damage,
    killed: ev.killed,
    point: { ...ev.point },
  }
  // Local player was shooter or victim → hitmarker / impact
  if (
    ev.shooterId === host.localPlayerId ||
    ev.targetId === host.localPlayerId
  ) {
    host.lastHit = hit
    host.lastHitAge = 0
    host.lastHitId += 1
    gameAudio.playHitConfirm({ zone: ev.zone, killed: ev.killed })
  }
  host.combatFx.showImpact(
    ev.point,
    ev.zone === 'head' ? 'head' : 'body',
    ev.killed,
  )

  // Our kill: permanent red tracer + silhouette until round reset
  if (
    ev.killed &&
    ev.shooterId === host.localPlayerId &&
    ev.origin &&
    ev.dir &&
    ev.end
  ) {
    host.combatFx.showTracer(ev.origin, ev.dir, ev.end, {
      killed: true,
      permanent: true,
    })
  }

  // Remote body reactions (local player is first-person — no body clip)
  if (ev.targetId !== host.localPlayerId) {
    const shotDir = estimateShotDir(host, ev)
    if (ev.killed) {
      // Freeze red silhouette at the actual hit pose (our kills only), then
      // re-yaw / knock for the Death fall along the shot — ghost stays put.
      if (ev.shooterId === host.localPlayerId) {
        const victim = host.remotes.getRoot(ev.targetId)
        if (victim) {
          host.combatFx.spawnKillGhost(victim, { permanent: true })
        }
      }
      if (shotDir) host.remotes.alignDeath(ev.targetId, shotDir)
      // Already aligned above — don't knock again.
      host.remotes.onDeath(ev.targetId)
    } else {
      host.remotes.onHit(ev.targetId)
    }
  }
}

/** Bullet direction for death fall: shooter → impact point when possible. */
export function estimateShotDir(
  host: NetApplyHost,
  ev: NetHitEvent,
): { x: number; y: number; z: number } | undefined {
  let ox: number | null = null
  let oy: number | null = null
  let oz: number | null = null
  if (ev.shooterId === host.localPlayerId) {
    const eye = eyePosShared(host.player)
    ox = eye.x
    oy = eye.y
    oz = eye.z
  }
  if (ox == null) return undefined
  const dx = ev.point.x - ox
  const dy = ev.point.y - oy!
  const dz = ev.point.z - oz!
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-4) return undefined
  return { x: dx / len, y: dy / len, z: dz / len }
}

