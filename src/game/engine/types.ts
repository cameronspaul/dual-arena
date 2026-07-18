/**
 * Public types for GameEngine and UI consumers.
 */
import type { HudSnapshot } from '../core/types'
import type { MapId } from '../maps'
import type { SkyboxId } from '../scene/skyboxes'
import type { VoicePeerStatus } from '../net'

export type HudListener = (hud: HudSnapshot) => void

/** In-match chat line for the HUD. */
export type ChatLine = {
  id: string
  fromId: string
  /** True when from local player. */
  self: boolean
  text: string
  t: number
}

export type ChatListener = (lines: ChatLine[]) => void

export type VoiceUiListener = (state: {
  status: VoicePeerStatus
  /** Local push-to-talk held. */
  talking: boolean
  micReady: boolean
  speakerEnabled: boolean
  remoteSpeaking: boolean
  detail?: string
}) => void

export type OnlineSessionOpts = {
  /** WebSocket URL, e.g. ws://localhost:2567 */
  serverUrl: string
  matchId: string
  /** Auth / identity token (opaque for now). */
  token?: string
  /** Host display name for lobby browser (first joiner). */
  hostName?: string
  /** Soft stake for lobby listing. */
  wager?: number
  /**
   * Ranked room map id sent on join (may differ from the visual wait-room map).
   * Practice range is never a duel arena — use a real 1v1 map here.
   */
  mapId?: string
  /**
   * Host lobby: load practice range visually until an opponent joins, then
   * remount onto `mapId`. Skips server team-pad snap while waiting.
   */
  waitOnRange?: boolean
  /** Wall-clock ms when this lobby was created (client; HUD age timer). */
  createdAt?: number
}

export type GameEngineOptions = {
  mapId?: MapId | string
  /**
   * Concrete skybox for this session (already resolved — not `"random"`).
   * Shared via URL / match config so all players see the same sky.
   */
  skybox?: SkyboxId
  /**
   * Offline practice range (default) vs ranked/wagered duel through the server.
   * Online: no local kill authority; dummies off; inputs → server.
   */
  mode?: 'offline' | 'online'
  online?: OnlineSessionOpts
}
