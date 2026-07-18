/**
 * Level editor public surface (spawns + barriers).
 */
import type {
  BarrierWall,
  MapBarrierLayout,
  MapSpawnLayout,
  SpawnPoint,
  TeamId,
} from '../../maps'
import type { GameEngine } from '../GameEngine'

export type EditorApi = {
  setLevelEditorActive(active: boolean): void
  getEditorTool(): 'spawn' | 'barrier'
  setEditorTool(tool: 'spawn' | 'barrier'): void
  getBarrierDefaults(): ReturnType<GameEngine['editor']['getBarrierDefaults']>
  setBarrierDefaults(opts: {
    length?: number
    height?: number
    thickness?: number
    infiniteHeight?: boolean
    infiniteWidth?: boolean
  }): void
  getBarrierLayout(): MapBarrierLayout
  onBarrierLayout(fn: (layout: MapBarrierLayout) => void): () => void
  placeBarrierAtPlayer(): BarrierWall | null
  removeBarrier(id: string): boolean
  undoLastBarrier(): boolean
  clearAllBarriers(): void
  resetBarriersToAuthored(): void
  setBarrierLayout(layout: MapBarrierLayout): void
  goToBarrier(id: string): boolean
  isLevelEditorActive(): boolean
  getSpawnLayout(): MapSpawnLayout
  onSpawnLayout(fn: (layout: MapSpawnLayout) => void): () => void
  getEditorTeam(): TeamId
  setEditorTeam(team: TeamId): void
  getEditorSnapFloor(): boolean
  setEditorSnapFloor(snap: boolean): void
  getEditorPosition(): ReturnType<GameEngine['editor']['getEditorPosition']>
  placeSpawnAtPlayer(team?: TeamId): SpawnPoint | null
  removeSpawn(id: string): boolean
  undoLastSpawn(): boolean
  clearTeamSpawns(team: TeamId): void
  clearAllSpawns(): void
  resetSpawnsToAuthored(): void
  setSpawnLayout(layout: MapSpawnLayout): void
  goToSpawn(id: string): boolean
}

export const editorApi: ThisType<GameEngine> & EditorApi = {
  setLevelEditorActive(active) {
    if (active) {
      this.thirdPerson = false
      this.voluntaryFreeCam = false
      this.freeCam = null
      if (this.playerVisuals.body) this.playerVisuals.body.visible = false
      if (this.viewmodel.root) this.viewmodel.root.visible = false
    } else if (this.viewmodel.root) {
      this.viewmodel.root.visible = true
    }
    this.editor.setActive(active)
  },
  getEditorTool() {
    return this.editor.getEditorTool()
  },
  setEditorTool(tool) {
    this.editor.setEditorTool(tool)
  },
  getBarrierDefaults() {
    return this.editor.getBarrierDefaults()
  },
  setBarrierDefaults(opts) {
    this.editor.setBarrierDefaults(opts)
  },
  getBarrierLayout() {
    return this.editor.getBarrierLayout()
  },
  onBarrierLayout(fn) {
    return this.editor.onBarrierLayout(fn)
  },
  placeBarrierAtPlayer() {
    return this.editor.placeBarrierAtPlayer()
  },
  removeBarrier(id) {
    return this.editor.removeBarrier(id)
  },
  undoLastBarrier() {
    return this.editor.undoLastBarrier()
  },
  clearAllBarriers() {
    this.editor.clearAllBarriers()
  },
  resetBarriersToAuthored() {
    this.editor.resetBarriersToAuthored()
  },
  setBarrierLayout(layout) {
    this.editor.setBarrierLayout(layout)
  },
  goToBarrier(id) {
    return this.editor.goToBarrier(id)
  },
  isLevelEditorActive() {
    return this.editor.active
  },
  getSpawnLayout() {
    return this.editor.getSpawnLayout()
  },
  onSpawnLayout(fn) {
    return this.editor.onSpawnLayout(fn)
  },
  getEditorTeam() {
    return this.editor.getEditorTeam()
  },
  setEditorTeam(team) {
    this.editor.setEditorTeam(team)
  },
  getEditorSnapFloor() {
    return this.editor.getEditorSnapFloor()
  },
  setEditorSnapFloor(snap) {
    this.editor.setEditorSnapFloor(snap)
  },
  getEditorPosition() {
    return this.editor.getEditorPosition()
  },
  placeSpawnAtPlayer(team) {
    return this.editor.placeSpawnAtPlayer(team)
  },
  removeSpawn(id) {
    return this.editor.removeSpawn(id)
  },
  undoLastSpawn() {
    return this.editor.undoLastSpawn()
  },
  clearTeamSpawns(team) {
    this.editor.clearTeamSpawns(team)
  },
  clearAllSpawns() {
    this.editor.clearAllSpawns()
  },
  resetSpawnsToAuthored() {
    this.editor.resetSpawnsToAuthored()
  },
  setSpawnLayout(layout) {
    this.editor.setSpawnLayout(layout)
  },
  goToSpawn(id) {
    return this.editor.goToSpawn(id)
  },
}
