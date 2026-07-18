import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import { gameAudio } from '@/game/audio'
import { SKYBOX_LABELS, type SkyboxPreference } from '@/game/scene/skyboxes'
import type { MapId } from '@/game/maps'
import { icons } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { PICKER_MAPS, SKYBOX_OPTIONS } from './constants'
import { Chip, GameIcon, HudPanel, MapThumb } from './ui'

export function MapSelectPanel({
  selectedId,
  onSelect,
  skybox,
  onSkyboxChange,
  onPlay,
  onPracticeRange,
  onTutorial,
}: {
  selectedId: MapId
  onSelect: (id: MapId) => void
  skybox: SkyboxPreference
  onSkyboxChange: (sky: SkyboxPreference) => void
  onPlay: () => void
  onPracticeRange?: () => void
  onTutorial?: () => void
}) {
  /** Map carousel page — 3 maps visible at a time. */
  const [mapPage, setMapPage] = useState(0)

  const selected =
    PICKER_MAPS.find((m) => m.id === selectedId) ??
    PICKER_MAPS[0]!

  const mapsPerPage = 3
  const mapPageCount = Math.max(1, Math.ceil(PICKER_MAPS.length / mapsPerPage))

  const selectedIndex = useMemo(
    () => PICKER_MAPS.findIndex((m) => m.id === selectedId),
    [selectedId],
  )

  // When selection changes (e.g. URL / external), show that map's page
  useEffect(() => {
    if (selectedIndex < 0) return
    setMapPage(Math.floor(selectedIndex / mapsPerPage))
  }, [selectedIndex])

  const visibleMaps = useMemo(() => {
    const start = mapPage * mapsPerPage
    return PICKER_MAPS.slice(start, start + mapsPerPage)
  }, [mapPage])

  const shiftMapPage = (dir: -1 | 1) => {
    gameAudio.uiClick()
    setMapPage((p) => (p + dir + mapPageCount) % mapPageCount)
  }

  const handlePlay = () => {
    gameAudio.uiConfirm()
    onPlay()
  }

  const handlePracticeRange = () => {
    gameAudio.uiConfirm()
    onPracticeRange?.()
  }

  const handleTutorial = () => {
    gameAudio.uiConfirm()
    onTutorial?.()
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08, duration: 0.28 }}
      className="min-h-0 lg:col-span-3 lg:col-start-1 lg:row-start-2"
    >
      <HudPanel className="p-2.5 sm:p-3" accent="tech">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <GameIcon src={icons.map} className="size-4" />
            <h2 className="text-base font-extrabold tracking-tight">Map</h2>
            <span className="rounded-md border-[2px] border-arena-ink/60 bg-arena-surface px-1.5 py-0.5 text-xs font-extrabold text-arena-fg/50 tabular-nums">
              {selectedIndex >= 0
                ? `${selectedIndex + 1}/${PICKER_MAPS.length}`
                : `${PICKER_MAPS.length} arenas`}
            </span>
            <span className="hidden text-xs font-semibold text-arena-fg/40 sm:inline">
              1v1 arenas
            </span>
          </div>
          <div className="flex items-center gap-1">
            {Array.from({ length: mapPageCount }).map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Map page ${i + 1}`}
                onClick={() => {
                  gameAudio.uiClick()
                  setMapPage(i)
                }}
                className={cn(
                  'size-1.5 rounded-full border border-arena-ink transition-all',
                  i === mapPage
                    ? 'w-3 bg-arena-tech'
                    : 'bg-arena-fg/25 hover:bg-arena-fg/45',
                )}
              />
            ))}
          </div>
        </div>

        <div className="flex items-stretch gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => shiftMapPage(-1)}
            aria-label="Previous maps"
            className="inline-flex w-9 shrink-0 items-center justify-center rounded-xl border-[3px] border-arena-ink bg-arena-surface shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-arena-hover active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)] sm:w-10"
          >
            <GameIcon src={icons.leftArrow} className="size-5" />
          </button>

          <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2">
            {visibleMaps.map((map) => {
              const active = map.id === selectedId
              return (
                <button
                  key={`${mapPage}-${map.id}`}
                  type="button"
                  onClick={() => {
                    if (!map.duelEligible) return
                    gameAudio.uiClick()
                    onSelect(map.id)
                  }}
                  className={cn(
                    'group relative aspect-[16/9] min-h-0 overflow-hidden rounded-xl border-[3px] border-arena-ink text-left transition-all',
                    active
                      ? 'shadow-[3px_4px_0_var(--arena-ink)] ring-2 ring-arena-heat/70'
                      : 'shadow-[2px_2px_0_var(--arena-ink)] hover:-translate-y-0.5 hover:ring-2 hover:ring-arena-tech/40',
                  )}
                >
                  <div className="absolute inset-0">
                    <MapThumb
                      mapId={map.id}
                      thumbUrl={map.thumbUrl}
                      name={map.name}
                      active={active}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
                  </div>

                  {active && (
                    <div className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full border-[2.5px] border-arena-ink bg-arena-heat shadow-[2px_2px_0_var(--arena-ink)]">
                      <GameIcon src={icons.check} className="size-3" />
                    </div>
                  )}

                  {/* Labels sit on a dark photo scrim — always light text */}
                  <div className="absolute inset-x-0 bottom-0 p-2">
                    <div
                      className={cn(
                        'truncate text-sm font-extrabold text-white drop-shadow-[0_1px_0_rgba(0,0,0,0.8)] sm:text-base',
                        active && 'text-arena-heat',
                      )}
                    >
                      {map.name}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => shiftMapPage(1)}
            aria-label="Next maps"
            className="inline-flex w-9 shrink-0 items-center justify-center rounded-xl border-[3px] border-arena-ink bg-arena-surface shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-arena-hover active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)] sm:w-10"
          >
            <GameIcon src={icons.rightArrow} className="size-5" />
          </button>
        </div>

        {/* Selected map + sky chips + train / deploy */}
        <div className="mt-2 flex flex-col gap-2 border-t-2 border-arena-ink/35 pt-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <AnimatePresence mode="wait">
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, x: 4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.15 }}
              className="min-w-0 sm:max-w-[11rem] sm:shrink-0"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <GameIcon
                  src={icons.location}
                  className="size-3.5 shrink-0"
                />
                <h3 className="truncate text-base font-black tracking-tight">
                  {selected.name}
                </h3>
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 sm:justify-center">
            <GameIcon
              src={icons.compass}
              className="size-3.5 shrink-0 opacity-60"
            />
            {SKYBOX_OPTIONS.map((id) => (
              <Chip
                key={id}
                active={skybox === id}
                className="h-7 px-2 text-xs"
                onClick={() => {
                  gameAudio.uiClick()
                  onSkyboxChange(id)
                }}
              >
                {SKYBOX_LABELS[id]}
              </Chip>
            ))}
          </div>

          <div className="flex w-full shrink-0 flex-col gap-1.5 sm:w-auto sm:flex-row">
            {(onPracticeRange || onTutorial) && (
              <div className="flex gap-1.5">
                {onPracticeRange && (
                  <button
                    type="button"
                    onClick={handlePracticeRange}
                    className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl border-[3px] border-arena-ink bg-arena-ok px-2.5 text-sm font-black tracking-wide text-arena-ink uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)] sm:h-11 sm:flex-none sm:px-3"
                    title="Free roam on the practice range — dummies, no match"
                  >
                    <GameIcon src={icons.aim} className="size-4" />
                    <span className="truncate">Practice</span>
                  </button>
                )}
                {onTutorial && (
                  <button
                    type="button"
                    onClick={handleTutorial}
                    className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl border-[3px] border-arena-ink bg-arena-tech px-2.5 text-sm font-black tracking-wide text-arena-ink uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)] sm:h-11 sm:flex-none sm:px-3"
                    title="Guided how-to-play on the practice range"
                  >
                    <GameIcon src={icons.star} className="size-4" />
                    <span className="truncate">Tutorial</span>
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={handlePlay}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border-[3px] border-arena-ink bg-arena-heat px-4 text-base font-black tracking-wide text-arena-ink uppercase shadow-[3px_4px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[3px_5px_0_var(--arena-ink)] active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)] sm:h-11 sm:w-auto sm:px-5"
            >
              <GameIcon src={icons.rocket} className="size-5" />
              Deploy
            </button>
          </div>
        </div>
      </HudPanel>
    </motion.div>
  )
}
