import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
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
import {
  SettingsDialog,
  type SettingsSection,
} from '@/components/SettingsDialog'
import { icons, WAGER_ICONS } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { gameAudio } from '@/game/audio'
import {
  DUEL_MAP_LIST,
  isDuelMapId,
  isMapId,
  MAP_LIST,
  type MapId,
} from '@/game/maps'
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
    href: 'https://discord.com/invite/KFTtqWbutQ',
    icon: SiDiscord,
    className: 'bg-[#5865F2] text-white',
  },
  {
    label: 'YouTube',
    href: 'https://www.youtube.com/@muxlabs',
    icon: SiYoutube,
    className: 'bg-[#FF0000] text-white',
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/muxlabs',
    icon: SiInstagram,
    className:
      'bg-gradient-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] text-white',
  },
  {
    label: 'TikTok',
    href: 'https://www.tiktok.com/@muxlabs',
    icon: SiTiktok,
    className: 'bg-black text-white',
  },
  {
    label: 'X',
    href: 'https://x.com/mux_labs',
    icon: SiX,
    className: 'bg-black text-white',
  },
] as const

export type OnlineLobbyJoin = {
  matchId: string
  /** Prefer the host's map when joining a listed lobby. */
  mapId?: MapId
  /** Soft stake from the lobby listing (display-only). */
  wager?: number
}

interface MapPickerProps {
  selectedId: MapId
  onSelect: (id: MapId) => void
  skybox: SkyboxPreference
  onSkyboxChange: (sky: SkyboxPreference) => void
  onPlay: () => void
  /** Offline free roam on the practice range. */
  onPracticeRange?: () => void
  /** Offline guided course on the practice range. */
  onTutorial?: () => void
  /** Host a new open lobby (map/region/stake from picker). */
  onHostOnline?: () => void
  /** Join an existing lobby by match id (optional map from browser). */
  onJoinOnline?: (lobby: OnlineLobbyJoin) => void
  /** Rejoin a mid-match lobby after disconnect/leave (same seat token). */
  onRejoinOnline?: () => void
}

type LobbyRow = {
  matchId: string
  mapId: string
  phase: string
  playerCount: number
  maxPlayers: number
  hostName: string
  wager: number
  createdAt: number
}

/** Homepage lobby watch: silent / sound+banner / sound+auto-join. */
type LobbyWatchMode = 'off' | 'notify' | 'auto'

const LOBBY_WATCH_KEY = 'dual-arena-lobby-watch'
const AUTO_JOIN_SECONDS = 5
/** Idle list poll — light load when not queue-watching. */
const LOBBY_POLL_IDLE_MS = 3000
/** Notify / Auto poll — snappier so queue-pop lands within ~1–2s of host. */
const LOBBY_POLL_WATCH_MS = 1500

function loadLobbyWatchMode(): LobbyWatchMode {
  try {
    const v = localStorage.getItem(LOBBY_WATCH_KEY)
    if (v === 'off' || v === 'notify' || v === 'auto') return v
  } catch {
    /* private mode / SSR */
  }
  return 'off'
}

function saveLobbyWatchMode(mode: LobbyWatchMode) {
  try {
    localStorage.setItem(LOBBY_WATCH_KEY, mode)
  } catch {
    /* ignore quota */
  }
}

function isJoinableLobby(lobby: LobbyRow): boolean {
  return lobby.playerCount < lobby.maxPlayers
}

/** Newest open lobby first (for queue-pop / auto-join pick). */
function pickNewestJoinable(list: LobbyRow[]): LobbyRow | null {
  const open = list.filter(isJoinableLobby)
  if (open.length === 0) return null
  open.sort((a, b) => b.createdAt - a.createdAt)
  return open[0] ?? null
}

/** ws(s)://host:port → http(s)://host:port for lobby HTTP polling. */
function httpBaseFromWs(wsUrl: string): string | null {
  const trimmed = wsUrl.trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed)
    if (u.protocol === 'ws:') u.protocol = 'http:'
    else if (u.protocol === 'wss:') u.protocol = 'https:'
    else if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.origin
  } catch {
    return null
  }
}

function mapLabel(mapId: string): string {
  const m = MAP_LIST.find((x) => x.id === mapId)
  return m?.name ?? mapId
}

