/**
 * Local player spawn, death, and free-cam helpers.
 * Host is typically GameEngine (fields must be writable).
 */
import { gameAudio } from '../core/audio'
import { DEATH, PLAYER } from '../core/config'
import type { InputManager } from '../core/input'
import type { DeathReason, SniperState } from '../core/types'
import { pickPlaySpawn, type MapDef, type MapSpawnLayout } from '../maps'
import { computeFallKillY } from '../sim/death'
import { eyePosition } from '../sim/player'
import type { PlayerBody } from '@glint/shared'
import { createFreeCam, type FreeCamState } from '../sim/spectate'
import { resetSniper } from '../sim/sniper'
import type { ViewmodelSystem } from '../viewmodel/ViewmodelSystem'
import type { PlayerVisuals } from '../systems/PlayerVisuals'

export type PlaySpawn = {
  spawn: { x: number; y: number; z: number }
  spawnYaw: number
}

export type SpawnHost = {
  player: PlayerBody
  input: InputManager
  isOnline: boolean
  onlineTeamSpawnReady: boolean
  playSpawn: PlaySpawn
  spawnLayout: MapSpawnLayout
  mapDef: MapDef
  fallKillY: number | null
}

export type CameraHost = {
  player: PlayerBody
  sniper: SniperState
  freeCam: FreeCamState | null
  thirdPerson: boolean
  voluntaryFreeCam: boolean
  playerAlive: boolean
  levelEditorActive: boolean
  isOnline: boolean
  playerVisuals: PlayerVisuals
  viewmodel: ViewmodelSystem
  enterFreeCam(): void
  exitFreeCam(): void
  restartRound(): void
}

export type DeathHost = {
  playerAlive: boolean
  levelEditorActive: boolean
  playerHp: number
  deathReason: DeathReason | null
  spectateTimer: number
  voluntaryFreeCam: boolean
  freeCam: FreeCamState | null
  sniper: SniperState
  prevSniperPhase: SniperState['phase']
  playSpawn: PlaySpawn
  thirdPerson: boolean
  playerVisuals: PlayerVisuals
  viewmodel: ViewmodelSystem
  enterFreeCam(): void
  applyPlaySpawn(fallback: PlaySpawn): void
}

export function applySpawn(
  host: Pick<SpawnHost, 'player' | 'input'>,
  spawn: { x: number; y: number; z: number },
  spawnYaw: number,
) {
  const { player, input } = host
  player.position.x = spawn.x
  // Engine ground plane is y=0; keep feet on/above it. Mesh floors near 0
  // are preferred by the placer — raised Y still helps until gravity settles.
  player.position.y = Math.max(0, spawn.y)
  player.position.z = spawn.z
  player.velocity.x = 0
  player.velocity.y = 0
  player.velocity.z = 0
  player.yaw = spawnYaw
  player.pitch = 0
  player.grounded = true
  player.state = 'idle'
  player.slideTimer = 0
  player.slideCd = 0
  player.slideSpeed = 0
  input.setLook(spawnYaw, 0)
}

/**
 * After GLB/range load: offline uses solo play pad; online keeps the
 * server team pad from welcome (map load must not stomp it).
 */
export function applyMapLoadSpawn(
  host: SpawnHost & {
    applySpawn(
      spawn: { x: number; y: number; z: number },
      spawnYaw: number,
    ): void
    applyPlaySpawn(fallback: PlaySpawn): void
    rebuildFallKillY(): void
  },
  catalogSpawn: { x: number; y: number; z: number },
  catalogYaw: number,
) {
  if (host.isOnline && host.onlineTeamSpawnReady) {
    host.applySpawn(host.playSpawn.spawn, host.playSpawn.spawnYaw)
    host.rebuildFallKillY()
    return
  }
  if (host.isOnline) {
    // Welcome not yet — park at catalog; welcome will re-place on team pad
    host.playSpawn = {
      spawn: { ...catalogSpawn },
      spawnYaw: catalogYaw,
    }
    host.applySpawn(catalogSpawn, catalogYaw)
    host.rebuildFallKillY()
    return
  }
  host.applyPlaySpawn({ spawn: catalogSpawn, spawnYaw: catalogYaw })
}

/** Team pads from editor/authored layout, else map catalog fallback. */
export function applyPlaySpawn(
  host: SpawnHost & {
    applySpawn(
      spawn: { x: number; y: number; z: number },
      spawnYaw: number,
    ): void
    rebuildFallKillY(): void
  },
  fallback: PlaySpawn,
) {
  const pad = pickPlaySpawn(host.spawnLayout)
  if (pad) {
    host.playSpawn = {
      spawn: { x: pad.x, y: pad.y, z: pad.z },
      spawnYaw: pad.yaw,
    }
    host.applySpawn(host.playSpawn.spawn, host.playSpawn.spawnYaw)
    host.rebuildFallKillY()
    return
  }
  host.playSpawn = {
    spawn: { ...fallback.spawn },
    spawnYaw: fallback.spawnYaw,
  }
  host.applySpawn(fallback.spawn, fallback.spawnYaw)
  host.rebuildFallKillY()
}

