/**
 * Playable map catalog — procedural range + GLB arenas under public/models/maps.
 */
import type { Vec3 } from '../core/types'
import { WORLD } from '../core/config'

export type MapId =
  | 'range'
  | 'desert'
  | 'desert-2'
  | 'arena-v3'
  | 'arena-v4'
  | 'tdm'

export interface MapDummyDef {
  id: string
  x: number
  z: number
  yaw: number
  /** Floor height under feet (set at load for mesh maps). */
  y?: number
}

export interface MapDef {
  id: MapId
  name: string
  blurb: string
  tags: string[]
  kind: 'range' | 'gltf'
  /** public URL for glTF maps */
  url?: string
  /**
   * Uniform scale applied to the GLB before centering.
   * Tuned so each map plays at roughly human / sniper scale.
   */
  scale: number
  /** Extra yaw (radians) after load */
  rotateY: number
  /**
   * Manual offset after auto floor-to-y=0 + XZ centering.
   * Use to nudge the whole mesh if needed.
   */
  offset: Vec3
  /**
   * Preferred spawn as an *offset from map center* after fit (not raw model space).
   * Clamped into the real footprint at load time — keep values small.
   */
  spawn: Vec3
  /** Preferred yaw; may be overridden to face map center when far from it */
  spawnYaw: number
  /**
   * Preferred dummy offsets from center (clamped into footprint at load).
   * Empty → auto ring.
   */
  dummies: MapDummyDef[]
  /** Soft max dummy wander half-extent (also clamped to map size) */
  dummyBounds: number
  cameraFar: number
  fogNear: number
  fogFar: number
  fogColor: number
  bgColor: number
  /** Optional thumbnail image URL for map picker */
  thumbUrl?: string
  /**
   * When true, load Kenney prototype floor/cover textures (procedural range).
   * Skyboxes are always applied from user settings on every map.
   */
  loadEnvTextures: boolean
  /**
   * When true, falling below the lowest spawn Y by `fallKillDepth` meters
   * kills the player and enters free-cam spectate → round restart.
   * Practice range stays off (flat floor); open GLB arenas enable it.
   */
  fallDeath: boolean
  /** Override DEATH.fallKillDepth for this map (meters below spawn Y). */
  fallKillDepth?: number
  /**
   * When false, map is training-only (practice range) and must never be
   * selected as the ranked / hosted 1v1 arena.
   */
  duelEligible: boolean
}

const rangeDummies: MapDummyDef[] = WORLD.dummies.map((d) => ({
  id: d.id,
  x: d.x,
  z: d.z,
  yaw: d.yaw,
}))

/** Shared dummy ring for GLB arenas (relative to map origin after fit). */
function arenaDummies(spread: number): MapDummyDef[] {
  const s = spread
  return [
    { id: 'd0', x: 0, z: -s * 0.35, yaw: 0 },
    { id: 'd1', x: -s * 0.25, z: -s * 0.55, yaw: 0.2 },
    { id: 'd2', x: s * 0.28, z: -s * 0.5, yaw: -0.15 },
    { id: 'd3', x: -s * 0.12, z: -s * 0.8, yaw: 0.1 },
    { id: 'd4', x: s * 0.15, z: -s * 0.95, yaw: -0.05 },
  ]
}

