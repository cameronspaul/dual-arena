import { LOOK, MOVE } from './config'
import { clampPitch } from './math'
import type { PlayerInput } from './types'

/**
 * Browser input: keyboard + pointer lock mouse.
 * Produces a fresh PlayerInput each frame via sample().
 */
export class InputManager {
  private keys = new Set<string>()
  private jumpPressed = false
  private reloadPressed = false
  private firePressed = false
  private adsHeld = false
  private yaw = 0
  private pitch = 0
  private pointerLocked = false
  private canvas: HTMLElement | null = null
  private adsBlend = 0
  /** When false, gameplay keys/mouse are ignored (UI / viewmodel editor). */
  private gameplayEnabled = true

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Escape') return
    if (!this.gameplayEnabled) return
    // prevent scroll / browser shortcuts while playing
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
      e.preventDefault()
    }
    this.keys.add(e.code)
    if (e.code === 'Space') this.jumpPressed = true
    if (e.code === 'KeyR') this.reloadPressed = true
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private onMouseDown = (e: MouseEvent) => {
    if (!this.gameplayEnabled) return
    if (!this.pointerLocked && this.canvas) {
      void this.canvas.requestPointerLock()
      return
    }
    if (e.button === 0) this.firePressed = true
    if (e.button === 2) this.adsHeld = true
  }

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 2) this.adsHeld = false
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked) return
    const sens =
      this.adsBlend > 0.5 ? LOOK.adsSensitivity : LOOK.hipSensitivity
    // blend sens smoothly
    const s =
      LOOK.hipSensitivity * (1 - this.adsBlend) +
      LOOK.adsSensitivity * this.adsBlend
    void sens
    this.yaw -= e.movementX * s
    this.pitch -= e.movementY * s
    this.pitch = clampPitch(this.pitch, MOVE.maxPitch)
  }

  private onContextMenu = (e: Event) => {
    e.preventDefault()
  }

  private onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas
    if (!this.pointerLocked) {
      this.adsHeld = false
    }
  }

  attach(canvas: HTMLElement) {
    this.canvas = canvas
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    canvas.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onMouseMove)
    canvas.addEventListener('contextmenu', this.onContextMenu)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.canvas?.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    this.canvas?.removeEventListener('contextmenu', this.onContextMenu)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock()
    }
    this.canvas = null
  }

  setAdsBlend(blend: number) {
    this.adsBlend = blend
  }

  /**
   * Disable WASD / fire / pointer-lock while a panel (e.g. viewmodel editor) is open.
   * Releases pointer lock when turning off.
   */
  setGameplayEnabled(enabled: boolean) {
    this.gameplayEnabled = enabled
    if (!enabled) {
      this.keys.clear()
      this.jumpPressed = false
      this.reloadPressed = false
      this.firePressed = false
      this.adsHeld = false
      if (document.pointerLockElement === this.canvas) {
        document.exitPointerLock()
      }
    }
  }

  isGameplayEnabled() {
    return this.gameplayEnabled
  }

  isPointerLocked() {
    return this.pointerLocked
  }

  getLook() {
    return { yaw: this.yaw, pitch: this.pitch }
  }

  setLook(yaw: number, pitch: number) {
    this.yaw = yaw
    this.pitch = pitch
  }

  sample(): PlayerInput {
    const forward =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0)
    const right =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0)

    const input: PlayerInput = {
      forward,
      right,
      jump: this.jumpPressed,
      crouch:
        this.keys.has('ControlLeft') ||
        this.keys.has('ControlRight') ||
        this.keys.has('KeyC'),
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      yaw: this.yaw,
      pitch: this.pitch,
      ads: this.adsHeld && this.pointerLocked,
      // bolt-action: one shot per click (edge), not hold-to-spray
      fire: this.firePressed && this.pointerLocked,
      reload: this.reloadPressed,
    }

    // edge-triggered
    this.jumpPressed = false
    this.reloadPressed = false
    this.firePressed = false

    return input
  }
}
