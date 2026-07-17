import { useEffect, useRef } from 'react'
import {
  GameEngine,
  type HudListener,
  type GameEngineOptions,
} from '@/game/engine'
import type { MapId } from '@/game/maps'

interface GameCanvasProps {
  onHud: HudListener
  /** Called once the engine is constructed (and again with null on dispose). */
  onEngine?: (engine: GameEngine | null) => void
  mapId?: MapId | string
}

export function GameCanvas({ onHud, onEngine, mapId }: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<GameEngine | null>(null)
  const onHudRef = useRef(onHud)
  onHudRef.current = onHud
  const onEngineRef = useRef(onEngine)
  onEngineRef.current = onEngine

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const opts: GameEngineOptions = { mapId }
    const engine = new GameEngine(el, opts)
    engineRef.current = engine
    onEngineRef.current?.(engine)
    const unsub = engine.onHud((snap) => onHudRef.current(snap))
    engine.start()

    return () => {
      unsub()
      engine.dispose()
      engineRef.current = null
      onEngineRef.current?.(null)
    }
  }, [mapId])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 h-full w-full overflow-hidden bg-black"
    />
  )
}
