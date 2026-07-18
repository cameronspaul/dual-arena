/**
 * Async map load: procedural range or GLTF arena + env + dummies.
 */
import * as THREE from 'three'
import { DEBUG } from '../core/config'
import type { AABB, DummyTarget } from '../core/types'
import {
  analyzeMapStaticPerf,
  buildMeshWorld,
  buildProceduralRange,
  loadEnvForMap,
  loadGltfMap,
  logMapStaticPerf,
  type MapBounds,
  type MapDef,
  type MapStaticPerf,
} from '../maps'
import type { SkyboxId } from '../scene/skyboxes'
import { createDummies } from '../sim/world'
import type { LevelEditorSystem } from '../editor/LevelEditorSystem'
import type { RemotePlayerSystem } from '../net'
import type { DummySystem } from '../systems/DummySystem'
import type { PlayerVisuals } from '../systems/PlayerVisuals'
import type { RangeControls } from '../systems/RangeControls'
import type { CharacterAppearance } from '../character/appearance'
import type { MapSpawnLayout, MapBarrierLayout } from '../maps'
import { useAppStore } from '@/stores/useAppStore'

export type MapBootstrapHost = {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  camera: THREE.PerspectiveCamera
  mapDef: MapDef
  skyboxId: SkyboxId
  colliders: AABB[]
  mapHitMeshes: THREE.Object3D[]
  meshWorld: { meshes: THREE.Object3D[] } | null
  floorMat: THREE.MeshStandardMaterial | null
  coverMat: THREE.MeshStandardMaterial | null
  envTextures: THREE.Texture[]
  dummies: DummyTarget[]
  mapReady: boolean
  mapLoadError: string | null
  mapStaticPerf: MapStaticPerf | null
  dummiesEnabled: boolean
  thirdPerson: boolean
  spawnLayout: MapSpawnLayout
  barrierLayout: MapBarrierLayout
  remotes: RemotePlayerSystem
  levelEditor: LevelEditorSystem
  dummiesSys: DummySystem
  playerVisuals: PlayerVisuals
  rangeControls: RangeControls
  applyMapLoadSpawn(
    catalogSpawn: { x: number; y: number; z: number },
    catalogYaw: number,
  ): void
  applyPlayerAppearance(appearance: CharacterAppearance): void
  captureMapPerf(
    root: THREE.Object3D | null,
    bounds: MapBounds | null,
    walkMeshes: THREE.Object3D[],
  ): void
}

export async function bootstrapMap(host: MapBootstrapHost) {
  try {
    if (host.mapDef.kind === 'range') {
      const built = buildProceduralRange(host.scene)
      host.colliders = built.colliders
      host.floorMat = built.floorMat
      host.coverMat = built.coverMat
      host.mapHitMeshes = built.hitMeshes
      host.meshWorld = null
      host.remotes.setMeshWorld(null)
      host.levelEditor.setHitMeshes(built.hitMeshes)
      host.applyMapLoadSpawn(built.spawn, built.spawnYaw)
      host.dummies = createDummies({
        defs: built.dummies,
        bounds: built.dummyBounds,
        practiceRange: true,
      })
      host.rangeControls.attach(built.controlButtons ?? [])
      host.rangeControls.setState(
        host.rangeControls.mode,
        host.rangeControls.rows,
      )
      const textures = await loadEnvForMap(
        host.mapDef,
        host.scene,
        host.renderer,
        host.floorMat,
        host.coverMat,
        host.skyboxId,
      )
      host.envTextures.push(...textures)
      host.captureMapPerf(null, built.bounds, [])
    } else {
      const built = await loadGltfMap(host.scene, host.mapDef)
      host.colliders = built.colliders
      host.mapHitMeshes = built.hitMeshes
      const walk =
        built.walkMeshes.length > 0 ? built.walkMeshes : built.hitMeshes
      host.meshWorld = walk.length > 0 ? buildMeshWorld(walk) : null
      host.remotes.setMeshWorld(host.meshWorld)
      host.levelEditor.setHitMeshes(built.hitMeshes)
      host.applyMapLoadSpawn(built.spawn, built.spawnYaw)
      host.dummies = createDummies({
        defs: built.dummies,
        bounds: built.dummyBounds,
      })
      host.rangeControls.clear()
      if (built.bounds) {
        const span = Math.hypot(built.bounds.size.x, built.bounds.size.z)
        host.camera.far = Math.max(host.mapDef.cameraFar, span * 1.2 + 40)
        host.camera.updateProjectionMatrix()
      }
      const textures = await loadEnvForMap(
        host.mapDef,
        host.scene,
        host.renderer,
        null,
        null,
        host.skyboxId,
      )
      host.envTextures.push(...textures)
      console.info(
        `[map] ${host.mapDef.id} fitted`,
        built.bounds,
        'spawn',
        built.spawn,
        'collisionMeshes',
        built.hitMeshes.length,
        'walkMeshes',
        walk.length,
      )
      host.captureMapPerf(built.root, built.bounds, walk)
    }
    host.mapReady = true
    host.levelEditor.sync(host.spawnLayout.spawns)
    host.levelEditor.syncBarriers(host.barrierLayout.barriers)
    void host.dummiesSys
      .load(
        host.scene,
        host.dummies,
        host.playerVisuals,
        host.thirdPerson,
        useAppStore.getState().characterAppearance,
      )
      .then(() => {
        host.dummiesSys.setEnabled(host.dummiesEnabled)
        host.applyPlayerAppearance(
          useAppStore.getState().characterAppearance,
        )
      })
  } catch (e) {
    console.error('Map load failed', e)
    host.mapLoadError =
      e instanceof Error ? e.message : 'Failed to load map'
    host.colliders = []
    host.mapReady = true
  }
}

/** Snapshot map geometry cost after load (console + HUD). */
export function captureMapPerf(
  host: {
    mapDef: MapDef
    scene: THREE.Scene
    colliders: AABB[]
    mapHitMeshes: THREE.Object3D[]
    mapStaticPerf: MapStaticPerf | null
  },
  root: THREE.Object3D | null,
  bounds: MapBounds | null,
  walkMeshes: THREE.Object3D[],
) {
  if (!DEBUG.showPerf) return
  const colliders =
    walkMeshes.length > 0 ? walkMeshes : host.mapHitMeshes
  const perf = analyzeMapStaticPerf({
    mapId: host.mapDef.id,
    root,
    scene: host.scene,
    collisionMeshes: colliders,
    aabbColliders: host.colliders.length,
    bounds,
  })
  host.mapStaticPerf = perf
  logMapStaticPerf(perf)
}
