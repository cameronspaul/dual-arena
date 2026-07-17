/**
 * Editor-placed barrier walls — invisible (or translucent in editor) AABB
 * blockers so players cannot walk past map edges / out-of-bounds zones.
 * Priority: localStorage override → authored defaults → empty.
 */
import { aabbFromCenter } from '../core/math'
import type { AABB } from '../core/types'
import { getAuthoredBarriers } from './authoredBarriers'
import type { MapId } from './catalog'

export interface BarrierWall {
  id: string
  /** Center X */
  x: number
  /** Center Y (finite walls: mid of box; infinite height still stores place Y) */
  y: number
  /** Center Z */
  z: number
  /** Full extent on X (finite size; infinite width expands long axis) */
  width: number
  /** Full extent on Y (finite size; ignored for collision when infiniteHeight) */
  height: number
  /** Full extent on Z */
  depth: number
  /** Expand vertically to cover practically all play height */
  infiniteHeight?: boolean
  /** Expand along the wall's long axis (length), keep thickness */
  infiniteWidth?: boolean
  /**
   * Which thin face shows the no-entry signs: +1 or -1 along the thin axis.
   * Set at place time so signs face the placer.
   */
  signFace?: 1 | -1
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
  infiniteHeight: false,
  infiniteWidth: false,
} as const

/**
 * Practical "infinite" full extent for collision (AABB can't be true ∞).
 * Sized well beyond any playable map so edges are never reachable in play.
 */
export const BARRIER_INFINITE_EXTENT = 50_000

/** Editor gizmo size when a dimension is infinite (readable, not world-scale). */
export const BARRIER_VISUAL_INFINITE = {
  height: 18,
  length: 80,
} as const

/** Gameplay hazard strip / signs length for infinite-width walls. */
export const BARRIER_GAME_INFINITE_LENGTH = 240

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

export function authoredBarrierLayout(mapId: string): MapBarrierLayout {
  return { version: 1, mapId, barriers: getAuthoredBarriers(mapId) }
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
      infiniteHeight: o.infiniteHeight === true,
      infiniteWidth: o.infiniteWidth === true,
      signFace: o.signFace === -1 ? -1 : o.signFace === 1 ? 1 : undefined,
    })
  }
  return barriers
}

/**
 * Load barriers for a map.
 * - Browser editor save for this map wins when present.
 * - Otherwise use baked authored barriers (e.g. tdm-location edges).
 */
export function loadBarrierLayout(mapId: string): MapBarrierLayout {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(barrierStorageKey(mapId))
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<MapBarrierLayout>
        const barriers = normalizeBarriers(parsed.barriers)
        // Override when the key exists *and* parses (incl. empty clear).
        if (barriers) {
          return { version: 1, mapId, barriers }
        }
      }
    } catch {
      // fall through to authored
    }
  }
  return authoredBarrierLayout(mapId)
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

/** Resolved world extents used for collision / hitscan. */
export function resolveBarrierCollision(b: BarrierWall): {
  x: number
  y: number
  z: number
  width: number
  height: number
  depth: number
} {
  let width = b.width
  let height = b.height
  let depth = b.depth
  let y = b.y

  if (b.infiniteHeight) {
    height = BARRIER_INFINITE_EXTENT
    // Center so the slab covers deep voids and sky (not only near y=0)
    y = 0
  }

  if (b.infiniteWidth) {
    // Expand the long axis only; keep the thin face as thickness
    if (width >= depth) width = BARRIER_INFINITE_EXTENT
    else depth = BARRIER_INFINITE_EXTENT
  }

  return { x: b.x, y, z: b.z, width, height, depth }
}

/**
 * Editor-only display size. Infinite axes use a capped preview so gizmos
 * stay readable instead of filling the entire frustum.
 */
export function resolveBarrierVisual(b: BarrierWall): {
  x: number
  y: number
  z: number
  width: number
  height: number
  depth: number
} {
  let width = b.width
  let height = b.height
  let depth = b.depth
  let y = b.y

  if (b.infiniteHeight) {
    height = BARRIER_VISUAL_INFINITE.height
    // Sit preview on the placed floor-ish center
    y = b.y - b.height * 0.5 + height * 0.5
  }

  if (b.infiniteWidth) {
    if (width >= depth) width = BARRIER_VISUAL_INFINITE.length
    else depth = BARRIER_VISUAL_INFINITE.length
  }

  return { x: b.x, y, z: b.z, width, height, depth }
}

export function barrierToAabb(b: BarrierWall): AABB {
  const r = resolveBarrierCollision(b)
  return aabbFromCenter(r.x, r.y, r.z, r.width / 2, r.height / 2, r.depth / 2)
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
        ...(b.infiniteHeight ? { infiniteHeight: true } : {}),
        ...(b.infiniteWidth ? { infiniteWidth: true } : {}),
        ...(b.signFace === -1 || b.signFace === 1
          ? { signFace: b.signFace }
          : {}),
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
