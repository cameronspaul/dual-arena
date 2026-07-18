/**
 * Practice-range control wall: look + fire to toggle dummy behavior,
 * reset targets, and cycle how many rows are active.
 */
import * as THREE from 'three'
import { RANGE, type DummyBehaviorMode } from '../core/config'
import type {
  RangeControlAction,
  RangeControlButton,
} from '../scene/environment'
import type { DummyTarget } from '../core/types'
import {
  applyDummyRowCount,
  resetRangeDummies,
  setDummyBehaviorMode,
  getDummyBehaviorMode,
  getDummyActiveRows,
  type DummyActiveRows,
} from '../sim/world'
import type { RespawnTimer } from '../sim/world'

const INTERACT_MAX_DIST = 5.5
const HIGHLIGHT_EMISSIVE = 0x335566

export type RangeControlsState = {
  mode: DummyBehaviorMode
  rows: DummyActiveRows
}

export class RangeControls {
  private buttons: RangeControlButton[] = []
  private raycaster = new THREE.Raycaster()
  private ndc = new THREE.Vector2(0, 0)
  private hovered: RangeControlButton | null = null
  private prevFire = false
  private cooldown = 0

  mode: DummyBehaviorMode = 'stationary'
  rows: DummyActiveRows = RANGE.rowDist.length

  attach(buttons: RangeControlButton[]) {
    this.buttons = buttons
    this.syncButtonVisuals()
  }

  clear() {
    this.buttons = []
    this.hovered = null
  }

  getState(): RangeControlsState {
    return { mode: this.mode, rows: this.rows }
  }

  /**
   * Highlight the button under the crosshair when close enough.
   * On fire edge while hovering, apply the action.
   * @returns true if the shot should be suppressed (button consumed the click).
   */
  update(opts: {
    camera: THREE.Camera
    playerPos: { x: number; y: number; z: number }
    fire: boolean
    dt: number
    dummies: DummyTarget[]
    respawns: RespawnTimer[]
  }): boolean {
    const { camera, playerPos, fire, dt, dummies, respawns } = opts
    this.cooldown = Math.max(0, this.cooldown - dt)

    if (this.buttons.length === 0) {
      this.prevFire = fire
      return false
    }

    // Center-screen ray (crosshair)
    this.raycaster.setFromCamera(this.ndc, camera)
    this.raycaster.far = INTERACT_MAX_DIST + 2
    const meshes = this.buttons.map((b) => b.mesh)
    const hits = this.raycaster.intersectObjects(meshes, false)

    let nextHover: RangeControlButton | null = null
    if (hits.length > 0) {
      const hit = hits[0]
      const btn = this.buttons.find((b) => b.mesh === hit.object) ?? null
      if (btn) {
        const dx = btn.position.x - playerPos.x
        const dy = btn.position.y - (playerPos.y + 1.5)
        const dz = btn.position.z - playerPos.z
        const dist = Math.hypot(dx, dy, dz)
        if (dist <= INTERACT_MAX_DIST) nextHover = btn
      }
    }

    if (this.hovered !== nextHover) {
      this.hovered = nextHover
      this.syncButtonVisuals()
    }

    let consumed = false
    const fireEdge = fire && !this.prevFire
    this.prevFire = fire

    if (fireEdge && this.hovered && this.cooldown <= 0) {
      this.applyAction(this.hovered.id, dummies, respawns)
      this.cooldown = 0.25
      consumed = true
      this.syncButtonVisuals()
    }

    return consumed
  }

  private applyAction(
    action: RangeControlAction,
    dummies: DummyTarget[],
    respawns: RespawnTimer[],
  ) {
    switch (action) {
      case 'mode_stationary':
        this.mode = 'stationary'
        setDummyBehaviorMode('stationary')
        break
      case 'mode_moving':
        this.mode = 'moving'
        setDummyBehaviorMode('moving')
        break
      case 'mode_strafing':
        this.mode = 'strafing'
        setDummyBehaviorMode('strafing')
        break
      case 'reset':
        resetRangeDummies(dummies, respawns)
        break
      case 'count': {
        const maxRows = Math.max(1, RANGE.rowDist.length)
        const next = (this.rows % maxRows) + 1
        this.rows = next
        applyDummyRowCount(dummies, respawns, next)
        break
      }
    }
    // Keep module state in sync if external callers mutated
    this.mode = getDummyBehaviorMode()
    this.rows = getDummyActiveRows()
  }

  /** Emissive highlight on active mode + hover. */
  syncButtonVisuals() {
    for (const btn of this.buttons) {
      const mat = btn.mesh.material as THREE.MeshStandardMaterial
      if (!mat.isMeshStandardMaterial) continue

      const isMode =
        (btn.id === 'mode_stationary' && this.mode === 'stationary') ||
        (btn.id === 'mode_moving' && this.mode === 'moving') ||
        (btn.id === 'mode_strafing' && this.mode === 'strafing')

      const hovered = this.hovered === btn
      if (hovered) {
        mat.emissive.setHex(HIGHLIGHT_EMISSIVE)
        mat.emissiveIntensity = 0.85
      } else if (isMode) {
        const accent = (btn.mesh.userData.accent as number) ?? 0x4488aa
        mat.emissive.setHex(accent)
        mat.emissiveIntensity = 0.45
      } else if (btn.id === 'count') {
        // Dim pulse encoding row count
        mat.emissive.setHex(0x6644aa)
        mat.emissiveIntensity = 0.15 + this.rows * 0.12
      } else {
        mat.emissive.setHex(0x000000)
        mat.emissiveIntensity = 0
      }
      mat.needsUpdate = true
    }
  }

  /** Call after external mode/row changes. */
  setState(mode: DummyBehaviorMode, rows: DummyActiveRows) {
    this.mode = mode
    this.rows = rows
    setDummyBehaviorMode(mode)
    this.syncButtonVisuals()
  }
}
