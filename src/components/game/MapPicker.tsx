import { useState } from 'react'
import {
  Crosshair,
  Map as MapIcon,
  Moon,
  Settings,
  Sun,
  Target,
} from 'lucide-react'
import { motion } from 'framer-motion'

import { SettingsDialog } from '@/components/SettingsDialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { gameAudio } from '@/game/audio'
import { MAP_LIST, type MapDef, type MapId } from '@/game/maps'
import {
  SKYBOX_IDS,
  SKYBOX_LABELS,
  type SkyboxPreference,
} from '@/game/scene/skyboxes'
import { useAppStore } from '@/stores/useAppStore'

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
  const { theme, toggleTheme } = useAppStore()
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-background text-foreground">
      {/* Atmosphere */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,_oklch(0.55_0.14_55/_0.18),_transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_90%_80%,_oklch(0.5_0.1_200/_0.14),_transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_120%,_oklch(0.2_0.04_260/_0.45),_transparent_55%)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Top bar — brand + utilities */}
      <header className="relative z-10 flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/15 text-primary shadow-[0_0_16px_oklch(0.7_0.15_55/_0.2)]">
            <Crosshair className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold tracking-tight sm:text-base">
              Dual Arena
            </div>
            <div className="hidden text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase sm:block">
              Sniper 1v1 · Browser
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              gameAudio.uiClick()
              toggleTheme()
            }}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card/80 px-2.5 py-2 text-sm text-foreground shadow-sm backdrop-blur-sm transition-colors hover:border-primary/40 hover:bg-muted sm:px-3"
            aria-label="Toggle theme"
          >
            {theme === 'light' ? (
              <Moon className="size-4 text-primary" />
            ) : (
              <Sun className="size-4 text-primary" />
            )}
            <span className="hidden font-medium sm:inline">
              {theme === 'light' ? 'Dark' : 'Light'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              gameAudio.uiClick()
              setSettingsOpen(true)
            }}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card/80 px-2.5 py-2 text-sm text-foreground shadow-sm backdrop-blur-sm transition-colors hover:border-primary/40 hover:bg-muted sm:px-3"
          >
            <Settings className="size-4 text-primary" />
            <span className="hidden font-medium sm:inline">Settings</span>
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-10 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8 text-center"
        >
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-semibold tracking-[0.18em] text-primary uppercase">
            <MapIcon className="size-3.5" />
            Deploy
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
            <span className="bg-gradient-to-br from-foreground via-foreground to-primary bg-clip-text text-transparent">
              Choose your map
            </span>
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground sm:text-base">
            One shot. One stake. Prove it. Pick a range or arena — offline local
            play is live now.
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
          className="relative mt-8 overflow-hidden rounded-lg border border-border bg-card/80 p-5 shadow-md backdrop-blur"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <div className="absolute top-0 left-0 h-full w-0.5 bg-primary" />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="text-center sm:text-left">
              <div className="text-[10px] font-semibold tracking-[0.2em] text-primary uppercase">
                Ready to deploy
              </div>
              <div className="mt-1 text-lg font-semibold">{selected.name}</div>
              <p className="mt-0.5 max-w-md text-xs text-muted-foreground">
                {selected.blurb}
              </p>
            </div>
            <Button
              size="lg"
              className="min-w-44 gap-2 text-base shadow-[0_0_20px_oklch(0.7_0.15_55/_0.22)] sm:shrink-0"
              onClick={() => {
                gameAudio.uiConfirm()
                onPlay()
              }}
            >
              <Target className="h-5 w-5" />
              Deploy
            </Button>
          </div>

          <div className="mt-5 border-t border-border/80 pt-4">
            <div className="mb-2 text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              Skybox
            </div>
            <p className="mb-2.5 text-xs text-muted-foreground">
              Locked for this session. Default is Day. Random picks once when you
              hit Deploy and is stored in the URL.
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
                        ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                        : 'border-border bg-background/60 text-muted-foreground hover:border-primary/30 hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {SKYBOX_LABELS[id]}
                  </button>
                )
              })}
            </div>
          </div>
        </motion.div>

        <p className="mt-8 text-center text-[11px] text-muted-foreground/55">
          Sniper viewmodel © DJMaesen (CC BY 4.0) · public/models/CREDITS.md
        </p>
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
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
        'group relative flex flex-col overflow-hidden rounded-lg border text-left shadow-sm transition-colors',
        selected
          ? 'border-primary bg-primary/10 ring-2 ring-primary/35'
          : 'border-border bg-card/70 hover:border-primary/30 hover:bg-card',
      )}
    >
      {selected && (
        <div className="absolute top-0 left-0 z-10 h-full w-0.5 bg-primary" />
      )}
      <MapThumb map={map} selected={selected} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-semibold leading-tight">{map.name}</h2>
          {map.kind === 'range' ? (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-600 uppercase dark:text-emerald-400">
              Official
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
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
        background: `linear-gradient(145deg, ${a} 0%, ${b} 55%, oklch(0.15 0.03 260) 100%)`,
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
      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/60 to-transparent" />
      <div className="absolute bottom-2 left-3 flex items-center gap-1.5 text-xs font-medium text-white/90 drop-shadow">
        <MapIcon className="h-3.5 w-3.5" />
        {map.kind === 'range' ? 'Procedural' : 'GLB arena'}
      </div>
    </div>
  )
}
