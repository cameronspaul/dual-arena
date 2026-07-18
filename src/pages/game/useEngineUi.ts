import { useCallback, useEffect, useRef, useState } from 'react'

import type { SettingsSection } from '@/components/SettingsDialog'
import { gameAudio } from '@/game/audio'
import type { GameEngine } from '@/game/engine'
import type { HudSnapshot } from '@/game/types'
import { useAppStore } from '@/stores/useAppStore'

import { hudKey } from './hudKey'

/**
 * Engine mount, HUD snapshot throttling, editor/settings/chat UI state,
 * and camera/dummy toggles for the play view.
 */
export function useEngineUi() {
  const characterAppearance = useAppStore((s) => s.characterAppearance)

  const [hud, setHud] = useState<HudSnapshot | null>(null)
  const [engine, setEngine] = useState<GameEngine | null>(null)
  const [vmEdit, setVmEdit] = useState(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).has('vm-edit')
  })
  const [levelEdit, setLevelEdit] = useState(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).has('level-edit')
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** In-match chat composer — pauses WASD / pointer lock like settings. */
  const [chatOpen, setChatOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<
    SettingsSection | undefined
  >(undefined)
  const [thirdPerson, setThirdPerson] = useState(false)
  const [freeCam, setFreeCam] = useState(false)
  const [dummiesEnabled, setDummiesEnabled] = useState(true)
  const lastKey = useRef('')

  const resetHud = useCallback(() => {
    setHud(null)
    lastKey.current = ''
  }, [])

  const leavePlay = useCallback(() => {
    setEngine(null)
    setHud(null)
    lastKey.current = ''
  }, [])

  const onHud = useCallback((snap: HudSnapshot) => {
    const k = hudKey(snap)
    if (k === lastKey.current) return
    lastKey.current = k
    setHud(snap)
    // Keep free-cam button in sync when death enters / exits cam.
    setFreeCam(snap.spectating)
  }, [])

  const onEngine = useCallback((eng: GameEngine | null) => {
    setEngine(eng)
    if (eng) {
      setThirdPerson(eng.isThirdPerson())
      setFreeCam(eng.isFreeCam())
      setDummiesEnabled(eng.isDummiesEnabled())
    } else {
      setThirdPerson(false)
      setFreeCam(false)
      setDummiesEnabled(true)
    }
  }, [])

  // Release pointer lock / block gameplay while settings or chat are open.
  // Viewmodel editor manages input itself; level editor keeps fly controls unless settings open.
  // Pause menu itself is driven by pointer unlock (Esc) — input stays enabled so Resume can re-lock.
  useEffect(() => {
    if (!engine || vmEdit) return
    engine.setGameplayEnabled(!settingsOpen && !chatOpen)
  }, [engine, settingsOpen, chatOpen, vmEdit])

  /** Resume from Esc pause menu: re-enable input and request pointer lock. */
  const resumePlay = useCallback(() => {
    setChatOpen(false)
    // Settings owns the screen while open — don't steal lock out from under it.
    if (settingsOpen) return
    // force: ensure InputManager accepts the lock even if a panel left it disabled.
    // Must stay synchronous inside the click/keydown stack for user-activation.
    // Menu visibility is owned by GameHud (dismiss on first press even if lock is denied).
    engine?.requestPointerLock({ force: true })
  }, [engine, settingsOpen])

  // Live character colors from settings → third-person body
  useEffect(() => {
    if (!engine) return
    engine.applyPlayerAppearance(characterAppearance)
  }, [engine, characterAppearance])

  // Only one editor at a time
  const openLevelEdit = useCallback(() => {
    setVmEdit(false)
    setLevelEdit(true)
  }, [])
  const openVmEdit = useCallback(() => {
    setLevelEdit(false)
    setVmEdit(true)
  }, [])

  const toggleThirdPerson = useCallback(() => {
    if (!engine) return
    const next = !engine.isThirdPerson()
    engine.setThirdPerson(next)
    setThirdPerson(next)
  }, [engine])

  const toggleFreeCam = useCallback(() => {
    if (!engine) return
    gameAudio.uiClick()
    const next = !engine.isFreeCam()
    engine.setFreeCam(next)
    setFreeCam(engine.isFreeCam())
  }, [engine])

  const toggleDummies = useCallback(() => {
    if (!engine) return
    const next = !engine.isDummiesEnabled()
    engine.setDummiesEnabled(next)
    setDummiesEnabled(next)
  }, [engine])

  const openSettings = useCallback((section?: SettingsSection) => {
    setChatOpen(false)
    setSettingsSection(section)
    setSettingsOpen(true)
  }, [])

  const openChat = useCallback(() => {
    // Drop pointer lock / WASD immediately (don't wait for React effect)
    engine?.setGameplayEnabled(false)
    setChatOpen(true)
  }, [engine])

  return {
    hud,
    engine,
    vmEdit,
    setVmEdit,
    levelEdit,
    setLevelEdit,
    settingsOpen,
    setSettingsOpen,
    chatOpen,
    setChatOpen,
    settingsSection,
    thirdPerson,
    freeCam,
    dummiesEnabled,
    onHud,
    onEngine,
    resetHud,
    leavePlay,
    resumePlay,
    openLevelEdit,
    openVmEdit,
    toggleThirdPerson,
    toggleFreeCam,
    toggleDummies,
    openSettings,
    openChat,
  }
}
