/**
 * Level editor: noclip placement of team spawns + barrier walls.
 * Owns layout state; host provides player pose and spawn helpers.
 */
import { gameAudio } from '../core/audio'
import { facingXZ } from '../core/math'
import { LevelEditorSystem } from '../editor/LevelEditorSystem'
import {
  authoredBarrierLayout,
  authoredLayout,
  BARRIER_DEFAULTS,
  barriersToAabbs,
  clearBarrierLayout,
  clearSpawnLayout,
  makeBarrierId,
  makeSpawnId,
  saveBarrierLayout,
  saveSpawnLayout,
  wallSizeFromYaw,
  type BarrierWall,
  type MapBarrierLayout,
  type MapId,
  type MapSpawnLayout,
  type SpawnPoint,
  type TeamId,
} from '../maps'
import type { AABB } from '../core/types'
import type { BarrierVisuals } from '../systems/BarrierVisuals'
import type { PlayerBody } from '@glint/shared'

export type LevelEditorHost = {
  player: PlayerBody
  mapId: MapId
  barrierVisuals: BarrierVisuals
  applySpawn(
    spawn: { x: number; y: number; z: number },
    spawnYaw: number,
  ): void
  rebuildFallKillY(): void
}

export class LevelEditorSession {
  readonly system = new LevelEditorSystem()
  active = false
  spawnLayout: MapSpawnLayout
  barrierLayout: MapBarrierLayout
  barrierColliders: AABB[] = []
  editorTeam: TeamId = 'blue'
  editorSnapFloor = true
  editorTool: 'spawn' | 'barrier' = 'spawn'
  barrierLength: number = BARRIER_DEFAULTS.length
  barrierHeight: number = BARRIER_DEFAULTS.height
  barrierThickness: number = BARRIER_DEFAULTS.thickness
  barrierInfiniteHeight: boolean = BARRIER_DEFAULTS.infiniteHeight
  barrierInfiniteWidth: boolean = BARRIER_DEFAULTS.infiniteWidth
  lastPlacedSpawnId: string | null = null
  lastPlacedBarrierId: string | null = null
  private host: LevelEditorHost
  private spawnLayoutListeners = new Set<(layout: MapSpawnLayout) => void>()
  private barrierLayoutListeners = new Set<(layout: MapBarrierLayout) => void>()

  constructor(
    host: LevelEditorHost,
    _mapId: MapId,
    spawnLayout: MapSpawnLayout,
    barrierLayout: MapBarrierLayout,
  ) {
    this.host = host
    this.spawnLayout = spawnLayout
    this.barrierLayout = barrierLayout
    this.rebuildBarrierColliders()
  }

  /** Rebind host after construction if needed (same object is fine). */
  setHost(host: LevelEditorHost) {
    this.host = host
  }

  setActive(active: boolean) {
    this.active = active
    this.system.setActive(active)
    const { player } = this.host
    if (active) {
      player.velocity.x = 0
      player.velocity.y = 0
      player.velocity.z = 0
    }
    this.system.sync(this.spawnLayout.spawns)
    this.system.syncBarriers(this.barrierLayout.barriers)
  }

  getEditorTool(): 'spawn' | 'barrier' {
    return this.editorTool
  }

  setEditorTool(tool: 'spawn' | 'barrier') {
    this.editorTool = tool
  }

  getBarrierDefaults() {
    return {
      length: this.barrierLength,
      height: this.barrierHeight,
      thickness: this.barrierThickness,
      infiniteHeight: this.barrierInfiniteHeight,
      infiniteWidth: this.barrierInfiniteWidth,
    }
  }

  setBarrierDefaults(opts: {
    length?: number
    height?: number
    thickness?: number
    infiniteHeight?: boolean
    infiniteWidth?: boolean
  }) {
    if (opts.length != null && opts.length > 0.1) this.barrierLength = opts.length
    if (opts.height != null && opts.height > 0.1) this.barrierHeight = opts.height
    if (opts.thickness != null && opts.thickness > 0.05) {
      this.barrierThickness = opts.thickness
    }
    if (opts.infiniteHeight != null) {
      this.barrierInfiniteHeight = opts.infiniteHeight
    }
    if (opts.infiniteWidth != null) {
      this.barrierInfiniteWidth = opts.infiniteWidth
    }
  }

  getBarrierLayout(): MapBarrierLayout {
    return {
      version: 1,
      mapId: this.barrierLayout.mapId,
      barriers: this.barrierLayout.barriers.map((b) => ({ ...b })),
    }
  }

  onBarrierLayout(fn: (layout: MapBarrierLayout) => void) {
    this.barrierLayoutListeners.add(fn)
    return () => this.barrierLayoutListeners.delete(fn)
  }

