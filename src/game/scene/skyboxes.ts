/**
 * Kenney CC0 equirectangular skyboxes under public/env/skyboxes/.
 */

export const SKYBOX_IDS = [
  'day',
  'morning',
  'night',
  'space',
  'alien',
] as const

export type SkyboxId = (typeof SKYBOX_IDS)[number]

/** User preference: fixed id, or pick randomly each map load. */
export type SkyboxPreference = SkyboxId | 'random'

export const SKYBOX_LABELS: Record<SkyboxPreference, string> = {
  day: 'Day',
  morning: 'Morning',
  night: 'Night',
  space: 'Space',
  alien: 'Alien',
  random: 'Random',
}

/** Soft fog tints that sit better under each sky. */
export const SKYBOX_FOG: Record<SkyboxId, number> = {
  day: 0xa8c4e0,
  morning: 0xd4b896,
  night: 0x1a2233,
  space: 0x0a0a12,
  alien: 0x4a3a5a,
}

export function skyboxUrl(id: SkyboxId): string {
  return `/env/skyboxes/skybox-${id}.png`
}

export function isSkyboxId(v: unknown): v is SkyboxId {
  return typeof v === 'string' && (SKYBOX_IDS as readonly string[]).includes(v)
}

export function isSkyboxPreference(v: unknown): v is SkyboxPreference {
  return v === 'random' || isSkyboxId(v)
}

export function normalizeSkyboxPreference(
  v: unknown,
  fallback: SkyboxPreference = 'day',
): SkyboxPreference {
  return isSkyboxPreference(v) ? v : fallback
}

/** Resolve preference → concrete skybox for this map load. */
export function resolveSkyboxId(pref: SkyboxPreference): SkyboxId {
  if (pref !== 'random') return pref
  const i = Math.floor(Math.random() * SKYBOX_IDS.length)
  return SKYBOX_IDS[i] ?? 'day'
}
