/**
 * Practice-range control wall.
 *
 * Unified interaction for every button:
 *  - Eye-ray + crosshair (same aim as shooting)
 *  - Fire edge activates the hovered button and suppresses the shot
 *  - Shared visual states: idle / hover / selected / pressed
 *
 * Button kinds:
 *  - radio (STILL/ROAM/STRAFE): one selected at a time
 *  - action (RESET): momentary flash
 *  - stepper (ROWS): advances the squad to the next distance band
 */
import * as THREE from 'three'
import { gameAudio } from '../core/audio'
import { RANGE, type DummyBehaviorMode } from '../core/config'
import {
  setButtonFaceLabel,
  type RangeControlAction,
  type RangeControlButton,
} from '../scene/environment'
import type { DummyTarget } from '../core/types'
import {
  advanceDummyDistanceRow,
  resetRangeDummies,
  setDummyBehaviorMode,
  getDummyBehaviorMode,
  getDummyActiveRows,
  getDummyActiveRowDist,
  type DummyActiveRows,
} from '../sim/world'
import type { RespawnTimer } from '../sim/world'

/** Max reach from eye to button center. */
const INTERACT_MAX_DIST = 7.5
/** Brief flash after a successful press. */
const PRESS_FLASH = 0.14
/** Debounce so one click can't double-fire. */
const COOLDOWN = 0.2

const _origin = new THREE.Vector3()
const _dir = new THREE.Vector3()

export type RangeControlsState = {
  mode: DummyBehaviorMode
  rows: DummyActiveRows
}

