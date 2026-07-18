import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  applyUserSettings,
  cloneKeybinds,
  DEFAULT_KEYBINDS,
  DEFAULT_USER_SETTINGS,
  MAX_BINDS_PER_ACTION,
  normalizeKeybinds,
  normalizeVoiceMode,
  type ActionId,
  type UserSettings,
  type VoiceMode,
} from '@/game/core/userSettings'
import { gameAudio } from '@/game/core/audio'

type SettingsState = UserSettings & {
  setMasterVolume: (v: number) => void
  setSfxVolume: (v: number) => void
  setMuted: (m: boolean) => void
  setMouseSensitivity: (v: number) => void
  setAdsSensitivity: (v: number) => void
  setInvertY: (v: boolean) => void
  setToggleAds: (v: boolean) => void
  setToggleCrouch: (v: boolean) => void
  setToggleSprint: (v: boolean) => void
  setVoiceMode: (mode: VoiceMode) => void
  setVoiceVolume: (v: number) => void
  /** Add a code to an action (multi-bind). Removes it from other actions. */
  addKeybind: (action: ActionId, code: string) => void
  /** Remove one code from an action (keeps at least one bind). */
  removeKeybind: (action: ActionId, code: string) => void
  resetKeybinds: () => void
  resetAll: () => void
}

function snapshot(get: () => SettingsState): UserSettings {
  const s = get()
  return {
    masterVolume: s.masterVolume,
    sfxVolume: s.sfxVolume,
    muted: s.muted,
    mouseSensitivity: s.mouseSensitivity,
    adsSensitivity: s.adsSensitivity,
    invertY: s.invertY,
    toggleAds: s.toggleAds,
    toggleCrouch: s.toggleCrouch,
    toggleSprint: s.toggleSprint,
    voiceMode: s.voiceMode,
    voiceVolume: s.voiceVolume,
    keybinds: cloneKeybinds(s.keybinds),
  }
}

function pushRuntime(partial: Partial<UserSettings>, get: () => SettingsState) {
  const base = snapshot(get)
  const next: UserSettings = {
    ...base,
    ...partial,
    keybinds: partial.keybinds
      ? normalizeKeybinds(partial.keybinds)
      : base.keybinds,
  }
  applyUserSettings(next)
  gameAudio.applyUserAudio(next)
}

