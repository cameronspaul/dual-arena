import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { GameCanvas } from '@/components/game/GameCanvas'
import { GameHud, HITMARKER_DURATION } from '@/components/game/GameHud'
import { LevelEditor } from '@/components/game/LevelEditor'
import { MapPicker } from '@/components/game/MapPicker'
import { TutorialOverlay } from '@/components/game/TutorialOverlay'
import { ViewmodelEditor } from '@/components/game/ViewmodelEditor'
import {
  SettingsDialog,
  type SettingsSection,
} from '@/components/SettingsDialog'
import type { GameEngine } from '@/game/engine'
import {
  coerceDuelMapId,
  DEFAULT_MAP_ID,
  getMap,
  isDuelMapId,
  isMapId,
  type MapId,
} from '@/game/maps'
import {
  isSkyboxId,
  isSkyboxPreference,
  resolveSkyboxId,
  SKYBOX_LABELS,
  type SkyboxId,
  type SkyboxPreference,
} from '@/game/scene/skyboxes'
import type { HudSnapshot } from '@/game/types'
import { gameAudio } from '@/game/audio'
import type { OnlineSessionOpts } from '@/game/engine'
import { useAppStore } from '@/stores/useAppStore'
import { icons } from '@/lib/icons'

function hudKey(s: HudSnapshot): string {
  return [
    s.ammo,
    s.phase,
    // Reload line progress (~20 ticks over full mag change)
    Math.round(s.phaseTimer * 10),
    s.ads ? 1 : 0,
    Math.round(s.adsBlend * 10),
    // Scoped reload reticle jiggle (~px-level updates while mag changing)
    Math.round(s.reloadJiggleX * 40),
    Math.round(s.reloadJiggleY * 40),
    // Quantize so the dynamic reticle updates as the cone opens/closes
    Math.round(s.aimSpread * 400),
    s.moveState,
    Math.round(s.speed * 2),
    s.sprintHeld ? 1 : 0,
    s.crouchHeld ? 1 : 0,
    s.moving ? 1 : 0,
    s.pointerLocked ? 1 : 0,
    s.kills,
    // Serial id so consecutive same-zone hits still re-render the hitmarker
    s.lastHitId,
    s.lastHitAge < HITMARKER_DURATION ? 1 : 0,
    s.hp,
    s.alive ? 1 : 0,
    s.spectating ? 1 : 0,
    // Whole-second ticks for death countdown UI
    Math.ceil(s.respawnIn),
    s.deathReason ?? '',
    s.fps,
    s.ping ?? -1,
    s.matchTimeLeft != null ? Math.ceil(s.matchTimeLeft) : '',
    s.matchWinnerId ?? '',
    s.matchEndReason ?? '',
    s.matchWaiting ? 1 : 0,
    s.matchPhase ?? '',
    Math.ceil(s.matchPhaseTimer ?? 0),
    s.matchFirstTo ?? 0,
    s.localReady ? 1 : 0,
    s.enemyReady ? 1 : 0,
    s.enemyKills ?? 0,
    s.teamColor ?? '',
    // Throttle perf panel: ~4 Hz on timings, integer draw/col counts
    s.perf
      ? [
          Math.round(s.perf.frameMs * 4),
          Math.round(s.perf.simMs * 4),
          Math.round(s.perf.renderMs * 4),
          s.perf.draws,
          Math.round(s.perf.triangles / 500),
          s.perf.nearbyCollision,
          s.perf.bottleneck,
        ].join(',')
      : '',
  ].join('|')
}

/** Cartoon sticker chrome — matches GameHud / public/icons outline language. */
const devBtn =
  'pointer-events-auto rounded-xl border-[3px] border-arena-ink bg-arena-panel px-3 py-1.5 text-xs font-extrabold tracking-wide text-arena-fg shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-arena-hover active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]'
const devBtnOn =
  'pointer-events-auto rounded-xl border-[3px] border-arena-ink bg-arena-heat px-3 py-1.5 text-xs font-extrabold tracking-wide text-arena-ink shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]'

/**
 * Picker selection is always a duel arena (never practice range).
 * `map=range` only applies while already in a play session (practice / tutorial / host wait).
 */
