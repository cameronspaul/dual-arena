/**
 * Official barrier walls baked from the level editor.
 * localStorage editor overrides still win when present.
 */
import type { MapId } from './catalog'
import type { BarrierWall } from './barriers'

/** World-space barrier centers after map fit (same coords the editor exports). */
export const AUTHORED_BARRIERS: Partial<Record<MapId, readonly BarrierWall[]>> =
  {
    'tdm-location': [
      {
        id: 'wall-0',
        x: -0.402,
        y: 2.167,
        z: 19.122,
        width: 8,
        height: 4,
        depth: 0.5,
        infiniteHeight: true,
        infiniteWidth: true,
      },
      {
        id: 'wall-1',
        x: -1.072,
        y: 2.167,
        z: -75.857,
        width: 8,
        height: 4,
        depth: 0.5,
        infiniteHeight: true,
        infiniteWidth: true,
      },
      {
        id: 'wall-2',
        x: 5.379,
        y: 2.167,
        z: -67.877,
        width: 0.5,
        height: 4,
        depth: 8,
        infiniteHeight: true,
        infiniteWidth: true,
      },
    ],
  }

export function getAuthoredBarriers(mapId: string): BarrierWall[] {
  const list = AUTHORED_BARRIERS[mapId as MapId]
  if (!list || list.length === 0) return []
  return list.map((b) => ({ ...b }))
}
