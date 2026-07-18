import { useEffect, useState } from 'react'

import { gameAudio } from '@/game/audio'
import type { GameEngine } from '@/game/engine'
import type { OnlineSessionOpts } from '@/game/engine'
import type { HudSnapshot } from '@/game/types'

import { isLocalhostHost } from './isLocalhost'
import type { GamePhase } from './useGameSession'

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  const tag = t.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    t.isContentEditable
  )
}

/**
 * Page-level play hotkeys: Enter chat, Y ready / draw, N decline draw, L admin.
 * Capture-phase listeners beat the game InputManager.
 */
export function useGameHotkeys(opts: {
  phase: GamePhase
  onlineSession: OnlineSessionOpts | null
  engine: GameEngine | null
  hud: HudSnapshot | null
  settingsOpen: boolean
  chatOpen: boolean
  setChatOpen: (open: boolean) => void
  openChat: () => void
  vmEdit: boolean
  levelEdit: boolean
}) {
  const {
    phase,
    onlineSession,
    engine,
    hud,
    settingsOpen,
    chatOpen,
    setChatOpen,
    openChat,
    vmEdit,
    levelEdit,
  } = opts

  /** Bottom-left admin strip — localhost only, toggled with L. */
  const [adminOpen, setAdminOpen] = useState(false)
  const isLocalhost = isLocalhostHost()

  // Leave chat when leaving online match / map select
  useEffect(() => {
    if (!onlineSession) setChatOpen(false)
  }, [onlineSession, setChatOpen])

  // In-match chat + pregame ready hotkeys (page-level so they work even before HUD mounts fully).
  // Enter always opens chat; Y ready-toggles in pregame. Esc closes chat.
  useEffect(() => {
    if (!onlineSession || phase !== 'play' || settingsOpen || vmEdit || levelEdit) {
      return
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return

      if (chatOpen) {
        if (e.code === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          setChatOpen(false)
        }
        return
      }

      if (isTypingTarget(e.target)) return

      // Pending opponent draw offer: Y accept / N decline (works in-game + Esc menu)
      const localId = engine?.getLocalPlayerId() ?? null
      const drawFromOpponent =
        Boolean(hud?.pendingDrawFromId) &&
        Boolean(localId) &&
        hud!.pendingDrawFromId !== localId &&
        !hud?.matchEndReason
      if (drawFromOpponent && (e.code === 'KeyY' || e.code === 'KeyN')) {
        e.preventDefault()
        e.stopPropagation()
        if (e.code === 'KeyY') {
          if (engine?.acceptDraw()) gameAudio.uiConfirm()
        } else if (engine?.declineDraw()) {
          gameAudio.uiClick()
        }
        return
      }

      // Pregame: Y = ready / unready (same as the Ready up button)
      const inPregame = hud?.matchPhase === 'pregame' && !hud.matchWaiting
      if (inPregame && e.code === 'KeyY') {
        e.preventDefault()
        e.stopPropagation()
        if (engine?.toggleReady()) gameAudio.uiConfirm()
        return
      }

      // Enter always opens chat
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault()
        e.stopPropagation()
        openChat()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    onlineSession,
    phase,
    settingsOpen,
    chatOpen,
    setChatOpen,
    openChat,
    vmEdit,
    levelEdit,
    engine,
    hud?.matchPhase,
    hud?.matchWaiting,
    hud?.pendingDrawFromId,
    hud?.matchEndReason,
  ])

  // Admin tools: L toggles the bottom-left strip (localhost + play only).
  useEffect(() => {
    if (!isLocalhost || phase !== 'play') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      if (e.code !== 'KeyL') return
      e.preventDefault()
      setAdminOpen((v) => !v)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isLocalhost, phase])

  // Leaving play or non-local: hide admin strip.
  useEffect(() => {
    if (phase !== 'play' || !isLocalhost) setAdminOpen(false)
  }, [phase, isLocalhost])

  return { adminOpen, isLocalhost }
}
