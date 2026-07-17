/**
 * Thin orchestrator: owns sim state + subsystems, runs the frame loop.
 */
import * as THREE from 'three'
import { gameAudio } from '../core/audio'
import { LOOK } from '../core/config'
import { InputManager } from '../core/input'
import type { HitEvent, HudSnapshot, SniperState } from '../core/types'
import { stepEditorMove } from '../editor/noclip'
import { LevelEditorSystem } from '../editor/LevelEditorSystem'
import {
  buildProceduralRange,
  castMapHitscan,
  getMap,
  loadEnvForMap,
  loadGltfMap,
  authoredLayout,
  BARRIER_DEFAULTS,
  barriersToAabbs,
  clearBarrierLayout,
  clearSpawnLayout,
  emptyBarrierLayout,
  loadBarrierLayout,
  loadSpawnLayout,
  makeBarrierId,
  makeSpawnId,
  pickPlaySpawn,
  saveBarrierLayout,
  saveSpawnLayout,
  wallSizeFromYaw,
  type BarrierWall,
  type MapBarrierLayout,
  type MapDef,
  type MapId,
  type MapSpawnLayout,
  type SpawnPoint,
  type TeamId,
} from '../maps'
import { facingXZ } from '../core/math'
import type { SkyboxId } from '../scene/skyboxes'
import { createPlayer, stepPlayer } from '../sim/player'
import {
  aimSpread,
  applyRecoil,
  createSniper,
  stepSniper,
  tryFire,
} from '../sim/sniper'
import {
  createDummies,
  stepDummies,
  stepRespawns,
  type RespawnTimer,
} from '../sim/world'
import { CombatFx } from '../systems/CombatFx'
import { DummySystem } from '../systems/DummySystem'
import { PlayerVisuals } from '../systems/PlayerVisuals'
import { ViewFeel } from '../systems/ViewFeel'
import { fireShot, playSniperPhaseSfx } from '../systems/combat'
import { ViewmodelSystem } from '../viewmodel/ViewmodelSystem'
import type { ViewmodelConfig } from '../viewmodel/config'

export type HudListener = (hud: HudSnapshot) => void

export type GameEngineOptions = {
  mapId?: MapId | string
  /**
   * Concrete skybox for this session (already resolved — not `"random"`).
   * Shared via URL / match config so all players see the same sky.
   */
  skybox?: SkyboxId
}

export class GameEngine {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private input = new InputManager()
  private player = createPlayer()
  private sniper = createSniper()
  private colliders: import('../core/types').AABB[] = []
  private dummies = createDummies()
  private respawns: RespawnTimer[] = []
  private running = false
  private raf = 0
  private lastTime = 0
  private container: HTMLElement

  private viewmodel = new ViewmodelSystem()
  private dummiesSys = new DummySystem()
  private playerVisuals = new PlayerVisuals()
  private combatFx = new CombatFx()
  private viewFeel = new ViewFeel()

  private hudListeners = new Set<HudListener>()
  private lastHit: HitEvent | null = null
  private lastHitAge = 999
  private lastHitId = 0
  private kills = 0
  private playerHp = 100
  private clock = new THREE.Clock()
  private floorMat: THREE.MeshStandardMaterial | null = null
  private coverMat: THREE.MeshStandardMaterial | null = null
  private envTextures: THREE.Texture[] = []
  private thirdPerson = false
  private dummiesPaused = false
  private prevSniperPhase: SniperState['phase'] = 'ready'

  private mapDef: MapDef
  /** Session skybox (concrete id; default day). */
  private skyboxId: SkyboxId
  private mapHitMeshes: THREE.Object3D[] = []
  /** Live triangle collision for GLB maps (null on procedural range). */
  private meshWorld: { meshes: THREE.Object3D[] } | null = null
  private mapReady = false
  private mapLoadError: string | null = null

  /** Level editor: noclip + team spawn / barrier placement */
  private levelEditor = new LevelEditorSystem()
  private levelEditorActive = false
  private spawnLayout: MapSpawnLayout
  private barrierLayout: MapBarrierLayout
  private barrierColliders: import('../core/types').AABB[] = []
  private editorTeam: TeamId = 'blue'
  private editorSnapFloor = true
  private editorTool: 'spawn' | 'barrier' = 'spawn'
  private barrierLength: number = BARRIER_DEFAULTS.length
  private barrierHeight: number = BARRIER_DEFAULTS.height
  private barrierThickness: number = BARRIER_DEFAULTS.thickness
  private lastPlacedSpawnId: string | null = null
  private lastPlacedBarrierId: string | null = null
  private spawnLayoutListeners = new Set<(layout: MapSpawnLayout) => void>()
  private barrierLayoutListeners = new Set<(layout: MapBarrierLayout) => void>()

