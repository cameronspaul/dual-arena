/**
 * Fall-kill plane + pure helpers for player death / round restart.
 */
import { DEATH } from '../core/config'
import type { DeathReason } from '../core/types'

export type { DeathReason }

/**
 * Lowest feet Y among team pads + catalog fallback, then subtract depth.
 * Returns null when fall death is disabled for the map.
 */
export function computeFallKillY(opts: {
  enabled: boolean
  /** Override DEATH.fallKillDepth when set on the map. */
  depth?: number
  /** Team pad feet Y values. */
  spawnYs: number[]
  /** Catalog / built map spawn feet Y. */
  fallbackSpawnY: number
}): number | null {
  if (!opts.enabled) return null
  const depth =
    opts.depth != null && opts.depth > 0 ? opts.depth : DEATH.fallKillDepth
  let minY = opts.fallbackSpawnY
  for (const y of opts.spawnYs) {
    if (y < minY) minY = y
  }
  return minY - depth
}

/** True when the player's feet are below the kill plane. */
export function isBelowFallKill(feetY: number, killY: number | null): boolean {
  return killY !== null && feetY < killY
}
