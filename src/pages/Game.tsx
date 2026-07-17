import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Map as MapIcon } from 'lucide-react'

import { GameCanvas } from '@/components/game/GameCanvas'
import { GameHud } from '@/components/game/GameHud'
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
  ].join('|')
}

const devBtn =
  'pointer-events-auto rounded-lg border border-white/15 bg-black/70 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur hover:bg-black/85 hover:text-white'
const devBtnOn =
  'pointer-events-auto rounded-lg border border-orange-400/50 bg-orange-500/25 px-3 py-1.5 text-xs font-medium text-orange-100 backdrop-blur hover:bg-orange-500/35'

function readInitialMap(params: URLSearchParams): MapId {
  const q = params.get('map')
  if (q && isMapId(q)) return q
  return DEFAULT_MAP_ID
}

export default function Game() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [phase, setPhase] = useState<'pick' | 'play'>(() =>
    searchParams.get('map') && isMapId(searchParams.get('map')!)
      ? 'play'
      : 'pick',
  )
  const [mapId, setMapId] = useState<MapId>(() => readInitialMap(searchParams))
  const [hud, setHud] = useState<HudSnapshot | null>(null)
  const [engine, setEngine] = useState<GameEngine | null>(null)
  const [vmEdit, setVmEdit] = useState(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).has('vm-edit')
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [thirdPerson, setThirdPerson] = useState(false)
  const [dummiesPaused, setDummiesPaused] = useState(false)
  const lastKey = useRef('')

  const onHud = useCallback((snap: HudSnapshot) => {
    const k = hudKey(snap)
    if (k === lastKey.current) return
    lastKey.current = k
    setHud(snap)
  }, [])

  const onEngine = useCallback((eng: GameEngine | null) => {
    setEngine(eng)
    if (eng) {
      setThirdPerson(eng.isThirdPerson())
      setDummiesPaused(eng.isDummiesPaused())
    } else {
      setThirdPerson(false)
      setDummiesPaused(false)
    }
  }, [])

  // Release pointer lock / block gameplay while settings are open
  useEffect(() => {
    if (!engine || vmEdit) return
    engine.setGameplayEnabled(!settingsOpen)
  }, [engine, settingsOpen, vmEdit])

  const startPlay = useCallback(
    (id: MapId) => {
      setMapId(id)
      setPhase('play')
      setHud(null)
      lastKey.current = ''
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('map', id)
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
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('map')
        return next
      },
      { replace: true },
    )
  }, [setSearchParams])

  const toggleThirdPerson = useCallback(() => {
    if (!engine) return
    const next = !engine.isThirdPerson()
    engine.setThirdPerson(next)
    setThirdPerson(next)
  }, [engine])

  const toggleDummiesPaused = useCallback(() => {
    if (!engine) return
    const next = !engine.isDummiesPaused()
    engine.setDummiesPaused(next)
    setDummiesPaused(next)
  }, [engine])

  if (phase === 'pick') {
    return (
      <MapPicker
        selectedId={mapId}
        onSelect={setMapId}
        onPlay={() => startPlay(mapId)}
      />
    )
  }

  const mapName = getMap(mapId).name

  return (
    <div className="relative h-svh w-full overflow-hidden bg-black">
      <GameCanvas mapId={mapId} onHud={onHud} onEngine={onEngine} />
      {!vmEdit && (
        <GameHud
          hud={hud}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {/* Map name badge */}
      {!vmEdit && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-full border border-white/10 bg-black/55 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
          {mapName}
        </div>
      )}

      {vmEdit ? (
        <ViewmodelEditor
          engine={engine}
          open={vmEdit}
          onClose={() => setVmEdit(false)}
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
          <button type="button" onClick={() => setVmEdit(true)} className={devBtn}>
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
            onClick={toggleDummiesPaused}
            className={dummiesPaused ? devBtnOn : devBtn}
            title="Freeze dummy AI and locomotion animations"
          >
            {dummiesPaused ? 'Dummies: paused' : 'Pause dummies'}
          </button>
        </div>
      )}

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
