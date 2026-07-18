/**
 * Free-cam spectate (death countdown or voluntary toggle).
 */
import * as THREE from 'three'
import { LOOK } from '../../core/config'
import type { DummyTarget, PlayerInput } from '../../core/types'
import { stepFreeCam, type FreeCamState } from '../../sim/spectate'
import { stepDummies, stepRespawns, type RespawnTimer } from '../../sim/world'
import type { CombatFx } from '../../systems/CombatFx'
import type { DummySystem } from '../../systems/DummySystem'
import type { PlayerVisuals } from '../../systems/PlayerVisuals'
import type { ViewmodelSystem } from '../../viewmodel/ViewmodelSystem'
import type { BarrierVisuals } from '../../systems/BarrierVisuals'

export type TickSpectateHost = {
  freeCam: FreeCamState | null
  enterFreeCam(): void
  camera: THREE.PerspectiveCamera
  viewmodel: ViewmodelSystem
  playerVisuals: PlayerVisuals
  dummiesEnabled: boolean
  dummies: DummyTarget[]
  respawns: RespawnTimer[]
  dummiesSys: DummySystem
  combatFx: CombatFx
  barrierVisuals: BarrierVisuals
  lastHitAge: number
  playerAlive: boolean
  spectateTimer: number
  restartRound(): void
  emitHud(): void
}

export function tickSpectate(
  host: TickSpectateHost,
  dt: number,
  input: PlayerInput,
) {
  if (!host.freeCam) {
    host.enterFreeCam()
  }
  if (!host.freeCam) return

  stepFreeCam(host.freeCam, input, dt)

  // Keep mouse look on free-cam (input already drives cam via sample)
  host.camera.position.set(
    host.freeCam.position.x,
    host.freeCam.position.y,
    host.freeCam.position.z,
  )
  host.camera.rotation.order = 'YXZ'
  host.camera.rotation.y = host.freeCam.yaw
  host.camera.rotation.x = host.freeCam.pitch
  host.camera.fov = LOOK.hipFov
  host.camera.updateProjectionMatrix()

  if (host.viewmodel.root) host.viewmodel.root.visible = false
  // Keep player model hidden for the whole free-cam session.
  if (host.playerVisuals.body) host.playerVisuals.body.visible = false

  if (host.dummiesEnabled) {
    stepDummies(host.dummies, dt)
    stepRespawns(host.dummies, host.respawns, dt)
    host.dummiesSys.update(dt, host.dummies, false)
  }
  host.combatFx.update(dt)
  host.barrierVisuals.update(host.freeCam.position)

  host.lastHitAge += dt

  if (!host.playerAlive) {
    host.spectateTimer = Math.max(0, host.spectateTimer - dt)
    host.emitHud()
    if (host.spectateTimer <= 0) {
      host.restartRound()
    }
    return
  }

  host.emitHud()
}
