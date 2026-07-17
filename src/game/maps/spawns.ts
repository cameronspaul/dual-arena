/**
 * Team spawn points for maps — level editor + baked authored layouts.
 * Priority: localStorage editor override → authored defaults → empty.
 * Catalog single `spawn` remains the last-resort play fallback.
 */
import type { MapId } from './catalog'
import { getAuthoredSpawns } from './authoredSpawns'

export type TeamId = 'blue' | 'red'

export interface SpawnPoint {
  id: string
  team: TeamId
  x: number
  y: number
  z: number
  /** Look yaw (radians), same convention as player / catalog spawnYaw */
  yaw: number
}

export interface MapSpawnLayout {
  version: 1
  mapId: MapId | string
  spawns: SpawnPoint[]
}

const STORAGE_PREFIX = 'dual-arena:spawns:v1:'

export function storageKey(mapId: string): string {
  return `${STORAGE_PREFIX}${mapId}`
}

export function makeSpawnId(team: TeamId, existing: SpawnPoint[]): string {
  const n = existing.filter((s) => s.team === team).length
  return `${team}-${n}`
}

export function emptyLayout(mapId: string): MapSpawnLayout {
  return { version: 1, mapId, spawns: [] }
}

export function authoredLayout(mapId: string): MapSpawnLayout {
  return { version: 1, mapId, spawns: getAuthoredSpawns(mapId) }
}

function normalizeSpawns(raw: unknown[] | undefined): SpawnPoint[] | null {
  if (!raw || !Array.isArray(raw)) return null
  const spawns: SpawnPoint[] = []
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue
    const o = s as Partial<SpawnPoint>
    if (o.team !== 'blue' && o.team !== 'red') continue
    if (
      typeof o.x !== 'number' ||
      typeof o.y !== 'number' ||
      typeof o.z !== 'number'
    ) {
      continue
    }
    spawns.push({
      id: typeof o.id === 'string' ? o.id : makeSpawnId(o.team, spawns),
      team: o.team,
      x: o.x,
      y: o.y,
      z: o.z,
      yaw: typeof o.yaw === 'number' ? o.yaw : 0,
    })
  }
  return spawns
}

/**
 * Load spawns for a map.
 * - If the browser has an editor save for this map, use that.
 * - Otherwise use baked authored spawns (e.g. desert team pads).
 */
export function loadSpawnLayout(mapId: string): MapSpawnLayout {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(storageKey(mapId))
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<MapSpawnLayout>
        const spawns = normalizeSpawns(parsed.spawns)
        // Only treat as override when the key exists *and* parses to a list
        // (including empty — intentional clear in editor still wins until reset).
        if (spawns) {
          return { version: 1, mapId, spawns }
        }
      }
    } catch {
      // fall through to authored
    }
  }
  return authoredLayout(mapId)
}

export function saveSpawnLayout(layout: MapSpawnLayout): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(
      storageKey(layout.mapId),
      JSON.stringify({
        version: 1,
        mapId: layout.mapId,
        spawns: layout.spawns,
      }),
    )
  } catch {
    // quota / private mode
  }
}

export function clearSpawnLayout(mapId: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(storageKey(mapId))
  } catch {
    // ignore
  }
}

/** Pretty JSON for copy / download — ready to paste into tools later. */
export function exportSpawnLayoutJson(layout: MapSpawnLayout): string {
  return JSON.stringify(
    {
      version: 1 as const,
      mapId: layout.mapId,
      spawns: layout.spawns.map((s) => ({
        id: s.id,
        team: s.team,
        x: round(s.x),
        y: round(s.y),
        z: round(s.z),
        yaw: round(s.yaw, 4),
      })),
    },
    null,
    2,
  )
}

export function parseSpawnLayout(
  raw: unknown,
  fallbackMapId: string,
): MapSpawnLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<MapSpawnLayout>
  const mapId =
    typeof o.mapId === 'string' && o.mapId.length > 0 ? o.mapId : fallbackMapId
  const spawns = normalizeSpawns(o.spawns)
  if (!spawns) return null
  return { version: 1, mapId, spawns }
}

/** Prefer blue pad 0, else first authored/editor spawn — for solo play start. */
export function pickPlaySpawn(layout: MapSpawnLayout): SpawnPoint | null {
  if (layout.spawns.length === 0) return null
  return (
    layout.spawns.find((s) => s.team === 'blue' && s.id === 'blue-0') ??
    layout.spawns.find((s) => s.team === 'blue') ??
    layout.spawns[0]
  )
}

export function spawnsForTeam(
  layout: MapSpawnLayout,
  team: TeamId,
): SpawnPoint[] {
  return layout.spawns.filter((s) => s.team === team)
}

function round(n: number, digits = 3): number {
  if (!Number.isFinite(n)) return 0
  const p = 10 ** digits
  const t = Math.round(n * p) / p
  return Object.is(t, -0) ? 0 : t
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
