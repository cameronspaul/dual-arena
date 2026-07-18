/**
 * Online duel — client-authoritative movement; combat from server snapshots.
 */
import * as THREE from 'three'
import { gameAudio } from '../../core/audio'
import type {
  AABB,
  DummyTarget,
  PlayerInput,
  SniperState,
} from '../../core/types'
import { stepPlayer } from '../../sim/player'
import { applyRecoil, stepSniper, tryFire } from '../../sim/sniper'
import { stepDummies, stepRespawns, type RespawnTimer } from '../../sim/world'
import type { CombatFx } from '../../systems/CombatFx'
import type { DummySystem } from '../../systems/DummySystem'
import type { PlayerVisuals } from '../../systems/PlayerVisuals'
import type { ViewFeel } from '../../systems/ViewFeel'
import { playSniperPhaseSfx } from '../../systems/combat'
import type { ViewmodelSystem } from '../../viewmodel/ViewmodelSystem'
import type { BarrierVisuals } from '../../systems/BarrierVisuals'
import type { NetClient, RemotePlayerSystem } from '../../net'
import {
  effectiveLook,
  eyePosition as eyePosShared,
  SNIPER,
  spreadLookDirection,
  aimSpread as aimSpreadShared,
  type MatchPhase,
  type PlayerBody,
} from '@glint/shared'

export type TickOnlineHost = {
  player: PlayerBody
  sniper: SniperState
  colliders: AABB[]
  meshWorld: { meshes: THREE.Object3D[] } | null
  barrierColliders: AABB[]
  matchPhase: MatchPhase | null
  playerAlive: boolean
  net: NetClient | null
  localPlayerId: string | null
  playerVisuals: PlayerVisuals
  viewmodel: ViewmodelSystem
  viewFeel: ViewFeel
  combatFx: CombatFx
  barrierVisuals: BarrierVisuals
  remotes: RemotePlayerSystem
  camera: THREE.PerspectiveCamera
  thirdPerson: boolean
  prevSniperPhase: SniperState['phase']
  lastHitAge: number
  dummiesEnabled: boolean
  dummies: DummyTarget[]
  respawns: RespawnTimer[]
  dummiesSys: DummySystem
  emitHud(): void
}

export function tickOnline(
  host: TickOnlineHost,
  dt: number,
  input: PlayerInput,
) {
  host.viewFeel.samplePreStep(host.player)
  const prevMoveState = host.player.state

  // Countdown / rejoin pause: freeze feet — look only.
  const movementLocked =
    host.matchPhase === 'countdown' || host.matchPhase === 'rejoin'
  const fireAllowed =
    host.playerAlive &&
    !movementLocked &&
    (host.matchPhase === 'pregame' ||
      host.matchPhase === 'live' ||
      host.matchPhase === 'waiting' ||
      host.matchPhase == null)

  if (movementLocked) {
    // Hold pad position; mouse look still updates yaw/pitch
    host.player.velocity.x = 0
    host.player.velocity.y = 0
    host.player.velocity.z = 0
    host.player.grounded = true
    host.player.state = 'idle'
    host.player.slideTimer = 0
    host.player.yaw = input.yaw
    host.player.pitch = input.pitch
  } else {
    // Same movement as offline practice — no fixed-step / no reconcile
    stepPlayer(
      host.player,
      input,
      dt,
      host.colliders,
      host.meshWorld,
      host.barrierColliders,
    )
  }

  // Cosmetic sniper step (server overwrites ammo/phase on snapshot)
  stepSniper(host.sniper, input, dt)

  // Send pose + buttons (force on combat edges so rate limit never drops fire)
  if (host.net && host.localPlayerId) {
    const sendInput =
      movementLocked || !fireAllowed
        ? {
            ...input,
            forward: movementLocked ? 0 : input.forward,
            right: movementLocked ? 0 : input.right,
            jump: false,
            sprint: movementLocked ? false : input.sprint,
            fire: fireAllowed ? input.fire : false,
          }
        : input
    const edge = sendInput.fire || sendInput.reload || sendInput.jump
    if (edge) host.net.sendInputNow(sendInput, host.player)
    else host.net.maybeSendInput(sendInput, dt, host.player)
  }

  if (host.playerVisuals.isMan) {
    host.playerVisuals.syncLocomotion(
      host.player,
      movementLocked
        ? { ...input, forward: 0, right: 0, jump: false, sprint: false }
        : input,
    )
    host.playerVisuals.update(dt)
  }
  host.viewmodel.syncAnim(host.sniper.phase)
  host.viewmodel.updateMixer(dt)

  const prevGrounded = host.viewFeel.wasGrounded
  // Optimistic fire FX only — damage comes from server HitEvents.
  const fireInput = fireAllowed ? input : { ...input, fire: false }
  const fireResult = tryFire(host.sniper, fireInput)
  if (fireResult === 'shot') {
    gameAudio.playFire()
    // Aim sample BEFORE recoil — matches offline fireShot + server resolveFire.
    const look = effectiveLook(host.player, host.sniper)
    const origin = eyePosShared(host.player)
    const spread = aimSpreadShared(host.sniper, host.player)
    const dir = spreadLookDirection(look.yaw, look.pitch, spread)
    const end = {
      x: origin.x + dir.x * SNIPER.maxRange,
      y: origin.y + dir.y * SNIPER.maxRange,
      z: origin.z + dir.z * SNIPER.maxRange,
    }
    host.combatFx.showTracer(origin, dir, end, { killed: false })
    applyRecoil(host.sniper)
    host.viewFeel.punchShot(
      host.sniper.adsBlend,
      host.sniper.ads ? host.sniper.adsBlend : 0,
    )
  } else if (fireResult === 'dry') {
    gameAudio.playDryFire()
  }
  host.prevSniperPhase = playSniperPhaseSfx(
    host.sniper.phase,
    host.prevSniperPhase,
  )

  const { grounded, speed } = host.viewFeel.stepLandingAndSfx(
    dt,
    host.player,
    host.sniper,
    prevGrounded,
    prevMoveState,
  )

  host.viewFeel.applyCameraAndViewmodel({
    dt,
    player: host.player,
    sniper: host.sniper,
    camera: host.camera,
    thirdPerson: host.thirdPerson,
    viewmodel: host.viewmodel,
    grounded,
    speed,
  })

  host.playerVisuals.updatePose(host.player, host.thirdPerson)
  host.remotes.update(dt)
  // Host wait room: practice dummies while alone in lobby
  if (host.dummiesEnabled) {
    stepDummies(host.dummies, dt)
    stepRespawns(host.dummies, host.respawns, dt)
    host.dummiesSys.update(dt, host.dummies, false)
  }
  host.combatFx.update(dt)
  host.barrierVisuals.update(host.player.position)

  host.lastHitAge += dt
  host.emitHud()
}