/** 1v1 arena carousel only — practice range lives next to Tutorial. */
const PICKER_MAPS = DUEL_MAP_LIST

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
        'inline-flex h-9 items-center justify-center gap-1 rounded-xl border-[2.5px] border-arena-ink px-2.5 text-sm font-extrabold transition-all',
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
      <span className="text-xs font-extrabold tracking-wide text-arena-fg/45 uppercase">
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
  onPracticeRange,
  onTutorial,
  onHostOnline,
  onJoinOnline,
  onRejoinOnline,
}: MapPickerProps) {
  const {
    theme,
    toggleTheme,
    username,
    setUsername,
    characterAppearance,
    serverRegion,
    setServerRegion,
    wagerAmount,
    setWagerAmount,
    balance,
    serverUrl,
    setServerUrl,
    setMatchId,
    rejoinSession,
    clearRejoinSession,
  } = useAppStore()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<
    SettingsSection | undefined
  >(undefined)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(username)
  /** Map carousel page — 2 maps visible at a time (1×2). */
  const [mapPage, setMapPage] = useState(0)
  const [lobbies, setLobbies] = useState<LobbyRow[]>([])
  const [lobbyStatus, setLobbyStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>(
    'idle',
  )
  const [lobbyError, setLobbyError] = useState<string | null>(null)
  /** off = silent list · notify = sound + banner · auto = sound + 5s join. */
  const [lobbyWatchMode, setLobbyWatchMode] =
    useState<LobbyWatchMode>(loadLobbyWatchMode)
  /** Newest lobby that just appeared (notify mode banner). */
  const [notifiedLobby, setNotifiedLobby] = useState<LobbyRow | null>(null)
  /** Lobby waiting for auto-join countdown. */
  const [autoJoinTarget, setAutoJoinTarget] = useState<LobbyRow | null>(null)
  const [autoJoinLeft, setAutoJoinLeft] = useState(0)
  /** Seeded after first successful poll so existing rooms don't fire alerts. */
  const knownLobbyIdsRef = useRef<Set<string> | null>(null)
  const lobbyWatchModeRef = useRef(lobbyWatchMode)
  lobbyWatchModeRef.current = lobbyWatchMode
  /** True while a countdown (or just-fired join) owns the auto-join slot. */
  const autoJoinBusyRef = useRef(false)
  /** Drop overlapping lobby polls (interval + visibility refresh). */
  const lobbyFetchInFlightRef = useRef(false)
  /** Latest server URL for the poll loop (avoids stale closures). */
  const serverUrlRef = useRef(serverUrl)
  serverUrlRef.current = serverUrl
  /** Seconds left on the homepage rejoin CTA (ticks every 250ms). */
  const [rejoinLeft, setRejoinLeft] = useState(0)

  // Practice range is never a selectable picker state — fall back to first arena
  const selected =
    PICKER_MAPS.find((m) => m.id === selectedId) ??
    PICKER_MAPS[0] ??
    MAP_LIST.find((m) => m.duelEligible)!
  const canHostDuel = isDuelMapId(selectedId)
  const displayName = username.trim() || 'Operator'

  /** Lobby backdrop: selected map art when available, else a duel-map thumb. */
  const backdropUrl = useMemo(() => {
    if (selected.thumbUrl) return selected.thumbUrl
    const withThumb = PICKER_MAPS.find((m) => m.thumbUrl)
    return withThumb?.thumbUrl ?? '/maps/thumbs/arena-v3.png'
  }, [selected.thumbUrl])

  /** Three arena previews per page — practice range is a separate button. */
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

  /** Jump straight into free range — does not change the selected arena. */
  const handlePracticeRange = () => {
    gameAudio.uiConfirm()
    onPracticeRange?.()
  }

  const handleTutorial = () => {
    gameAudio.uiConfirm()
    onTutorial?.()
  }

  const handleHostOnline = () => {
    if (!canHostDuel) return
    gameAudio.uiConfirm()
    onHostOnline?.()
  }

  const handleJoinOnline = (lobby: OnlineLobbyJoin) => {
    gameAudio.stopLobbyNotify()
    gameAudio.uiConfirm()
    if (lobby.matchId) setMatchId(lobby.matchId)
    onJoinOnline?.(lobby)
  }

  const clearAutoJoin = () => {
    autoJoinBusyRef.current = false
    setAutoJoinTarget(null)
    setAutoJoinLeft(0)
    gameAudio.stopLobbyNotify()
  }

  const setWatchMode = (mode: LobbyWatchMode) => {
    gameAudio.uiClick()
    setLobbyWatchMode(mode)
    saveLobbyWatchMode(mode)
    if (mode === 'off') {
      setNotifiedLobby(null)
      clearAutoJoin()
    }
  }

  const cancelAutoJoin = () => {
    gameAudio.uiClick()
    clearAutoJoin()
  }

  const dismissNotify = () => {
    gameAudio.uiClick()
    setNotifiedLobby(null)
  }

  /**
   * Apply a lobby list snapshot (from SSE push or HTTP poll).
   * Detects newcomers for Notify / Auto queue alerts.
   */
  const applyLobbySnapshot = (next: LobbyRow[]) => {
    setLobbies(next)
    setLobbyStatus('ok')
    setLobbyError(null)

    const nextIds = new Set(next.map((l) => l.matchId))
    const known = knownLobbyIdsRef.current
    if (known == null) {
      // First successful snapshot — don't alert for rooms already open.
      knownLobbyIdsRef.current = nextIds
      return
    }

    const newcomers = next.filter((l) => !known.has(l.matchId))
    knownLobbyIdsRef.current = nextIds

    // Drop stale auto-join / notify if the room closed.
    setAutoJoinTarget((cur) => {
      if (cur && !nextIds.has(cur.matchId)) {
        autoJoinBusyRef.current = false
        setAutoJoinLeft(0)
        return null
      }
      return cur
    })
    setNotifiedLobby((cur) =>
      cur && !nextIds.has(cur.matchId) ? null : cur,
    )

    const mode = lobbyWatchModeRef.current
    if (mode === 'off' || newcomers.length === 0) return

    const pick = pickNewestJoinable(newcomers)
    if (!pick) return

    if (mode === 'notify') {
      gameAudio.lobbyNotify({ times: 2 })
      setNotifiedLobby(pick)
    } else if (mode === 'auto' && !autoJoinBusyRef.current) {
      gameAudio.lobbyNotify({ loop: true })
      autoJoinBusyRef.current = true
      setAutoJoinTarget(pick)
      setAutoJoinLeft(AUTO_JOIN_SECONDS)
    }
  }

  /**
   * HTTP poll fallback. Background ticks use `silent` so the list doesn't
   * flash a loading state. Prefer SSE — browsers throttle timers when hidden.
   */
  const refreshLobbies = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    const base = httpBaseFromWs(serverUrlRef.current)
    if (!base) {
      setLobbyStatus('error')
      setLobbyError('Invalid server URL')
      setLobbies([])
      return
    }
    if (lobbyFetchInFlightRef.current) return
    lobbyFetchInFlightRef.current = true
    if (!silent) {
      setLobbyStatus((s) => (s === 'ok' ? s : 'loading'))
      setLobbyError(null)
    }
    const ac = new AbortController()
    const timeoutId = window.setTimeout(() => ac.abort(), 8000)
    try {
      const res = await fetch(`${base}/lobbies`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: ac.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { lobbies?: LobbyRow[] }
      applyLobbySnapshot(Array.isArray(data.lobbies) ? data.lobbies : [])
    } catch (err) {
      // Keep the last good list on silent poll failures (transient blips).
      if (!silent) {
        setLobbies([])
        setLobbyStatus('error')
        setLobbyError(
          err instanceof Error ? err.message : 'Failed to load lobbies',
        )
      }
    } finally {
      window.clearTimeout(timeoutId)
      lobbyFetchInFlightRef.current = false
    }
  }

  // Live lobby feed: SSE push (works in background tabs) + slow poll backup.
  useEffect(() => {
    // New server URL → re-seed so we don't false-alert on a different region.
    knownLobbyIdsRef.current = null
    setNotifiedLobby(null)
    clearAutoJoin()

    const base = httpBaseFromWs(serverUrl)
    if (!base) {
      setLobbyStatus('error')
      setLobbyError('Invalid server URL')
      setLobbies([])
      return
    }

    let disposed = false
    let es: EventSource | null = null
    let pollId: number | null = null
    let reconnectId: number | null = null
    let sseHealthy = false

    const startPollFallback = (ms: number) => {
      if (pollId != null) window.clearInterval(pollId)
      pollId = window.setInterval(() => {
        void refreshLobbies({ silent: true })
      }, ms)
    }

    const connectSse = () => {
      if (disposed) return
      try {
        es?.close()
      } catch {
        /* ignore */
      }
      es = null

      try {
        // EventSource delivers pushed lobby lists even when the tab is hidden
        // (unlike setInterval, which browsers throttle hard in background).
        const stream = new EventSource(`${base}/lobbies/stream`)
        es = stream

        stream.onopen = () => {
          if (disposed) return
          sseHealthy = true
          // SSE is live — keep a slow safety poll only.
          startPollFallback(LOBBY_POLL_IDLE_MS * 4)
        }

        stream.onmessage = (ev) => {
          if (disposed) return
          try {
            const data = JSON.parse(String(ev.data)) as { lobbies?: LobbyRow[] }
            applyLobbySnapshot(
              Array.isArray(data.lobbies) ? data.lobbies : [],
            )
            sseHealthy = true
          } catch {
            /* ignore bad frame */
          }
        }

        stream.onerror = () => {
          if (disposed) return
          sseHealthy = false
          try {
            stream.close()
          } catch {
            /* ignore */
          }
          if (es === stream) es = null
          // Fast poll while reconnecting — still best-effort in background.
          startPollFallback(
            lobbyWatchModeRef.current === 'off'
              ? LOBBY_POLL_IDLE_MS
              : LOBBY_POLL_WATCH_MS,
          )
          if (reconnectId != null) window.clearTimeout(reconnectId)
          reconnectId = window.setTimeout(connectSse, 2000)
        }
      } catch {
        // EventSource unavailable — poll only.
        startPollFallback(
          lobbyWatchModeRef.current === 'off'
            ? LOBBY_POLL_IDLE_MS
            : LOBBY_POLL_WATCH_MS,
        )
      }
    }

    // Immediate HTTP snapshot, then open the push stream.
    void refreshLobbies({ silent: false })
    connectSse()
    // Until SSE opens, poll at the watch-aware rate.
    startPollFallback(
      lobbyWatchMode === 'off' ? LOBBY_POLL_IDLE_MS : LOBBY_POLL_WATCH_MS,
    )

    const onVisibility = () => {
      if (document.hidden) return
      // Tab focused again → snap refresh (and ensure stream is up).
      void refreshLobbies({ silent: true })
      if (!sseHealthy && es == null) connectSse()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (pollId != null) window.clearInterval(pollId)
      if (reconnectId != null) window.clearTimeout(reconnectId)
      try {
        es?.close()
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- feed targets
  }, [serverUrl, lobbyWatchMode])

  // Silence the queue sting as soon as the user comes back to this tab/window.
  // (Countdown / banner stay; only the looping audio cuts off.)
  useEffect(() => {
    const silence = () => {
      gameAudio.stopLobbyNotify()
    }
    const onVisibility = () => {
      if (!document.hidden) silence()
    }
    window.addEventListener('focus', silence)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', silence)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // Auto-join countdown (queue-accept style).
  useEffect(() => {
    if (!autoJoinTarget) return
    if (autoJoinLeft <= 0) {
      const target = autoJoinTarget
      clearAutoJoin()
      setNotifiedLobby(null)
      handleJoinOnline({
        matchId: target.matchId,
        mapId: isMapId(target.mapId) ? target.mapId : undefined,
        wager: target.wager,
      })
      return
    }
    const id = window.setTimeout(() => {
      setAutoJoinLeft((s) => Math.max(0, s - 1))
    }, 1000)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- join via stable handleJoinOnline
  }, [autoJoinTarget, autoJoinLeft])

  // Tick rejoin countdown; drop stale sessions when the window ends.
  useEffect(() => {
    const tick = () => {
      const exp = rejoinSession?.expiresAt
      if (exp == null) {
        setRejoinLeft(0)
        return
      }
      const left = Math.max(0, Math.ceil((exp - Date.now()) / 1000))
      setRejoinLeft(left)
      if (left <= 0) clearRejoinSession()
    }
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [rejoinSession, clearRejoinSession])

  const canRejoin =
    Boolean(onRejoinOnline) &&
    rejoinSession != null &&
    rejoinSession.expiresAt != null &&
    rejoinLeft > 0

  const handleRejoin = () => {
    if (!canRejoin) return
    gameAudio.uiConfirm()
    onRejoinOnline?.()
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
        {canRejoin && (
          <button
            type="button"
            onClick={handleRejoin}
            className="inline-flex h-9 items-center gap-2 rounded-xl border-[3px] border-arena-ink bg-arena-heat px-3 text-sm font-black tracking-wide text-arena-ink uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]"
            title={`Rejoin ${rejoinSession?.matchId ?? 'match'} — ${rejoinLeft}s left`}
          >
            <GameIcon src={icons.reberth} className="size-4" />
            Rejoin match
            <span className="rounded-md border-[2px] border-arena-ink/60 bg-arena-ink/10 px-1.5 py-0.5 font-mono text-xs tabular-nums">
              {Math.floor(rejoinLeft / 60)}:
              {(rejoinLeft % 60).toString().padStart(2, '0')}
            </span>
          </button>
        )}
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
            setSettingsSection(undefined)
            setSettingsOpen(true)
          }}
          title="Settings"
        >
          <GameIcon src={icons.settings} className="size-5" />
        </ChromeBtn>
      </header>

      {/*
        Layout (lg+):
          [ Balance ] [ Host duel ] [ Lobbies ] [ Operator ]
          [ Map 1×2 + sky ………………… ]           [ Community ]
      */}
      <main
        className={cn(
          'relative z-10 mx-auto grid min-h-0 w-full max-w-[90rem] flex-1 gap-2.5 overflow-hidden p-2.5 sm:gap-3 sm:p-3 md:p-4',
          'grid-cols-1',
          'lg:grid-cols-[minmax(10rem,12.5rem)_minmax(13rem,1fr)_minmax(14rem,1.15fr)_minmax(15rem,18rem)]',
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
                <h2 className="text-xs font-extrabold tracking-wide text-arena-fg/55 uppercase">
                  Balance
                </h2>
              </div>
              <span className="rounded-md border-[2px] border-arena-ink bg-arena-surface px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-[#14F195]/80 uppercase">
                Solana
              </span>
            </div>

            <div className="mt-3 flex min-h-0 flex-1 flex-col items-center justify-center text-center">
              <div className="mb-2 flex size-11 items-center justify-center rounded-xl border-[3px] border-arena-ink bg-gradient-to-br from-[#9945FF]/35 to-[#14F195]/25 shadow-[2px_3px_0_var(--arena-ink)]">
                <SiSolana className="size-5 text-arena-fg" aria-hidden />
              </div>
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-3xl font-black tabular-nums tracking-tight text-arena-heat drop-shadow-[0_2px_0_var(--arena-ink)] sm:text-4xl">
                  {solBalanceLabel}
                </span>
                <span className="text-sm font-extrabold text-arena-fg/45">SOL</span>
              </div>
              <p className="mt-1 text-xs font-semibold text-arena-fg/40">
                Wallet not connected
              </p>
            </div>

            <button
              type="button"
              onClick={() => gameAudio.uiClick()}
              className="mt-3 inline-flex h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl border-[3px] border-arena-ink bg-arena-heat px-2 text-sm font-black tracking-wide text-arena-ink uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]"
              title="Connect Solana wallet — coming soon"
            >
              <SiSolana className="size-3.5" aria-hidden />
              Connect
            </button>
          </HudPanel>
        </motion.div>

        {/* Host duel — settings for creating a lobby */}
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
                <GameIcon src={icons.flag} className="size-4" />
                <span className="text-base font-extrabold">Host duel</span>
              </div>
              <span className="inline-flex items-center gap-1 rounded-md border-[2px] border-arena-ink bg-arena-ok/25 px-1.5 py-0.5 text-[11px] font-extrabold text-arena-ok uppercase">
                <GameIcon src={icons.fire} className="size-3" />
                1v1
              </span>
            </div>

            <div className="mb-2 shrink-0">
              <SectionLabel iconSrc={icons.globe}>Server</SectionLabel>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                spellCheck={false}
                className="w-full rounded-lg border-[2px] border-arena-ink bg-arena-surface px-2 py-1.5 font-mono text-sm text-arena-fg outline-none focus:border-arena-tech"
                placeholder="ws://localhost:2567"
              />
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-2">
              <div>
                <SectionLabel iconSrc={icons.map}>Map</SectionLabel>
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-lg border-[2px] bg-arena-surface px-2.5 py-1.5',
                    canHostDuel
                      ? 'border-arena-ink'
                      : 'border-arena-danger/50',
                  )}
                >
                  <GameIcon src={icons.location} className="size-3.5 shrink-0" />
                  <span className="truncate text-sm font-extrabold text-arena-fg">
                    {selected.name}
                  </span>
                  <span
                    className={cn(
                      'ml-auto shrink-0 text-[11px] font-bold tracking-wide uppercase',
                      canHostDuel
                        ? 'text-arena-fg/40'
                        : 'text-arena-danger',
                    )}
                  >
                    {canHostDuel ? '1v1' : 'Training only'}
                  </span>
                </div>
                {!canHostDuel && (
                  <p className="mt-1 text-xs font-semibold text-arena-danger/90">
                    Pick a duel arena below — Practice Range can&apos;t host 1v1.
                  </p>
                )}
              </div>

              <div>
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

              <div>
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

            <p className="mt-2 shrink-0 text-xs font-semibold text-arena-fg/40">
              You wait on the practice range; the duel map loads when someone joins.
            </p>

            <button
              type="button"
              disabled={
                !onHostOnline || !serverUrl.trim() || !canHostDuel
              }
              onClick={handleHostOnline}
              title={
                !canHostDuel
                  ? 'Select a 1v1 map — Practice Range is training only'
                  : undefined
              }
              className="mt-2 inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl border-[3px] border-arena-ink bg-arena-ok px-4 text-sm font-black tracking-wide text-arena-ink uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 disabled:pointer-events-none disabled:opacity-40 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]"
            >
              <GameIcon src={icons.flag} className="size-5" />
              Host duel
            </button>
          </HudPanel>
        </motion.div>

        {/* Lobbies — browse + join open rooms */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, duration: 0.28 }}
          className="min-h-0 lg:col-start-3 lg:row-start-1"
        >
          <HudPanel
            className="flex h-full min-h-0 flex-col overflow-hidden p-3 sm:p-3.5"
            accent="tech"
          >
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <GameIcon src={icons.friend} className="size-4" />
                <span className="text-base font-extrabold">Lobbies</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  gameAudio.uiClick()
                  void refreshLobbies()
                }}
                className="inline-flex h-7 items-center gap-1 rounded-lg border-[2px] border-arena-ink bg-arena-surface px-2 text-xs font-extrabold text-arena-fg/70 uppercase shadow-[1px_2px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-arena-hover hover:text-arena-fg"
              >
                <GameIcon src={icons.reberth} className="size-3" />
                Refresh
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
              {lobbyStatus === 'loading' && lobbies.length === 0 && (
                <p className="rounded-lg border-[2px] border-dashed border-arena-ink/40 bg-arena-surface/50 px-2.5 py-3 text-center text-sm font-semibold text-arena-fg/45">
                  Loading lobbies…
                </p>
              )}
              {lobbyStatus === 'error' && (
                <p className="rounded-lg border-[2px] border-arena-danger/40 bg-arena-danger/10 px-2.5 py-3 text-center text-sm font-semibold text-arena-danger">
                  {lobbyError ?? 'Could not reach server'}
                </p>
              )}
              {lobbyStatus === 'ok' && lobbies.length === 0 && (
                <p className="rounded-lg border-[2px] border-dashed border-arena-ink/40 bg-arena-surface/50 px-2.5 py-3 text-center text-sm font-semibold text-arena-fg/45">
                  No open lobbies — host one, or turn on Auto join below.
                </p>
              )}
              {lobbies.map((lobby) => (
                <div
                  key={lobby.matchId}
                  className={cn(
                    'flex items-center gap-2 rounded-xl border-[2.5px] border-arena-ink bg-arena-surface px-2 py-1.5 shadow-[1px_2px_0_var(--arena-ink)]',
                    (autoJoinTarget?.matchId === lobby.matchId ||
                      notifiedLobby?.matchId === lobby.matchId) &&
                      'ring-2 ring-arena-heat/60',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-extrabold text-arena-fg">
                        {lobby.hostName || 'Host'}
                      </span>
                      <span className="shrink-0 rounded border border-arena-ink/50 bg-arena-panel px-1 py-px text-[10px] font-bold text-arena-fg/50 uppercase">
                        {lobby.playerCount}/{lobby.maxPlayers}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-arena-fg/50">
                      <span className="truncate text-arena-tech">
                        {mapLabel(lobby.mapId)}
                      </span>
                      {lobby.wager > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-arena-heat">
                          <GameIcon src={icons.coins} className="size-2.5" />$
                          {lobby.wager}
                        </span>
                      )}
                      <span className="truncate font-mono text-[11px] text-arena-fg/35">
                        {lobby.matchId}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!onJoinOnline || !serverUrl.trim()}
                    onClick={() =>
                      handleJoinOnline({
                        matchId: lobby.matchId,
                        mapId: isMapId(lobby.mapId) ? lobby.mapId : undefined,
                        wager: lobby.wager,
                      })
                    }
                    className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border-[2.5px] border-arena-ink bg-arena-ok px-2.5 text-xs font-black tracking-wide text-arena-ink uppercase shadow-[1px_2px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 disabled:pointer-events-none disabled:opacity-40 active:translate-y-0.5 active:shadow-none"
                  >
                    Join
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-2 shrink-0 border-t-2 border-arena-ink/35 pt-2">
              <SectionLabel iconSrc={icons.bolt}>Auto join</SectionLabel>
              <div className="mb-1.5 flex gap-1">
                {(
                  [
                    { id: 'off', label: 'Off' },
                    { id: 'notify', label: 'Notify' },
                    { id: 'auto', label: 'Auto' },
                  ] as const
                ).map((opt) => (
                  <Chip
                    key={opt.id}
                    active={lobbyWatchMode === opt.id}
                    onClick={() => setWatchMode(opt.id)}
                    className="h-7 min-w-0 flex-1 px-1.5 text-xs"
                    title={
                      opt.id === 'off'
                        ? 'No alerts for new lobbies'
                        : opt.id === 'notify'
                          ? 'Play a queue-pop sound when a lobby opens'
                          : 'Sound + auto-join the newest lobby in 5s'
                    }
                  >
                    {opt.label}
                  </Chip>
                ))}
              </div>

              {lobbyWatchMode === 'off' && (
                <p className="text-xs font-semibold leading-snug text-arena-fg/40">
                  Silent list. Switch to Notify for a queue-pop sound, or Auto
                  to join in {AUTO_JOIN_SECONDS}s.
                </p>
              )}

              {lobbyWatchMode === 'notify' && !notifiedLobby && !autoJoinTarget && (
                <p className="text-xs font-semibold leading-snug text-arena-fg/40">
                  Live updates (even in background) — new lobbies play the
                  queue sting twice and show a banner.
                </p>
              )}

              {lobbyWatchMode === 'auto' && !autoJoinTarget && (
                <p className="text-xs font-semibold leading-snug text-arena-fg/40">
                  Live updates (even in background) — sting loops until join;
                  auto-joins after {AUTO_JOIN_SECONDS}s (cancel anytime).
                </p>
              )}

              {autoJoinTarget && (
                <div className="mt-1.5 rounded-xl border-[2.5px] border-arena-ink bg-arena-heat/15 px-2 py-1.5 shadow-[1px_2px_0_var(--arena-ink)]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-black tracking-wide text-arena-heat uppercase">
                        Queue pop · joining in {autoJoinLeft}s
                      </p>
                      <p className="mt-0.5 truncate text-sm font-extrabold text-arena-fg">
                        {autoJoinTarget.hostName || 'Host'} ·{' '}
                        <span className="text-arena-tech">
                          {mapLabel(autoJoinTarget.mapId)}
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={cancelAutoJoin}
                      className="inline-flex h-7 shrink-0 items-center justify-center rounded-lg border-[2px] border-arena-ink bg-arena-surface px-2 text-xs font-black tracking-wide text-arena-fg uppercase shadow-[1px_2px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-arena-hover"
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full border border-arena-ink/40 bg-arena-surface">
                    <div
                      className="h-full rounded-full bg-arena-heat transition-[width] duration-1000 ease-linear"
                      style={{
                        width: `${(autoJoinLeft / AUTO_JOIN_SECONDS) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {notifiedLobby && !autoJoinTarget && (
                <div className="mt-1.5 rounded-xl border-[2.5px] border-arena-ink bg-arena-ok/15 px-2 py-1.5 shadow-[1px_2px_0_var(--arena-ink)]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-black tracking-wide text-arena-ok uppercase">
                        New lobby
                      </p>
                      <p className="mt-0.5 truncate text-sm font-extrabold text-arena-fg">
                        {notifiedLobby.hostName || 'Host'} ·{' '}
                        <span className="text-arena-tech">
                          {mapLabel(notifiedLobby.mapId)}
                        </span>
                        {notifiedLobby.wager > 0 && (
                          <span className="text-arena-heat">
                            {' '}
                            · ${notifiedLobby.wager}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={dismissNotify}
                        className="inline-flex h-7 items-center justify-center rounded-lg border-[2px] border-arena-ink bg-arena-surface px-2 text-xs font-black tracking-wide text-arena-fg/70 uppercase shadow-[1px_2px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-arena-hover"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        disabled={!onJoinOnline || !serverUrl.trim()}
                        onClick={() => {
                          setNotifiedLobby(null)
                          handleJoinOnline({
                            matchId: notifiedLobby.matchId,
                            mapId: isMapId(notifiedLobby.mapId)
                              ? notifiedLobby.mapId
                              : undefined,
                            wager: notifiedLobby.wager,
                          })
                        }}
                        className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border-[2.5px] border-arena-ink bg-arena-ok px-2 text-xs font-black tracking-wide text-arena-ink uppercase shadow-[1px_2px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
                      >
                        Join
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </HudPanel>
        </motion.div>

        {/* Map 1×2 carousel — bottom row, left of operator */}
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
                    <GameIcon src={icons.location} className="size-3.5 shrink-0" />
                    <h3 className="truncate text-base font-black tracking-tight">
                      {selected.name}
                    </h3>
                  </div>
                </motion.div>
              </AnimatePresence>

              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 sm:justify-center">
                <GameIcon src={icons.compass} className="size-3.5 shrink-0 opacity-60" />
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

        {/* RIGHT — callsign + walking character */}
        <motion.aside
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.28 }}
          className="flex min-h-0 flex-col gap-2.5 overflow-hidden max-lg:min-h-[22rem] lg:col-start-4 lg:row-span-2 lg:row-start-1"
        >
          <HudPanel
            className="flex min-h-0 flex-1 flex-col overflow-hidden p-2.5 sm:p-3"
            accent="none"
          >
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <GameIcon src={icons.cap} className="size-4" />
                <span className="text-xs font-extrabold tracking-wide text-arena-fg/45 uppercase">
                  Operator
                </span>
              </div>
              <span className="truncate text-sm font-extrabold text-arena-tech">
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
                className="mb-2 h-9 w-full shrink-0 rounded-xl border-[2.5px] border-arena-tech/50 bg-arena-surface px-3 text-base font-bold text-arena-fg outline-none placeholder:text-arena-fg/35 focus:border-arena-tech"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  gameAudio.uiClick()
                  setNameDraft(username)
                  setEditingName(true)
                }}
                className="mb-2 flex h-9 w-full shrink-0 items-center justify-between rounded-xl border-[2.5px] border-arena-ink bg-arena-surface px-3 text-left text-base transition-colors hover:bg-arena-hover"
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
                <span className="text-[11px] font-extrabold tracking-wide text-arena-fg/40 uppercase">
                  Live preview
                </span>
              </div>
              <CharacterPreview
                appearance={characterAppearance}
                animation="walk"
                spin={false}
                className="absolute inset-0 h-full w-full"
              />
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-arena-panel to-transparent"
                aria-hidden
              />
              <button
                type="button"
                title="Customize character"
                aria-label="Customize character colors"
                onClick={() => {
                  gameAudio.uiClick()
                  setSettingsSection('character')
                  setSettingsOpen(true)
                }}
                className={cn(
                  'absolute bottom-2.5 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-xl border-[2.5px] border-arena-ink bg-arena-panel px-3 py-1.5 text-sm font-extrabold tracking-wide text-arena-fg uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all',
                  'hover:-translate-y-0.5 hover:bg-arena-hover active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]',
                )}
              >
                <GameIcon src={icons.brush} className="size-3.5" />
                Customize
              </button>
            </div>
          </HudPanel>

          <HudPanel className="hidden shrink-0 px-3 py-2 min-[700px]:block" accent="none">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-extrabold tracking-wide text-arena-fg/45 uppercase">
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

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialSection={settingsSection}
      />
    </div>
  )
}
