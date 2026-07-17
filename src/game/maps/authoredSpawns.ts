/**
 * Official team spawn points baked from the level editor.
 * localStorage editor overrides still win when present.
 */
import type { MapId } from './catalog'
import type { SpawnPoint } from './spawns'

/** World-space feet positions after map fit (same coords the editor exports). */
export const AUTHORED_SPAWNS: Partial<Record<MapId, readonly SpawnPoint[]>> = {
  desert: [
    {
      id: 'red-0',
      team: 'red',
      x: 13.364,
      y: 0.086,
      z: 3.155,
      yaw: -4.6583,
    },
    {
      id: 'red-1',
      team: 'red',
      x: 13.05,
      y: 0.161,
      z: -5.006,
      yaw: -4.5675,
    },
    {
      id: 'blue-0',
      team: 'blue',
      x: -13.247,
      y: 0.086,
      z: 3.49,
      yaw: -1.5583,
    },
    {
      id: 'blue-1',
      team: 'blue',
      x: -13.343,
      y: 0.087,
      z: -4.155,
      yaw: -1.5583,
    },
  ],
  'arena-v3': [
    {
      id: 'blue-0',
      team: 'blue',
      x: -11.381,
      y: 1,
      z: -3.861,
      yaw: 4.73,
    },
    {
      id: 'blue-1',
      team: 'blue',
      x: -9.987,
      y: 1,
      z: 4.212,
      yaw: 4.741,
    },
    {
      id: 'red-0',
      team: 'red',
      x: 11.254,
      y: 1,
      z: 4.045,
      yaw: 7.8562,
    },
    {
      id: 'red-1',
      team: 'red',
      x: 11.027,
      y: 1,
      z: -4.262,
      yaw: 7.9046,
    },
  ],
  'arena-v4': [
    {
      id: 'blue-0',
      team: 'blue',
      x: 20.502,
      y: 0,
      z: -15.613,
      yaw: 1.6302,
    },
    {
      id: 'blue-1',
      team: 'blue',
      x: 21.866,
      y: 0,
      z: -1.446,
      yaw: 1.5884,
    },
    {
      id: 'blue-2',
      team: 'blue',
      x: 21.834,
      y: 0,
      z: 17.332,
      yaw: 1.606,
    },
    {
      id: 'red-0',
      team: 'red',
      x: -21.039,
      y: 0,
      z: 17.109,
      yaw: 4.8598,
    },
    {
      id: 'red-1',
      team: 'red',
      x: -21.851,
      y: 0,
      z: 0.619,
      yaw: 4.7256,
    },
    {
      id: 'red-2',
      team: 'red',
      x: -22.909,
      y: 0,
      z: -15.45,
      yaw: 4.642,
    },
  ],
  tdm: [
    {
      id: 'blue-0',
      team: 'blue',
      x: -4.327,
      y: 2.627,
      z: 16.661,
      yaw: 6.3162,
    },
    {
      id: 'blue-1',
      team: 'blue',
      x: 6.744,
      y: 2.627,
      z: 17.222,
      yaw: 6.38,
    },
    {
      id: 'red-0',
      team: 'red',
      x: -4.862,
      y: 2.627,
      z: -20.092,
      yaw: 9.4776,
    },
    {
      id: 'red-1',
      team: 'red',
      x: 8.901,
      y: 0.002,
      z: -19.605,
      yaw: 8.9716,
    },
  ],
}

export function getAuthoredSpawns(mapId: string): SpawnPoint[] {
  const list = AUTHORED_SPAWNS[mapId as MapId]
  if (!list || list.length === 0) return []
  return list.map((s) => ({ ...s }))
}
