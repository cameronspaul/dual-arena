/**
 * Official team spawn points baked from the level editor.
 * Source of truth for online: @duel/shared (server-authoritative).
 * localStorage editor overrides still win on the client offline path only.
 */
import {
  AUTHORED_SPAWNS as SHARED_AUTHORED,
  getAuthoredSpawns as sharedGetAuthored,
  type SpawnPoint as SharedSpawnPoint,
} from '@duel/shared'
import type { MapId } from './catalog'
import type { SpawnPoint } from './spawns'

/** Re-export shared table for maps that have authored pads. */
export const AUTHORED_SPAWNS: Partial<
  Record<MapId, readonly SpawnPoint[]>
> = SHARED_AUTHORED as Partial<Record<MapId, readonly SpawnPoint[]>>

export function getAuthoredSpawns(mapId: string): SpawnPoint[] {
  return sharedGetAuthored(mapId) as SpawnPoint[]
}

export type { SharedSpawnPoint }
