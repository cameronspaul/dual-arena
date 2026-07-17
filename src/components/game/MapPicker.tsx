import { useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, Moon, Sparkles, Sun } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  SiDiscord,
  SiInstagram,
  SiTiktok,
  SiX,
  SiYoutube,
} from 'react-icons/si'

import { CharacterPreview } from '@/components/game/CharacterPreview'
import { SettingsDialog } from '@/components/SettingsDialog'
import { Button } from '@/components/ui/button'
import { icons, WAGER_ICONS } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { gameAudio } from '@/game/audio'
import { MAP_LIST, type MapId } from '@/game/maps'
import {
  SKYBOX_IDS,
  SKYBOX_LABELS,
  type SkyboxPreference,
} from '@/game/scene/skyboxes'
import {
  useAppStore,
  type ServerRegion,
  type WagerAmount,
} from '@/stores/useAppStore'

const WAGER_OPTIONS: WagerAmount[] = [1, 3, 5, 10]
const SKYBOX_OPTIONS: SkyboxPreference[] = [...SKYBOX_IDS, 'random']

const PRESET_COLORS = [
  '#a855f7',
  '#f59e0b',
  '#22d3ee',
  '#ef4444',
  '#22c55e',
  '#ec4899',
  '#3b82f6',
  '#eab308',
] as const

const COMMUNITY_LINKS = [
  {
    label: 'Discord',
    href: 'https://discord.gg/',
    icon: SiDiscord,
    className: 'bg-[#5865F2] text-white',
  },
  {
    label: 'YouTube',
    href: 'https://youtube.com/',
    icon: SiYoutube,
    className: 'bg-[#FF0000] text-white',
  },
  {
    label: 'Instagram',
    href: 'https://instagram.com/',
    icon: SiInstagram,
    className:
      'bg-gradient-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] text-white',
  },
  {
    label: 'TikTok',
    href: 'https://tiktok.com/',
    icon: SiTiktok,
    className: 'bg-black text-white',
  },
  {
    label: 'X',
    href: 'https://x.com/',
    icon: SiX,
    className: 'bg-black text-white',
  },
] as const

interface MapPickerProps {
  selectedId: MapId
  onSelect: (id: MapId) => void
  skybox: SkyboxPreference
  onSkyboxChange: (sky: SkyboxPreference) => void
  onPlay: () => void
  /** Start an online 1v1 against the configured server / match id. */
  onPlayOnline?: () => void
}

/** Decorative game PNG icon from /public/icons (cartoon outline set). */
function GameIcon({
  src,
  className,
}: {
  src: string
  className?: string
}) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className={cn(
        'shrink-0 object-contain select-none drop-shadow-[0_2px_0_rgba(0,0,0,0.25)]',
        className,
      )}
    />
  )
}

function SkyIcon({ id }: { id: SkyboxPreference }) {
  if (id === 'night' || id === 'space') return <Moon className="size-3.5" />
  if (id === 'random') return <Sparkles className="size-3.5" />
  return <Sun className="size-3.5" />
}

function MapThumb({
  mapId,
  thumbUrl,
  name,
  active,
}: {
  mapId: MapId
  thumbUrl?: string
  name: string
  active: boolean
}) {
  // Practice range has no thumb — procedural gradient stand-in
  if (!thumbUrl) {
    return (
      <div
        className={cn(
          'absolute inset-0 bg-gradient-to-br from-slate-600 via-slate-700 to-slate-900',
          active && 'from-amber-700/80 via-slate-700 to-slate-900',
        )}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <GameIcon src={icons.aim} className="size-12 opacity-30" />
        </div>
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
            backgroundSize: '16px 16px',
          }}
        />
        <span className="sr-only">{name}</span>
      </div>
    )
  }

  return (
    <img
      src={thumbUrl}
      alt={name}
      loading="lazy"
      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
      data-map={mapId}
    />
  )
}