  /**
   * Place an axis-aligned barrier wall in front of the player.
   * Orientation snaps to cardinal axes from look yaw (thin face blocks you).
   */
  placeBarrierAtPlayer(): BarrierWall | null {
    const { player } = this.host
    const yaw = player.yaw
    const size = wallSizeFromYaw(
      yaw,
      this.barrierLength,
      this.barrierHeight,
      this.barrierThickness,
    )
    const look = facingXZ(yaw)
    // Sit just ahead of the thin face so the player is not inside on place
    const thin = Math.min(size.width, size.depth)
    const offset = thin * 0.5 + player.radius + 0.35
    let x = player.position.x + look.x * offset
    let z = player.position.z + look.z * offset
    let floorY = player.position.y
    if (this.editorSnapFloor) {
      const floor = this.system.sampleFloorY(
        x,
        z,
        Math.max(player.position.y + 4, 20),
      )
      if (floor !== null) floorY = floor
    }
    // Signs face the placer: thin-axis face whose normal points back at the player
    const alongX = size.width >= size.depth
    const signFace: 1 | -1 = alongX
      ? look.z < 0
        ? 1
        : -1
      : look.x < 0
        ? 1
        : -1
    const wall: BarrierWall = {
      id: makeBarrierId(this.barrierLayout.barriers),
      x,
      y: floorY + size.height * 0.5,
      z,
      width: size.width,
      height: size.height,
      depth: size.depth,
      infiniteHeight: this.barrierInfiniteHeight,
      infiniteWidth: this.barrierInfiniteWidth,
      signFace,
    }
    this.barrierLayout.barriers.push(wall)
    this.lastPlacedBarrierId = wall.id
    this.persistAndSyncBarriers()
    return wall
  }

  removeBarrier(id: string): boolean {
    const before = this.barrierLayout.barriers.length
    this.barrierLayout.barriers = this.barrierLayout.barriers.filter(
      (b) => b.id !== id,
    )
    if (this.barrierLayout.barriers.length === before) return false
    if (this.lastPlacedBarrierId === id) this.lastPlacedBarrierId = null
    this.persistAndSyncBarriers()
    return true
  }

  undoLastBarrier(): boolean {
    if (this.lastPlacedBarrierId) {
      return this.removeBarrier(this.lastPlacedBarrierId)
    }
    const last =
      this.barrierLayout.barriers[this.barrierLayout.barriers.length - 1]
    if (!last) return false
    return this.removeBarrier(last.id)
  }

  clearAllBarriers() {
    // Drop browser override so baked authored walls return
    clearBarrierLayout(this.host.mapId)
    this.barrierLayout = authoredBarrierLayout(this.host.mapId)
    this.lastPlacedBarrierId = null
    this.rebuildBarrierColliders()
    this.system.syncBarriers(this.barrierLayout.barriers)
    this.system.highlightBarrier(null)
    this.host.barrierVisuals.sync(this.barrierLayout.barriers)
    const snap = this.getBarrierLayout()
    for (const fn of this.barrierLayoutListeners) fn(snap)
  }

  /** Force authored barrier defaults (clears localStorage override). */
  resetBarriersToAuthored() {
    this.clearAllBarriers()
  }

  setBarrierLayout(layout: MapBarrierLayout) {
    this.barrierLayout = {
      version: 1,
      mapId: this.host.mapId,
      barriers: layout.barriers.map((b) => ({ ...b })),
    }
    this.lastPlacedBarrierId = null
    this.persistAndSyncBarriers()
  }

  goToBarrier(id: string): boolean {
    const b = this.barrierLayout.barriers.find((w) => w.id === id)
    if (!b) return false
    const { player } = this.host
    // Stand just outside the thin face (finite thickness, not infinite axes)
    const halfThin = Math.min(b.width, b.depth) * 0.5 + player.radius + 0.4
    const alongX = b.width < b.depth
    const feetY = b.infiniteHeight
      ? Math.max(0, b.y - b.height * 0.5)
      : b.y - b.height * 0.5
    this.host.applySpawn(
      {
        x: alongX ? b.x + halfThin : b.x,
        y: feetY,
        z: alongX ? b.z : b.z + halfThin,
      },
      player.yaw,
    )
    this.lastPlacedBarrierId = b.id
    this.system.highlightBarrier(b.id)
    return true
  }

  rebuildBarrierColliders() {
    this.barrierColliders = barriersToAabbs(this.barrierLayout.barriers)
  }

  private persistAndSyncBarriers() {
    this.barrierLayout.mapId = this.host.mapId
    saveBarrierLayout(this.barrierLayout)
    this.rebuildBarrierColliders()
    this.system.syncBarriers(this.barrierLayout.barriers)
    this.system.highlightBarrier(this.lastPlacedBarrierId)
    this.host.barrierVisuals.sync(this.barrierLayout.barriers)
    const snap = this.getBarrierLayout()
    for (const fn of this.barrierLayoutListeners) fn(snap)
  }

  getSpawnLayout(): MapSpawnLayout {
    return {
      version: 1,
      mapId: this.spawnLayout.mapId,
      spawns: this.spawnLayout.spawns.map((s) => ({ ...s })),
    }
  }

  onSpawnLayout(fn: (layout: MapSpawnLayout) => void) {
    this.spawnLayoutListeners.add(fn)
    return () => this.spawnLayoutListeners.delete(fn)
  }

