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
 * Sensitivity / multi-keybinds / hold-vs-toggle come from getUserSettings() (live).
 */
export class InputManager {
  private keys = new Set<string>()
  private jumpPressed = false
  private reloadPressed = false
  private firePressed = false
  /** Mouse ADS hold only (keyboard uses `keys` for hold mode). */
  private adsMouseHeld = false
  /** Latched states when toggle* settings are on. */
  private adsLatched = false
  private crouchLatched = false
  private sprintLatched = false
  private yaw = 0
  private pitch = 0
  private canvas: HTMLElement | null = null
  private adsBlend = 0
  /** When false, gameplay keys/mouse are ignored (UI / settings / viewmodel editor). */
  private gameplayEnabled = true
  private keyboardLocked = false
  /** Notified when pointer lock is acquired or released (for immediate HUD). */
  private onLockChange: ((locked: boolean) => void) | null = null
  /**
   * performance.now() of the last requestPointerLock() call.
   * Collapses doc-capture + button mousedown both firing in the same click
   * (a second request in one gesture is often denied and can cancel the first).
   */
  private lockRequestAt = 0

  private clearLatches() {
    this.adsMouseHeld = false
    this.adsLatched = false
    this.crouchLatched = false
    this.sprintLatched = false
  }

  /** Live pointer-lock status from the document (never a stale cached flag). */
  private liveLocked() {
    return this.canvas != null && document.pointerLockElement === this.canvas
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // Escape: never request pointer lock here. Browsers deny it from Esc, and a
    // failed request used to burn the re-lock debounce so Resume needed two clicks.
    // Menu open/dismiss is owned entirely by React (GameHud / PauseMenu).
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

    const settings = getUserSettings()
    // Toggle modes flip on press edge; hold modes use `keys` in sample().
    if (isBoundTo('ads', e.code) && settings.toggleAds) {
      this.adsLatched = !this.adsLatched
    }
    if (isBoundTo('crouch', e.code) && settings.toggleCrouch) {
      this.crouchLatched = !this.crouchLatched
    }
    if (isBoundTo('sprint', e.code) && settings.toggleSprint) {
      this.sprintLatched = !this.sprintLatched
    }
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  /**
   * Document-level capture so clicks through HUD overlays still re-lock.
   * Skip UI marked `[data-no-pointer-lock]` (pause menu, settings, etc.).
   */
  private onDocMouseDown = (e: MouseEvent) => {
    if (!this.gameplayEnabled || this.liveLocked() || !this.canvas) return
    if (e.button !== 0) return
    const t = e.target
    if (t instanceof Element && t.closest('[data-no-pointer-lock]')) return
    this.tryRequestPointerLock()
  }

  private onMouseDown = (e: MouseEvent) => {
    if (!this.gameplayEnabled) return
    if (!this.liveLocked()) {
      // Canvas click — also covered by onDocMouseDown; keep as fallback.
      this.tryRequestPointerLock()
      return
    }
    const code = mouseButtonCode(e.button)
    if (!code) return
    if (isBoundTo('fire', code)) this.firePressed = true
    if (isBoundTo('ads', code)) {
      if (getUserSettings().toggleAds) {
        this.adsLatched = !this.adsLatched
      } else {
        this.adsMouseHeld = true
      }
    }
    // Mouse crouch / sprint (rare but supported via keybinds)
    if (isBoundTo('crouch', code) && getUserSettings().toggleCrouch) {
      this.crouchLatched = !this.crouchLatched
    }
    if (isBoundTo('sprint', code) && getUserSettings().toggleSprint) {
      this.sprintLatched = !this.sprintLatched
    }
  }

  private onMouseUp = (e: MouseEvent) => {
    const code = mouseButtonCode(e.button)
    if (!code) return
    if (isBoundTo('ads', code) && !getUserSettings().toggleAds) {
      this.adsMouseHeld = false
    }
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.liveLocked()) return
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
    const locked = this.liveLocked()
    if (locked) {
      void this.lockKeyboard()
    } else {
      this.clearLatches()
      this.unlockKeyboard()
    }
    this.onLockChange?.(locked)
  }

  private onPointerLockError = () => {
    this.onLockChange?.(this.liveLocked())
  }

