import type { MapId } from '@/game/maps'
import type { SkyboxPreference } from '@/game/scene/skyboxes'

export type OnlineLobbyJoin = {
  matchId: string
  /** Prefer the host's map when joining a listed lobby. */
  mapId?: MapId
  /** Soft stake from the lobby listing (display-only). */
  wager?: number
}

export interface MainMenuProps {
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

export type LobbyRow = {
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
export type LobbyWatchMode = 'off' | 'notify' | 'auto'

export type LobbyStatus = 'idle' | 'loading' | 'ok' | 'error'
