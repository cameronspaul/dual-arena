import { LOOK, MOVE } from './config'
import { clampPitch } from './math'
import type { PlayerInput } from './types'
import {
  allBoundCodes,
  codesFor,
  getUserSettings,
  isBoundTo,
  mouseButtonCode,
} from './userSettings'

/**
 * Ctrl/Cmd + these close tabs, open new ones, etc.
 * Crouch (Ctrl) + forward (W) is the classic "close the game" bug.
 */
const BROWSER_SHORTCUT_CODES = new Set([
  'KeyW', // close tab
  'KeyT', // new / reopen tab
  'KeyN', // new window
  'KeyR', // reload
  'KeyQ', // quit (some browsers / macOS)
])

/** Keys we always suppress while the game owns input (scroll / browser actions). */
const ALWAYS_PREVENT = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])

type KeyboardLockAPI = {
  lock: (keyCodes?: string[]) => Promise<void>
  unlock: () => void
}

function getKeyboardLock(): KeyboardLockAPI | null {
  const kb = (navigator as Navigator & { keyboard?: KeyboardLockAPI }).keyboard
  if (!kb || typeof kb.lock !== 'function' || typeof kb.unlock !== 'function') {
    return null
  }
  return kb
}

/**
 * Browser input: keyboard + pointer lock mouse.
 * Produces a fresh PlayerInput each frame via sample().
 * Sensitivity / multi-keybinds come from getUserSettings() (live).
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
  /** When false, gameplay keys/mouse are ignored (UI / settings / viewmodel editor). */
  private gameplayEnabled = true
  private keyboardLocked = false

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Escape') return

    // Always block tab-close / navigation combos while input is attached.
    // Ctrl is crouch; Ctrl+W would otherwise close the browser tab.
    if ((e.ctrlKey || e.metaKey) && BROWSER_SHORTCUT_CODES.has(e.code)) {
      e.preventDefault()
    }

    if (!this.gameplayEnabled) return

    const boundCodes = allBoundCodes()
    if (ALWAYS_PREVENT.has(e.code) || boundCodes.has(e.code)) {
      e.preventDefault()
    }

    // Ignore auto-repeat for edge-triggered actions
    if (e.repeat) {
      this.keys.add(e.code)
      return
    }

    this.keys.add(e.code)
    if (isBoundTo('jump', e.code)) this.jumpPressed = true
    if (isBoundTo('reload', e.code)) this.reloadPressed = true
    if (isBoundTo('fire', e.code)) this.firePressed = true
    if (isBoundTo('ads', e.code)) this.adsHeld = true
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
    const code = mouseButtonCode(e.button)
    if (!code) return
    if (isBoundTo('fire', code)) this.firePressed = true
    if (isBoundTo('ads', code)) this.adsHeld = true
  }

  private onMouseUp = (e: MouseEvent) => {
    const code = mouseButtonCode(e.button)
    if (!code) return
    if (isBoundTo('ads', code)) {
      // Clear mouse ADS only if no other mouse ADS button is down (single button typical)
      this.adsHeld = false
    }
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked) return
    const settings = getUserSettings()
    const hip = LOOK.hipSensitivity * settings.mouseSensitivity
    const ads = LOOK.adsSensitivity * settings.adsSensitivity
    const s = hip * (1 - this.adsBlend) + ads * this.adsBlend
    this.yaw -= e.movementX * s
    // Default: move mouse up → look up (negative pitch in engine convention).
    const ySign = settings.invertY ? 1 : -1
    this.pitch += e.movementY * s * ySign
    this.pitch = clampPitch(this.pitch, MOVE.maxPitch)
  }

  private onContextMenu = (e: Event) => {
    e.preventDefault()
  }

  private onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas
    if (this.pointerLocked) {
      void this.lockKeyboard()
    } else {
      this.adsHeld = false
      this.unlockKeyboard()
    }
  }

  /** Chromium: claim keys so Ctrl+W isn't handled by the browser while playing. */
  private async lockKeyboard() {
    const kb = getKeyboardLock()
    if (!kb || this.keyboardLocked) return
    try {
      await kb.lock()
      this.keyboardLocked = true
    } catch {
      this.keyboardLocked = false
    }
  }

  private unlockKeyboard() {
    if (!this.keyboardLocked) return
    const kb = getKeyboardLock()
    try {
      kb?.unlock()
    } catch {
      // ignore
    }
    this.keyboardLocked = false
  }

  attach(canvas: HTMLElement) {
    this.canvas = canvas
    window.addEventListener('keydown', this.onKeyDown, true)
    window.addEventListener('keyup', this.onKeyUp, true)
    canvas.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onMouseMove)
    canvas.addEventListener('contextmenu', this.onContextMenu)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
  }

  detach() {
    this.unlockKeyboard()
    window.removeEventListener('keydown', this.onKeyDown, true)
    window.removeEventListener('keyup', this.onKeyUp, true)
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
   * Disable WASD / fire / pointer-lock while a panel (settings, viewmodel editor) is open.
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
    const held = (action: Parameters<typeof codesFor>[0]) =>
      codesFor(action).some((c) => this.keys.has(c))

    // ADS: any keyboard ADS bind held, or mouse ADS hold flag
    const adsKeyboard = held('ads')
    const ads =
      this.pointerLocked && (adsKeyboard || this.adsHeld)

    const input: PlayerInput = {
      forward: (held('forward') ? 1 : 0) - (held('back') ? 1 : 0),
      right: (held('right') ? 1 : 0) - (held('left') ? 1 : 0),
      jump: this.jumpPressed,
      crouch: held('crouch'),
      sprint: held('sprint'),
      yaw: this.yaw,
      pitch: this.pitch,
      ads,
      fire: this.firePressed && this.pointerLocked,
      reload: this.reloadPressed,
    }

    this.jumpPressed = false
    this.reloadPressed = false
    this.firePressed = false

    return input
  }
}
