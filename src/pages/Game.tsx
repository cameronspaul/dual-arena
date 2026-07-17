import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { GameCanvas } from '@/components/game/GameCanvas'
import { GameHud, HITMARKER_DURATION } from '@/components/game/GameHud'
import { LevelEditor } from '@/components/game/LevelEditor'
import { MapPicker } from '@/components/game/MapPicker'
import { ViewmodelEditor } from '@/components/game/ViewmodelEditor'
import { SettingsDialog } from '@/components/SettingsDialog'
import type { GameEngine } from '@/game/engine'
import {
  DEFAULT_MAP_ID,
  getMap,
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
  'pointer-events-auto rounded-xl border-[3px] border-arena-ink bg-arena-panel px-3 py-1.5 text-xs font-extrabold tracking-wide text-white shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-white/10 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]'
const devBtnOn =
  'pointer-events-auto rounded-xl border-[3px] border-arena-ink bg-arena-heat px-3 py-1.5 text-xs font-extrabold tracking-wide text-arena-ink shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]'

function readInitialMap(params: URLSearchParams): MapId {
  const q = params.get('map')
  if (q && isMapId(q)) return q
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
  const username = useAppStore((s) => s.username)

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
  const [thirdPerson, setThirdPerson] = useState(false)
  const [freeCam, setFreeCam] = useState(false)
  const [dummiesEnabled, setDummiesEnabled] = useState(true)
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

  // Release pointer lock / block gameplay while settings are open.
  // Viewmodel editor manages input itself; level editor keeps fly controls unless settings open.
  useEffect(() => {
    if (!engine || vmEdit) return
    engine.setGameplayEnabled(!settingsOpen)
  }, [engine, settingsOpen, vmEdit])

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
    (id: MapId, pref: SkyboxPreference, online?: OnlineSessionOpts | null) => {
      // Resolve random once so all clients with the same URL share one sky.
      const sky = resolveSkyboxId(pref)
      setMapId(id)
      setSkyboxPref(pref === 'random' ? sky : pref)
      setSessionSkybox(sky)
      setOnlineSession(online ?? null)
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
          } else {
            next.delete('online')
            next.delete('match')
            next.delete('server')
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const startOnline = useCallback(() => {
    const session: OnlineSessionOpts = {
      serverUrl: serverUrl.trim() || 'ws://localhost:2567',
      matchId: matchIdStore.trim() || 'duel-1',
      token: username.trim() || undefined,
    }
    startPlay(mapId, skyboxPref, session)
  }, [serverUrl, matchIdStore, username, mapId, skyboxPref, startPlay])

  const backToPicker = useCallback(() => {
    gameAudio.uiClick()
    setPhase('pick')
    setEngine(null)
    setHud(null)
    setOnlineSession(null)
    // Keep last concrete sky selected in the picker (not random)
    setSkyboxPref(sessionSkybox)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('map')
        next.delete('online')
        next.delete('match')
        next.delete('server')
        // Leave sky so re-enter can reuse the same sky if desired
        if (sessionSkybox) next.set('sky', sessionSkybox)
        return next
      },
      { replace: true },
    )
  }, [setSearchParams, sessionSkybox])

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

  if (phase === 'pick') {
    return (
      <MapPicker
        selectedId={mapId}
        onSelect={setMapId}
        skybox={skyboxPref}
        onSkyboxChange={setSkyboxPref}
        onPlay={() => startPlay(mapId, skyboxPref)}
        onPlayOnline={startOnline}
      />
    )
  }

  const mapName = getMap(mapId).name
  const isOnline = !!onlineSession

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
          onOpenSettings={() => setSettingsOpen(true)}
          onExit={backToPicker}
          onReady={(ready) => engine?.setReady(ready)}
        />
      )}

      {/* Map + sky badge — top-left so center scoreboard owns the middle */}
      {!vmEdit && !levelEdit && (
        <div className="pointer-events-none absolute top-3 left-3 z-30 flex max-w-[40vw] items-center gap-1.5 rounded-xl border-[3px] border-arena-ink bg-arena-panel px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-white shadow-[2px_3px_0_var(--arena-ink)]">
          <img
            src={icons.map}
            alt=""
            aria-hidden
            className="size-3.5 shrink-0 object-contain drop-shadow-[0_1px_0_rgba(0,0,0,0.4)]"
          />
          <span className="truncate text-arena-heat">{mapName}</span>
          <span className="text-white/30">·</span>
          <span className="truncate text-arena-tech">
            {SKYBOX_LABELS[sessionSkybox]}
          </span>
          {isOnline && (
            <>
              <span className="text-white/30">·</span>
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

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
