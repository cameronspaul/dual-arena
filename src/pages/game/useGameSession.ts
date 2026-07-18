import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { gameAudio } from '@/game/audio'
import type { OnlineSessionOpts } from '@/game/engine'
import {
  coerceDuelMapId,
  DEFAULT_MAP_ID,
  isDuelMapId,
  isMapId,
  type MapId,
} from '@/game/maps'
import {
  resolveSkyboxId,
  type SkyboxId,
  type SkyboxPreference,
} from '@/game/scene/skyboxes'
import type { HudSnapshot } from '@/game/types'
import { useAppStore } from '@/stores/useAppStore'

import {
  readInitialMap,
  readInitialSkybox,
  readPickerSkybox,
} from './urlParams'

export type GamePhase = 'pick' | 'play'

/**
 * Map / sky / online session lifecycle: pick → play, host/join/rejoin,
 * wait-room remount, and back-to-picker with rejoin arming.
 */
export function useGameSession(opts: {
  hud: HudSnapshot | null
  onLeavePlay: () => void
  onHudReset: () => void
}) {
  const { hud, onLeavePlay, onHudReset } = opts
  const [searchParams, setSearchParams] = useSearchParams()

  const serverUrl = useAppStore((s) => s.serverUrl)
  const matchIdStore = useAppStore((s) => s.matchId)
  const setMatchIdStore = useAppStore((s) => s.setMatchId)
  const username = useAppStore((s) => s.username)
  const playerToken = useAppStore((s) => s.playerToken)
  const wagerAmount = useAppStore((s) => s.wagerAmount)
  const setRejoinSession = useAppStore((s) => s.setRejoinSession)
  const armRejoinWindow = useAppStore((s) => s.armRejoinWindow)
  const clearRejoinSession = useAppStore((s) => s.clearRejoinSession)

  const [phase, setPhase] = useState<GamePhase>(() =>
    searchParams.get('map') && isMapId(searchParams.get('map')!)
      ? 'play'
      : 'pick',
  )
  const [mapId, setMapId] = useState<MapId>(() => readInitialMap(searchParams))
  /** Preference shown on map select (may be random). */
  const [skyboxPref, setSkyboxPref] = useState<SkyboxPreference>(() =>
    readPickerSkybox(searchParams),
  )
  /** Concrete sky locked for the active play session. */
  const [sessionSkybox, setSessionSkybox] = useState<SkyboxId>(() =>
    readInitialSkybox(searchParams),
  )
  /** When set, GameCanvas starts an online session. */
  const [onlineSession, setOnlineSession] = useState<OnlineSessionOpts | null>(
    () => {
      const online = searchParams.get('online')
      const mid = searchParams.get('match')
      const url = searchParams.get('server')
      if (online === '1' && mid) {
        return {
          serverUrl: url || 'ws://localhost:2567',
          matchId: mid,
        }
      }
      return null
    },
  )
  /**
   * Guided how-to-play on the practice range.
   * URL `tutorial=1` or MainMenu "Tutorial" starts it offline.
   */
  const [tutorialOpen, setTutorialOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('tutorial') === '1'
  })

  const startPlay = useCallback(
    (
      id: MapId,
      pref: SkyboxPreference,
      online?: OnlineSessionOpts | null,
      playOpts?: { tutorial?: boolean },
    ) => {
      // Resolve random once so all clients with the same URL share one sky.
      const sky = resolveSkyboxId(pref)
      const tutorial = Boolean(playOpts?.tutorial) && !online
      setMapId(id)
      setSkyboxPref(pref === 'random' ? sky : pref)
      setSessionSkybox(sky)
      setOnlineSession(online ?? null)
      setTutorialOpen(tutorial)
      setPhase('play')
      onHudReset()
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('map', id)
          next.set('sky', sky)
          if (online) {
            next.set('online', '1')
            next.set('match', online.matchId)
            next.set('server', online.serverUrl)
            next.delete('tutorial')
          } else {
            next.delete('online')
            next.delete('match')
            next.delete('server')
            if (tutorial) next.set('tutorial', '1')
            else next.delete('tutorial')
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams, onHudReset],
  )

  /** Offline guided course on the practice range. */
  const startTutorial = useCallback(() => {
    startPlay('range', skyboxPref, null, { tutorial: true })
  }, [startPlay, skyboxPref])

  /** Persist seat credentials; homepage CTA stays hidden until armRejoinWindow. */
  const rememberRejoin = useCallback(
    (session: OnlineSessionOpts, playMap: MapId) => {
      const token = session.token?.trim() || playerToken
      const prev = useAppStore.getState().rejoinSession
      // Keep leaveCount when rejoining the same match; reset for a new room
      const sameMatch =
        prev &&
        prev.matchId === session.matchId &&
        prev.serverUrl === session.serverUrl
      setRejoinSession({
        matchId: session.matchId,
        serverUrl: session.serverUrl,
        token,
        mapId: playMap,
        expiresAt: null,
        leaveCount: sameMatch ? prev.leaveCount : 0,
      })
    },
    [playerToken, setRejoinSession],
  )

  /** Host: mint a fresh room code and open a joinable lobby. */
  const startHostOnline = useCallback(() => {
    // Practice range is training-only — never a 1v1 arena
    if (!isDuelMapId(mapId)) return
    const duelMap = coerceDuelMapId(mapId)
    const code = `duel-${Math.random().toString(36).slice(2, 8)}`
    setMatchIdStore(code)
    const session: OnlineSessionOpts = {
      serverUrl: serverUrl.trim() || 'ws://localhost:2567',
      matchId: code,
      token: playerToken,
      hostName: username.trim() || 'Host',
      wager: wagerAmount,
      mapId: duelMap,
      waitOnRange: true,
      createdAt: Date.now(),
    }
    rememberRejoin(session, duelMap)
    // Hang on the practice range until an opponent joins, then remount onto duelMap
    startPlay('range', skyboxPref, session)
  }, [
    serverUrl,
    username,
    playerToken,
    wagerAmount,
    mapId,
    skyboxPref,
    startPlay,
    setMatchIdStore,
    rememberRejoin,
  ])

  /** Join: use listed lobby (or manual code) — map comes from host when known. */
  const startJoinOnline = useCallback(
    (lobby: { matchId: string; mapId?: MapId; wager?: number }) => {
      const mid = lobby.matchId.trim() || matchIdStore.trim() || 'duel-1'
      setMatchIdStore(mid)
      // Never load practice range as a 1v1 arena
      const playMap = coerceDuelMapId(
        lobby.mapId && isMapId(lobby.mapId) ? lobby.mapId : mapId,
      )
      const session: OnlineSessionOpts = {
        serverUrl: serverUrl.trim() || 'ws://localhost:2567',
        matchId: mid,
        token: playerToken,
        mapId: playMap,
        wager:
          typeof lobby.wager === 'number' && Number.isFinite(lobby.wager)
            ? Math.max(0, lobby.wager)
            : undefined,
        createdAt: Date.now(),
      }
      rememberRejoin(session, playMap)
      startPlay(playMap, skyboxPref, session)
    },
    [
      serverUrl,
      matchIdStore,
      playerToken,
      mapId,
      skyboxPref,
      startPlay,
      setMatchIdStore,
      rememberRejoin,
    ],
  )

  /** Homepage one-click rejoin after disconnect / leave mid-match. */
  const startRejoinOnline = useCallback(() => {
    const session = useAppStore.getState().rejoinSession
    const exp = session?.expiresAt
    if (!session || exp == null || exp <= Date.now()) {
      clearRejoinSession()
      return
    }
    const playMap = coerceDuelMapId(session.mapId)
    setMatchIdStore(session.matchId)
    const online: OnlineSessionOpts = {
      serverUrl: session.serverUrl,
      matchId: session.matchId,
      token: session.token || playerToken,
      mapId: playMap,
    }
    // Stay on the armed CTA while reconnecting; clear on match end
    setRejoinSession({
      ...session,
      expiresAt: session.expiresAt,
    })
    startPlay(playMap, skyboxPref, online)
  }, [
    playerToken,
    skyboxPref,
    startPlay,
    setMatchIdStore,
    setRejoinSession,
    clearRejoinSession,
  ])

  const backToPicker = useCallback(() => {
    gameAudio.uiClick()
    // Competitive phases keep the seat on the server for 60s rejoin
    const matchPhase = hud?.matchPhase
    const midMatch =
      Boolean(onlineSession) &&
      !hud?.matchEndReason &&
      (matchPhase === 'countdown' ||
        matchPhase === 'live' ||
        matchPhase === 'round_reset' ||
        matchPhase === 'rejoin')
    if (midMatch) {
      armRejoinWindow()
    } else {
      clearRejoinSession()
    }
    // Picker never holds practice range — restore duel map or default arena
    if (onlineSession?.mapId && isDuelMapId(onlineSession.mapId)) {
      setMapId(onlineSession.mapId)
    } else if (!isDuelMapId(mapId)) {
      setMapId(DEFAULT_MAP_ID)
    }
    setPhase('pick')
    onLeavePlay()
    setOnlineSession(null)
    setTutorialOpen(false)
    // Keep last concrete sky selected in the picker (not random)
    setSkyboxPref(sessionSkybox)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('map')
        next.delete('online')
        next.delete('match')
        next.delete('server')
        next.delete('tutorial')
        // Leave sky so re-enter can reuse the same sky if desired
        if (sessionSkybox) next.set('sky', sessionSkybox)
        return next
      },
      { replace: true },
    )
  }, [
    setSearchParams,
    sessionSkybox,
    onlineSession,
    hud?.matchEndReason,
    hud?.matchPhase,
    armRejoinWindow,
    clearRejoinSession,
    mapId,
    onLeavePlay,
  ])

  const openHelp = useCallback(() => {
    setTutorialOpen(true)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('tutorial', '1')
        return next
      },
      { replace: true },
    )
  }, [setSearchParams])

  const closeTutorial = useCallback(() => {
    setTutorialOpen(false)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('tutorial')
        return next
      },
      { replace: true },
    )
  }, [setSearchParams])

  // Drop rejoin CTA once the match fully ends while still in play view
  useEffect(() => {
    if (hud?.matchEndReason) clearRejoinSession()
  }, [hud?.matchEndReason, clearRejoinSession])

  /**
   * Host wait room: after an opponent joins, remount from practice range onto
   * the duel map. Server keeps the pregame seat for a short reconnect grace.
   */
  useEffect(() => {
    if (!onlineSession?.waitOnRange) return
    if (!onlineSession.mapId || !isDuelMapId(onlineSession.mapId)) return
    if (mapId !== 'range') return
    // Still alone in lobby
    if (!hud || hud.matchWaiting || hud.matchPhase === 'waiting') return
    if (hud.matchPhase == null) return

    const duelMap = onlineSession.mapId
    const nextSession: OnlineSessionOpts = {
      ...onlineSession,
      waitOnRange: false,
    }
    setOnlineSession(nextSession)
    setMapId(duelMap)
    onHudReset()
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('map', duelMap)
        return next
      },
      { replace: true },
    )
  }, [
    onlineSession,
    mapId,
    hud?.matchWaiting,
    hud?.matchPhase,
    setSearchParams,
    onHudReset,
  ])

  // Tab close / refresh mid-match: arm the next leave's rejoin window
  useEffect(() => {
    if (!onlineSession) return
    const onPageHide = () => {
      if (!useAppStore.getState().rejoinSession) return
      armRejoinWindow()
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [onlineSession, armRejoinWindow])

  return {
    phase,
    mapId,
    setMapId,
    skyboxPref,
    setSkyboxPref,
    sessionSkybox,
    onlineSession,
    tutorialOpen,
    username,
    startPlay,
    startTutorial,
    startHostOnline,
    startJoinOnline,
    startRejoinOnline,
    backToPicker,
    openHelp,
    closeTutorial,
  }
}
