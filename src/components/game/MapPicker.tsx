import { Link } from 'react-router-dom'
import { ArrowLeft, Map as MapIcon, Target } from 'lucide-react'
import { motion } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { gameAudio } from '@/game/audio'
import { MAP_LIST, type MapDef, type MapId } from '@/game/maps'
import {
  SKYBOX_IDS,
  SKYBOX_LABELS,
  type SkyboxPreference,
} from '@/game/scene/skyboxes'

const SKYBOX_OPTIONS: SkyboxPreference[] = [...SKYBOX_IDS, 'random']

interface MapPickerProps {
  selectedId: MapId
  onSelect: (id: MapId) => void
  /** Skybox preference for this map session (default day; random resolves on Play). */
  skybox: SkyboxPreference
  onSkyboxChange: (sky: SkyboxPreference) => void
  onPlay: () => void
}

export function MapPicker({
  selectedId,
  onSelect,
  skybox,
  onSkyboxChange,
  onPlay,
}: MapPickerProps) {
  const selected = MAP_LIST.find((m) => m.id === selectedId) ?? MAP_LIST[0]

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_oklch(0.35_0.08_250/_0.35),_transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_oklch(0.4_0.12_40/_0.2),_transparent_50%)]" />

      <header className="relative z-10 flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Button variant="outline" size="sm" asChild className="gap-2">
          <Link
            to="/"
            onClick={() => gameAudio.uiClick()}
          >
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
        </Button>
        <div className="inline-flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <MapIcon className="h-3.5 w-3.5" />
          Select map
        </div>
        <div className="w-20" />
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-10 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mb-8 text-center"
        >
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Choose your map
          </h1>
          <p className="mt-2 text-muted-foreground">
            Practice range or load a full arena. Maps use offline local play.
          </p>
        </motion.div>

        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MAP_LIST.map((map, i) => (
            <MapCard
              key={map.id}
              map={map}
              selected={map.id === selectedId}
              index={i}
              onSelect={() => {
                gameAudio.uiClick()
                onSelect(map.id)
              }}
            />
          ))}
        </div>

        <motion.div
          className="mt-8 flex flex-col gap-4 rounded-2xl border border-border bg-card/70 p-5 backdrop-blur"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="text-center sm:text-left">
              <div className="text-sm font-semibold">{selected.name}</div>
              <p className="mt-0.5 max-w-md text-xs text-muted-foreground">
                {selected.blurb}
              </p>
            </div>
            <Button
              size="lg"
              className="min-w-44 gap-2 text-base sm:shrink-0"
              onClick={() => {
                gameAudio.uiConfirm()
                onPlay()
              }}
            >
              <Target className="h-5 w-5" />
              Play
            </Button>
          </div>

          <div className="border-t border-border/80 pt-4">
            <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Skybox
            </div>
            <p className="mb-2.5 text-xs text-muted-foreground">
              Same for everyone in this map session. Default is Day. Random picks
              once when you hit Play and is locked in the URL.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SKYBOX_OPTIONS.map((id) => {
                const active = skybox === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      gameAudio.uiClick()
                      onSkyboxChange(id)
                    }}
                    className={cn(
                      'rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {SKYBOX_LABELS[id]}
                  </button>
                )
              })}
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  )
}

function MapCard({
  map,
  selected,
  index,
  onSelect,
}: {
  map: MapDef
  selected: boolean
  index: number
  onSelect: () => void
}) {
  return (
    <motion.button
      type="button"
      onClick={onSelect}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 * index, duration: 0.35 }}
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.985 }}
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border text-left transition-colors',
        selected
          ? 'border-primary bg-primary/10 ring-2 ring-primary/40'
          : 'border-border bg-card/60 hover:bg-card',
      )}
    >
      <MapThumb map={map} selected={selected} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-semibold leading-tight">{map.name}</h2>
          {map.kind === 'range' ? (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium tracking-wide text-emerald-600 uppercase dark:text-emerald-400">
              Official
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Arena
            </span>
          )}
        </div>
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {map.blurb}
        </p>
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {map.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-border/80 bg-background/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </motion.button>
  )
}

/** Screenshot thumb when available; otherwise procedural color gradient. */
function MapThumb({ map, selected }: { map: MapDef; selected: boolean }) {
  const a = `#${map.bgColor.toString(16).padStart(6, '0')}`
  const b = `#${map.fogColor.toString(16).padStart(6, '0')}`
  return (
    <div
      className={cn(
        'relative h-28 w-full overflow-hidden',
        selected && 'opacity-100',
      )}
      style={{
        background: `linear-gradient(145deg, ${a} 0%, ${b} 55%, oklch(0.2 0.02 250) 100%)`,
      }}
    >
      {map.thumbUrl ? (
        <img
          src={map.thumbUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_30%_40%,white_0.5px,transparent_1px)] [background-size:12px_12px]" />
      )}
      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/55 to-transparent" />
      <div className="absolute bottom-2 left-3 flex items-center gap-1.5 text-xs font-medium text-white/90 drop-shadow">
        <MapIcon className="h-3.5 w-3.5" />
        {map.kind === 'range' ? 'Procedural' : 'GLB arena'}
      </div>
    </div>
  )
}
