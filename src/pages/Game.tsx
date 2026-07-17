import { useCallback, useRef, useState } from 'react'
import { GameCanvas } from '@/components/game/GameCanvas'
import { GameHud } from '@/components/game/GameHud'
import { ViewmodelEditor } from '@/components/game/ViewmodelEditor'
import type { GameEngine } from '@/game/engine'
import type { HudSnapshot } from '@/game/types'

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

export default function Game() {
  const [hud, setHud] = useState<HudSnapshot | null>(null)
  const [engine, setEngine] = useState<GameEngine | null>(null)
  const [vmEdit, setVmEdit] = useState(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).has('vm-edit')
  })
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

  return (
    <div className="relative h-svh w-full overflow-hidden bg-black">
      <GameCanvas onHud={onHud} onEngine={onEngine} />
      {!vmEdit && <GameHud hud={hud} />}

      {vmEdit ? (
        <ViewmodelEditor
          engine={engine}
          open={vmEdit}
          onClose={() => setVmEdit(false)}
        />
      ) : (
        <div className="absolute bottom-3 left-3 z-40 flex flex-wrap items-center gap-2">
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
    </div>
  )
}
