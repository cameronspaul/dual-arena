import { useEffect, useRef } from 'react'
import {
  GameEngine,
  type HudListener,
  type GameEngineOptions,
  type OnlineSessionOpts,
} from '@/game/engine'
import type { MapId } from '@/game/maps'
import type { SkyboxId } from '@/game/scene/skyboxes'

interface GameCanvasProps {
  onHud: HudListener
  /** Called once the engine is constructed (and again with null on dispose). */
  onEngine?: (engine: GameEngine | null) => void
  mapId?: MapId | string
  /** Concrete session skybox (shared; default day). */
  skybox?: SkyboxId
  /** Online 1v1 session; omit for offline practice. */
  online?: OnlineSessionOpts | null
}

export function GameCanvas({
  onHud,
  onEngine,
  mapId,
  skybox = 'day',
  online = null,
}: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<GameEngine | null>(null)
  const onHudRef = useRef(onHud)
  onHudRef.current = onHud
  const onEngineRef = useRef(onEngine)
  onEngineRef.current = onEngine

  const onlineKey = online
    ? `${online.serverUrl}|${online.matchId}|${online.token ?? ''}`
    : ''

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const opts: GameEngineOptions = {
      mapId,
      skybox,
      mode: online ? 'online' : 'offline',
      online: online ?? undefined,
    }
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
    // onlineKey captures server/match identity without unstable object identity
  }, [mapId, skybox, onlineKey])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 h-full w-full overflow-hidden bg-black"
    />
  )
}
