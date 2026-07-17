/**
 * Editor-placed barrier walls — invisible (or translucent in editor) AABB
 * blockers so players cannot walk past map edges / out-of-bounds zones.
 * Priority: localStorage override → empty (no baked defaults yet).
 */
import { aabbFromCenter } from '../core/math'
import type { AABB } from '../core/types'
import type { MapId } from './catalog'

export interface BarrierWall {
  id: string
  /** Center X */
  x: number
  /** Center Y */
  y: number
  /** Center Z */
  z: number
  /** Full extent on X */
  width: number
  /** Full extent on Y */
  height: number
  /** Full extent on Z */
  depth: number
}

export interface MapBarrierLayout {
  version: 1
  mapId: MapId | string
  barriers: BarrierWall[]
}

/** Defaults for new walls (metres). Thin slab; length runs across facing. */
export const BARRIER_DEFAULTS = {
  length: 8,
  height: 4,
  thickness: 0.5,
} as const

const STORAGE_PREFIX = 'dual-arena:barriers:v1:'

export function barrierStorageKey(mapId: string): string {
  return `${STORAGE_PREFIX}${mapId}`
}

/** Stable unique id — never reuse length-based ids after deletes. */
export function makeBarrierId(existing: BarrierWall[]): string {
  let n = existing.length
  const used = new Set(existing.map((b) => b.id))
  let id = `wall-${n}`
  while (used.has(id)) {
    n += 1
    id = `wall-${n}`
  }
  return id
}

export function emptyBarrierLayout(mapId: string): MapBarrierLayout {
  return { version: 1, mapId, barriers: [] }
}

function normalizeBarriers(raw: unknown[] | undefined): BarrierWall[] | null {
  if (!raw || !Array.isArray(raw)) return null
  const barriers: BarrierWall[] = []
  for (const b of raw) {
    if (!b || typeof b !== 'object') continue
    const o = b as Partial<BarrierWall>
    if (
      typeof o.x !== 'number' ||
      typeof o.y !== 'number' ||
      typeof o.z !== 'number' ||
      typeof o.width !== 'number' ||
      typeof o.height !== 'number' ||
      typeof o.depth !== 'number'
    ) {
      continue
    }
    if (o.width <= 0 || o.height <= 0 || o.depth <= 0) continue
    barriers.push({
      id: typeof o.id === 'string' ? o.id : makeBarrierId(barriers),
      x: o.x,
      y: o.y,
      z: o.z,
      width: o.width,
      height: o.height,
      depth: o.depth,
    })
  }
  return barriers
}

export function loadBarrierLayout(mapId: string): MapBarrierLayout {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(barrierStorageKey(mapId))
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<MapBarrierLayout>
        const barriers = normalizeBarriers(parsed.barriers)
        if (barriers) {
          return { version: 1, mapId, barriers }
        }
      }
    } catch {
      // fall through
    }
  }
  return emptyBarrierLayout(mapId)
}

export function saveBarrierLayout(layout: MapBarrierLayout): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(
      barrierStorageKey(layout.mapId),
      JSON.stringify({
        version: 1,
        mapId: layout.mapId,
        barriers: layout.barriers,
      }),
    )
  } catch {
    // quota / private mode
  }
}

export function clearBarrierLayout(mapId: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(barrierStorageKey(mapId))
  } catch {
    // ignore
  }
}

export function barrierToAabb(b: BarrierWall): AABB {
  return aabbFromCenter(b.x, b.y, b.z, b.width / 2, b.height / 2, b.depth / 2)
}

export function barriersToAabbs(barriers: BarrierWall[]): AABB[] {
  return barriers.map(barrierToAabb)
}

/**
 * Axis-aligned extents from look yaw: long axis across the facing direction,
 * thin axis along facing (so the wall blocks the way you're looking).
 */
export function wallSizeFromYaw(
  yaw: number,
  length: number,
  height: number,
  thickness: number,
): { width: number; height: number; depth: number } {
  const fx = Math.abs(Math.sin(yaw))
  const fz = Math.abs(Math.cos(yaw))
  // Facing mostly ±X → wall runs along Z
  if (fx > fz) {
    return { width: thickness, height, depth: length }
  }
  // Facing mostly ±Z → wall runs along X
  return { width: length, height, depth: thickness }
}

/** Pretty JSON for copy / download. */
export function exportBarrierLayoutJson(layout: MapBarrierLayout): string {
  return JSON.stringify(
    {
      version: 1 as const,
      mapId: layout.mapId,
      barriers: layout.barriers.map((b) => ({
        id: b.id,
        x: round(b.x),
        y: round(b.y),
        z: round(b.z),
        width: round(b.width),
        height: round(b.height),
        depth: round(b.depth),
      })),
    },
    null,
    2,
  )
}

export function parseBarrierLayout(
  raw: unknown,
  fallbackMapId: string,
): MapBarrierLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<MapBarrierLayout>
  const mapId =
    typeof o.mapId === 'string' && o.mapId.length > 0 ? o.mapId : fallbackMapId
  // Accept either { barriers: [...] } or a bare array of walls
  const list = Array.isArray(raw)
    ? (raw as unknown[])
    : Array.isArray(o.barriers)
      ? o.barriers
      : null
  if (!list) return null
  const barriers = normalizeBarriers(list)
  if (!barriers) return null
  return { version: 1, mapId, barriers }
}

function round(n: number, digits = 3): number {
  if (!Number.isFinite(n)) return 0
  const p = 10 ** digits
  const t = Math.round(n * p) / p
  return Object.is(t, -0) ? 0 : t
}