function accentHex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`
}

export class RangeControls {
  private buttons: RangeControlButton[] = []
  private raycaster = new THREE.Raycaster()
  private hovered: RangeControlButton | null = null
  private prevFire = false
  private cooldown = 0
  /** Seconds of press-flash remaining per button id. */
  private pressT = new Map<RangeControlAction, number>()
  /** Last painted face signature so we don't thrash canvas textures. */
  private faceSig = new Map<RangeControlAction, string>()

  mode: DummyBehaviorMode = 'stationary'
  /** Current distance-band index (0 = closest). */
  rows: DummyActiveRows = 0

  attach(buttons: RangeControlButton[]) {
    this.buttons = buttons
    this.hovered = null
    this.pressT.clear()
    this.faceSig.clear()
    this.mode = getDummyBehaviorMode()
    this.rows = getDummyActiveRows()
    this.paintAllFaces(true)
    this.syncButtonVisuals()
  }

  clear() {
    this.buttons = []
    this.hovered = null
    this.pressT.clear()
    this.faceSig.clear()
  }

  getState(): RangeControlsState {
    return { mode: this.mode, rows: this.rows }
  }

  /**
   * Highlight + activate from eye ray.
   * @returns true if the shot should be suppressed this frame.
   */
  update(opts: {
    eye: { x: number; y: number; z: number }
    lookDir: { x: number; y: number; z: number }
    fire: boolean
    dt: number
    dummies: DummyTarget[]
    respawns: RespawnTimer[]
    /** Optional: snap dummy meshes to idle after RESET. */
    forceIdleVisuals?: (dummies: DummyTarget[]) => void
  }): boolean {
    const { eye, lookDir, fire, dt, dummies, respawns, forceIdleVisuals } = opts
    this.cooldown = Math.max(0, this.cooldown - dt)

    // Decay press flashes
    for (const [id, t] of this.pressT) {
      const next = t - dt
      if (next <= 0) this.pressT.delete(id)
      else this.pressT.set(id, next)
    }

    if (this.buttons.length === 0) {
      this.prevFire = fire
      return false
    }

    _origin.set(eye.x, eye.y, eye.z)
    _dir.set(lookDir.x, lookDir.y, lookDir.z)
    if (_dir.lengthSq() < 1e-8) {
      this.prevFire = fire
      this.syncButtonVisuals()
      return false
    }
    _dir.normalize()

    this.raycaster.set(_origin, _dir)
    this.raycaster.far = INTERACT_MAX_DIST
    this.raycaster.near = 0.05

    const hitTargets = this.buttons.map((b) => b.hitMesh)
    const hits = this.raycaster.intersectObjects(hitTargets, false)

    let nextHover: RangeControlButton | null = null
    if (hits.length > 0) {
      const hit = hits[0]
      // Prefer hitMesh match; fall back to userData action id
      nextHover =
        this.buttons.find((b) => b.hitMesh === hit.object) ??
        this.buttons.find(
          (b) => b.id === (hit.object.userData.rangeAction as string),
        ) ??
        null
      // Distance gate (ray far already limits, double-check center)
      if (nextHover) {
        const dx = nextHover.position.x - eye.x
        const dy = nextHover.position.y - eye.y
        const dz = nextHover.position.z - eye.z
        if (Math.hypot(dx, dy, dz) > INTERACT_MAX_DIST) nextHover = null
      }
    }

    const hoverChanged = this.hovered !== nextHover
    this.hovered = nextHover

    let consumed = false
    const fireEdge = fire && !this.prevFire
    this.prevFire = fire

    if (fireEdge && this.hovered && this.cooldown <= 0) {
      const action = this.hovered.id
      this.applyAction(action, dummies, respawns)
      this.pressT.set(action, PRESS_FLASH)
      this.cooldown = COOLDOWN
      consumed = true
      gameAudio.uiClick()
      this.paintAllFaces(true)
      if (action === 'reset') {
        forceIdleVisuals?.(dummies)
      }
    }

    if (hoverChanged || consumed || this.pressT.size > 0) {
      this.syncButtonVisuals()
    } else {
      // Still refresh press decay visuals
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
        setDummyBehaviorMode('stationary', dummies)
        break
      case 'mode_moving':
        this.mode = 'moving'
        setDummyBehaviorMode('moving', dummies)
        break
      case 'mode_strafing':
        this.mode = 'strafing'
        setDummyBehaviorMode('strafing', dummies)
        break
      case 'reset':
        // Home + heal + idle; forces stationary so they don't resume walk/strafe
        resetRangeDummies(dummies, respawns)
        this.mode = 'stationary'
        setDummyBehaviorMode('stationary', dummies)
        break
      case 'count': {
        // Move the same squad to the next distance band (do not spawn more)
        this.rows = advanceDummyDistanceRow(dummies, respawns)
        break
      }
    }
    this.mode = getDummyBehaviorMode()
    this.rows = getDummyActiveRows()
  }

  /** True if this radio is the active mode. */
  private isSelected(btn: RangeControlButton): boolean {
    if (btn.kind === 'radio' && btn.mode) return btn.mode === this.mode
    return false
  }

  private faceSubtitle(btn: RangeControlButton): string {
    if (btn.kind === 'stepper') {
      const dist =
        RANGE.rowDist[this.rows] ?? getDummyActiveRowDist()
      return `${dist}m`
    }
    if (btn.kind === 'radio') {
      if (btn.mode === 'stationary') return 'Hold'
      if (btn.mode === 'moving') return 'Free'
      if (btn.mode === 'strafing') return 'Side'
    }
    if (btn.id === 'reset') return 'Home'
    return ''
  }

  private paintAllFaces(force = false) {
    for (const btn of this.buttons) {
      const selected = this.isSelected(btn)
      const sub = this.faceSubtitle(btn)
      const sig = `${btn.title}|${sub}|${selected ? 1 : 0}`
      if (!force && this.faceSig.get(btn.id) === sig) continue
      this.faceSig.set(btn.id, sig)
      setButtonFaceLabel(btn.faceMat, btn.title, sub, {
        accent: accentHex(btn.accent),
        selected,
      })
    }
  }

  /**
   * Shared state machine for every button:
   * pressed > hover > selected > idle
   */
  syncButtonVisuals() {
    for (const btn of this.buttons) {
      const pressed = (this.pressT.get(btn.id) ?? 0) > 0
      const hovered = this.hovered === btn
      const selected = this.isSelected(btn)

      let emissive = 0x000000
      let intensity = 0
      let bodyColor = 0x1a222c

      if (pressed) {
        emissive = 0xffffff
        intensity = 0.95
        bodyColor = 0x2a3848
      } else if (hovered) {
        emissive = btn.accent
        intensity = 0.7
        bodyColor = 0x222c38
      } else if (selected) {
        emissive = btn.accent
        intensity = 0.5
        bodyColor = 0x1e2a34
      } else if (btn.kind === 'stepper') {
        // Always readable — soft accent so it doesn't look "dead"
        emissive = btn.accent
        intensity = 0.18
      }

      btn.bodyMat.color.setHex(bodyColor)
      btn.bodyMat.emissive.setHex(emissive)
      btn.bodyMat.emissiveIntensity = intensity
      btn.bodyMat.needsUpdate = true

      // Face plate follows the same hierarchy (lighter)
      if (pressed) {
        btn.faceMat.emissive.setHex(0xffffff)
        btn.faceMat.emissiveIntensity = 0.35
      } else if (hovered) {
        btn.faceMat.emissive.setHex(btn.accent)
        btn.faceMat.emissiveIntensity = 0.2
      } else if (selected) {
        btn.faceMat.emissive.setHex(btn.accent)
        btn.faceMat.emissiveIntensity = 0.12
      } else {
        btn.faceMat.emissive.setHex(0x000000)
        btn.faceMat.emissiveIntensity = 0
      }
      btn.faceMat.needsUpdate = true

      // Subtle press squash on the body only
      const s = pressed ? 0.94 : hovered ? 1.03 : 1
      btn.mesh.scale.set(s, s, s)
      btn.face.scale.set(s, s, 1)
    }
  }

  /** Call after external mode/row changes. */
  setState(mode: DummyBehaviorMode, rows: DummyActiveRows, dummies?: DummyTarget[]) {
    this.mode = mode
    this.rows = rows
    setDummyBehaviorMode(mode, dummies)
    this.paintAllFaces(true)
    this.syncButtonVisuals()
  }
}
