import { useEffect, useRef, useState } from 'react'

import { gameAudio } from '@/game/audio'
import { isMapId } from '@/game/maps'

import {
  AUTO_JOIN_SECONDS,
  LOBBY_POLL_IDLE_MS,
  LOBBY_POLL_WATCH_MS,
} from './constants'
import {
  httpBaseFromWs,
  loadLobbyWatchMode,
  pickNewestJoinable,
  saveLobbyWatchMode,
} from './lobbyUtils'
import type {
  LobbyRow,
  LobbyStatus,
  LobbyWatchMode,
  OnlineLobbyJoin,
} from './types'

export function useLobbyBrowser({
  serverUrl,
  onJoinOnline,
  setMatchId,
}: {
  serverUrl: string
  onJoinOnline?: (lobby: OnlineLobbyJoin) => void
  setMatchId: (id: string) => void
}) {
  const [lobbies, setLobbies] = useState<LobbyRow[]>([])
  const [lobbyStatus, setLobbyStatus] = useState<LobbyStatus>('idle')
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

  const handleJoinOnline = (lobby: OnlineLobbyJoin) => {
    gameAudio.stopLobbyNotify()
    gameAudio.uiConfirm()
    if (lobby.matchId) setMatchId(lobby.matchId)
    onJoinOnline?.(lobby)
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

  return {
    lobbies,
    lobbyStatus,
    lobbyError,
    lobbyWatchMode,
    setWatchMode,
    notifiedLobby,
    setNotifiedLobby,
    autoJoinTarget,
    autoJoinLeft,
    refreshLobbies,
    handleJoinOnline,
    cancelAutoJoin,
    dismissNotify,
  }
}
