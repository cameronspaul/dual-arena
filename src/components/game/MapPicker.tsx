import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  SiDiscord,
  SiInstagram,
  SiSolana,
  SiTiktok,
  SiX,
  SiYoutube,
} from 'react-icons/si'

import { CharacterPreview } from '@/components/game/CharacterPreview'
import { SettingsDialog } from '@/components/SettingsDialog'
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

/** Cartoon PNG from /public/icons — thick outline sticker set (matches HUD). */
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
        'shrink-0 object-contain select-none drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]',
        className,
      )}
    />
  )
}

/**
 * Cartoon sticker panel — thick ink border, hard drop shadow, chunky radius.
 * Same language as GameHud HudPanel.
 */
function HudPanel({
  children,
  className,
  accent = 'none',
}: {
  children: ReactNode
  className?: string
  accent?: 'heat' | 'tech' | 'danger' | 'ok' | 'none'
}) {
  return (
    <div
      className={cn(
        'relative rounded-2xl border-[3px] border-arena-ink bg-arena-panel shadow-[3px_4px_0_var(--arena-ink)]',
        accent === 'heat' && 'ring-2 ring-arena-heat/50',
        accent === 'tech' && 'ring-2 ring-arena-tech/50',
        accent === 'danger' && 'ring-2 ring-arena-danger/55',
        accent === 'ok' && 'ring-2 ring-arena-ok/50',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-3 top-0 h-2 rounded-b-full bg-arena-sheen" />
      {children}
    </div>
  )
}

function ChromeBtn({
  children,
  onClick,
  title,
  className,
}: {
  children: ReactNode
  onClick?: () => void
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex size-10 items-center justify-center rounded-xl border-[3px] border-arena-ink bg-arena-panel text-arena-fg shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-arena-hover hover:shadow-[2px_4px_0_var(--arena-ink)] active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]',
        className,
      )}
    >
      {children}
    </button>
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
        'inline-flex h-8 items-center justify-center gap-1 rounded-xl border-[2.5px] border-arena-ink px-2.5 text-[11px] font-extrabold transition-all',
        active
          ? 'bg-arena-heat text-arena-ink shadow-[2px_3px_0_var(--arena-ink)]'
          : 'bg-arena-surface text-arena-fg/70 shadow-[1px_2px_0_var(--arena-ink)] hover:-translate-y-0.5 hover:bg-arena-hover hover:text-arena-fg',
        className,
      )}
    >
      {children}
    </button>
  )
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
  if (!thumbUrl) {
    return (
      <div
        className={cn(
          'absolute inset-0 bg-gradient-to-br from-slate-600 via-slate-700 to-slate-900',
          active && 'from-amber-700/80 via-slate-700 to-slate-900',
        )}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <GameIcon src={icons.aim} className="size-10 opacity-30" />
        </div>
        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
            backgroundSize: '14px 14px',
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
      className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
      data-map={mapId}
    />
  )
}

