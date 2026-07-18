/**
 * Client re-export of shared mesh hitscan helpers.
 * Offline range + visuals use the same code path as the server.
 */
export {
  meshNameToZone,
  zoneWireColor,
  damageForZone,
  isArmBoneName,
  registerHitMeshes,
  splitSkinnedGeometryByArmBones,
  makeZoneProxyMesh,
  splitChestMeshesByArmWeights,
  paintDummyMeshes,
  makePlaceholderDummy,
  createMeshHitscanScratch,
  castMeshHitscan,
  collectDummyHitTargets,
} from '@glint/shared'
export type { MeshHitscanScratch } from '@glint/shared'
