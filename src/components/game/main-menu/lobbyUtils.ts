import { MAP_LIST } from '@/game/maps'

import type { LobbyRow, LobbyWatchMode } from './types'
import { LOBBY_WATCH_KEY } from './constants'

export function loadLobbyWatchMode(): LobbyWatchMode {
  try {
    const v = localStorage.getItem(LOBBY_WATCH_KEY)
    if (v === 'off' || v === 'notify' || v === 'auto') return v
  } catch {
    /* private mode / SSR */
  }
  return 'off'
}

export function saveLobbyWatchMode(mode: LobbyWatchMode) {
  try {
    localStorage.setItem(LOBBY_WATCH_KEY, mode)
  } catch {
    /* ignore quota */
  }
}

export function isJoinableLobby(lobby: LobbyRow): boolean {
  return lobby.playerCount < lobby.maxPlayers
}

/** Newest open lobby first (for queue-pop / auto-join pick). */
export function pickNewestJoinable(list: LobbyRow[]): LobbyRow | null {
  const open = list.filter(isJoinableLobby)
  if (open.length === 0) return null
  open.sort((a, b) => b.createdAt - a.createdAt)
  return open[0] ?? null
}

/** ws(s)://host:port → http(s)://host:port for lobby HTTP polling. */
export function httpBaseFromWs(wsUrl: string): string | null {
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

export function mapLabel(mapId: string): string {
  const m = MAP_LIST.find((x) => x.id === mapId)
  return m?.name ?? mapId
}