function readInitialMap(params: URLSearchParams): MapId {
  const q = params.get('map')
  if (q && isDuelMapId(q)) return q
  return DEFAULT_MAP_ID
}

/** Session sky from URL (concrete only). Missing → day. */
function readInitialSkybox(params: URLSearchParams): SkyboxId {
  const q = params.get('sky')
  if (q && isSkyboxId(q)) return q
  return 'day'
}

/** Picker preference: allow random in UI; URL concrete ids map 1:1. */
function readPickerSkybox(params: URLSearchParams): SkyboxPreference {
  const q = params.get('sky')
  if (q && isSkyboxPreference(q)) return q
  return 'day'
}

/** Dev/admin tools only on local machines (not production hosts). */
function isLocalhostHost(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '[::1]' ||
    h === '::1' ||
    h.endsWith('.local')
  )
}

export default function Game() {
  const [searchParams, setSearchParams] = useSearchParams()
  const serverUrl = useAppStore((s) => s.serverUrl)
  const matchIdStore = useAppStore((s) => s.matchId)
  const setMatchIdStore = useAppStore((s) => s.setMatchId)
  const username = useAppStore((s) => s.username)
  const playerToken = useAppStore((s) => s.playerToken)
  const wagerAmount = useAppStore((s) => s.wagerAmount)
  const characterAppearance = useAppStore((s) => s.characterAppearance)
  const setRejoinSession = useAppStore((s) => s.setRejoinSession)
  const armRejoinWindow = useAppStore((s) => s.armRejoinWindow)
  const clearRejoinSession = useAppStore((s) => s.clearRejoinSession)

  const [phase, setPhase] = useState<'pick' | 'play'>(() =>
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
  /**
   * Guided how-to-play on the practice range.
   * URL `tutorial=1` or MapPicker "Tutorial" starts it offline.
   */
  const [tutorialOpen, setTutorialOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('tutorial') === '1'
  })
  /** Bottom-left admin strip — localhost only, toggled with L. */
  const [adminOpen, setAdminOpen] = useState(false)
  const isLocalhost = isLocalhostHost()
  const lastKey = useRef('')

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
  useEffect(() => {
    if (!engine || vmEdit) return
    engine.setGameplayEnabled(!settingsOpen && !chatOpen)
  }, [engine, settingsOpen, chatOpen, vmEdit])

  // Leave chat when leaving online match / map select
  useEffect(() => {
    if (!onlineSession) setChatOpen(false)
  }, [onlineSession])

  // In-match chat hotkeys (page-level so they work even before HUD mounts fully).
  // Enter / Y open; Esc closes. Capture phase beats game InputManager.
  useEffect(() => {
    if (!onlineSession || phase !== 'play' || settingsOpen || vmEdit || levelEdit) {
      return
    }
    const isTypingTarget = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false
      const tag = t.tagName
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        t.isContentEditable
      )
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

      if (
        e.code === 'Enter' ||
        e.code === 'NumpadEnter' ||
        e.code === 'KeyY'
      ) {
        e.preventDefault()
        e.stopPropagation()
        // Drop pointer lock / WASD immediately (don't wait for React effect)
        engine?.setGameplayEnabled(false)
        setChatOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    onlineSession,
    phase,
    settingsOpen,
    chatOpen,
    vmEdit,
    levelEdit,
    engine,
  ])

  // Live character colors from settings → third-person body
  useEffect(() => {
    if (!engine) return
    engine.applyPlayerAppearance(characterAppearance)
  }, [engine, characterAppearance])

  // Admin tools: L toggles the bottom-left strip (localhost + play only).
  useEffect(() => {
    if (!isLocalhost || phase !== 'play') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }
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

  // Only one editor at a time
  const openLevelEdit = useCallback(() => {
    setVmEdit(false)
    setLevelEdit(true)
  }, [])
  const openVmEdit = useCallback(() => {
    setLevelEdit(false)
    setVmEdit(true)
  }, [])

  const startPlay = useCallback(
    (
      id: MapId,
      pref: SkyboxPreference,
      online?: OnlineSessionOpts | null,
      opts?: { tutorial?: boolean },
    ) => {
      // Resolve random once so all clients with the same URL share one sky.
      const sky = resolveSkyboxId(pref)
      const tutorial = Boolean(opts?.tutorial) && !online
      setMapId(id)
      setSkyboxPref(pref === 'random' ? sky : pref)
      setSessionSkybox(sky)
      setOnlineSession(online ?? null)
      setTutorialOpen(tutorial)
      setPhase('play')
      setHud(null)
      lastKey.current = ''
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
    [setSearchParams],
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
    (lobby: { matchId: string; mapId?: MapId }) => {
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
    mapId,
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
    const phase = hud?.matchPhase
    const midMatch =
      Boolean(onlineSession) &&
      !hud?.matchEndReason &&
      (phase === 'countdown' ||
        phase === 'live' ||
        phase === 'round_reset' ||
        phase === 'rejoin')
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
    setEngine(null)
    setHud(null)
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
  ])

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
    setHud(null)
    lastKey.current = ''
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

  if (phase === 'pick') {
    return (
      <MapPicker
        selectedId={isDuelMapId(mapId) ? mapId : DEFAULT_MAP_ID}
        onSelect={(id) => {
          if (isDuelMapId(id)) setMapId(id)
        }}
        skybox={skyboxPref}
        onSkyboxChange={setSkyboxPref}
        onPlay={() =>
          startPlay(isDuelMapId(mapId) ? mapId : DEFAULT_MAP_ID, skyboxPref)
        }
        onPracticeRange={() => startPlay('range', skyboxPref)}
        onTutorial={startTutorial}
        onHostOnline={startHostOnline}
        onJoinOnline={startJoinOnline}
        onRejoinOnline={startRejoinOnline}
      />
    )
  }

  const mapName = getMap(mapId).name
  const isOnline = !!onlineSession
  /** Duel arena for the open lobby (may differ from visual wait-room map). */
  const lobbyDuelMapId =
    onlineSession?.mapId && isMapId(onlineSession.mapId)
      ? onlineSession.mapId
      : mapId
  const lobbyMapName = getMap(lobbyDuelMapId).name

  return (
    <div className="relative h-svh w-full overflow-hidden bg-black">
      <GameCanvas
        mapId={mapId}
        skybox={sessionSkybox}
        online={onlineSession}
        onHud={onHud}
        onEngine={onEngine}
      />
      {!vmEdit && !levelEdit && (
        <GameHud
          hud={hud}
          engine={isOnline ? engine : null}
          chatOpen={chatOpen}
          onChatOpenChange={(open) => {
            if (open) engine?.setGameplayEnabled(false)
            setChatOpen(open)
          }}
          onOpenSettings={() => {
            setChatOpen(false)
            setSettingsSection(undefined)
            setSettingsOpen(true)
          }}
          onExit={backToPicker}
          onReady={(ready) => engine?.setReady(ready)}
          lobby={
            isOnline && onlineSession
              ? {
                  matchId: onlineSession.matchId,
                  mapId: lobbyDuelMapId,
                  mapName: lobbyMapName,
                  wager: onlineSession.wager ?? 0,
                  createdAt: onlineSession.createdAt ?? null,
                  hostName: onlineSession.hostName,
                  waitOnRange: Boolean(onlineSession.waitOnRange),
                }
              : null
          }
        />
      )}

      {/* Guided how-to-play (offline practice range only) */}
      {!vmEdit && !levelEdit && !isOnline && mapId === 'range' && (
        <TutorialOverlay
          open={tutorialOpen}
          hud={hud}
          settingsOpen={settingsOpen}
          onOpenSettings={(section) => {
            setSettingsSection(section)
            setSettingsOpen(true)
          }}
          onClose={() => {
            setTutorialOpen(false)
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev)
                next.delete('tutorial')
                return next
              },
              { replace: true },
            )
          }}
        />
      )}

      {/* Map + sky badge (+ offline Help) — top-left; hide badge while tutorial owns that corner */}
      {!vmEdit && !levelEdit && !tutorialOpen && (
        <div className="absolute top-3 left-3 z-30 flex max-w-[min(50vw,22rem)] flex-col items-start gap-1.5">
          <div className="pointer-events-none flex max-w-full items-center gap-1.5 rounded-xl border-[3px] border-arena-ink bg-arena-panel px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-arena-fg shadow-[2px_3px_0_var(--arena-ink)]">
            <img
              src={icons.map}
              alt=""
              aria-hidden
              className="size-3.5 shrink-0 object-contain drop-shadow-[0_1px_0_rgba(0,0,0,0.4)]"
            />
            <span className="truncate text-arena-heat">{mapName}</span>
            <span className="text-arena-fg/30">·</span>
            <span className="truncate text-arena-tech">
              {SKYBOX_LABELS[sessionSkybox]}
            </span>
            {isOnline && (
              <>
                <span className="text-arena-fg/30">·</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-arena-ok">
                  <img
                    src={icons.globe}
                    alt=""
                    aria-hidden
                    className="size-3 object-contain"
                  />
                  Online
                </span>
              </>
            )}
          </div>
          {/* Tutorial lives on the practice range only */}
          {!isOnline && mapId === 'range' && (
            <button
              type="button"
              onClick={() => {
                gameAudio.uiClick()
                setTutorialOpen(true)
                setSearchParams(
                  (prev) => {
                    const next = new URLSearchParams(prev)
                    next.set('tutorial', '1')
                    return next
                  },
                  { replace: true },
                )
              }}
              className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-xl border-[3px] border-arena-ink bg-arena-panel px-2.5 text-[10px] font-extrabold tracking-wide text-arena-fg uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-arena-hover active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]"
              title="Open how-to-play tutorial"
            >
              <img
                src={icons.star}
                alt=""
                aria-hidden
                className="size-3.5 object-contain drop-shadow-[0_1px_0_rgba(0,0,0,0.4)]"
              />
              Help
            </button>
          )}
        </div>
      )}

      {/* Crosshair while level editing (spawn aim) */}
      {levelEdit && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="relative h-5 w-5">
            <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/70" />
            <div className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-white/70" />
          </div>
        </div>
      )}

      {vmEdit ? (
        <ViewmodelEditor
          engine={engine}
          open={vmEdit}
          onClose={() => setVmEdit(false)}
        />
      ) : levelEdit ? (
        <LevelEditor
          engine={engine}
          open={levelEdit}
          mapName={mapName}
          onClose={() => setLevelEdit(false)}
        />
      ) : (
        isLocalhost &&
        adminOpen && (
          <div className="absolute bottom-3 left-3 z-40 flex max-w-[min(96vw,42rem)] flex-wrap items-center gap-2">
            <span className="pointer-events-none rounded-lg border-[2.5px] border-arena-ink bg-arena-heat px-2 py-1 text-[10px] font-extrabold tracking-wide text-arena-ink uppercase shadow-[1px_2px_0_var(--arena-ink)]">
              Admin · L
            </span>
            <button
              type="button"
              onClick={backToPicker}
              className={devBtn}
              title="Return to map select"
            >
              <span className="inline-flex items-center gap-1.5">
                <img
                  src={icons.map}
                  alt=""
                  aria-hidden
                  draggable={false}
                  className="size-4 object-contain"
                />
                Change map
              </span>
            </button>
            {!isOnline && (
              <>
                <button
                  type="button"
                  onClick={openLevelEdit}
                  className={devBtn}
                >
                  Level editor
                </button>
                <button type="button" onClick={openVmEdit} className={devBtn}>
                  Viewmodel editor
                </button>
              </>
            )}
            <button
              type="button"
              onClick={toggleThirdPerson}
              className={thirdPerson ? devBtnOn : devBtn}
              title="Toggle over-the-shoulder third-person camera"
            >
              {thirdPerson ? 'Third person: on' : 'Third person'}
            </button>
            {!isOnline && (
              <>
                <button
                  type="button"
                  onClick={toggleFreeCam}
                  className={freeCam ? devBtnOn : devBtn}
                  title={
                    freeCam
                      ? 'Exit free cam (while dead: respawn now)'
                      : 'Fly freely — WASD, Space/crouch, sprint boost'
                  }
                >
                  {freeCam ? 'Free cam: on' : 'Free cam'}
                </button>
                <button
                  type="button"
                  onClick={toggleDummies}
                  className={dummiesEnabled ? devBtn : devBtnOn}
                  title="Turn practice dummies fully off (no AI, anims, hitscan, or drawing)"
                >
                  {dummiesEnabled ? 'Dummies: on' : 'Dummies: off'}
                </button>
              </>
            )}
          </div>
        )
      )}

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialSection={settingsSection}
      />
    </div>
  )
}