export const MAPS: Record<MapId, MapDef> = {
  range: {
    id: 'range',
    name: 'Practice Range',
    blurb:
      'Rainbow distance corridor with a left/middle/right squad. ROWS moves them to the next band (8–38 m). Control wall: still / move / strafe, reset. Start Tutorial from the lobby for a guided how-to-play.',
    tags: ['official', 'training', 'tutorial'],
    kind: 'range',
    scale: 1,
    rotateY: 0,
    offset: { x: 0, y: 0, z: 0 },
    spawn: { x: 0, y: 0, z: 5.5 },
    spawnYaw: 0,
    dummies: rangeDummies,
    /** Long axis of the enclosed corridor (berm ~45 m downrange). */
    dummyBounds: 48,
    cameraFar: 200,
    fogNear: 55,
    fogFar: 120,
    fogColor: 0xa8c4e0,
    bgColor: 0x87a0b8,
    loadEnvTextures: true,
    fallDeath: false,
    duelEligible: false,
  },
  desert: {
    id: 'desert',
    name: 'Desert Arena',
    blurb: 'Wide open low-poly desert with long sightlines and natural cover.',
    tags: ['1v1', 'long range'],
    kind: 'gltf',
    url: '/models/maps/desert_arena_environment__low_poly_game_asset.glb',
    thumbUrl: '/maps/thumbs/desert.png',
    // World size ~29×21 m after Sketchfab Z-up fix — stay at 1:1.
    scale: 1,
    rotateY: 0,
    offset: { x: 0, y: 0, z: 0 },
    // Solo fallback ≈ blue-0 (team pads live in authoredSpawns.ts)
    spawn: { x: -13.247, y: 0.086, z: 3.49 },
    spawnYaw: -1.5583,
    dummies: arenaDummies(8),
    dummyBounds: 10,
    cameraFar: 120,
    fogNear: 25,
    fogFar: 90,
    fogColor: 0xc9b48a,
    bgColor: 0xb8a070,
    loadEnvTextures: false,
    fallDeath: true,
    duelEligible: true,
  },
  'desert-2': {
    id: 'desert-2',
    name: 'Desert Outpost',
    blurb: 'Second desert environment — open sightlines with outpost cover.',
    tags: ['1v1', 'long range'],
    kind: 'gltf',
    url: '/models/maps/fps_desert_2_Map.glb',
    thumbUrl: '/maps/thumbs/desert-2.png',
    scale: 1.5,
    rotateY: 0,
    offset: { x: 0, y: 0, z: 0 },
    spawn: { x: 0, y: 0, z: 4 },
    spawnYaw: 0,
    dummies: arenaDummies(8),
    dummyBounds: 12,
    cameraFar: 120,
    fogNear: 25,
    fogFar: 90,
    fogColor: 0xc4a87a,
    bgColor: 0xb09060,
    loadEnvTextures: false,
    fallDeath: true,
    duelEligible: true,
  },
  'arena-v3': {
    id: 'arena-v3',
    name: 'Shooter Arena',
    blurb: 'Compact box arena — close fights and fast peeks.',
    tags: ['close', 'duel'],
    kind: 'gltf',
    url: '/models/maps/fps_shooter_game_arena_map_v3.glb',
    thumbUrl: '/maps/thumbs/arena-v3.png',
    // World ~30×30×11 m after fit.
    scale: 1,
    rotateY: 0,
    offset: { x: 0, y: 0, z: 0 },
    // Solo fallback ≈ blue-0 (team pads in authoredSpawns.ts)
    spawn: { x: -11.381, y: 1, z: -3.861 },
    spawnYaw: 4.73,
    dummies: arenaDummies(8),
    dummyBounds: 12,
    cameraFar: 120,
    fogNear: 30,
    fogFar: 90,
    fogColor: 0x8a9aaa,
    bgColor: 0x6a7a8a,
    loadEnvTextures: false,
    fallDeath: true,
    duelEligible: true,
  },
  'arena-v4': {
    id: 'arena-v4',
    name: 'Shooter Arena V4',
    blurb: 'Updated box arena layout — tight corridors and multi-level peeks.',
    tags: ['close', 'duel'],
    kind: 'gltf',
    url: '/models/maps/fps_shooter_game_arena_map_v4.glb',
    thumbUrl: '/maps/thumbs/arena-v4.png',
    scale: 1,
    rotateY: 0,
    offset: { x: 0, y: 0, z: 0 },
    // Solo fallback ≈ blue-0 (team pads in authoredSpawns.ts)
    spawn: { x: 20.502, y: 0, z: -15.613 },
    spawnYaw: 1.6302,
    dummies: arenaDummies(8),
    dummyBounds: 12,
    cameraFar: 120,
    fogNear: 30,
    fogFar: 90,
    fogColor: 0x7a8a9a,
    bgColor: 0x5a6a7a,
    loadEnvTextures: false,
    fallDeath: true,
    duelEligible: true,
  },
  tdm: {
    id: 'tdm',
    name: 'TDM Compound',
    blurb: 'Resoforge low-poly TDM layout — mid-range lanes and props.',
    tags: ['mid range', 'cover'],
    kind: 'gltf',
    url: '/models/maps/lowpoly__fps__tdm__game__map_by_resoforge.glb',
    thumbUrl: '/maps/thumbs/tdm.png',
    // World ~8.5×16×4 m — mild scale so lanes feel playable without skyscraper walls.
    scale: 2.5,
    rotateY: 0,
    offset: { x: 0, y: 0, z: 0 },
    // Solo fallback ≈ blue-0 (team pads in authoredSpawns.ts)
    spawn: { x: -4.327, y: 2.627, z: 16.661 },
    spawnYaw: 6.3162,
    dummies: arenaDummies(6),
    dummyBounds: 12,
    cameraFar: 160,
    fogNear: 30,
    fogFar: 110,
    fogColor: 0x9aa8b8,
    bgColor: 0x7a8898,
    loadEnvTextures: false,
    fallDeath: true,
    duelEligible: true,
  },
}

export const MAP_LIST: MapDef[] = [
  MAPS.range,
  MAPS.desert,
  MAPS['desert-2'],
  MAPS['arena-v3'],
  MAPS['arena-v4'],
  MAPS.tdm,
]

/** Maps allowed for hosted / joined 1v1 (excludes practice range). */
export const DUEL_MAP_LIST: MapDef[] = MAP_LIST.filter((m) => m.duelEligible)

/** Default picker / deploy selection — never the practice range. */
export const DEFAULT_MAP_ID: MapId = 'desert'

/** Fallback arena when a host tries to use the practice range. */
export const DEFAULT_DUEL_MAP_ID: MapId = 'desert'

export function getMap(id: string | null | undefined): MapDef {
  if (id && id in MAPS) return MAPS[id as MapId]
  return MAPS[DEFAULT_MAP_ID]
}

export function isMapId(id: string): id is MapId {
  return id in MAPS
}

/** True for catalog maps that can be hosted as a 1v1 arena. */
export function isDuelMapId(id: string): id is MapId {
  return isMapId(id) && MAPS[id].duelEligible
}

/** Coerce any id to a duel-eligible map (practice range → default arena). */
export function coerceDuelMapId(id: string | null | undefined): MapId {
  if (id && isDuelMapId(id)) return id
  return DEFAULT_DUEL_MAP_ID
}