  constructor(container: HTMLElement, opts: GameEngineOptions = {}) {
    this.container = container
    this.mapDef = getMap(opts.mapId)
    this.skyboxId = opts.skybox ?? 'day'
    this.spawnLayout = loadSpawnLayout(this.mapDef.id)
    this.barrierLayout = loadBarrierLayout(this.mapDef.id)
    this.rebuildBarrierColliders()

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(this.mapDef.bgColor)
    this.scene.fog = new THREE.Fog(
      this.mapDef.fogColor,
      this.mapDef.fogNear,
      this.mapDef.fogFar,
    )

    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight
    this.camera = new THREE.PerspectiveCamera(
      LOOK.hipFov,
      w / h,
      0.05,
      this.mapDef.cameraFar,
    )
    this.camera.rotation.order = 'YXZ'

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.classList.add('touch-none', 'outline-none')
    this.renderer.domElement.tabIndex = 0

    // Temporary spawn — GLB maps re-place the player after real bounds are known.
    this.player = createPlayer(this.mapDef.spawn)
    this.player.yaw = this.mapDef.spawnYaw
    this.input.setLook(this.mapDef.spawnYaw, 0)

    this.dummies = createDummies({
      defs: this.mapDef.dummies,
      bounds: this.mapDef.dummyBounds,
    })

    this.combatFx.build(this.scene)
    this.playerVisuals.buildPlaceholder(this.scene)
    this.scene.add(this.levelEditor.root)
    this.levelEditor.sync(this.spawnLayout.spawns)
    this.levelEditor.syncBarriers(this.barrierLayout.barriers)
    void this.bootstrapMap()
    void this.viewmodel.load(this.camera, this.scene)
    this.input.attach(this.renderer.domElement)

    window.addEventListener('resize', this.onResize)
  }

  private applySpawn(
    spawn: { x: number; y: number; z: number },
    spawnYaw: number,
  ) {
    this.player.position.x = spawn.x
    // Engine ground plane is y=0; keep feet on/above it. Mesh floors near 0
    // are preferred by the placer — raised Y still helps until gravity settles.
    this.player.position.y = Math.max(0, spawn.y)
    this.player.position.z = spawn.z
    this.player.velocity.x = 0
    this.player.velocity.y = 0
    this.player.velocity.z = 0
    this.player.yaw = spawnYaw
    this.player.pitch = 0
    this.player.grounded = true
    this.input.setLook(spawnYaw, 0)
  }

  /** Team pads from editor/authored layout, else map catalog fallback. */
  private applyPlaySpawn(fallback: {
    spawn: { x: number; y: number; z: number }
    spawnYaw: number
  }) {
    const pad = pickPlaySpawn(this.spawnLayout)
    if (pad) {
      this.applySpawn({ x: pad.x, y: pad.y, z: pad.z }, pad.yaw)
      return
    }
    this.applySpawn(fallback.spawn, fallback.spawnYaw)
  }