function hydrateFromPartial(p: Partial<UserSettings>): UserSettings {
  return {
    masterVolume: p.masterVolume ?? DEFAULT_USER_SETTINGS.masterVolume,
    sfxVolume: p.sfxVolume ?? DEFAULT_USER_SETTINGS.sfxVolume,
    muted: p.muted ?? DEFAULT_USER_SETTINGS.muted,
    mouseSensitivity:
      p.mouseSensitivity ?? DEFAULT_USER_SETTINGS.mouseSensitivity,
    adsSensitivity: p.adsSensitivity ?? DEFAULT_USER_SETTINGS.adsSensitivity,
    invertY: p.invertY ?? DEFAULT_USER_SETTINGS.invertY,
    toggleAds: p.toggleAds ?? DEFAULT_USER_SETTINGS.toggleAds,
    toggleCrouch: p.toggleCrouch ?? DEFAULT_USER_SETTINGS.toggleCrouch,
    toggleSprint: p.toggleSprint ?? DEFAULT_USER_SETTINGS.toggleSprint,
    voiceMode: normalizeVoiceMode(
      p.voiceMode ?? DEFAULT_USER_SETTINGS.voiceMode,
    ),
    voiceVolume: p.voiceVolume ?? DEFAULT_USER_SETTINGS.voiceVolume,
    keybinds: normalizeKeybinds(
      p.keybinds as Partial<Record<ActionId, string | string[]>> | undefined,
    ),
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_USER_SETTINGS,
      keybinds: cloneKeybinds(DEFAULT_KEYBINDS),

      setMasterVolume: (masterVolume) => {
        set({ masterVolume })
        pushRuntime({ masterVolume }, get)
      },
      setSfxVolume: (sfxVolume) => {
        set({ sfxVolume })
        pushRuntime({ sfxVolume }, get)
      },
      setMuted: (muted) => {
        set({ muted })
        pushRuntime({ muted }, get)
      },
      setMouseSensitivity: (mouseSensitivity) => {
        set({ mouseSensitivity })
        pushRuntime({ mouseSensitivity }, get)
      },
      setAdsSensitivity: (adsSensitivity) => {
        set({ adsSensitivity })
        pushRuntime({ adsSensitivity }, get)
      },
      setInvertY: (invertY) => {
        set({ invertY })
        pushRuntime({ invertY }, get)
      },
      setToggleAds: (toggleAds) => {
        set({ toggleAds })
        pushRuntime({ toggleAds }, get)
      },
      setToggleCrouch: (toggleCrouch) => {
        set({ toggleCrouch })
        pushRuntime({ toggleCrouch }, get)
      },
      setToggleSprint: (toggleSprint) => {
        set({ toggleSprint })
        pushRuntime({ toggleSprint }, get)
      },
      setVoiceMode: (voiceMode) => {
        set({ voiceMode })
        pushRuntime({ voiceMode }, get)
      },
      setVoiceVolume: (voiceVolume) => {
        set({ voiceVolume })
        pushRuntime({ voiceVolume }, get)
      },
      addKeybind: (action, code) => {
        const keybinds = cloneKeybinds(get().keybinds)

        // Remove this code from every other action
        for (const id of Object.keys(keybinds) as ActionId[]) {
          if (id === action) continue
          keybinds[id] = keybinds[id].filter((c) => c !== code)
          if (keybinds[id].length === 0) {
            // Don't leave an action empty — restore default primary if stripped
            keybinds[id] = [DEFAULT_KEYBINDS[id][0]]
          }
        }

        const list = keybinds[action]
        if (list.includes(code)) {
          // Already bound — no-op
          set({ keybinds })
          pushRuntime({ keybinds }, get)
          return
        }
        if (list.length >= MAX_BINDS_PER_ACTION) {
          // Replace last slot
          list[list.length - 1] = code
        } else {
          list.push(code)
        }
        keybinds[action] = list
        set({ keybinds })
        pushRuntime({ keybinds }, get)
      },
      removeKeybind: (action, code) => {
        const keybinds = cloneKeybinds(get().keybinds)
        const next = keybinds[action].filter((c) => c !== code)
        // Keep at least one bind
        if (next.length === 0) return
        keybinds[action] = next
        set({ keybinds })
        pushRuntime({ keybinds }, get)
      },
      resetKeybinds: () => {
        const keybinds = cloneKeybinds(DEFAULT_KEYBINDS)
        set({ keybinds })
        pushRuntime({ keybinds }, get)
      },
      resetAll: () => {
        const next: UserSettings = {
          ...DEFAULT_USER_SETTINGS,
          keybinds: cloneKeybinds(DEFAULT_KEYBINDS),
        }
        set(next)
        applyUserSettings(next)
        gameAudio.applyUserAudio(next)
      },
    }),
    {
      name: 'glint-settings',
      version: 4,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<UserSettings>
        return hydrateFromPartial(p)
      },
      partialize: (s) => ({
        masterVolume: s.masterVolume,
        sfxVolume: s.sfxVolume,
        muted: s.muted,
        mouseSensitivity: s.mouseSensitivity,
        adsSensitivity: s.adsSensitivity,
        invertY: s.invertY,
        toggleAds: s.toggleAds,
        toggleCrouch: s.toggleCrouch,
        toggleSprint: s.toggleSprint,
        voiceMode: s.voiceMode,
        voiceVolume: s.voiceVolume,
        keybinds: s.keybinds,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const next = hydrateFromPartial(state)
        // Ensure store itself has normalized arrays + new defaults
        useSettingsStore.setState(next)
        applyUserSettings(next)
        gameAudio.applyUserAudio(next)
      },
    },
  ),
)

/** Call once at app boot so defaults hit the engine even before rehydrate. */
export function bootstrapSettings() {
  const s = useSettingsStore.getState()
  const next = hydrateFromPartial(s)
  applyUserSettings(next)
  gameAudio.applyUserAudio(next)
}
