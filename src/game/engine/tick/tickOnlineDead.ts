/**
 * Online: dead until server respawns — free-cam spectate, no local restart.
 */
import * as THREE from 'three'
import { LOOK } from '../../core/config'
import type { PlayerInput, SniperState } from '../../core/types'
import { stepFreeCam, type FreeCamState } from '../../sim/spectate'
import type { CombatFx } from '../../systems/CombatFx'
import type { PlayerVisuals } from '../../systems/PlayerVisuals'
import type { ViewmodelSystem } from '../../viewmodel/ViewmodelSystem'
import type { BarrierVisuals } from '../../systems/BarrierVisuals'
import type { NetClient, RemotePlayerSystem } from '../../net'
import type { PlayerBody } from '@glint/shared'

export type TickOnlineDeadHost = {
  sniper: SniperState
  viewmodel: ViewmodelSystem
  playerVisuals: PlayerVisuals
  freeCam: FreeCamState | null
  enterFreeCam(): void
  camera: THREE.PerspectiveCamera
  remotes: RemotePlayerSystem
  combatFx: CombatFx
  barrierVisuals: BarrierVisuals
  player: PlayerBody
  lastHitAge: number
  spectateTimer: number
  serverRespawnIn: number
  net: NetClient | null
  localPlayerId: string | null
  emitHud(): void
}

export function tickOnlineDead(
  host: TickOnlineDeadHost,
  dt: number,
  input: PlayerInput,
) {
  host.sniper.ads = false
  host.sniper.adsBlend = Math.max(0, host.sniper.adsBlend - dt * 8)
  host.viewmodel.syncAnim(host.sniper.phase)
  host.viewmodel.updateMixer(dt)
  if (host.viewmodel.root) host.viewmodel.root.visible = false
  if (host.playerVisuals.body) host.playerVisuals.body.visible = false

  if (!host.freeCam) host.enterFreeCam()
  if (host.freeCam) {
    stepFreeCam(host.freeCam, input, dt)
    host.camera.position.set(
      host.freeCam.position.x,
      host.freeCam.position.y,
      host.freeCam.position.z,
    )
    host.camera.rotation.order = 'YXZ'
    host.camera.rotation.y = host.freeCam.yaw
    host.camera.rotation.x = host.freeCam.pitch
  }

  host.camera.fov = LOOK.hipFov
  host.camera.updateProjectionMatrix()

  host.remotes.update(dt)
  host.combatFx.update(dt)
  host.barrierVisuals.update(host.freeCam?.position ?? host.player.position)
  host.lastHitAge += dt
  host.spectateTimer = host.serverRespawnIn
  // Keep sending pose so server ack doesn't stall (dead body frozen server-side)
  if (host.net && host.localPlayerId) {
    host.net.maybeSendInput(
      { ...input, fire: false, jump: false },
      dt,
      host.player,
    )
  }
  host.emitHud()
}