  /** Chromium: claim keys so Ctrl+W isn't handled by the browser while playing. */
  private async lockKeyboard() {
    const kb = getKeyboardLock()
    if (!kb || this.keyboardLocked) return
    try {
      // Only claim tab-close shortcuts — locking *all* keys can interfere with
      // Esc / pointer-lock exit on some Chromium builds.
      await kb.lock([...BROWSER_SHORTCUT_CODES])
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

  /**
   * @param opts.force — re-enable gameplay if needed (pause-menu resume).
   *   Call only from a user-gesture stack (mousedown / click).
   */
  private tryRequestPointerLock(opts?: { force?: boolean }) {
    if (opts?.force) this.gameplayEnabled = true
    if (!this.gameplayEnabled || !this.canvas) return
    if (this.liveLocked()) return

    // One request per gesture. Doc capture + Resume mousedown both fire in the
    // same click; a second requestPointerLock often fails and can cancel the first.
    const now = performance.now()
    if (now - this.lockRequestAt < 120) return
    this.lockRequestAt = now

    const canvas = this.canvas
    try {
      // Focus canvas before lock so keyboard (WASD / Esc) works immediately
      // after lock without needing a second click into the page.
      canvas.focus({ preventScroll: true })
    } catch {
      // ignore
    }
    try {
      // Plain lock only. Do NOT:
      //  - pass { unadjustedMovement: true } then async-fallback on reject
      //  - call requestPointerLock again in a .catch()
      // The browser consumes the user gesture on the first call; an async
      // retry has no activation left → "works on the second click".
      void canvas.requestPointerLock()
    } catch {
      // Older browsers / denied without promise
    }
  }

  attach(canvas: HTMLElement) {
    this.canvas = canvas
    // Ensure the canvas fills its container so clicks always hit it.
    if (canvas instanceof HTMLElement) {
      canvas.style.display = 'block'
      canvas.style.width = '100%'
      canvas.style.height = '100%'
    }
    window.addEventListener('keydown', this.onKeyDown, true)
    window.addEventListener('keyup', this.onKeyUp, true)
    // Capture phase: one click anywhere (through pointer-events-none HUD) re-locks.
    document.addEventListener('mousedown', this.onDocMouseDown, true)
    canvas.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onMouseMove)
    canvas.addEventListener('contextmenu', this.onContextMenu)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    document.addEventListener('pointerlockerror', this.onPointerLockError)
  }

  detach() {
    this.unlockKeyboard()
    window.removeEventListener('keydown', this.onKeyDown, true)
    window.removeEventListener('keyup', this.onKeyUp, true)
    document.removeEventListener('mousedown', this.onDocMouseDown, true)
    this.canvas?.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    this.canvas?.removeEventListener('contextmenu', this.onContextMenu)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    document.removeEventListener('pointerlockerror', this.onPointerLockError)
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock()
    }
    this.canvas = null
    this.onLockChange = null
    this.lockRequestAt = 0
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
      this.clearLatches()
      if (document.pointerLockElement === this.canvas) {
        document.exitPointerLock()
      }
    }
  }

  isGameplayEnabled() {
    return this.gameplayEnabled
  }

  isPointerLocked() {
    return this.liveLocked()
  }

  /** Fired on every pointerlockchange (lock or unlock). */
  setPointerLockChangeListener(fn: ((locked: boolean) => void) | null) {
    this.onLockChange = fn
  }

  /**
   * Request pointer lock on the game canvas (e.g. Resume from pause menu).
   * Must run synchronously inside a user-gesture handler.
   */
  requestPointerLock(opts?: { force?: boolean }) {
    this.tryRequestPointerLock(opts)
  }

  getLook() {
    return { yaw: this.yaw, pitch: this.pitch }
  }

  setLook(yaw: number, pitch: number) {
    this.yaw = yaw
    this.pitch = pitch
  }

  sample(): PlayerInput {
    const settings = getUserSettings()
    const held = (action: Parameters<typeof codesFor>[0]) =>
      codesFor(action).some((c) => this.keys.has(c))

    const locked = this.liveLocked()

    // ADS: hold (keyboard keys + mouse flag) or latched toggle
    const adsRaw = settings.toggleAds
      ? this.adsLatched
      : held('ads') || this.adsMouseHeld
    const ads = locked && adsRaw

    const crouch = settings.toggleCrouch
      ? this.crouchLatched
      : held('crouch')
    const sprint = settings.toggleSprint
      ? this.sprintLatched
      : held('sprint')

    const input: PlayerInput = {
      forward: (held('forward') ? 1 : 0) - (held('back') ? 1 : 0),
      right: (held('right') ? 1 : 0) - (held('left') ? 1 : 0),
      jump: this.jumpPressed,
      jumpHeld: held('jump'),
      crouch,
      sprint,
      yaw: this.yaw,
      pitch: this.pitch,
      ads,
      fire: this.firePressed && locked,
      reload: this.reloadPressed,
    }

    this.jumpPressed = false
    this.reloadPressed = false
    this.firePressed = false

    return input
  }
}
