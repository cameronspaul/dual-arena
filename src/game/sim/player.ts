/**
 * Client adapter over shared player sim.
 * Preserves MeshWorld signature used by GameEngine / noclip.
 */
import {
  createPlayer,
  eyePosition,
  playerHitboxes,
  playerVolumes,
  resolveExtraAabbColliders,
  resolvePlayerWorldCollisions as resolvePlayerWorldCollisionsShared,
  stepPlayer as stepPlayerShared,
  volumesToHitboxes,
} from '@duel/shared'
import type { AABB, PlayerBody, PlayerInput } from '@duel/shared'
import {
  resolveMeshCollisions,
  type MeshWorld,
} from '../maps/meshCollision'

export {
  createPlayer,
  eyePosition,
  playerHitboxes,
  playerVolumes,
  resolveExtraAabbColliders,
  volumesToHitboxes,
}

function meshResolve(
  meshWorld: MeshWorld | null | undefined,
): ((p: PlayerBody, dt: number) => void) | null {
  if (!meshWorld || meshWorld.meshes.length === 0) return null
  return (p, dt) => resolveMeshCollisions(p, meshWorld, dt)
}

export function stepPlayer(
  p: PlayerBody,
  input: PlayerInput,
  dt: number,
  worldColliders: AABB[],
  meshWorld?: MeshWorld | null,
  extraColliders?: AABB[] | null,
) {
  stepPlayerShared(
    p,
    input,
    dt,
    worldColliders,
    meshResolve(meshWorld),
    extraColliders,
  )
}

export function resolvePlayerWorldCollisions(
  p: PlayerBody,
  worldColliders: AABB[],
  meshWorld?: MeshWorld | null,
  dt = 1 / 60,
  extraColliders?: AABB[] | null,
) {
  resolvePlayerWorldCollisionsShared(
    p,
    worldColliders,
    meshResolve(meshWorld),
    dt,
    extraColliders,
  )
}
