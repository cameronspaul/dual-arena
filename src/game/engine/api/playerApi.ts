/**
 * Local player / camera / map / HUD public + internal surface.
 */
import type { DeathReason, PlayerInput } from '../../core/types'
import type { CharacterAppearance } from '../../character/appearance'
import type { MapId, MapBounds } from '../../maps'
import type * as THREE from 'three'
import {
  applyMapLoadSpawn,
  applyPlaySpawn,
  applySpawn,
  damagePlayer,
  enterFreeCam,
  exitFreeCam,
  killPlayer,
  rebuildFallKillY,
  restartRound,
  setFreeCam,
  setThirdPerson,
  type PlaySpawn,
} from '../playerLifecycle'
import { captureMapPerf } from '../mapBootstrap'
import { emitHud } from '../hud'
import { tickSpectate } from '../tick/tickSpectate'
import type { HudListener } from '../types'
import type { GameEngine } from '../GameEngine'

export type PlayerApi = {
  // internal (used by modules / host pattern)
  applySpawn(
    spawn: { x: number; y: number; z: number },
    spawnYaw: number,
  ): void
  applyMapLoadSpawn(
    catalogSpawn: { x: number; y: number; z: number },
    catalogYaw: number,
  ): void
  applyPlaySpawn(fallback: PlaySpawn): void
  rebuildFallKillY(): void
  killPlayer(reason: DeathReason): void
  restartRound(): void
  enterFreeCam(): void
  exitFreeCam(): void
  tickSpectate(dt: number, input: PlayerInput): void
  emitHud(): void
  captureMapPerf(
    root: THREE.Object3D | null,
    bounds: MapBounds | null,
    walkMeshes: THREE.Object3D[],
  ): void

  // public
  damagePlayer(amount: number, reason?: DeathReason): void
  isPlayerAlive(): boolean
  isSpectating(): boolean
  getMapId(): MapId
  getMapName(): string
  isMapReady(): boolean
  getMapLoadError(): string | null
  onHud(fn: HudListener): () => void
  setThirdPerson(enabled: boolean): void
  isThirdPerson(): boolean
  setFreeCam(enabled: boolean): void
  isFreeCam(): boolean
  isVoluntaryFreeCam(): boolean
  setDummiesEnabled(enabled: boolean): void
  applyPlayerAppearance(appearance: CharacterAppearance): void
  isDummiesEnabled(): boolean
  setDummiesPaused(paused: boolean): void
  isDummiesPaused(): boolean
}

export const playerApi: ThisType<GameEngine> & PlayerApi = {
  applySpawn(spawn, spawnYaw) {
    applySpawn(this, spawn, spawnYaw)
  },
  applyMapLoadSpawn(catalogSpawn, catalogYaw) {
    applyMapLoadSpawn(this, catalogSpawn, catalogYaw)
  },
  applyPlaySpawn(fallback) {
    applyPlaySpawn(this, fallback)
  },
  rebuildFallKillY() {
    rebuildFallKillY(this)
  },
  killPlayer(reason) {
    killPlayer(this, reason)
  },
  restartRound() {
    restartRound(this)
  },
  enterFreeCam() {
    enterFreeCam(this)
  },
  exitFreeCam() {
    exitFreeCam(this)
  },
  tickSpectate(dt, input) {
    tickSpectate(this, dt, input)
  },
  emitHud() {
    emitHud(this)
  },
  captureMapPerf(root, bounds, walkMeshes) {
    captureMapPerf(this, root, bounds, walkMeshes)
  },

  damagePlayer(amount, reason = 'combat') {
    damagePlayer(this, amount, reason)
  },
  isPlayerAlive() {
    return this.playerAlive
  },
  isSpectating() {
    return this.freeCam !== null
  },
  getMapId() {
    return this.mapDef.id
  },
  getMapName() {
    return this.mapDef.name
  },
  isMapReady() {
    return this.mapReady
  },
  getMapLoadError() {
    return this.mapLoadError
  },
  onHud(fn) {
    this.hudListeners.add(fn)
    return () => this.hudListeners.delete(fn)
  },
  setThirdPerson(enabled) {
    setThirdPerson(this, enabled)
  },
  isThirdPerson() {
    return this.thirdPerson
  },
  setFreeCam(enabled) {
    setFreeCam(this, enabled)
  },
  isFreeCam() {
    return this.freeCam !== null
  },
  isVoluntaryFreeCam() {
    return this.voluntaryFreeCam
  },
  setDummiesEnabled(enabled) {
    if (this.isOnline) return
    this.dummiesEnabled = enabled
    this.dummiesSys.setEnabled(enabled)
  },
  applyPlayerAppearance(appearance) {
    this.playerVisuals.applyAppearance(appearance)
  },
  isDummiesEnabled() {
    return this.dummiesEnabled
  },
  setDummiesPaused(paused) {
    this.setDummiesEnabled(!paused)
  },
  isDummiesPaused() {
    return !this.dummiesEnabled
  },
}