  private async bootstrapMap() {
    try {
      if (this.mapDef.kind === 'range') {
        const built = buildProceduralRange(this.scene)
        this.colliders = built.colliders
        this.floorMat = built.floorMat
        this.coverMat = built.coverMat
        this.mapHitMeshes = built.hitMeshes
        this.meshWorld = null
        this.levelEditor.setHitMeshes(built.hitMeshes)
        this.applyPlaySpawn({
          spawn: built.spawn,
          spawnYaw: built.spawnYaw,
        })
        this.dummies = createDummies({
          defs: built.dummies,
          bounds: built.dummyBounds,
        })
        const textures = await loadEnvForMap(
          this.mapDef,
          this.scene,
          this.renderer,
          this.floorMat,
          this.coverMat,
          this.skyboxId,
        )
        this.envTextures.push(...textures)
      } else {
        const built = await loadGltfMap(this.scene, this.mapDef)
        this.colliders = built.colliders
        this.mapHitMeshes = built.hitMeshes
        // Walk / bullets use real triangle geometry
        this.meshWorld =
          built.hitMeshes.length > 0 ? { meshes: built.hitMeshes } : null
        this.levelEditor.setHitMeshes(built.hitMeshes)
        // Team pads (authored/editor) preferred over auto-placed catalog spawn
        this.applyPlaySpawn({
          spawn: built.spawn,
          spawnYaw: built.spawnYaw,
        })
        this.dummies = createDummies({
          defs: built.dummies,
          bounds: built.dummyBounds,
        })
        if (built.bounds) {
          const span = Math.hypot(built.bounds.size.x, built.bounds.size.z)
          this.camera.far = Math.max(this.mapDef.cameraFar, span * 1.2 + 40)
          this.camera.updateProjectionMatrix()
        }
        // Session skybox over solid map bgColor (shared via match / URL)
        const textures = await loadEnvForMap(
          this.mapDef,
          this.scene,
          this.renderer,
          null,
          null,
          this.skyboxId,
        )
        this.envTextures.push(...textures)
        console.info(
          `[map] ${this.mapDef.id} fitted`,
          built.bounds,
          'spawn',
          built.spawn,
          'collisionMeshes',
          built.hitMeshes.length,
        )
      }
      this.mapReady = true
      this.levelEditor.sync(this.spawnLayout.spawns)
      this.levelEditor.syncBarriers(this.barrierLayout.barriers)
      void this.dummiesSys.load(
        this.scene,
        this.dummies,
        this.playerVisuals,
        this.thirdPerson,
      )
    } catch (e) {
      console.error('Map load failed', e)
      this.mapLoadError =
        e instanceof Error ? e.message : 'Failed to load map'
      // Floor plane still works at y=0 with no cover colliders
      this.colliders = []
      this.mapReady = true
    }
  }

  getMapId(): MapId {
    return this.mapDef.id
  }

  getMapName(): string {
    return this.mapDef.name
  }

  isMapReady() {
    return this.mapReady
  }

  getMapLoadError() {
    return this.mapLoadError
  }

  onHud(fn: HudListener) {
    this.hudListeners.add(fn)
    return () => this.hudListeners.delete(fn)
  }

  isViewmodelReady() {
    return this.viewmodel.ready
  }

  getViewmodelConfig(): ViewmodelConfig {
    return this.viewmodel.getConfig()
  }

  setViewmodelConfig(partial: unknown, replace = false) {
    this.viewmodel.setConfig(partial, replace)
  }

  resetViewmodelConfig() {
    this.viewmodel.resetConfig()
  }

  setViewmodelEditorActive(active: boolean) {
    this.viewmodel.setEditorActive(active)
    this.input.setGameplayEnabled(!active)
  }

  /** Pause gameplay input (settings modal, etc.) and release pointer lock. */
  setGameplayEnabled(enabled: boolean) {
    this.input.setGameplayEnabled(enabled)
  }

  isGameplayEnabled() {
    return this.input.isGameplayEnabled()
  }

  setViewmodelArmSolo(solo: 'both' | 'left' | 'right') {
    this.viewmodel.setArmSolo(solo)
  }

  getViewmodelArmSolo() {
    return this.viewmodel.armSolo
  }

  hasArmBones() {
    return this.viewmodel.hasArmBones()
  }

  hasHandBones() {
    return this.viewmodel.hasHandBones()
  }

  isViewmodelEditorActive() {
    return this.viewmodel.editorActive
  }

  setViewmodelForceAds(value: number | null) {
    this.viewmodel.forceAds = value
  }

  getViewmodelForceAds() {
    return this.viewmodel.forceAds
  }

  setViewmodelForceRun(value: number | null) {
    this.viewmodel.forceRun = value
  }

  getViewmodelForceRun() {
    return this.viewmodel.forceRun
  }

  setViewmodelFreezeBob(freeze: boolean) {
    this.viewmodel.freezeBob = freeze
  }

  getViewmodelFreezeBob() {
    return this.viewmodel.freezeBob
  }

  setViewmodelKeepVisible(keep: boolean) {
    this.viewmodel.keepVisible = keep
  }

  getViewmodelKeepVisible() {
    return this.viewmodel.keepVisible
  }

