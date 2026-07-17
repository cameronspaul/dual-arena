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
    s.moveState,
    Math.round(s.speed * 2),
    s.pointerLocked ? 1 : 0,
    s.kills,
    s.lastHitAge < 1.2 ? `${s.lastHit?.zone}${s.lastHit?.damage}` : '',
    s.hp,
  ].join('|')
}

export default function Game() {
  const [hud, setHud] = useState<HudSnapshot | null>(null)
  const [engine, setEngine] = useState<GameEngine | null>(null)
  const [vmEdit, setVmEdit] = useState(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).has('vm-edit')
  })
  const lastKey = useRef('')

  const onHud = useCallback((snap: HudSnapshot) => {
    const k = hudKey(snap)
    if (k === lastKey.current) return
    lastKey.current = k
    setHud(snap)
  }, [])

  return (
    <div className="relative h-svh w-full overflow-hidden bg-black">
      <GameCanvas onHud={onHud} onEngine={setEngine} />
      {!vmEdit && <GameHud hud={hud} />}

      {vmEdit ? (
        <ViewmodelEditor
          engine={engine}
          open={vmEdit}
          onClose={() => setVmEdit(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setVmEdit(true)}
          className="pointer-events-auto absolute bottom-3 left-3 z-40 rounded-lg border border-white/15 bg-black/70 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur hover:bg-black/85 hover:text-white"
        >
          Viewmodel editor
        </button>
      )}
    </div>
  )
}
