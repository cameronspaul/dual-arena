/**
 * Runtime user settings consumed by the game engine (input, audio).
 * React/Zustand owns persistence; this module is the live read surface.
 */

export type ActionId =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'crouch'
  | 'sprint'
  | 'reload'
  | 'fire'
  | 'ads'
  | 'voice'

/** In-match mic transmit mode. */
export type VoiceMode = 'push_to_talk' | 'open_mic' | 'off'

/** One or more keyboard/mouse codes bound to an action. */
export type Keybinds = Record<ActionId, string[]>

export interface UserSettings {
  /** Master volume 0–1 */
  masterVolume: number
  /** SFX bus 0–1 */
  sfxVolume: number
  muted: boolean
  /**
   * Multiplier on LOOK.hipSensitivity (1 = default feel).
   * UI often shows this as 1–100 or 0.1–3×.
   */
  mouseSensitivity: number
  /** Multiplier on LOOK.adsSensitivity */
  adsSensitivity: number
  invertY: boolean
  /**
   * When true, ADS press toggles aim on/off.
   * When false (default), hold to aim.
   */
  toggleAds: boolean
  /**
   * When true, crouch press toggles crouch on/off.
   * When false (default), hold to crouch.
   * Sprint always clears a latched crouch (stand up to run).
   */
  toggleCrouch: boolean
  /**
   * When true, sprint toggles while moving and auto-clears when you stop.
   * When false (default), hold to sprint.
   * Only engages if a movement key is already held; stop moving ends it.
   */
  toggleSprint: boolean
  /**
   * In-match voice chat mode.
   * - push_to_talk: hold voice key / Speak button to transmit
   * - open_mic: always transmit when in match
   * - off: full disable — no send, no hear
   */
  voiceMode: VoiceMode
  /** Remote voice chat level 0–1 (independent of SFX). */
  voiceVolume: number
  keybinds: Keybinds
}

export const MAX_BINDS_PER_ACTION = 4

/** Actions shown in the keybind list (order). Declared before clone helpers. */
export const ACTION_ORDER: ActionId[] = [
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'crouch',
  'sprint',
  'reload',
  'fire',
  'ads',
  'voice',
]

export const ACTION_LABELS: Record<ActionId, string> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Move left',
  right: 'Move right',
  jump: 'Jump',
  crouch: 'Crouch / slide',
  sprint: 'Sprint',
  reload: 'Reload',
  fire: 'Fire',
  ads: 'Aim down sights',
  voice: 'Push to talk',
}

export const DEFAULT_KEYBINDS: Keybinds = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'ControlRight', 'KeyC'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  reload: ['KeyR'],
  fire: ['MouseLeft'],
  ads: ['MouseRight'],
  voice: ['KeyV'],
}

export const VOICE_MODE_OPTIONS: {
  id: VoiceMode
  label: string
  description: string
}[] = [
  {
    id: 'push_to_talk',
    label: 'Push to talk',
    description: 'Hold the voice key or Speak button to transmit',
  },
  {
    id: 'open_mic',
    label: 'Always open',
    description: 'Mic stays on while you are in a match',
  },
  {
    id: 'off',
    label: 'Voice off',
    description: 'No voice chat — you neither send nor hear',
  },
]

export function normalizeVoiceMode(v: unknown): VoiceMode {
  if (v === 'open_mic' || v === 'off' || v === 'push_to_talk') return v
  return 'push_to_talk'
}

export function cloneKeybinds(src: Keybinds): Keybinds {
  const out = {} as Keybinds
  for (const id of ACTION_ORDER) {
    out[id] = [...(src[id] ?? DEFAULT_KEYBINDS[id])]
  }
  return out
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  masterVolume: 1,
  sfxVolume: 1,
  muted: false,
  mouseSensitivity: 1,
  adsSensitivity: 1,
  invertY: false,
  toggleAds: false,
  toggleCrouch: false,
  toggleSprint: false,
  voiceMode: 'push_to_talk',
  voiceVolume: 1,
  keybinds: cloneKeybinds(DEFAULT_KEYBINDS),
}

