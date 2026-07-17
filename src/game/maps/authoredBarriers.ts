/**
 * Official barrier walls baked from the level editor.
 * localStorage editor overrides still win when present.
 */
import type { MapId } from './catalog'
import type { BarrierWall } from './barriers'

/** World-space barrier centers after map fit (same coords the editor exports). */
export const AUTHORED_BARRIERS: Partial<Record<MapId, readonly BarrierWall[]>> =
  {}

export function getAuthoredBarriers(mapId: string): BarrierWall[] {
  const list = AUTHORED_BARRIERS[mapId as MapId]
  if (!list || list.length === 0) return []
  return list.map((b) => ({ ...b }))
}
