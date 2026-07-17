import { useCallback, useRef, useState } from 'react'
import { GameCanvas } from '@/components/game/GameCanvas'
import { GameHud } from '@/components/game/GameHud'
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
  const lastKey = useRef('')

  const onHud = useCallback((snap: HudSnapshot) => {
    const k = hudKey(snap)
    if (k === lastKey.current) return
    lastKey.current = k
    setHud(snap)
  }, [])

  return (
    <div className="relative h-svh w-full overflow-hidden bg-black">
      <GameCanvas onHud={onHud} />
      <GameHud hud={hud} />
    </div>
  )
}