  setThirdPerson(enabled: boolean) {
    this.thirdPerson = enabled
    if (this.playerVisuals.body) {
      this.playerVisuals.body.visible = enabled
    }
    if (this.viewmodel.root && !enabled) {
      this.viewmodel.root.visible = true
    }
  }

  isThirdPerson() {
    return this.thirdPerson
  }

  setDummiesPaused(paused: boolean) {
    this.dummiesPaused = paused
  }

  isDummiesPaused() {
    return this.dummiesPaused
  }

  // --- Level editor (noclip + team spawns + barrier walls) ---

  setLevelEditorActive(active: boolean) {
    this.levelEditorActive = active
    this.levelEditor.setActive(active)
    if (active) {
      // Hide gun / combat clutter; keep first-person free-look
      this.thirdPerson = false
      if (this.playerVisuals.body) this.playerVisuals.body.visible = false
      if (this.viewmodel.root) this.viewmodel.root.visible = false
      this.player.velocity.x = 0
      this.player.velocity.y = 0
      this.player.velocity.z = 0
    } else if (this.viewmodel.root) {
      this.viewmodel.root.visible = true
    }
    this.levelEditor.sync(this.spawnLayout.spawns)
    this.levelEditor.syncBarriers(this.barrierLayout.barriers)
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
    }
  }

  setBarrierDefaults(opts: {
    length?: number
    height?: number
    thickness?: number
  }) {
    if (opts.length != null && opts.length > 0.1) this.barrierLength = opts.length
    if (opts.height != null && opts.height > 0.1) this.barrierHeight = opts.height
    if (opts.thickness != null && opts.thickness > 0.05) {
      this.barrierThickness = opts.thickness
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
    const yaw = this.player.yaw
    const size = wallSizeFromYaw(
      yaw,
      this.barrierLength,
      this.barrierHeight,
      this.barrierThickness,
    )
    const look = facingXZ(yaw)
    // Sit just ahead of the thin face so the player is not inside on place
    const thin = Math.min(size.width, size.depth)
    const offset = thin * 0.5 + this.player.radius + 0.35
    let x = this.player.position.x + look.x * offset
    let z = this.player.position.z + look.z * offset
    let floorY = this.player.position.y
    if (this.editorSnapFloor) {
      const floor = this.levelEditor.sampleFloorY(
        x,
        z,
        Math.max(this.player.position.y + 4, 20),
      )
      if (floor !== null) floorY = floor
    }
    const wall: BarrierWall = {
      id: makeBarrierId(this.barrierLayout.barriers),
      x,
      y: floorY + size.height * 0.5,
      z,
      width: size.width,
      height: size.height,
      depth: size.depth,
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
    const last = this.barrierLayout.barriers[this.barrierLayout.barriers.length - 1]
    if (!last) return false
    return this.removeBarrier(last.id)
  }

  clearAllBarriers() {
    clearBarrierLayout(this.mapDef.id)
    this.barrierLayout = emptyBarrierLayout(this.mapDef.id)
    this.lastPlacedBarrierId = null
    this.rebuildBarrierColliders()
    this.levelEditor.syncBarriers(this.barrierLayout.barriers)
    this.levelEditor.highlightBarrier(null)
    const snap = this.getBarrierLayout()
    for (const fn of this.barrierLayoutListeners) fn(snap)
  }

  setBarrierLayout(layout: MapBarrierLayout) {
    this.barrierLayout = {
      version: 1,
      mapId: this.mapDef.id,
      barriers: layout.barriers.map((b) => ({ ...b })),
    }
    this.lastPlacedBarrierId = null
    this.persistAndSyncBarriers()
  }

  goToBarrier(id: string): boolean {
    const b = this.barrierLayout.barriers.find((w) => w.id === id)
    if (!b) return false
    // Stand just outside the thin face
    const halfThin = Math.min(b.width, b.depth) * 0.5 + this.player.radius + 0.4
    const alongX = b.width < b.depth
    this.applySpawn(
      {
        x: alongX ? b.x + halfThin : b.x,
        y: b.y - b.height * 0.5,
        z: alongX ? b.z : b.z + halfThin,
      },
      this.player.yaw,
    )
    this.lastPlacedBarrierId = b.id
    this.levelEditor.highlightBarrier(b.id)
    return true
  }

  private rebuildBarrierColliders() {
    this.barrierColliders = barriersToAabbs(this.barrierLayout.barriers)
  }

  private persistAndSyncBarriers() {
    this.barrierLayout.mapId = this.mapDef.id
    saveBarrierLayout(this.barrierLayout)
    this.rebuildBarrierColliders()
    this.levelEditor.syncBarriers(this.barrierLayout.barriers)
    this.levelEditor.highlightBarrier(this.lastPlacedBarrierId)
    const snap = this.getBarrierLayout()
    for (const fn of this.barrierLayoutListeners) fn(snap)
  }

  isLevelEditorActive() {
    return this.levelEditorActive
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
    return {
      x: this.player.position.x,
      y: this.player.position.y,
      z: this.player.position.z,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
    }
  }

  /**
   * Place a spawn at the camera feet (optional floor snap).
   * Returns the new point, or null if nothing was added.
   */
  placeSpawnAtPlayer(team: TeamId = this.editorTeam): SpawnPoint | null {
    let y = this.player.position.y
    const x = this.player.position.x
    const z = this.player.position.z
    if (this.editorSnapFloor) {
      const floor = this.levelEditor.sampleFloorY(
        x,
        z,
        Math.max(y + 4, 20),
      )
      if (floor !== null) y = floor
    }
    const spawn: SpawnPoint = {
      id: makeSpawnId(team, this.spawnLayout.spawns),
      team,
      x,
      y,
      z,
      yaw: this.player.yaw,
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
    clearSpawnLayout(this.mapDef.id)
    this.spawnLayout = authoredLayout(this.mapDef.id)
    this.lastPlacedSpawnId = null
    this.levelEditor.sync(this.spawnLayout.spawns)
    this.levelEditor.highlight(null)
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
      mapId: this.mapDef.id,
      spawns: layout.spawns.map((s) => ({ ...s })),
    }
    this.lastPlacedSpawnId = null
    this.persistAndSyncSpawns()
  }

  /** Teleport editor camera to a spawn (feet). */
  goToSpawn(id: string): boolean {
    const s = this.spawnLayout.spawns.find((p) => p.id === id)
    if (!s) return false
    this.applySpawn({ x: s.x, y: s.y, z: s.z }, s.yaw)
    this.lastPlacedSpawnId = s.id
    this.levelEditor.highlight(s.id)
    return true
  }

  private persistAndSyncSpawns() {
    this.spawnLayout.mapId = this.mapDef.id
    saveSpawnLayout(this.spawnLayout)
    this.levelEditor.sync(this.spawnLayout.spawns)
    this.levelEditor.highlight(this.lastPlacedSpawnId)
    const snap = this.getSpawnLayout()
    for (const fn of this.spawnLayoutListeners) fn(snap)
  }

  start() {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    this.clock.start()
    this.loop()
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.raf)
  }

  dispose() {
    this.stop()
    this.input.detach()
    window.removeEventListener('resize', this.onResize)
    this.levelEditor.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    for (const t of this.envTextures) t.dispose()
    this.envTextures = []
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        const m = obj.material
        if (Array.isArray(m)) m.forEach((x) => x.dispose())
        else m.dispose()
      }
    })
  }

  private onResize = () => {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  private loop = () => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    let dt = (now - this.lastTime) / 1000
    this.lastTime = now
    dt = Math.min(dt, 0.05)

    this.tick(dt)
    this.renderer.render(this.scene, this.camera)
  }

  private tick(dt: number) {
    const input = this.input.sample()
    this.input.setAdsBlend(this.sniper.adsBlend)

    if (this.levelEditorActive) {
      this.tickLevelEditor(dt, input)
      return
    }

    this.viewFeel.samplePreStep(this.player)
    const prevMoveState = this.player.state
    stepPlayer(
      this.player,
      input,
      dt,
      this.colliders,
      this.meshWorld,
      this.barrierColliders,
    )
    stepSniper(this.sniper, input, dt)
    if (!this.dummiesPaused) {
      stepDummies(this.dummies, dt)
      stepRespawns(this.dummies, this.respawns, dt)
    }

    this.dummiesSys.update(dt, this.dummies, this.dummiesPaused)

    if (this.playerVisuals.isMan) {
      this.playerVisuals.syncLocomotion(this.player, input)
      this.playerVisuals.update(dt)
    }
    this.viewmodel.syncAnim(this.sniper.phase)
    this.viewmodel.updateMixer(dt)

    const prevGrounded = this.viewFeel.wasGrounded
    const fireResult = tryFire(this.sniper, input)
    if (fireResult === 'shot') {
      gameAudio.playFire()
      const result = fireShot({
        player: this.player,
        sniper: this.sniper,
        colliders: this.colliders,
        barrierColliders: this.barrierColliders,
        dummies: this.dummies,
        respawns: this.respawns,
        dummiesSys: this.dummiesSys,
        fx: this.combatFx,
        castWorldMesh: (origin, dir, maxRange) =>
          castMapHitscan(this.mapHitMeshes, origin, dir, maxRange),
      })
      if (result.lastHit) {
        this.lastHit = result.lastHit
        this.lastHitAge = 0
        this.lastHitId += 1
      }
      this.kills += result.killsDelta
      applyRecoil(this.sniper)
      this.viewFeel.punchShot(this.sniper.adsBlend)
    } else if (fireResult === 'dry') {
      gameAudio.playDryFire()
    }
    this.prevSniperPhase = playSniperPhaseSfx(
      this.sniper.phase,
      this.prevSniperPhase,
    )

    const { grounded, speed } = this.viewFeel.stepLandingAndSfx(
      dt,
      this.player,
      this.sniper,
      prevGrounded,
      prevMoveState,
    )

    this.viewFeel.applyCameraAndViewmodel({
      dt,
      player: this.player,
      sniper: this.sniper,
      camera: this.camera,
      thirdPerson: this.thirdPerson,
      viewmodel: this.viewmodel,
      grounded,
      speed,
    })

    this.playerVisuals.updatePose(this.player, this.thirdPerson)
    this.combatFx.update(dt)

    this.lastHitAge += dt
    this.emitHud()
  }

  /** Walk / fly with map collision + place spawns / barriers; no combat. */
  private tickLevelEditor(
    dt: number,
    input: import('../core/types').PlayerInput,
  ) {
    stepEditorMove(
      this.player,
      input,
      dt,
      this.colliders,
      this.meshWorld,
      this.barrierColliders,
    )

    // LMB / fire = place active tool
    if (input.fire) {
      if (this.editorTool === 'barrier') {
        if (this.placeBarrierAtPlayer()) gameAudio.uiClick()
      } else {
        this.placeSpawnAtPlayer(this.editorTeam)
        gameAudio.uiClick()
      }
    }
    // Reload = undo last of active tool
    if (input.reload) {
      if (this.editorTool === 'barrier') {
        if (this.undoLastBarrier()) gameAudio.uiClick()
      } else if (this.undoLastSpawn()) {
        gameAudio.uiClick()
      }
    }

    // Simple free-look camera (no bob / ADS / viewmodel)
    this.camera.position.set(
      this.player.position.x,
      this.player.position.y + this.player.eyeHeight,
      this.player.position.z,
    )
    this.camera.rotation.order = 'YXZ'
    this.camera.rotation.y = this.player.yaw
    this.camera.rotation.x = this.player.pitch
    this.camera.fov = LOOK.hipFov
    this.camera.updateProjectionMatrix()

    if (this.viewmodel.root) this.viewmodel.root.visible = false
    this.dummiesSys.update(dt, this.dummies, true)
    this.combatFx.update(dt)
    this.lastHitAge += dt
    this.emitHud()
  }

  private emitHud() {
    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z)
    const snap: HudSnapshot = {
      hp: this.playerHp,
      ammo: this.sniper.ammo,
      magSize: this.sniper.magSize,
      reserve: this.sniper.reserve,
      phase: this.sniper.phase,
      ads: this.sniper.ads,
      adsBlend: this.sniper.adsBlend,
      reloadJiggleX: this.sniper.reloadJiggleX,
      reloadJiggleY: this.sniper.reloadJiggleY,
      aimSpread: aimSpread(this.sniper, this.player),
      moveState: this.player.state,
      speed,
      pointerLocked: this.input.isPointerLocked(),
      kills: this.kills,
      lastHit: this.lastHit,
      lastHitAge: this.lastHitAge,
      lastHitId: this.lastHitId,
    }
    for (const fn of this.hudListeners) fn(snap)
  }
}
