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
  type MeshWorld,
} from './meshCollision'
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
  barrierToAabb,
  barriersToAabbs,
  wallSizeFromYaw,
  BARRIER_DEFAULTS,
  type BarrierWall,
  type MapBarrierLayout,
} from './barriers'
export { AUTHORED_SPAWNS, getAuthoredSpawns } from './authoredSpawns'
