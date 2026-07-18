/**
 * Offline practice range — client-authoritative combat OK.
 */
import * as THREE from 'three'
import { gameAudio } from '../../core/audio'
import type {
  AABB,
  DeathReason,
  DummyTarget,
  HitEvent,
  PlayerInput,
  SniperState,
} from '../../core/types'
import { castMapHitscan } from '../../maps'
import { isBelowFallKill } from '../../sim/death'
import { stepPlayer } from '../../sim/player'
import { applyRecoil, stepSniper, tryFire } from '../../sim/sniper'
import { stepDummies, stepRespawns, type RespawnTimer } from '../../sim/world'
import type { CombatFx } from '../../systems/CombatFx'
import type { DummySystem } from '../../systems/DummySystem'
import type { PlayerVisuals } from '../../systems/PlayerVisuals'
import type { ViewFeel } from '../../systems/ViewFeel'
import { fireShot, playSniperPhaseSfx } from '../../systems/combat'
import type { ViewmodelSystem } from '../../viewmodel/ViewmodelSystem'
import type { BarrierVisuals } from '../../systems/BarrierVisuals'
import type { PlayerBody } from '@glint/shared'

export type TickOfflineHost = {
  player: PlayerBody
  sniper: SniperState
  colliders: AABB[]
  meshWorld: { meshes: THREE.Object3D[] } | null
  barrierColliders: AABB[]
  fallKillY: number | null
  dummiesEnabled: boolean
  dummies: DummyTarget[]
  respawns: RespawnTimer[]
  dummiesSys: DummySystem
  playerVisuals: PlayerVisuals
  viewmodel: ViewmodelSystem
  viewFeel: ViewFeel
  combatFx: CombatFx
  barrierVisuals: BarrierVisuals
  camera: THREE.PerspectiveCamera
  thirdPerson: boolean
  prevSniperPhase: SniperState['phase']
  lastHit: HitEvent | null
  lastHitAge: number
  lastHitId: number
  kills: number
  mapHitMeshes: THREE.Object3D[]
  killPlayer(reason: DeathReason): void
  tickSpectate(dt: number, input: PlayerInput): void
  emitHud(): void
}

export function tickOffline(
  host: TickOfflineHost,
  dt: number,
  input: PlayerInput,
) {
  host.viewFeel.samplePreStep(host.player)
  const prevMoveState = host.player.state
  stepPlayer(
    host.player,
    input,
    dt,
    host.colliders,
    host.meshWorld,
    host.barrierColliders,
  )

  if (isBelowFallKill(host.player.position.y, host.fallKillY)) {
    host.killPlayer('fall')
    host.tickSpectate(dt, input)
    return
  }

  stepSniper(host.sniper, input, dt)
  if (host.dummiesEnabled) {
    stepDummies(host.dummies, dt)
    stepRespawns(host.dummies, host.respawns, dt)
    host.dummiesSys.update(dt, host.dummies, false)
  }

  if (host.playerVisuals.isMan) {
    host.playerVisuals.syncLocomotion(host.player, input)
    host.playerVisuals.update(dt)
  }
  host.viewmodel.syncAnim(host.sniper.phase)
  host.viewmodel.updateMixer(dt)

  const prevGrounded = host.viewFeel.wasGrounded
  const fireResult = tryFire(host.sniper, input)
  if (fireResult === 'shot') {
    gameAudio.playFire()
    const result = fireShot({
      player: host.player,
      sniper: host.sniper,
      colliders: host.colliders,
      barrierColliders: host.barrierColliders,
      dummies: host.dummiesEnabled ? host.dummies : [],
      respawns: host.respawns,
      dummiesSys: host.dummiesSys,
      fx: host.combatFx,
      castWorldMesh: (origin, dir, maxRange) =>
        castMapHitscan(host.mapHitMeshes, origin, dir, maxRange),
    })
    if (result.lastHit) {
      host.lastHit = result.lastHit
      host.lastHitAge = 0
      host.lastHitId += 1
    }
    host.kills += result.killsDelta
    applyRecoil(host.sniper)
    // Full camera shake when fire kicks us out of ADS (bolt); soft only if still scoped.
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
  host.combatFx.update(dt)
  host.barrierVisuals.update(host.player.position)

  host.lastHitAge += dt
  host.emitHud()
}