  getEditorTeam(): TeamId {
    return this.editorTeam
  }

  setEditorTeam(team: TeamId) {
    this.editorTeam = team
  }

  getEditorSnapFloor() {
    return this.editorSnapFloor
  }

  setEditorSnapFloor(snap: boolean) {
    this.editorSnapFloor = snap
  }

  getEditorPosition() {
    const { player } = this.host
    return {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      yaw: player.yaw,
      pitch: player.pitch,
    }
  }

  /**
   * Place a spawn at the camera feet (optional floor snap).
   * Returns the new point, or null if nothing was added.
   */
  placeSpawnAtPlayer(team: TeamId = this.editorTeam): SpawnPoint | null {
    const { player } = this.host
    let y = player.position.y
    const x = player.position.x
    const z = player.position.z
    if (this.editorSnapFloor) {
      const floor = this.system.sampleFloorY(x, z, Math.max(y + 4, 20))
      if (floor !== null) y = floor
    }
    const spawn: SpawnPoint = {
      id: makeSpawnId(team, this.spawnLayout.spawns),
      team,
      x,
      y,
      z,
      yaw: player.yaw,
    }
    this.spawnLayout.spawns.push(spawn)
    this.lastPlacedSpawnId = spawn.id
    this.persistAndSyncSpawns()
    return spawn
  }

  removeSpawn(id: string): boolean {
    const before = this.spawnLayout.spawns.length
    this.spawnLayout.spawns = this.spawnLayout.spawns.filter((s) => s.id !== id)
    if (this.spawnLayout.spawns.length === before) return false
    if (this.lastPlacedSpawnId === id) this.lastPlacedSpawnId = null
    this.persistAndSyncSpawns()
    return true
  }

  /** Remove last placed spawn, or last of the active team. */
  undoLastSpawn(): boolean {
    if (this.lastPlacedSpawnId) {
      return this.removeSpawn(this.lastPlacedSpawnId)
    }
    for (let i = this.spawnLayout.spawns.length - 1; i >= 0; i--) {
      if (this.spawnLayout.spawns[i].team === this.editorTeam) {
        return this.removeSpawn(this.spawnLayout.spawns[i].id)
      }
    }
    return false
  }

  clearTeamSpawns(team: TeamId) {
    this.spawnLayout.spawns = this.spawnLayout.spawns.filter(
      (s) => s.team !== team,
    )
    this.lastPlacedSpawnId = null
    this.persistAndSyncSpawns()
  }

  clearAllSpawns() {
    // Drop browser override so baked authored pads (e.g. desert) return
    clearSpawnLayout(this.host.mapId)
    this.spawnLayout = authoredLayout(this.host.mapId)
    this.lastPlacedSpawnId = null
    this.system.sync(this.spawnLayout.spawns)
    this.system.highlight(null)
    const snap = this.getSpawnLayout()
    for (const fn of this.spawnLayoutListeners) fn(snap)
  }

  /** Force authored defaults (clears localStorage override). */
  resetSpawnsToAuthored() {
    this.clearAllSpawns()
  }

  setSpawnLayout(layout: MapSpawnLayout) {
    this.spawnLayout = {
      version: 1,
      mapId: this.host.mapId,
      spawns: layout.spawns.map((s) => ({ ...s })),
    }
    this.lastPlacedSpawnId = null
    this.persistAndSyncSpawns()
  }

  /** Teleport editor camera to a spawn (feet). */
  goToSpawn(id: string): boolean {
    const s = this.spawnLayout.spawns.find((p) => p.id === id)
    if (!s) return false
    this.host.applySpawn({ x: s.x, y: s.y, z: s.z }, s.yaw)
    this.lastPlacedSpawnId = s.id
    this.system.highlight(s.id)
    return true
  }

  private persistAndSyncSpawns() {
    this.spawnLayout.mapId = this.host.mapId
    saveSpawnLayout(this.spawnLayout)
    this.system.sync(this.spawnLayout.spawns)
    this.system.highlight(this.lastPlacedSpawnId)
    this.host.rebuildFallKillY()
    const snap = this.getSpawnLayout()
    for (const fn of this.spawnLayoutListeners) fn(snap)
  }

  /** Place active tool / undo on editor input edges. */
  handleEditorInput(input: { fire: boolean; reload: boolean }) {
    if (input.fire) {
      if (this.editorTool === 'barrier') {
        if (this.placeBarrierAtPlayer()) gameAudio.uiClick()
      } else {
        this.placeSpawnAtPlayer(this.editorTeam)
        gameAudio.uiClick()
      }
    }
    if (input.reload) {
      if (this.editorTool === 'barrier') {
        if (this.undoLastBarrier()) gameAudio.uiClick()
      } else if (this.undoLastSpawn()) {
        gameAudio.uiClick()
      }
    }
  }

  dispose() {
    this.system.dispose()
    this.spawnLayoutListeners.clear()
    this.barrierLayoutListeners.clear()
  }
}
