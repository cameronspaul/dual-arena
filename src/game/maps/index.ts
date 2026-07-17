export {
  MAPS,
  MAP_LIST,
  DEFAULT_MAP_ID,
  getMap,
  isMapId,
  type MapId,
  type MapDef,
  type MapDummyDef,
} from './catalog'
export {
  buildProceduralRange,
  loadGltfMap,
  loadEnvForMap,
  castMapHitscan,
  type MapLoadResult,
  type MapBounds,
} from './MapWorld'
export {
  prepareCollisionMeshes,
  resolveMeshCollisions,
  castMeshWorldHitscan,
  countNearbyCollisionMeshes,
  type MeshWorld,
} from './meshCollision'
export {
  analyzeMapStaticPerf,
  logMapStaticPerf,
  fmtNum,
  inferBottleneck,
  ema as perfEma,
  type MapStaticPerf,
  type LivePerf,
} from './mapPerf'
export {
  loadSpawnLayout,
  saveSpawnLayout,
  clearSpawnLayout,
  exportSpawnLayoutJson,
  parseSpawnLayout,
  downloadText,
  makeSpawnId,
  emptyLayout,
  authoredLayout,
  pickPlaySpawn,
  spawnsForTeam,
  type TeamId,
  type SpawnPoint,
  type MapSpawnLayout,
} from './spawns'
export {
  loadBarrierLayout,
  saveBarrierLayout,
  clearBarrierLayout,
  exportBarrierLayoutJson,
  parseBarrierLayout,
  makeBarrierId,
  emptyBarrierLayout,
  authoredBarrierLayout,
  barrierToAabb,
  barriersToAabbs,
  resolveBarrierCollision,
  resolveBarrierVisual,
  wallSizeFromYaw,
  BARRIER_DEFAULTS,
  BARRIER_INFINITE_EXTENT,
  BARRIER_GAME_INFINITE_LENGTH,
  type BarrierWall,
  type MapBarrierLayout,
} from './barriers'
export { AUTHORED_SPAWNS, getAuthoredSpawns } from './authoredSpawns'
export {
  AUTHORED_BARRIERS,
  getAuthoredBarriers,
} from './authoredBarriers'