function Chip({
  active,
  children,
  onClick,
  className,
  title,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
  className?: string
  title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border-[2.5px] px-3 text-xs font-extrabold transition-all',
        active
          ? 'border-foreground/90 bg-primary text-primary-foreground shadow-[2px_3px_0_oklch(0.2_0.03_260)]'
          : 'border-border bg-muted/40 text-muted-foreground shadow-[1px_2px_0_oklch(0.2_0.03_260/_0.12)] hover:-translate-y-0.5 hover:border-primary/50 hover:bg-muted/70 hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}

function SideSection({
  iconSrc,
  title,
  children,
  className,
}: {
  iconSrc: string
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-2">
        <GameIcon src={iconSrc} className="size-5" />
        <h3 className="text-[11px] font-extrabold tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
      </div>
      {children}
    </div>
  )
}

/** Shared sticker card shell for lobby panels. */
function StickerCard({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border-[3px] border-foreground/85 bg-card p-4 shadow-[3px_4px_0_oklch(0.2_0.03_260/_0.55)] sm:p-5',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function MapPicker({
  selectedId,
  onSelect,
  skybox,
  onSkyboxChange,
  onPlay,
  onPlayOnline,
}: MapPickerProps) {
  const {
    theme,
    toggleTheme,
    username,
    setUsername,
    characterColor,
    setCharacterColor,
    serverRegion,
    setServerRegion,
    wagerAmount,
    setWagerAmount,
    balance,
    serverUrl,
    setServerUrl,
    matchId,
    setMatchId,
  } = useAppStore()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(username)
  const [showOnline, setShowOnline] = useState(true)

  const selected = MAP_LIST.find((m) => m.id === selectedId) ?? MAP_LIST[0]
  const displayName = username.trim() || 'Operator'

  const commitName = () => {
    setUsername(nameDraft.trim())
    setEditingName(false)
    gameAudio.uiClick()
  }

  const selectedIndex = useMemo(
    () => MAP_LIST.findIndex((m) => m.id === selectedId),
    [selectedId],
  )

  const handlePlay = () => {
    gameAudio.uiConfirm()
    onPlay()
  }

  const handlePlayOnline = () => {
    gameAudio.uiConfirm()
    onPlayOnline?.()
  }

  return (
    <div className="relative flex min-h-svh flex-col overflow-x-hidden bg-background text-foreground">
      {/* Atmosphere */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_-10%,_oklch(0.55_0.16_55/_0.22),_transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_95%_60%,_oklch(0.45_0.1_200/_0.14),_transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_120%,_oklch(0.15_0.03_260/_0.55),_transparent_55%)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* ── Top bar ── */}
      <header className="relative z-20 flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border-[3px] border-foreground/85 bg-primary shadow-[2px_3px_0_oklch(0.2_0.03_260/_0.55)]">
            <GameIcon src={icons.aim} className="size-7" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-base font-black tracking-tight sm:text-lg">
              Dual Arena
            </div>
            <div className="hidden text-[10px] font-extrabold tracking-wide text-muted-foreground uppercase sm:block">
              Sniper 1v1
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border-[2.5px] border-foreground/80 bg-arena-tech/20 px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-arena-tech uppercase shadow-[1px_2px_0_oklch(0.2_0.03_260/_0.35)] sm:inline-flex">
            <GameIcon src={icons.bolt} className="size-3.5" />
            Practice mode
          </span>
          <div
            className="hidden items-center gap-1.5 rounded-xl border-[2.5px] border-foreground/80 bg-card px-2.5 py-1.5 shadow-[2px_2px_0_oklch(0.2_0.03_260/_0.4)] sm:inline-flex"
            title="Soft currency (coming with online stakes)"
          >
            <GameIcon src={icons.coins} className="size-4" />
            <span className="text-xs font-extrabold tabular-nums text-foreground">
              {balance}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              gameAudio.uiClick()
              toggleTheme()
            }}
            className="inline-flex size-10 items-center justify-center rounded-xl border-[2.5px] border-foreground/80 bg-card text-foreground shadow-[2px_2px_0_oklch(0.2_0.03_260/_0.4)] transition-all hover:-translate-y-0.5 hover:bg-muted"
            aria-label="Toggle theme"
          >
            {theme === 'light' ? (
              <Moon className="size-4 text-primary" />
            ) : (
              <Sun className="size-4 text-primary" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              gameAudio.uiClick()
              setSettingsOpen(true)
            }}
            className="inline-flex size-10 items-center justify-center rounded-xl border-[2.5px] border-foreground/80 bg-card text-foreground shadow-[2px_2px_0_oklch(0.2_0.03_260/_0.4)] transition-all hover:-translate-y-0.5 hover:bg-muted sm:w-auto sm:gap-2 sm:px-3"
            aria-label="Settings"
          >
            <GameIcon src={icons.settings} className="size-5" />
            <span className="hidden text-sm font-extrabold sm:inline">
              Settings
            </span>
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 pb-6 sm:px-6 lg:px-10">
        {/* ── Hero strip ── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-extrabold tracking-wide text-primary uppercase">
              <GameIcon src={icons.aim} className="size-4" />
              One shot
              <span className="text-primary/40">·</span>
              <GameIcon src={icons.coins} className="size-4" />
              One stake
              <span className="text-primary/40">·</span>
              <GameIcon src={icons.trophy} className="size-4" />
              Prove it
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
              Pick a map. Deploy. Train your aim.
            </h1>
            <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
              Offline sniper practice with dummies, or join an online 1v1 —
              server owns hits, ammo, and score.
            </p>
          </div>
          <div className="hidden items-center gap-2 sm:flex" aria-hidden>
            <GameIcon src={icons.map} className="size-8 opacity-80" />
            <GameIcon src={icons.flag} className="size-8 opacity-80" />
            <GameIcon src={icons.rocket} className="size-8 opacity-80" />
          </div>
        </motion.div>

        {/* ── Main layout: maps + loadout ── */}
        <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_340px] xl:gap-6">
          {/* LEFT: Map selection + deploy */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.35 }}
            className="flex min-h-0 flex-col"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GameIcon src={icons.map} className="size-5" />
                <h2 className="text-sm font-semibold tracking-tight">
                  Choose map
                </h2>
                <span className="rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                  {selectedIndex + 1}/{MAP_LIST.length}
                </span>
              </div>
            </div>

            {/* Map grid */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
              {MAP_LIST.map((map, i) => {
                const active = map.id === selectedId
                return (
                  <motion.button
                    key={map.id}
                    type="button"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.04 + i * 0.03 }}
                    onClick={() => {
                      gameAudio.uiClick()
                      onSelect(map.id)
                    }}
                    className={cn(
                      'group relative aspect-[16/10] overflow-hidden rounded-2xl border-[3px] text-left transition-all',
                      active
                        ? 'border-foreground/90 shadow-[3px_4px_0_oklch(0.2_0.03_260/_0.55)] ring-2 ring-primary/60'
                        : 'border-foreground/50 shadow-[2px_2px_0_oklch(0.2_0.03_260/_0.2)] hover:-translate-y-0.5 hover:border-primary/70 hover:shadow-[3px_3px_0_oklch(0.2_0.03_260/_0.35)]',
                    )}
                  >
                    <MapThumb
                      mapId={map.id}
                      thumbUrl={map.thumbUrl}
                      name={map.name}
                      active={active}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

                    {active && (
                      <div className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full border-[2.5px] border-foreground/90 bg-primary shadow-[2px_2px_0_oklch(0.2_0.03_260/_0.55)]">
                        <GameIcon src={icons.check} className="size-4" />
                      </div>
                    )}

                    <div className="absolute inset-x-0 bottom-0 p-2.5 sm:p-3">
                      <div
                        className={cn(
                          'truncate text-xs font-bold sm:text-sm',
                          active ? 'text-primary' : 'text-white',
                        )}
                      >
                        {map.name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {map.tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-black/40 px-1.5 py-px text-[9px] font-medium tracking-wide text-white/70 uppercase backdrop-blur-sm"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </motion.button>
                )
              })}
            </div>

            {/* Selected map detail + sky + CTA */}
            <StickerCard className="mt-4">
              <AnimatePresence mode="wait">
                <motion.div
                  key={selected.id}
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={{ duration: 0.18 }}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <GameIcon src={icons.location} className="size-5" />
                        <h3 className="text-lg font-bold tracking-tight">
                          {selected.name}
                        </h3>
                        {selected.kind === 'range' && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-arena-ok/30 bg-arena-ok/10 px-1.5 py-0.5 text-[10px] font-semibold text-arena-ok uppercase">
                            <GameIcon src={icons.star} className="size-3.5" />
                            Best for new players
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {selected.blurb}
                      </p>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>

              {/* Skybox */}
              <div className="mt-4 border-t border-border/50 pt-4">
                <div className="mb-2 flex items-center gap-2">
                  <GameIcon src={icons.compass} className="size-4" />
                  <span className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                    Sky
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SKYBOX_OPTIONS.map((id) => (
                    <Chip
                      key={id}
                      active={skybox === id}
                      onClick={() => {
                        gameAudio.uiClick()
                        onSkyboxChange(id)
                      }}
                    >
                      <SkyIcon id={id} />
                      {SKYBOX_LABELS[id]}
                    </Chip>
                  ))}
                </div>
              </div>

              {/* Primary CTA */}
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  size="lg"
                  className="h-12 w-full gap-2 rounded-xl border-[3px] border-foreground/90 text-base font-black shadow-[3px_4px_0_oklch(0.2_0.03_260/_0.55)] sm:h-14 sm:flex-1 sm:text-lg"
                  onClick={handlePlay}
                >
                  <GameIcon src={icons.rocket} className="size-6" />
                  Deploy to {selected.name}
                  <ChevronRight className="size-4 opacity-70" />
                </Button>
                <div className="hidden text-center text-[11px] text-muted-foreground sm:block sm:max-w-[140px] sm:text-left">
                  Click in-game to lock mouse.
                  <br />
                  <span className="text-foreground/70">Esc</span> opens menu.
                </div>
              </div>
            </StickerCard>
          </motion.section>

          {/* RIGHT: Identity / loadout sidebar */}
          <motion.aside
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.35 }}
            className="flex flex-col gap-4"
          >
            <StickerCard className="flex flex-1 flex-col gap-5">
              {/* Username */}
              <SideSection iconSrc={icons.cap} title="Callsign">
                <div className="flex gap-2">
                  {editingName ? (
                    <input
                      autoFocus
                      value={nameDraft}
                      maxLength={24}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitName()
                        if (e.key === 'Escape') {
                          setNameDraft(username)
                          setEditingName(false)
                        }
                      }}
                      onBlur={commitName}
                      placeholder="Enter name"
                      className="h-11 flex-1 rounded-xl border border-primary/40 bg-background/70 px-3 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-primary"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        gameAudio.uiClick()
                        setNameDraft(username)
                        setEditingName(true)
                      }}
                      className="flex h-11 flex-1 items-center justify-between rounded-xl border border-border/70 bg-background/40 px-3 text-left text-sm transition-colors hover:border-primary/35"
                    >
                      <span
                        className={cn(
                          'truncate font-medium',
                          username.trim()
                            ? 'text-foreground'
                            : 'text-muted-foreground',
                        )}
                      >
                        {username.trim() || 'Set your name'}
                      </span>
                      <GameIcon
                        src={icons.pencil}
                        className="size-4 shrink-0 opacity-70"
                      />
                    </button>
                  )}
                </div>
              </SideSection>

              {/* Character */}
              <SideSection iconSrc={icons.brush} title="Appearance">
                <div className="relative overflow-hidden rounded-xl border border-border/60 bg-gradient-to-b from-muted/50 to-background/80">
                  <div className="absolute inset-x-0 top-2 z-10 flex items-center justify-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">
                    <GameIcon src={icons.verified} className="size-3.5 opacity-80" />
                    {displayName}
                  </div>
                  <CharacterPreview
                    color={characterColor}
                    className="h-[200px] w-full sm:h-[220px]"
                  />
                  <div
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent"
                    aria-hidden
                  />
                </div>

                <div className="flex flex-wrap justify-center gap-2 pt-1">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Color ${c}`}
                      onClick={() => {
                        gameAudio.uiClick()
                        setCharacterColor(c)
                      }}
                      className={cn(
                        'size-8 rounded-full border-2 transition-transform hover:scale-110',
                        characterColor.toLowerCase() === c
                          ? 'scale-110 border-white shadow-md ring-2 ring-primary/50'
                          : 'border-transparent opacity-85 hover:opacity-100',
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>

                <label className="flex w-full cursor-pointer items-center gap-2">
                  <span className="sr-only">Custom color</span>
                  <input
                    type="color"
                    value={characterColor}
                    onChange={(e) => setCharacterColor(e.target.value)}
                    className="h-9 w-full cursor-pointer rounded-lg border border-border/70 bg-muted/30 p-1"
                  />
                </label>
              </SideSection>

              {/* Quick summary before deploy (mobile helper) */}
              <div className="rounded-xl border border-border/60 bg-muted/25 p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  <GameIcon src={icons.inv} className="size-3.5" />
                  Ready loadout
                </div>
                <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                  <li className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <GameIcon src={icons.map} className="size-3.5" />
                      Map
                    </span>
                    <span className="truncate font-semibold text-foreground">
                      {selected.name}
                    </span>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <GameIcon src={icons.compass} className="size-3.5" />
                      Sky
                    </span>
                    <span className="font-semibold text-foreground">
                      {SKYBOX_LABELS[skybox]}
                    </span>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <GameIcon src={icons.cap} className="size-3.5" />
                      Operator
                    </span>
                    <span className="truncate font-semibold text-foreground">
                      {displayName}
                    </span>
                  </li>
                </ul>
              </div>

              {/* Mobile deploy (mirrors primary CTA) */}
              <Button
                size="lg"
                className="h-12 w-full gap-2 rounded-xl border-[3px] border-foreground/90 font-black shadow-[3px_4px_0_oklch(0.2_0.03_260/_0.55)] lg:hidden"
                onClick={handlePlay}
              >
                <GameIcon src={icons.rocket} className="size-5" />
                Deploy
              </Button>
            </StickerCard>

            {/* Online 1v1 — invite join (server-authoritative) */}
            <StickerCard className="border-primary/50">
              <button
                type="button"
                onClick={() => {
                  gameAudio.uiClick()
                  setShowOnline((v) => !v)
                }}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <div className="flex items-center gap-2">
                  <GameIcon src={icons.globe} className="size-4" />
                  <span className="text-sm font-semibold">Online 1v1</span>
                  <span className="inline-flex items-center gap-1 rounded-md border border-arena-ok/40 bg-arena-ok/10 px-1.5 py-0.5 text-[10px] font-medium text-arena-ok">
                    Live
                  </span>
                </div>
                <ChevronRight
                  className={cn(
                    'size-4 text-muted-foreground transition-transform',
                    showOnline && 'rotate-90',
                  )}
                />
              </button>

              <AnimatePresence initial={false}>
                {showOnline && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 space-y-3 border-t border-border/50 pt-3">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Share the same match id with a friend. Server owns
                        damage, ammo, and score. Run{' '}
                        <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                          npm run dev:server
                        </code>{' '}
                        locally.
                      </p>

                      <div>
                        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                          <GameIcon src={icons.globe} className="size-3.5" />
                          Server URL
                        </div>
                        <input
                          type="text"
                          value={serverUrl}
                          onChange={(e) => setServerUrl(e.target.value)}
                          spellCheck={false}
                          className="w-full rounded-lg border border-border/70 bg-background/80 px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary/50"
                          placeholder="ws://localhost:2567"
                        />
                      </div>

                      <div>
                        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                          <GameIcon src={icons.friend} className="size-3.5" />
                          Match / invite id
                        </div>
                        <input
                          type="text"
                          value={matchId}
                          onChange={(e) => setMatchId(e.target.value)}
                          spellCheck={false}
                          className="w-full rounded-lg border border-border/70 bg-background/80 px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary/50"
                          placeholder="duel-1"
                        />
                      </div>

                      <div>
                        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                          <GameIcon src={icons.location} className="size-3.5" />
                          Preferred region
                        </div>
                        <div className="flex gap-1.5">
                          {(
                            [
                              { id: 'us-east' as ServerRegion, label: 'US East' },
                              { id: 'eu' as ServerRegion, label: 'EU' },
                            ] as const
                          ).map((r) => (
                            <Chip
                              key={r.id}
                              active={serverRegion === r.id}
                              className="flex-1"
                              onClick={() => {
                                gameAudio.uiClick()
                                setServerRegion(r.id)
                              }}
                            >
                              <GameIcon src={icons.globe} className="size-3.5" />
                              {r.label}
                            </Chip>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                          <GameIcon src={icons.trade} className="size-3.5" />
                          Preferred stake
                        </div>
                        <div className="flex gap-1.5">
                          {WAGER_OPTIONS.map((w, i) => (
                            <Chip
                              key={w}
                              active={wagerAmount === w}
                              className="flex-1 px-0"
                              onClick={() => {
                                gameAudio.uiClick()
                                setWagerAmount(w)
                              }}
                            >
                              <GameIcon
                                src={WAGER_ICONS[i] ?? icons.coins}
                                className="size-4"
                              />
                              ${w}
                            </Chip>
                          ))}
                        </div>
                      </div>

                      <Button
                        type="button"
                        className="w-full gap-2 border-[2.5px] border-foreground/90 font-extrabold shadow-[2px_3px_0_oklch(0.2_0.03_260/_0.5)]"
                        disabled={!onPlayOnline || !serverUrl.trim()}
                        onClick={handlePlayOnline}
                      >
                        <GameIcon src={icons.aim} className="size-4" />
                        Join duel
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </StickerCard>

            {/* Community compact */}
            <StickerCard>
              <p className="flex items-center justify-center gap-1.5 text-center text-xs font-extrabold text-muted-foreground">
                <GameIcon src={icons.friend} className="size-4" />
                Join the community
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {COMMUNITY_LINKS.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={link.label}
                    onClick={() => gameAudio.uiClick()}
                    className={cn(
                      'inline-flex size-9 items-center justify-center rounded-full border-[2.5px] border-foreground/80 shadow-[2px_2px_0_oklch(0.2_0.03_260/_0.45)] transition-transform hover:scale-110',
                      link.className,
                    )}
                  >
                    <link.icon className="size-3.5" />
                  </a>
                ))}
              </div>
            </StickerCard>
          </motion.aside>
        </div>

        <p className="mt-6 text-center text-[10px] text-muted-foreground/50">
          Sniper viewmodel © DJMaesen (CC BY 4.0) · public/models/CREDITS.md
        </p>
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