/** Live copy — mutated via applyUserSettings from the store. */
let live: UserSettings = {
  ...DEFAULT_USER_SETTINGS,
  keybinds: cloneKeybinds(DEFAULT_KEYBINDS),
}

export function getUserSettings(): Readonly<UserSettings> {
  return live
}

export function applyUserSettings(next: UserSettings) {
  live = {
    masterVolume: clamp01(next.masterVolume),
    sfxVolume: clamp01(next.sfxVolume),
    muted: Boolean(next.muted),
    mouseSensitivity: clamp(next.mouseSensitivity, 0.05, 5),
    adsSensitivity: clamp(next.adsSensitivity, 0.05, 5),
    invertY: Boolean(next.invertY),
    toggleAds: Boolean(next.toggleAds),
    toggleCrouch: Boolean(next.toggleCrouch),
    toggleSprint: Boolean(next.toggleSprint),
    voiceMode: normalizeVoiceMode(next.voiceMode),
    voiceVolume: clamp01(next.voiceVolume),
    keybinds: normalizeKeybinds(next.keybinds),
  }
}

/**
 * Coerce persisted / partial keybinds into string[] per action.
 * Accepts legacy single-string values from settings v1.
 */
export function normalizeKeybinds(
  partial?: Partial<Record<ActionId, string | string[]>> | null,
): Keybinds {
  const out = cloneKeybinds(DEFAULT_KEYBINDS)
  if (!partial) return out
  for (const id of ACTION_ORDER) {
    const raw = partial[id]
    if (raw == null) continue
    const list = (Array.isArray(raw) ? raw : [raw])
      .filter((c): c is string => typeof c === 'string' && c.length > 0)
    // Dedupe while preserving order
    const seen = new Set<string>()
    const unique: string[] = []
    for (const c of list) {
      if (seen.has(c)) continue
      seen.add(c)
      unique.push(c)
      if (unique.length >= MAX_BINDS_PER_ACTION) break
    }
    if (unique.length > 0) out[id] = unique
  }
  return out
}

export function codesFor(action: ActionId, binds = live.keybinds): string[] {
  return binds[action] ?? DEFAULT_KEYBINDS[action]
}

export function isBoundTo(
  action: ActionId,
  code: string,
  binds = live.keybinds,
): boolean {
  return codesFor(action, binds).includes(code)
}

export function anyBoundHeld(
  action: ActionId,
  held: Set<string>,
  binds = live.keybinds,
): boolean {
  return codesFor(action, binds).some((c) => held.has(c))
}

/** All codes currently assigned to any action (for preventDefault). */
export function allBoundCodes(binds = live.keybinds): Set<string> {
  const set = new Set<string>()
  for (const id of ACTION_ORDER) {
    for (const c of codesFor(id, binds)) set.add(c)
  }
  return set
}

export function effectiveVolume(clipVolume: number): number {
  if (live.muted) return 0
  return clamp01(clipVolume * live.masterVolume * live.sfxVolume)
}

/** Human-readable key / mouse label for UI. */
export function formatKeyCode(code: string): string {
  if (code.startsWith('Mouse')) {
    const map: Record<string, string> = {
      MouseLeft: 'LMB',
      MouseRight: 'RMB',
      MouseMiddle: 'MMB',
      MouseBack: 'Mouse 4',
      MouseForward: 'Mouse 5',
    }
    return map[code] ?? code
  }
  if (code.startsWith('Key') && code.length === 4) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  const names: Record<string, string> = {
    Space: 'Space',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    AltLeft: 'L-Alt',
    AltRight: 'R-Alt',
    MetaLeft: 'L-Meta',
    MetaRight: 'R-Meta',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
    Tab: 'Tab',
    CapsLock: 'Caps',
    Enter: 'Enter',
    Backspace: 'Backspace',
  }
  if (names[code]) return names[code]
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
  return code
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

/** Map MouseEvent.button → synthetic code used in keybinds. */
export function mouseButtonCode(button: number): string | null {
  switch (button) {
    case 0:
      return 'MouseLeft'
    case 1:
      return 'MouseMiddle'
    case 2:
      return 'MouseRight'
    case 3:
      return 'MouseBack'
    case 4:
      return 'MouseForward'
    default:
      return null
  }
}