/** Recompute fall kill plane from current team pads + catalog fallback. */
export function rebuildFallKillY(host: SpawnHost) {
  host.fallKillY = computeFallKillY({
    enabled: host.mapDef.fallDeath,
    depth: host.mapDef.fallKillDepth,
    spawnYs: host.spawnLayout.spawns.map((s) => s.y),
    fallbackSpawnY: host.playSpawn.spawn.y,
  })
}

/**
 * Local player death → free-cam spectate for DEATH.spectateDuration,
 * then restartRound(). Safe to call only once while already dead.
 */
export function killPlayer(host: DeathHost, reason: DeathReason) {
  if (!host.playerAlive || host.levelEditorActive) return
  host.playerAlive = false
  host.playerHp = 0
  host.deathReason = reason
  host.spectateTimer = DEATH.spectateDuration
  // Death cam is not voluntary — keep the flag so UI can still show Free cam on.
  host.voluntaryFreeCam = true
  host.enterFreeCam()

  gameAudio.unlock()
  gameAudio.playHitConfirm({ zone: 'body', killed: true })
}

/** Respawn at play pad, full HP / mag, exit free-cam. Keeps match kills. */
export function restartRound(host: DeathHost) {
  host.playerAlive = true
  host.playerHp = PLAYER.maxHp
  host.deathReason = null
  host.spectateTimer = 0
  host.voluntaryFreeCam = false
  host.freeCam = null
  resetSniper(host.sniper)
  host.prevSniperPhase = 'ready'
  host.applyPlaySpawn(host.playSpawn)

  if (host.playerVisuals.body) {
    host.playerVisuals.body.visible = host.thirdPerson
  }
  if (host.viewmodel.root && !host.thirdPerson) {
    host.viewmodel.root.visible = true
  }
}

export function damagePlayer(
  host: DeathHost & { killPlayer(reason: DeathReason): void },
  amount: number,
  reason: DeathReason = 'combat',
) {
  if (!host.playerAlive || host.levelEditorActive) return
  host.playerHp = Math.max(0, host.playerHp - amount)
  if (host.playerHp <= 0) host.killPlayer(reason)
}

export function setThirdPerson(host: CameraHost, enabled: boolean) {
  host.thirdPerson = enabled
  // Free-cam hides the body and viewmodel entirely.
  if (host.freeCam) {
    if (host.playerVisuals.body) host.playerVisuals.body.visible = false
    if (host.viewmodel.root) host.viewmodel.root.visible = false
    return
  }
  if (host.playerVisuals.body) {
    host.playerVisuals.body.visible = enabled
  }
  if (host.viewmodel.root && !enabled) {
    host.viewmodel.root.visible = true
  }
}

/**
 * Enter / exit free-cam spectate (fly + look, no combat).
 * While alive: toggle explore mode. While dead: turning off respawns early.
 */
export function setFreeCam(host: CameraHost, enabled: boolean) {
  if (host.levelEditorActive) return
  // Ranked: no free-cam / noclip while match is live
  if (host.isOnline && enabled && host.playerAlive) return

  if (enabled) {
    host.voluntaryFreeCam = true
    host.enterFreeCam()
    return
  }

  host.voluntaryFreeCam = false
  if (!host.playerAlive) {
    // Skip remaining death countdown and restart the round.
    host.restartRound()
    return
  }
  host.exitFreeCam()
}

/** Detach camera into free-fly from the current eye (idempotent). */
export function enterFreeCam(host: CameraHost) {
  host.player.velocity.x = 0
  host.player.velocity.y = 0
  host.player.velocity.z = 0
  host.sniper.ads = false
  host.sniper.adsBlend = 0

  if (!host.freeCam) {
    const eye = eyePosition(host.player)
    host.freeCam = createFreeCam(eye, host.player.yaw, host.player.pitch)
  }

  // Ghost mode — no body or gun while flying.
  if (host.playerVisuals.body) host.playerVisuals.body.visible = false
  if (host.viewmodel.root) host.viewmodel.root.visible = false
}

/** Return to player-controlled camera after voluntary free-cam. */
export function exitFreeCam(host: CameraHost) {
  if (host.freeCam) {
    host.player.yaw = host.freeCam.yaw
    host.player.pitch = host.freeCam.pitch
    host.freeCam = null
  }
  if (host.playerVisuals.body) {
    host.playerVisuals.body.visible = host.thirdPerson
  }
  if (host.viewmodel.root && !host.thirdPerson) {
    host.viewmodel.root.visible = true
  }
}