function SectionLabel({
  iconSrc,
  children,
}: {
  iconSrc: string
  children: ReactNode
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <GameIcon src={iconSrc} className="size-3.5" />
      <span className="text-[10px] font-extrabold tracking-wide text-arena-fg/45 uppercase">
        {children}
      </span>
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
  /** Map carousel page — 2 maps visible at a time (1×2). */
  const [mapPage, setMapPage] = useState(0)

  const selected = MAP_LIST.find((m) => m.id === selectedId) ?? MAP_LIST[0]
  const displayName = username.trim() || 'Operator'

  /** Lobby backdrop: selected map art when available, else a duel-map thumb. */
  const backdropUrl = useMemo(() => {
    if (selected.thumbUrl) return selected.thumbUrl
    const withThumb = MAP_LIST.find((m) => m.thumbUrl)
    return withThumb?.thumbUrl ?? '/maps/thumbs/arena-v3.png'
  }, [selected.thumbUrl])

  const mapsPerPage = 2
  const mapPageCount = Math.max(1, Math.ceil(MAP_LIST.length / mapsPerPage))

  const selectedIndex = useMemo(
    () => MAP_LIST.findIndex((m) => m.id === selectedId),
    [selectedId],
  )

  // When selection changes (e.g. URL / external), show that map's page
  useEffect(() => {
    if (selectedIndex < 0) return
    setMapPage(Math.floor(selectedIndex / mapsPerPage))
  }, [selectedIndex])

  const visibleMaps = useMemo(() => {
    const start = mapPage * mapsPerPage
    return MAP_LIST.slice(start, start + mapsPerPage)
  }, [mapPage])

  const commitName = () => {
    setUsername(nameDraft.trim())
    setEditingName(false)
    gameAudio.uiClick()
  }

  const shiftMapPage = (dir: -1 | 1) => {
    gameAudio.uiClick()
    setMapPage((p) => (p + dir + mapPageCount) % mapPageCount)
  }

  const handlePlay = () => {
    gameAudio.uiConfirm()
    onPlay()
  }

  const handlePlayOnline = () => {
    gameAudio.uiConfirm()
    onPlayOnline?.()
  }

  const solBalanceLabel = balance.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })

  return (
    <div className="relative flex h-svh w-full flex-col overflow-hidden bg-arena-void text-arena-fg">
      {/* Cinematic map backdrop — tracks selection, stays dark under HUD */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <AnimatePresence mode="sync" initial={false}>
          <motion.img
            key={backdropUrl}
            src={backdropUrl}
            alt=""
            initial={{ opacity: 0, scale: 1.08 }}
            animate={{ opacity: 1, scale: 1.16 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-[6px] saturate-[1.05] brightness-[0.85] dark:brightness-[0.7]"
            draggable={false}
          />
        </AnimatePresence>
        {/* Theme-aware scrims so sticker panels stay readable */}
        <div className="absolute inset-0 bg-arena-scrim" />
        <div className="absolute inset-0 bg-gradient-to-t from-arena-void via-arena-void/60 to-arena-void/20" />
        <div className="absolute inset-0 bg-gradient-to-r from-arena-void/75 via-transparent to-arena-void/70" />
        <div className="absolute inset-0 bg-arena-vignette [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black_100%)] [-webkit-mask-image:radial-gradient(ellipse_at_center,transparent_20%,black_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,_oklch(0.55_0.16_55/_0.12),_transparent_45%)]" />
      </div>

      {/* ── Top bar (utilities only) ── */}
      <header className="relative z-20 flex shrink-0 items-center justify-end gap-2 px-3 pt-3 sm:px-5">
        <span className="hidden items-center gap-1.5 rounded-xl border-[2.5px] border-arena-ink bg-arena-panel px-2.5 py-1.5 text-[10px] font-extrabold tracking-wide text-arena-tech uppercase shadow-[2px_2px_0_var(--arena-ink)] sm:inline-flex">
          <GameIcon src={icons.bolt} className="size-3.5" />
          Practice
        </span>
        <ChromeBtn
          onClick={() => {
            gameAudio.uiClick()
            toggleTheme()
          }}
          title={theme === 'light' ? 'Dark mode' : 'Light mode'}
        >
          {theme === 'light' ? (
            <Moon className="size-4 text-arena-heat" />
          ) : (
            <Sun className="size-4 text-arena-heat" />
          )}
        </ChromeBtn>
        <ChromeBtn
          onClick={() => {
            gameAudio.uiClick()
            setSettingsOpen(true)
          }}
          title="Settings"
        >
          <GameIcon src={icons.settings} className="size-5" />
        </ChromeBtn>
      </header>

      {/*
        Layout (lg+):
          [ SOL balance ] [ Online 1v1 ] [ Callsign + walking character ]
          [ Map 1×2 + sky …………… ]   [ Community                    ]
      */}
      <main
        className={cn(
          'relative z-10 mx-auto grid min-h-0 w-full max-w-7xl flex-1 gap-2.5 overflow-hidden p-2.5 sm:gap-3 sm:p-3 md:p-4',
          'grid-cols-1',
          'lg:grid-cols-[minmax(11.5rem,14rem)_minmax(0,1fr)_minmax(16rem,20rem)]',
          'lg:grid-rows-[minmax(0,1fr)_auto]',
        )}
      >
        {/* SOL balance — compact left */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28 }}
          className="min-h-0 lg:col-start-1 lg:row-start-1"
        >
          <HudPanel className="flex h-full flex-col p-3 sm:p-3.5" accent="heat">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5">
                <SiSolana className="size-3.5 text-[#9945FF]" aria-hidden />
                <h2 className="text-[10px] font-extrabold tracking-wide text-arena-fg/55 uppercase">
                  Balance
                </h2>
              </div>
              <span className="rounded-md border-[2px] border-arena-ink bg-arena-surface px-1.5 py-0.5 text-[8px] font-extrabold tracking-wide text-[#14F195]/80 uppercase">
                Solana
              </span>
            </div>

            <div className="mt-3 flex min-h-0 flex-1 flex-col items-center justify-center text-center">
              <div className="mb-2 flex size-11 items-center justify-center rounded-xl border-[3px] border-arena-ink bg-gradient-to-br from-[#9945FF]/35 to-[#14F195]/25 shadow-[2px_3px_0_var(--arena-ink)]">
                <SiSolana className="size-5 text-arena-fg" aria-hidden />
              </div>
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-2xl font-black tabular-nums tracking-tight text-arena-heat drop-shadow-[0_2px_0_var(--arena-ink)] sm:text-3xl">
                  {solBalanceLabel}
                </span>
                <span className="text-xs font-extrabold text-arena-fg/45">SOL</span>
              </div>
              <p className="mt-1 text-[10px] font-semibold text-arena-fg/40">
                Wallet not connected
              </p>
            </div>

            <button
              type="button"
              onClick={() => gameAudio.uiClick()}
              className="mt-3 inline-flex h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl border-[3px] border-arena-ink bg-arena-heat px-2 text-[11px] font-black tracking-wide text-arena-ink uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]"
              title="Connect Solana wallet — coming soon"
            >
              <SiSolana className="size-3.5" aria-hidden />
              Connect
            </button>
          </HudPanel>
        </motion.div>

        {/* Online 1v1 — top middle */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.04, duration: 0.28 }}
          className="min-h-0 lg:col-start-2 lg:row-start-1"
        >
          <HudPanel
            className="flex h-full min-h-0 flex-col overflow-hidden p-3 sm:p-3.5"
            accent="ok"
          >
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <GameIcon src={icons.globe} className="size-4" />
                <span className="text-sm font-extrabold">Online 1v1</span>
              </div>
              <span className="inline-flex items-center gap-1 rounded-md border-[2px] border-arena-ink bg-arena-ok/25 px-1.5 py-0.5 text-[9px] font-extrabold text-arena-ok uppercase">
                <GameIcon src={icons.fire} className="size-3" />
                Live
              </span>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-2 sm:grid-cols-2">
              <div>
                <SectionLabel iconSrc={icons.globe}>Server</SectionLabel>
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  spellCheck={false}
                  className="w-full rounded-lg border-[2px] border-arena-ink bg-arena-surface px-2 py-1.5 font-mono text-[11px] text-arena-fg outline-none focus:border-arena-tech"
                  placeholder="ws://localhost:2567"
                />
              </div>

              <div>
                <SectionLabel iconSrc={icons.friend}>Match id</SectionLabel>
                <input
                  type="text"
                  value={matchId}
                  onChange={(e) => setMatchId(e.target.value)}
                  spellCheck={false}
                  className="w-full rounded-lg border-[2px] border-arena-ink bg-arena-surface px-2 py-1.5 font-mono text-[11px] text-arena-fg outline-none focus:border-arena-tech"
                  placeholder="duel-1"
                />
              </div>

              <div className="sm:col-span-2">
                <SectionLabel iconSrc={icons.location}>Region</SectionLabel>
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
                      {r.label}
                    </Chip>
                  ))}
                </div>
              </div>

              <div className="sm:col-span-2">
                <SectionLabel iconSrc={icons.trade}>Stake</SectionLabel>
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
                        className="size-3.5"
                      />
                      ${w}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={!onPlayOnline || !serverUrl.trim()}
              onClick={handlePlayOnline}
              className="mt-2.5 inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl border-[3px] border-arena-ink bg-arena-ok px-4 text-xs font-black tracking-wide text-arena-ink uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 disabled:pointer-events-none disabled:opacity-40 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]"
            >
              <GameIcon src={icons.aim} className="size-5" />
              Join duel
            </button>
          </HudPanel>
        </motion.div>

        {/* Map 1×2 carousel — bottom left+middle */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, duration: 0.28 }}
          className="min-h-0 lg:col-span-2 lg:col-start-1 lg:row-start-2"
        >
          <HudPanel className="p-2.5 sm:p-3" accent="tech">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <GameIcon src={icons.map} className="size-4" />
                <h2 className="text-sm font-extrabold tracking-tight">Map</h2>
                <span className="rounded-md border-[2px] border-arena-ink/60 bg-arena-surface px-1.5 py-0.5 text-[10px] font-extrabold text-arena-fg/50 tabular-nums">
                  {selectedIndex + 1}/{MAP_LIST.length}
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

              <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5 sm:gap-2">
                {visibleMaps.map((map) => {
                  const active = map.id === selectedId
                  return (
                    <button
                      key={`${mapPage}-${map.id}`}
                      type="button"
                      onClick={() => {
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
                            'truncate text-xs font-extrabold text-white drop-shadow-[0_1px_0_rgba(0,0,0,0.8)] sm:text-sm',
                            active && 'text-arena-heat',
                          )}
                        >
                          {map.name}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {map.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="rounded border border-white/15 bg-black/45 px-1 py-px text-[8px] font-bold tracking-wide text-white/75 uppercase"
                            >
                              {tag}
                            </span>
                          ))}
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

            {/* Sky + selected + deploy */}
            <div className="mt-2.5 space-y-2.5 border-t-2 border-arena-ink/35 pt-2.5">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <GameIcon src={icons.compass} className="size-3.5" />
                  <span className="text-[10px] font-extrabold tracking-wide text-arena-fg/45 uppercase">
                    Sky
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {SKYBOX_OPTIONS.map((id) => (
                    <Chip
                      key={id}
                      active={skybox === id}
                      className="h-7 px-2 text-[10px]"
                      onClick={() => {
                        gameAudio.uiClick()
                        onSkyboxChange(id)
                      }}
                    >
                      {SKYBOX_LABELS[id]}
                    </Chip>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={selected.id}
                    initial={{ opacity: 0, x: 4 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -4 }}
                    transition={{ duration: 0.15 }}
                    className="min-w-0 flex-1"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <GameIcon src={icons.location} className="size-4" />
                      <h3 className="truncate text-sm font-black tracking-tight sm:text-base">
                        {selected.name}
                      </h3>
                      {selected.kind === 'range' && (
                        <span className="inline-flex items-center gap-1 rounded-md border-[2px] border-arena-ink bg-arena-ok/20 px-1.5 py-0.5 text-[9px] font-extrabold text-arena-ok uppercase">
                          <GameIcon src={icons.star} className="size-3" />
                          Training
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-[11px] font-semibold text-arena-fg/45">
                      {selected.blurb}
                    </p>
                  </motion.div>
                </AnimatePresence>

                <button
                  type="button"
                  onClick={handlePlay}
                  className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border-[3px] border-arena-ink bg-arena-heat px-5 text-sm font-black tracking-wide text-arena-ink uppercase shadow-[3px_4px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[3px_5px_0_var(--arena-ink)] active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)] sm:h-12 sm:px-6"
                >
                  <GameIcon src={icons.rocket} className="size-5" />
                  Deploy
                </button>
              </div>
            </div>
          </HudPanel>
        </motion.div>

        {/* RIGHT — callsign + walking character */}
        <motion.aside
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.28 }}
          className="flex min-h-0 flex-col gap-2.5 overflow-hidden max-lg:min-h-[22rem] lg:col-start-3 lg:row-span-2 lg:row-start-1"
        >
          <HudPanel
            className="flex min-h-0 flex-1 flex-col overflow-hidden p-2.5 sm:p-3"
            accent="none"
          >
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <GameIcon src={icons.cap} className="size-4" />
                <span className="text-[10px] font-extrabold tracking-wide text-arena-fg/45 uppercase">
                  Operator
                </span>
              </div>
              <span className="truncate text-[11px] font-extrabold text-arena-tech">
                {displayName}
              </span>
            </div>

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
                className="mb-2 h-9 w-full shrink-0 rounded-xl border-[2.5px] border-arena-tech/50 bg-arena-surface px-3 text-sm font-bold text-arena-fg outline-none placeholder:text-arena-fg/35 focus:border-arena-tech"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  gameAudio.uiClick()
                  setNameDraft(username)
                  setEditingName(true)
                }}
                className="mb-2 flex h-9 w-full shrink-0 items-center justify-between rounded-xl border-[2.5px] border-arena-ink bg-arena-surface px-3 text-left text-sm transition-colors hover:bg-arena-hover"
              >
                <span
                  className={cn(
                    'truncate font-extrabold',
                    username.trim() ? 'text-arena-fg' : 'text-arena-fg/40',
                  )}
                >
                  {username.trim() || 'Set your name'}
                </span>
                <GameIcon
                  src={icons.pencil}
                  className="size-4 shrink-0 opacity-80"
                />
              </button>
            )}

            {/* Walking man — fills leftover column height */}
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border-[2.5px] border-arena-ink bg-gradient-to-b from-arena-surface/40 via-arena-surface to-arena-surface-strong">
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-1.5 pt-2">
                <GameIcon src={icons.speed} className="size-3.5 opacity-80" />
                <span className="text-[9px] font-extrabold tracking-wide text-arena-fg/40 uppercase">
                  Live preview
                </span>
              </div>
              <CharacterPreview
                animation="walk"
                spin={false}
                className="absolute inset-0 h-full w-full"
              />
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-arena-panel to-transparent"
                aria-hidden
              />
            </div>
          </HudPanel>

          <HudPanel className="hidden shrink-0 px-3 py-2 min-[700px]:block" accent="none">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold tracking-wide text-arena-fg/45 uppercase">
                <GameIcon src={icons.friend} className="size-3.5" />
                Community
              </span>
              <div className="flex items-center gap-1.5">
                {COMMUNITY_LINKS.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={link.label}
                    onClick={() => gameAudio.uiClick()}
                    className={cn(
                      'inline-flex size-7 items-center justify-center rounded-lg border-[2.5px] border-arena-ink shadow-[2px_2px_0_var(--arena-ink)] transition-transform hover:-translate-y-0.5 hover:scale-105',
                      link.className,
                    )}
                  >
                    <link.icon className="size-3" />
                  </a>
                ))}
              </div>
            </div>
          </HudPanel>
        </motion.aside>
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
