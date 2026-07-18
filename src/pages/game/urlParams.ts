import {
  DEFAULT_MAP_ID,
  isDuelMapId,
  type MapId,
} from '@/game/maps'
import {
  isSkyboxId,
  isSkyboxPreference,
  type SkyboxId,
  type SkyboxPreference,
} from '@/game/scene/skyboxes'

/**
 * Picker selection is always a duel arena (never practice range).
 * `map=range` only applies while already in a play session (practice / tutorial / host wait).
 */
export function readInitialMap(params: URLSearchParams): MapId {
  const q = params.get('map')
  if (q && isDuelMapId(q)) return q
  return DEFAULT_MAP_ID
}

/** Session sky from URL (concrete only). Missing → day. */
export function readInitialSkybox(params: URLSearchParams): SkyboxId {
  const q = params.get('sky')
  if (q && isSkyboxId(q)) return q
  return 'day'
}

/** Picker preference: allow random in UI; URL concrete ids map 1:1. */
export function readPickerSkybox(params: URLSearchParams): SkyboxPreference {
  const q = params.get('sky')
  if (q && isSkyboxPreference(q)) return q
  return 'day'
}
