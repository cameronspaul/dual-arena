import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Map as MapIcon } from 'lucide-react'

import { GameCanvas } from '@/components/game/GameCanvas'
import { GameHud } from '@/components/game/GameHud'
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

function hudKey(s: HudSnapshot): string {
  return [
    s.ammo,
    s.reserve,
    s.phase,
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
    s.lastHitAge < 0.605 ? 1 : 0,
    s.hp,
    s.alive ? 1 : 0,
    s.spectating ? 1 : 0,
    // Whole-second ticks for death countdown UI
    Math.ceil(s.respawnIn),
    s.deathReason ?? '',
    s.fps,
    s.ping ?? -1,
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

const devBtn =
  'pointer-events-auto rounded-md border border-arena-panel-border bg-arena-panel px-3 py-1.5 text-xs font-medium tracking-wide text-white/75 shadow-md backdrop-blur-md transition-all hover:border-arena-heat/40 hover:bg-white/10 hover:text-white'
const devBtnOn =
  'pointer-events-auto rounded-md border border-arena-heat/50 bg-arena-heat/20 px-3 py-1.5 text-xs font-medium tracking-wide text-arena-heat shadow-[0_0_16px_var(--arena-heat-dim)] backdrop-blur-md transition-all hover:bg-arena-heat/30'

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

export default function Game() {
  const [searchParams, setSearchParams] = useSearchParams()
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
    (id: MapId, pref: SkyboxPreference) => {
      // Resolve random once so all clients with the same URL share one sky.
      const sky = resolveSkyboxId(pref)
      setMapId(id)
      setSkyboxPref(pref === 'random' ? sky : pref)
      setSessionSkybox(sky)
      setPhase('play')
      setHud(null)
      lastKey.current = ''
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('map', id)
          next.set('sky', sky)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const backToPicker = useCallback(() => {
    gameAudio.uiClick()
    setPhase('pick')
    setEngine(null)
    setHud(null)
    // Keep last concrete sky selected in the picker (not random)
    setSkyboxPref(sessionSkybox)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('map')
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
      />
    )
  }

  const mapName = getMap(mapId).name

  return (
    <div className="relative h-svh w-full overflow-hidden bg-black">
      <GameCanvas
        mapId={mapId}
        skybox={sessionSkybox}
        onHud={onHud}
        onEngine={onEngine}
      />
      {!vmEdit && !levelEdit && (
        <GameHud
          hud={hud}
          onOpenSettings={() => setSettingsOpen(true)}
          onExit={backToPicker}
        />
      )}

      {/* Map + sky badge */}
      {!vmEdit && !levelEdit && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-md border border-arena-panel-border bg-arena-panel px-3.5 py-1.5 text-[11px] font-medium tracking-wide text-white/80 shadow-md backdrop-blur-md">
          <span className="text-arena-heat">{mapName}</span>
          <span className="mx-1.5 text-white/25">·</span>
          <span className="text-arena-tech/90">{SKYBOX_LABELS[sessionSkybox]}</span>
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
        <div className="absolute bottom-3 left-3 z-40 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={backToPicker}
            className={devBtn}
            title="Return to map select"
          >
            <span className="inline-flex items-center gap-1.5">
              <MapIcon className="h-3.5 w-3.5" />
              Change map
            </span>
          </button>
          <button type="button" onClick={openLevelEdit} className={devBtn}>
            Level editor
          </button>
          <button type="button" onClick={openVmEdit} className={devBtn}>
            Viewmodel editor
          </button>
          <button
            type="button"
            onClick={toggleThirdPerson}
            className={thirdPerson ? devBtnOn : devBtn}
            title="Toggle over-the-shoulder third-person camera"
          >
            {thirdPerson ? 'Third person: on' : 'Third person'}
          </button>
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
        </div>
      )}

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
