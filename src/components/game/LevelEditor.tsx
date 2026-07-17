import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { GameEngine } from '@/game/engine'
import {
  downloadText,
  exportBarrierLayoutJson,
  exportSpawnLayoutJson,
  parseBarrierLayout,
  parseSpawnLayout,
  type BarrierWall,
  type MapBarrierLayout,
  type MapSpawnLayout,
  type SpawnPoint,
  type TeamId,
} from '@/game/maps'
import { gameAudio } from '@/game/audio'

type Props = {
  engine: GameEngine | null
  open: boolean
  mapName: string
  onClose: () => void
}

type EditorTool = 'spawn' | 'barrier'

function fmt(n: number, digits = 2) {
  if (!Number.isFinite(n)) return '0'
  const t = Number(n.toFixed(digits))
  return Object.is(t, -0) ? '0' : String(t)
}

function yawDeg(yaw: number) {
  let d = (yaw * 180) / Math.PI
  d = ((d % 360) + 360) % 360
  return fmt(d, 1)
}

export function LevelEditor({ engine, open, mapName, onClose }: Props) {
  const [layout, setLayout] = useState<MapSpawnLayout | null>(null)
  const [barriers, setBarriers] = useState<MapBarrierLayout | null>(null)
  const [team, setTeam] = useState<TeamId>('blue')
  const [tool, setTool] = useState<EditorTool>('spawn')
  const [snapFloor, setSnapFloor] = useState(true)
  const [wallLength, setWallLength] = useState(8)
  const [wallHeight, setWallHeight] = useState(4)
  const [wallThickness, setWallThickness] = useState(0.5)
  const [infiniteHeight, setInfiniteHeight] = useState(false)
  const [infiniteWidth, setInfiniteWidth] = useState(false)
  const [status, setStatus] = useState('')
  const [pos, setPos] = useState({ x: 0, y: 0, z: 0, yaw: 0 })
  const spawnFileRef = useRef<HTMLInputElement>(null)
  const barrierFileRef = useRef<HTMLInputElement>(null)

  const refreshLayout = useCallback(() => {
    if (!engine) return
    setLayout(engine.getSpawnLayout())
    setBarriers(engine.getBarrierLayout())
  }, [engine])

  useEffect(() => {
    if (!open || !engine) return
    engine.setLevelEditorActive(true)
    engine.setEditorTeam(team)
    engine.setEditorSnapFloor(snapFloor)
    engine.setEditorTool(tool)
    const defs = engine.getBarrierDefaults()
    setWallLength(defs.length)
    setWallHeight(defs.height)
    setWallThickness(defs.thickness)
    setInfiniteHeight(defs.infiniteHeight)
    setInfiniteWidth(defs.infiniteWidth)
    setLayout(engine.getSpawnLayout())
    setBarriers(engine.getBarrierLayout())
    setStatus('Walk the map (collides) — Space/crouch to fly, LMB place')

    const unsubSpawns = engine.onSpawnLayout((l) => setLayout(l))
    const unsubBarriers = engine.onBarrierLayout((l) => setBarriers(l))

    let raf = 0
    const tick = () => {
      setPos(engine.getEditorPosition())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      unsubSpawns()
      unsubBarriers()
      engine.setLevelEditorActive(false)
    }
  }, [open, engine])

  // Keep engine team / snap / tool / sizes in sync without re-entering editor
  useEffect(() => {
    if (!open || !engine) return
    engine.setEditorTeam(team)
  }, [team, open, engine])

  useEffect(() => {
    if (!open || !engine) return
    engine.setEditorSnapFloor(snapFloor)
  }, [snapFloor, open, engine])

  useEffect(() => {
    if (!open || !engine) return
    engine.setEditorTool(tool)
  }, [tool, open, engine])

  useEffect(() => {
    if (!open || !engine) return
    engine.setBarrierDefaults({
      length: wallLength,
      height: wallHeight,
      thickness: wallThickness,
      infiniteHeight,
      infiniteWidth,
    })
  }, [
    wallLength,
    wallHeight,
    wallThickness,
    infiniteHeight,
    infiniteWidth,
    open,
    engine,
  ])

  // Hotkeys while editor is open (don't steal when typing in inputs)
  useEffect(() => {
    if (!open || !engine) return

    const onKey = (e: KeyboardEvent) => {
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

      if (e.code === 'Digit1' || e.code === 'Numpad1') {
        e.preventDefault()
        if (tool === 'barrier') {
          setTool('spawn')
          engine.setEditorTool('spawn')
          setStatus('Tool: team spawns')
        } else {
          setTeam('blue')
          engine.setEditorTeam('blue')
          setStatus('Active team: Blue')
        }
      } else if (e.code === 'Digit2' || e.code === 'Numpad2') {
        e.preventDefault()
        if (tool === 'barrier') {
          setTool('barrier')
          setStatus('Tool: barrier walls')
        } else {
          setTeam('red')
          engine.setEditorTeam('red')
          setStatus('Active team: Red')
        }
      } else if (e.code === 'Digit3' || e.code === 'Numpad3') {
        e.preventDefault()
        setTool('spawn')
        engine.setEditorTool('spawn')
        setStatus('Tool: team spawns')
      } else if (e.code === 'Digit4' || e.code === 'Numpad4') {
        e.preventDefault()
        setTool('barrier')
        engine.setEditorTool('barrier')
        setStatus('Tool: barrier walls')
      } else if (e.code === 'KeyF') {
        e.preventDefault()
        setSnapFloor((v) => {
          const next = !v
          engine.setEditorSnapFloor(next)
          setStatus(next ? 'Floor snap: on' : 'Floor snap: off')
          return next
        })
      } else if (e.code === 'KeyP') {
        e.preventDefault()
        if (tool === 'barrier') {
          const w = engine.placeBarrierAtPlayer()
          if (w) {
            gameAudio.uiConfirm()
            setStatus(
              `Placed wall ${w.id} (${fmt(w.width)}×${fmt(w.height)}×${fmt(w.depth)})`,
            )
          }
        } else {
          const s = engine.placeSpawnAtPlayer(team)
          if (s) {
            gameAudio.uiConfirm()
            setStatus(
              `Placed ${s.team} spawn at (${fmt(s.x)}, ${fmt(s.y)}, ${fmt(s.z)})`,
            )
          }
        }
      } else if (e.code === 'Backspace' || e.code === 'Delete' || e.code === 'KeyZ') {
        if (e.code === 'KeyZ' && !e.ctrlKey && !e.metaKey) return
        e.preventDefault()
        if (tool === 'barrier') {
          if (engine.undoLastBarrier()) {
            gameAudio.uiClick()
            setStatus('Removed last barrier')
          }
        } else if (engine.undoLastSpawn()) {
          gameAudio.uiClick()
          setStatus('Removed last spawn')
        }
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, engine, team, tool])

  if (!open) return null

  const blue = layout?.spawns.filter((s) => s.team === 'blue') ?? []
  const red = layout?.spawns.filter((s) => s.team === 'red') ?? []
  const wallList = barriers?.barriers ?? []

  const place = () => {
    if (!engine) return
    if (tool === 'barrier') {
      const w = engine.placeBarrierAtPlayer()
      if (w) {
        gameAudio.uiConfirm()
        setStatus(`Placed barrier ${w.id}`)
      }
      return
    }
    const s = engine.placeSpawnAtPlayer(team)
    if (s) {
      gameAudio.uiConfirm()
      setStatus(`Placed ${s.team} spawn`)
    }
  }

  const copySpawnJson = async () => {
    if (!engine) return
    const json = exportSpawnLayoutJson(engine.getSpawnLayout())
    try {
      await navigator.clipboard.writeText(json)
      setStatus('Copied spawn JSON to clipboard')
      gameAudio.uiConfirm()
    } catch {
      setStatus('Clipboard failed — use Download instead')
    }
  }

  const downloadSpawns = () => {
    if (!engine) return
    const layoutSnap = engine.getSpawnLayout()
    const json = exportSpawnLayoutJson(layoutSnap)
    downloadText(`spawns-${layoutSnap.mapId}.json`, json)
    setStatus('Downloaded spawn JSON')
    gameAudio.uiConfirm()
  }

  const copyBarrierJson = async () => {
    if (!engine) return
    const json = exportBarrierLayoutJson(engine.getBarrierLayout())
    try {
      await navigator.clipboard.writeText(json)
      setStatus('Copied barrier JSON to clipboard')
      gameAudio.uiConfirm()
    } catch {
      setStatus('Clipboard failed — use Download instead')
    }
  }

  const downloadBarriers = () => {
    if (!engine) return
    const snap = engine.getBarrierLayout()
    const json = exportBarrierLayoutJson(snap)
    downloadText(`barriers-${snap.mapId}.json`, json)
    setStatus('Downloaded barrier JSON')
    gameAudio.uiConfirm()
  }

  const onImportSpawnFile = async (file: File) => {
    if (!engine) return
    try {
      const text = await file.text()
      const parsed = parseSpawnLayout(JSON.parse(text), engine.getMapId())
      if (!parsed) {
        setStatus('Invalid spawn file')
        return
      }
      engine.setSpawnLayout(parsed)
      refreshLayout()
      setStatus(`Imported ${parsed.spawns.length} spawn(s)`)
      gameAudio.uiConfirm()
    } catch {
      setStatus('Failed to parse spawn JSON')
    }
  }

  const onImportBarrierFile = async (file: File) => {
    if (!engine) return
    try {
      const text = await file.text()
      const parsed = parseBarrierLayout(JSON.parse(text), engine.getMapId())
      if (!parsed) {
        setStatus('Invalid barrier file')
        return
      }
      engine.setBarrierLayout(parsed)
      refreshLayout()
      setStatus(`Imported ${parsed.barriers.length} barrier(s)`)
      gameAudio.uiConfirm()
    } catch {
      setStatus('Failed to parse barrier JSON')
    }
  }

  return (
    <div
      className="pointer-events-auto absolute bottom-3 left-3 top-3 z-50 flex w-[min(100vw-1.5rem,22rem)] flex-col overflow-hidden rounded-xl border border-white/15 bg-black/85 text-white shadow-2xl backdrop-blur-md"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div>
          <div className="text-sm font-semibold tracking-wide">Level editor</div>
          <div className="text-[10px] text-white/50">
            {mapName} · spawns & barriers · walk / fly
          </div>
        </div>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
          onClick={() => {
            gameAudio.uiClick()
            onClose()
          }}
        >
          Close
        </button>
      </header>

      <div className="space-y-3 overflow-y-auto p-3 text-[11px]">
        {/* Fly help */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-2 leading-relaxed text-white/70">
          <div className="mb-1 font-medium text-white/90">Move (map collision)</div>
          <p>
            Click the world to lock the mouse. <kbd className="text-white/90">WASD</kbd>{' '}
            walks on floors (gravity + walls). Hold{' '}
            <kbd className="text-white/90">Space</kbd> / crouch to fly up / down
            while still clipping geometry. Sprint for speed.
          </p>
          <p className="mt-1">
            <kbd className="text-white/90">LMB</kbd> or <kbd className="text-white/90">P</kbd>{' '}
            place · <kbd className="text-white/90">R</kbd> undo ·{' '}
            <kbd className="text-white/90">3</kbd> spawns ·{' '}
            <kbd className="text-white/90">4</kbd> barriers
          </p>
        </div>

        {/* Live position */}
        <div className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[10px] text-white/80">
          <span className="text-white/45">pos </span>
          {fmt(pos.x)} {fmt(pos.y)} {fmt(pos.z)}
          <span className="ml-2 text-white/45">yaw </span>
          {yawDeg(pos.yaw)}°
        </div>

        {/* Tool */}
        <div>
          <div className="mb-1.5 text-white/55">Tool</div>
          <div className="flex gap-2">
            <ToolButton
              label="Spawns"
              active={tool === 'spawn'}
              accent="sky"
              onClick={() => {
                setTool('spawn')
                gameAudio.uiClick()
              }}
            />
            <ToolButton
              label="Barriers"
              active={tool === 'barrier'}
              accent="amber"
              count={wallList.length}
              onClick={() => {
                setTool('barrier')
                gameAudio.uiClick()
              }}
            />
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-white/75">
          <input
            type="checkbox"
            checked={snapFloor}
            onChange={(e) => {
              setSnapFloor(e.target.checked)
              gameAudio.uiClick()
            }}
          />
          Snap Y to floor when placing (F)
        </label>

        {tool === 'spawn' ? (
          <>
            {/* Team */}
            <div>
              <div className="mb-1.5 text-white/55">Active team</div>
              <div className="flex gap-2">
                <TeamButton
                  team="blue"
                  active={team === 'blue'}
                  count={blue.length}
                  onClick={() => {
                    setTeam('blue')
                    gameAudio.uiClick()
                  }}
                />
                <TeamButton
                  team="red"
                  active={team === 'red'}
                  count={red.length}
                  onClick={() => {
                    setTeam('red')
                    gameAudio.uiClick()
                  }}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <Btn onClick={place} primary={team === 'blue' ? 'blue' : 'red'}>
                Place {team} spawn
              </Btn>
              <Btn
                onClick={() => {
                  if (engine?.undoLastSpawn()) {
                    gameAudio.uiClick()
                    setStatus('Removed last spawn')
                  }
                }}
              >
                Undo
              </Btn>
            </div>

            <SpawnList
              title="Blue spawns"
              team="blue"
              items={blue}
              onGo={(id) => {
                engine?.goToSpawn(id)
                gameAudio.uiClick()
              }}
              onRemove={(id) => {
                engine?.removeSpawn(id)
                gameAudio.uiClick()
                setStatus('Removed spawn')
              }}
              onClear={() => {
                engine?.clearTeamSpawns('blue')
                gameAudio.uiClick()
                setStatus('Cleared blue spawns')
              }}
            />
            <SpawnList
              title="Red spawns"
              team="red"
              items={red}
              onGo={(id) => {
                engine?.goToSpawn(id)
                gameAudio.uiClick()
              }}
              onRemove={(id) => {
                engine?.removeSpawn(id)
                gameAudio.uiClick()
                setStatus('Removed spawn')
              }}
              onClear={() => {
                engine?.clearTeamSpawns('red')
                gameAudio.uiClick()
                setStatus('Cleared red spawns')
              }}
            />

            <div className="flex flex-wrap gap-1.5 border-t border-white/10 pt-3">
              <Btn onClick={copySpawnJson}>Copy JSON</Btn>
              <Btn onClick={downloadSpawns}>Download</Btn>
              <Btn onClick={() => spawnFileRef.current?.click()}>Import</Btn>
              <Btn
                onClick={() => {
                  if (!engine) return
                  if (
                    !window.confirm(
                      'Reset spawns to baked map defaults? (clears this browser’s editor override)',
                    )
                  ) {
                    return
                  }
                  engine.resetSpawnsToAuthored()
                  gameAudio.uiClick()
                  setStatus('Reset to authored defaults')
                }}
              >
                Reset defaults
              </Btn>
              <input
                ref={spawnFileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onImportSpawnFile(f)
                  e.target.value = ''
                }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-amber-400/25 bg-amber-500/10 p-2 leading-relaxed text-amber-50/80">
              <div className="mb-1 font-medium text-amber-100">Barrier walls</div>
              <p>
                Invisible blockers that stop walking (and bullets). In-game
                they show red no-entry signs when you get close. Amber boxes
                are editor-only. Face the block direction (cardinal snap).
                Use ∞ height / width for map-edge walls.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="flex cursor-pointer items-center gap-2 text-white/80">
                <input
                  type="checkbox"
                  checked={infiniteHeight}
                  onChange={(e) => {
                    setInfiniteHeight(e.target.checked)
                    gameAudio.uiClick()
                  }}
                />
                <span>
                  Infinite height{' '}
                  <span className="text-white/40">(blocks jumps / fly)</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-white/80">
                <input
                  type="checkbox"
                  checked={infiniteWidth}
                  onChange={(e) => {
                    setInfiniteWidth(e.target.checked)
                    gameAudio.uiClick()
                  }}
                />
                <span>
                  Infinite width{' '}
                  <span className="text-white/40">(runs forever along wall)</span>
                </span>
              </label>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <SizeField
                label={infiniteWidth ? 'Length (∞)' : 'Length'}
                value={wallLength}
                min={0.5}
                max={80}
                step={0.5}
                onChange={setWallLength}
                disabled={infiniteWidth}
              />
              <SizeField
                label={infiniteHeight ? 'Height (∞)' : 'Height'}
                value={wallHeight}
                min={0.5}
                max={40}
                step={0.25}
                onChange={setWallHeight}
                disabled={infiniteHeight}
              />
              <SizeField
                label="Thick"
                value={wallThickness}
                min={0.1}
                max={8}
                step={0.1}
                onChange={setWallThickness}
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              <Btn onClick={place} primary="amber">
                Place wall
                {(infiniteHeight || infiniteWidth) && ' ∞'}
              </Btn>
              <Btn
                onClick={() => {
                  if (engine?.undoLastBarrier()) {
                    gameAudio.uiClick()
                    setStatus('Removed last barrier')
                  }
                }}
              >
                Undo
              </Btn>
            </div>

            <BarrierList
              items={wallList}
              onGo={(id) => {
                engine?.goToBarrier(id)
                gameAudio.uiClick()
              }}
              onRemove={(id) => {
                engine?.removeBarrier(id)
                gameAudio.uiClick()
                setStatus('Removed barrier')
              }}
              onClear={() => {
                if (
                  !window.confirm(
                    'Clear all barrier walls for this map in this browser?',
                  )
                ) {
                  return
                }
                engine?.clearAllBarriers()
                gameAudio.uiClick()
                setStatus('Cleared barriers')
              }}
            />

            <div className="flex flex-wrap gap-1.5 border-t border-white/10 pt-3">
              <Btn onClick={copyBarrierJson}>Copy JSON</Btn>
              <Btn onClick={downloadBarriers}>Download</Btn>
              <Btn onClick={() => barrierFileRef.current?.click()}>Import</Btn>
              <input
                ref={barrierFileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onImportBarrierFile(f)
                  e.target.value = ''
                }}
              />
            </div>
          </>
        )}

        {status && (
          <p className="text-[10px] leading-snug text-emerald-300/90">{status}</p>
        )}

        <p className="text-[10px] leading-relaxed text-white/40">
          Spawns and barriers auto-save per map in this browser. Export JSON to
          share or bake into the map catalog later.
        </p>
      </div>
    </div>
  )
}

function ToolButton({
  label,
  active,
  accent,
  count,
  onClick,
}: {
  label: string
  active: boolean
  accent: 'sky' | 'amber'
  count?: number
  onClick: () => void
}) {
  const on =
    accent === 'sky'
      ? 'border-sky-400/60 bg-sky-500/30 text-sky-50'
      : 'border-amber-400/60 bg-amber-500/30 text-amber-50'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
        active ? on : 'border-white/10 bg-white/5 text-white/65 hover:bg-white/10'
      }`}
    >
      {label}
      {count != null && (
        <span className="font-mono text-[10px] opacity-70">{count}</span>
      )}
    </button>
  )
}

function TeamButton({
  team,
  active,
  count,
  onClick,
}: {
  team: TeamId
  active: boolean
  count: number
  onClick: () => void
}) {
  const isBlue = team === 'blue'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
        active
          ? isBlue
            ? 'border-sky-400/60 bg-sky-500/30 text-sky-50'
            : 'border-red-400/60 bg-red-500/30 text-red-50'
          : 'border-white/10 bg-white/5 text-white/65 hover:bg-white/10'
      }`}
    >
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${
          isBlue ? 'bg-sky-400' : 'bg-red-400'
        }`}
      />
      {isBlue ? 'Blue' : 'Red'}
      <span className="font-mono text-[10px] opacity-70">{count}</span>
    </button>
  )
}

function Btn({
  children,
  onClick,
  primary,
}: {
  children: ReactNode
  onClick: () => void
  primary?: 'blue' | 'red' | 'amber'
}) {
  const cls =
    primary === 'blue'
      ? 'border-sky-400/40 bg-sky-500/25 text-sky-50 hover:bg-sky-500/35'
      : primary === 'red'
        ? 'border-red-400/40 bg-red-500/25 text-red-50 hover:bg-red-500/35'
        : primary === 'amber'
          ? 'border-amber-400/40 bg-amber-500/25 text-amber-50 hover:bg-amber-500/35'
          : 'border-white/15 bg-white/5 text-white/80 hover:bg-white/10'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 py-1 text-[11px] font-medium ${cls}`}
    >
      {children}
    </button>
  )
}

function SizeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (n: number) => void
  disabled?: boolean
}) {
  return (
    <label className={`block ${disabled ? 'opacity-45' : ''}`}>
      <span className="mb-0.5 block text-[10px] text-white/45">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(n)
        }}
        className="w-full rounded-md border border-white/15 bg-black/50 px-1.5 py-1 font-mono text-[11px] text-white outline-none focus:border-amber-400/50 disabled:cursor-not-allowed"
      />
    </label>
  )
}

function SpawnList({
  title,
  team,
  items,
  onGo,
  onRemove,
  onClear,
}: {
  title: string
  team: TeamId
  items: SpawnPoint[]
  onGo: (id: string) => void
  onRemove: (id: string) => void
  onClear: () => void
}) {
  const accent = team === 'blue' ? 'text-sky-300' : 'text-red-300'
  return (
    <div className="rounded-lg border border-white/10 bg-black/30">
      <div className="flex items-center justify-between border-b border-white/10 px-2 py-1.5">
        <span className={`text-[11px] font-semibold ${accent}`}>{title}</span>
        {items.length > 0 && (
          <button
            type="button"
            className="text-[10px] text-white/40 hover:text-white/80"
            onClick={onClear}
          >
            Clear
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="px-2 py-2 text-[10px] text-white/35">None yet</p>
      ) : (
        <ul className="max-h-36 overflow-y-auto">
          {items.map((s, i) => (
            <li
              key={s.id}
              className="flex items-center gap-1 border-t border-white/5 px-2 py-1 font-mono text-[10px]"
            >
              <span className="w-4 text-white/35">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-white/75">
                {fmt(s.x)} {fmt(s.y)} {fmt(s.z)}
                <span className="text-white/35"> · {yawDeg(s.yaw)}°</span>
              </span>
              <button
                type="button"
                className="rounded px-1 text-white/45 hover:bg-white/10 hover:text-white"
                title="Teleport here"
                onClick={() => onGo(s.id)}
              >
                Go
              </button>
              <button
                type="button"
                className="rounded px-1 text-white/45 hover:bg-white/10 hover:text-red-300"
                title="Remove"
                onClick={() => onRemove(s.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function barrierSizeLabel(b: BarrierWall) {
  const w = b.infiniteWidth && b.width >= b.depth ? '∞' : fmt(b.width)
  const h = b.infiniteHeight ? '∞' : fmt(b.height)
  const d = b.infiniteWidth && b.depth > b.width ? '∞' : fmt(b.depth)
  // When width == depth and infinite width, show ∞ on the long axis we expand
  // (both equal → length was set equal to thickness; rare)
  if (b.infiniteWidth && b.width === b.depth) {
    return `∞×${h}×${fmt(b.depth)}`
  }
  return `${w}×${h}×${d}`
}

function BarrierList({
  items,
  onGo,
  onRemove,
  onClear,
}: {
  items: BarrierWall[]
  onGo: (id: string) => void
  onRemove: (id: string) => void
  onClear: () => void
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30">
      <div className="flex items-center justify-between border-b border-white/10 px-2 py-1.5">
        <span className="text-[11px] font-semibold text-amber-300">
          Walls ({items.length})
        </span>
        {items.length > 0 && (
          <button
            type="button"
            className="text-[10px] text-white/40 hover:text-white/80"
            onClick={onClear}
          >
            Clear
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="px-2 py-2 text-[10px] text-white/35">None yet</p>
      ) : (
        <ul className="max-h-44 overflow-y-auto">
          {items.map((b, i) => (
            <li
              key={b.id}
              className="flex items-center gap-1 border-t border-white/5 px-2 py-1 font-mono text-[10px]"
            >
              <span className="w-4 text-white/35">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-white/75">
                {fmt(b.x)} {fmt(b.y)} {fmt(b.z)}
                <span className="text-white/35">
                  {' '}
                  · {barrierSizeLabel(b)}
                </span>
                {(b.infiniteHeight || b.infiniteWidth) && (
                  <span className="ml-1 text-orange-300/90">∞</span>
                )}
              </span>
              <button
                type="button"
                className="rounded px-1 text-white/45 hover:bg-white/10 hover:text-white"
                title="Teleport here"
                onClick={() => onGo(b.id)}
              >
                Go
              </button>
              <button
                type="button"
                className="rounded px-1 text-white/45 hover:bg-white/10 hover:text-red-300"
                title="Remove"
                onClick={() => onRemove(b.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
