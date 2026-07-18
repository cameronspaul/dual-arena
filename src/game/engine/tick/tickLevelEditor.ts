/**
 * Walk / fly with map collision + place spawns / barriers; no combat.
 */
import * as THREE from 'three'
import { LOOK } from '../../core/config'
import type { AABB, DummyTarget, PlayerInput } from '../../core/types'
import { stepEditorMove } from '../../editor/noclip'
import type { PlayerBody } from '@glint/shared'
import type { DummySystem } from '../../systems/DummySystem'
import type { CombatFx } from '../../systems/CombatFx'
import type { BarrierVisuals } from '../../systems/BarrierVisuals'
import type { ViewmodelSystem } from '../../viewmodel/ViewmodelSystem'
import type { LevelEditorSession } from '../levelEditorSession'

export type TickLevelEditorHost = {
  player: PlayerBody
  colliders: AABB[]
  meshWorld: { meshes: THREE.Object3D[] } | null
  editor: LevelEditorSession
  barrierColliders: AABB[]
  camera: THREE.PerspectiveCamera
  viewmodel: ViewmodelSystem
  dummiesEnabled: boolean
  dummies: DummyTarget[]
  dummiesSys: DummySystem
  combatFx: CombatFx
  barrierVisuals: BarrierVisuals
  lastHitAge: number
  emitHud(): void
}

export function tickLevelEditor(
  host: TickLevelEditorHost,
  dt: number,
  input: PlayerInput,
) {
  stepEditorMove(
    host.player,
    input,
    dt,
    host.colliders,
    host.meshWorld,
    host.barrierColliders,
  )

  host.editor.handleEditorInput(input)

  // Simple free-look camera (no bob / ADS / viewmodel)
  host.camera.position.set(
    host.player.position.x,
    host.player.position.y + host.player.eyeHeight,
    host.player.position.z,
  )
  host.camera.rotation.order = 'YXZ'
  host.camera.rotation.y = host.player.yaw
  host.camera.rotation.x = host.player.pitch
  host.camera.fov = LOOK.hipFov
  host.camera.updateProjectionMatrix()

  if (host.viewmodel.root) host.viewmodel.root.visible = false
  if (host.dummiesEnabled) {
    host.dummiesSys.update(dt, host.dummies, true)
  }
  host.combatFx.update(dt)
  // Always show signs in the editor so placement is obvious
  host.barrierVisuals.update(host.player.position, true)
  host.lastHitAge += dt
  host.emitHud()
}
