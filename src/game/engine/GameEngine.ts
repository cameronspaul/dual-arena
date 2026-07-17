/**
 * Thin orchestrator: owns sim state + subsystems, runs the frame loop.
 */
import * as THREE from 'three'
import { gameAudio } from '../core/audio'
import { DEBUG, DEATH, LOOK, PLAYER } from '../core/config'
import { InputManager } from '../core/input'
import type {
  DeathReason,
  HitEvent,
  HudSnapshot,
  SniperState,
} from '../core/types'
import { stepEditorMove } from '../editor/noclip'
import { LevelEditorSystem } from '../editor/LevelEditorSystem'
import {
  analyzeMapStaticPerf,
  buildMeshWorld,
  buildProceduralRange,
  castMapHitscan,
  countNearbyCollisionMeshes,
  getMap,
  loadEnvForMap,
  loadGltfMap,
  logMapStaticPerf,
  authoredBarrierLayout,
  authoredLayout,
  BARRIER_DEFAULTS,
  barriersToAabbs,
  clearBarrierLayout,
  clearSpawnLayout,
  perfEma,
  inferBottleneck,
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
  type MapStaticPerf,
  type SpawnPoint,
  type TeamId,
} from '../maps'
import { facingXZ } from '../core/math'
import type { SkyboxId } from '../scene/skyboxes'
import { computeFallKillY, isBelowFallKill } from '../sim/death'
import { createPlayer, eyePosition, stepPlayer } from '../sim/player'
import {
  aimSpread,
  applyRecoil,
  createSniper,
  resetSniper,
  stepSniper,
  tryFire,
} from '../sim/sniper'
import {
  createFreeCam,
  stepFreeCam,
  type FreeCamState,
} from '../sim/spectate'
import {
  createDummies,
  stepDummies,
  stepRespawns,
  type RespawnTimer,
} from '../sim/world'
import { BarrierVisuals } from '../systems/BarrierVisuals'
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
  /** EMA of frame time (seconds) for a stable FPS readout. */
  private frameTimeEma = 1 / 60
  private fps = 60
  /** Live timing EMAs (ms) for perf HUD. */
  private simMsEma = 0
  private renderMsEma = 0
  private frameMsEma = 16.7
  private nearbyCollision = 0
  private mapStaticPerf: MapStaticPerf | null = null
  /**
   * Last measured RTT to the game server (ms). Stays null until multiplayer
   * session wiring lands — local range has no network hop.
   */
  private pingMs: number | null = null
  private container: HTMLElement

  private viewmodel = new ViewmodelSystem()
  private dummiesSys = new DummySystem()
  private playerVisuals = new PlayerVisuals()
  private combatFx = new CombatFx()
  private barrierVisuals = new BarrierVisuals()
  private viewFeel = new ViewFeel()

  private hudListeners = new Set<HudListener>()
  private lastHit: HitEvent | null = null
  private lastHitAge = 999
  private lastHitId = 0
  private kills = 0
  private playerHp: number = PLAYER.maxHp
  private playerAlive = true
  private deathReason: DeathReason | null = null
  /** Countdown while free-cam spectating after death. */
  private spectateTimer = 0
  private freeCam: FreeCamState | null = null
  /**
   * Feet Y kill plane (spawn min Y − depth). Null when fall death is off
   * for this map or still loading.
   */
  private fallKillY: number | null = null
  /** Last applied play spawn — used when restarting the round after death. */
  private playSpawn = {
    spawn: { x: 0, y: 0, z: 8 },
    spawnYaw: 0,
  }
  private clock = new THREE.Clock()
  private floorMat: THREE.MeshStandardMaterial | null = null
  private coverMat: THREE.MeshStandardMaterial | null = null
  private envTextures: THREE.Texture[] = []
  private thirdPerson = false
  /** When false: no dummy AI, anim, hitscan, or drawing. */
  private dummiesEnabled = true
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
  private barrierInfiniteHeight: boolean = BARRIER_DEFAULTS.infiniteHeight
  private barrierInfiniteWidth: boolean = BARRIER_DEFAULTS.infiniteWidth
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
    // Cap DPR — 2× on 1440p/4k blows the 180 Hz budget on fill rate alone
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.setSize(w, h)
    this.renderer.shadowMap.enabled = true
    // Soft PCF is ~2× the shadow-pass cost; basic PCF is fine for arena lighting
    this.renderer.shadowMap.type = THREE.PCFShadowMap
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
    this.scene.add(this.barrierVisuals.root)
    this.levelEditor.sync(this.spawnLayout.spawns)
    this.levelEditor.syncBarriers(this.barrierLayout.barriers)
    this.barrierVisuals.sync(this.barrierLayout.barriers)
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
    this.player.state = 'idle'
    this.player.slideTimer = 0
    this.player.slideCd = 0
    this.player.slideSpeed = 0
    this.input.setLook(spawnYaw, 0)
  }

  /** Team pads from editor/authored layout, else map catalog fallback. */
  private applyPlaySpawn(fallback: {
    spawn: { x: number; y: number; z: number }
    spawnYaw: number
  }) {
    const pad = pickPlaySpawn(this.spawnLayout)
    if (pad) {
      this.playSpawn = {
        spawn: { x: pad.x, y: pad.y, z: pad.z },
        spawnYaw: pad.yaw,
      }
      this.applySpawn(this.playSpawn.spawn, this.playSpawn.spawnYaw)
      this.rebuildFallKillY()
      return
    }
    this.playSpawn = {
      spawn: { ...fallback.spawn },
      spawnYaw: fallback.spawnYaw,
    }
    this.applySpawn(fallback.spawn, fallback.spawnYaw)
    this.rebuildFallKillY()
  }

  /** Recompute fall kill plane from current team pads + catalog fallback. */
  private rebuildFallKillY() {
    this.fallKillY = computeFallKillY({
      enabled: this.mapDef.fallDeath,
      depth: this.mapDef.fallKillDepth,
      spawnYs: this.spawnLayout.spawns.map((s) => s.y),
      fallbackSpawnY: this.playSpawn.spawn.y,
    })
  }

  /**
   * Local player death → free-cam spectate for DEATH.spectateDuration,
   * then restartRound(). Safe to call only once while already dead.
   */
  private killPlayer(reason: DeathReason) {
    if (!this.playerAlive || this.levelEditorActive) return
    this.playerAlive = false
    this.playerHp = 0
    this.deathReason = reason
    this.spectateTimer = DEATH.spectateDuration

    // Freeze body at death pose; free-cam detaches from the corpse.
    this.player.velocity.x = 0
    this.player.velocity.y = 0
    this.player.velocity.z = 0
    this.sniper.ads = false
    this.sniper.adsBlend = 0

    const eye = eyePosition(this.player)
    this.freeCam = createFreeCam(eye, this.player.yaw, this.player.pitch)

    // Show third-person body so freecam can orbit the death spot / tracers.
    if (this.playerVisuals.body) {
      this.playerVisuals.body.visible = true
    }
    if (this.viewmodel.root) this.viewmodel.root.visible = false

    gameAudio.unlock()
    // Soft confirm — dedicated death sting can replace later.
    gameAudio.play('hitBody', { volume: 0.55 })
  }

  /** Respawn at play pad, full HP / mag, exit free-cam. Keeps match kills. */
  private restartRound() {
    this.playerAlive = true
    this.playerHp = PLAYER.maxHp
    this.deathReason = null
    this.spectateTimer = 0
    this.freeCam = null
    resetSniper(this.sniper)
    this.prevSniperPhase = 'ready'
    this.applyPlaySpawn(this.playSpawn)

    if (this.playerVisuals.body) {
      this.playerVisuals.body.visible = this.thirdPerson
    }
    if (this.viewmodel.root && !this.thirdPerson) {
      this.viewmodel.root.visible = true
    }
  }

  /** Public entry for future combat damage (hitscan vs local player). */
  damagePlayer(amount: number, reason: DeathReason = 'combat') {
    if (!this.playerAlive || this.levelEditorActive) return
    this.playerHp = Math.max(0, this.playerHp - amount)
    if (this.playerHp <= 0) this.killPlayer(reason)
  }

  isPlayerAlive() {
    return this.playerAlive
  }

  isSpectating() {
    return !this.playerAlive && this.freeCam !== null
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
        // procedural range: no triangle walk world
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
        this.captureMapPerf(null, built.bounds, [])
      } else {
        const built = await loadGltfMap(this.scene, this.mapDef)
        this.colliders = built.colliders
        this.mapHitMeshes = built.hitMeshes
        // Walk uses filtered set (or COL_ hull); bullets keep full hitMeshes.
        // Do NOT pass extractColliders as wall AABBs — they fill whole buildings
        // and shove the player out of the map / off spawn pads.
        const walk =
          built.walkMeshes.length > 0 ? built.walkMeshes : built.hitMeshes
        this.meshWorld = walk.length > 0 ? buildMeshWorld(walk) : null
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
          'walkMeshes',
          walk.length,
        )
        this.captureMapPerf(built.root, built.bounds, walk)
      }
      this.mapReady = true
      this.levelEditor.sync(this.spawnLayout.spawns)
      this.levelEditor.syncBarriers(this.barrierLayout.barriers)
      void this.dummiesSys
        .load(this.scene, this.dummies, this.playerVisuals, this.thirdPerson)
        .then(() => {
          // Re-apply in case user toggled off while GLB was loading
          this.dummiesSys.setEnabled(this.dummiesEnabled)
        })
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

  /**
   * Toggle practice dummies fully on/off.
   * Off skips AI, respawns, animation mixers, mesh updates, and hitscan.
   */
  setDummiesEnabled(enabled: boolean) {
    this.dummiesEnabled = enabled
    this.dummiesSys.setEnabled(enabled)
  }

  isDummiesEnabled() {
    return this.dummiesEnabled
  }

  /** @deprecated Use setDummiesEnabled — pause is now a full off. */
  setDummiesPaused(paused: boolean) {
    this.setDummiesEnabled(!paused)
  }

  /** @deprecated Use isDummiesEnabled */
  isDummiesPaused() {
    return !this.dummiesEnabled
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
    const last = this.barrierLayout.barriers[this.barrierLayout.barriers.length - 1]
    if (!last) return false
    return this.removeBarrier(last.id)
  }

  clearAllBarriers() {
    // Drop browser override so baked authored walls return
    clearBarrierLayout(this.mapDef.id)
    this.barrierLayout = authoredBarrierLayout(this.mapDef.id)
    this.lastPlacedBarrierId = null
    this.rebuildBarrierColliders()
    this.levelEditor.syncBarriers(this.barrierLayout.barriers)
    this.levelEditor.highlightBarrier(null)
    this.barrierVisuals.sync(this.barrierLayout.barriers)
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
      mapId: this.mapDef.id,
      barriers: layout.barriers.map((b) => ({ ...b })),
    }
    this.lastPlacedBarrierId = null
    this.persistAndSyncBarriers()
  }

  goToBarrier(id: string): boolean {
    const b = this.barrierLayout.barriers.find((w) => w.id === id)
    if (!b) return false
    // Stand just outside the thin face (finite thickness, not infinite axes)
    const halfThin = Math.min(b.width, b.depth) * 0.5 + this.player.radius + 0.4
    const alongX = b.width < b.depth
    const feetY = b.infiniteHeight
      ? Math.max(0, b.y - b.height * 0.5)
      : b.y - b.height * 0.5
    this.applySpawn(
      {
        x: alongX ? b.x + halfThin : b.x,
        y: feetY,
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
    this.barrierVisuals.sync(this.barrierLayout.barriers)
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
    this.rebuildFallKillY()
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
    this.barrierVisuals.dispose()
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

    // Sample raw frame time for FPS before the sim clamp (which caps spikes).
    if (dt > 0 && dt < 1) {
      this.frameTimeEma = this.frameTimeEma * 0.9 + dt * 0.1
      this.fps = Math.round(1 / this.frameTimeEma)
      this.frameMsEma = perfEma(this.frameMsEma, dt * 1000, 0.12)
    }

    dt = Math.min(dt, 0.05)

    const t0 = performance.now()
    this.tick(dt)
    const t1 = performance.now()
    this.renderer.render(this.scene, this.camera)
    const t2 = performance.now()

    if (DEBUG.showPerf) {
      this.simMsEma = perfEma(this.simMsEma, t1 - t0)
      this.renderMsEma = perfEma(this.renderMsEma, t2 - t1)
      // Same radius as walk probes (meshCollision probeR default floor)
      this.nearbyCollision = countNearbyCollisionMeshes(
        this.meshWorld,
        this.player.position,
        8,
      )
    }
  }

  /** Snapshot map geometry cost after load (console + HUD). */
  private captureMapPerf(
    root: THREE.Object3D | null,
    bounds: import('../maps').MapBounds | null,
    walkMeshes: THREE.Object3D[],
  ) {
    if (!DEBUG.showPerf) return
    // Report walk-collider count (what movement actually raycasts)
    const colliders =
      walkMeshes.length > 0 ? walkMeshes : this.mapHitMeshes
    const perf = analyzeMapStaticPerf({
      mapId: this.mapDef.id,
      root,
      scene: this.scene,
      collisionMeshes: colliders,
      aabbColliders: this.colliders.length,
      bounds,
    })
    this.mapStaticPerf = perf
    logMapStaticPerf(perf)
  }

  private tick(dt: number) {
    const input = this.input.sample()
    this.input.setAdsBlend(this.sniper.adsBlend)

    if (this.levelEditorActive) {
      this.tickLevelEditor(dt, input)
      return
    }

    // Dead: free-cam spectate, world still runs, no combat / player move.
    if (!this.playerAlive) {
      this.tickSpectate(dt, input)
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

    // Fall out of world (maps with fallDeath) → death → free-cam.
    if (isBelowFallKill(this.player.position.y, this.fallKillY)) {
      this.killPlayer('fall')
      this.tickSpectate(dt, input)
      return
    }

    stepSniper(this.sniper, input, dt)
    if (this.dummiesEnabled) {
      stepDummies(this.dummies, dt)
      stepRespawns(this.dummies, this.respawns, dt)
      this.dummiesSys.update(dt, this.dummies, false)
    }

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
        dummies: this.dummiesEnabled ? this.dummies : [],
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
    this.barrierVisuals.update(this.player.position)

    this.lastHitAge += dt
    this.emitHud()
  }

  /**
   * Free-cam death spectate: fly + look, world/dummies/FX keep updating,
   * then restart the round after the countdown.
   */
  private tickSpectate(
    dt: number,
    input: import('../core/types').PlayerInput,
  ) {
    if (!this.freeCam) {
      const eye = eyePosition(this.player)
      this.freeCam = createFreeCam(eye, this.player.yaw, this.player.pitch)
    }

    stepFreeCam(this.freeCam, input, dt)

    // Keep mouse look on free-cam (input already drives cam via sample)
    this.camera.position.set(
      this.freeCam.position.x,
      this.freeCam.position.y,
      this.freeCam.position.z,
    )
    this.camera.rotation.order = 'YXZ'
    this.camera.rotation.y = this.freeCam.yaw
    this.camera.rotation.x = this.freeCam.pitch
    this.camera.fov = LOOK.hipFov
    this.camera.updateProjectionMatrix()

    if (this.viewmodel.root) this.viewmodel.root.visible = false

    // Corpse stays at death feet — pose without live locomotion.
    this.playerVisuals.updatePose(this.player, true)
    if (this.playerVisuals.body) this.playerVisuals.body.visible = true

    if (this.dummiesEnabled) {
      stepDummies(this.dummies, dt)
      stepRespawns(this.dummies, this.respawns, dt)
      this.dummiesSys.update(dt, this.dummies, false)
    }
    this.combatFx.update(dt)
    if (this.freeCam) {
      this.barrierVisuals.update(this.freeCam.position)
    }

    this.spectateTimer = Math.max(0, this.spectateTimer - dt)
    this.lastHitAge += dt
    this.emitHud()

    if (this.spectateTimer <= 0) {
      this.restartRound()
    }
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
    if (this.dummiesEnabled) {
      this.dummiesSys.update(dt, this.dummies, true)
    }
    this.combatFx.update(dt)
    // Always show signs in the editor so placement is obvious
    this.barrierVisuals.update(this.player.position, true)
    this.lastHitAge += dt
    this.emitHud()
  }

  private emitHud() {
    const speed = this.playerAlive
      ? Math.hypot(this.player.velocity.x, this.player.velocity.z)
      : 0
    const snap: HudSnapshot = {
      hp: this.playerHp,
      ammo: this.sniper.ammo,
      magSize: this.sniper.magSize,
      reserve: this.sniper.reserve,
      phase: this.sniper.phase,
      ads: this.playerAlive ? this.sniper.ads : false,
      adsBlend: this.playerAlive ? this.sniper.adsBlend : 0,
      reloadJiggleX: this.sniper.reloadJiggleX,
      reloadJiggleY: this.sniper.reloadJiggleY,
      aimSpread: this.playerAlive ? aimSpread(this.sniper, this.player) : 0,
      moveState: this.playerAlive ? this.player.state : 'idle',
      speed,
      pointerLocked: this.input.isPointerLocked(),
      kills: this.kills,
      lastHit: this.lastHit,
      lastHitAge: this.lastHitAge,
      lastHitId: this.lastHitId,
      alive: this.playerAlive,
      spectating: !this.playerAlive,
      respawnIn: this.playerAlive ? 0 : this.spectateTimer,
      deathReason: this.deathReason,
      fps: this.fps,
      ping: this.pingMs,
      perf: this.buildPerfHud(),
    }
    for (const fn of this.hudListeners) fn(snap)
  }

  private buildPerfHud(): import('../core/types').PerfHud | null {
    if (!DEBUG.showPerf) return null
    const info = this.renderer.info
    const staticP = this.mapStaticPerf
    const draws = info.render.calls
    const triangles = info.render.triangles
    const bottleneck = inferBottleneck({
      frameMs: this.frameMsEma,
      simMs: this.simMsEma,
      renderMs: this.renderMsEma,
      draws,
      triangles,
      nearbyCollision: this.nearbyCollision,
      collisionMeshes: staticP?.collisionMeshes ?? this.mapHitMeshes.length,
      dedicatedCollision: staticP?.dedicatedCollision ?? false,
      pixelRatio: this.renderer.getPixelRatio(),
      staticTriangles: staticP?.triangles ?? 0,
      shadowCasters: staticP?.shadowCasters ?? 0,
    })
    return {
      frameMs: this.frameMsEma,
      simMs: this.simMsEma,
      renderMs: this.renderMsEma,
      draws,
      triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      collisionMeshes: staticP?.collisionMeshes ?? this.mapHitMeshes.length,
      nearbyCollision: this.nearbyCollision,
      pixelRatio: this.renderer.getPixelRatio(),
      bottleneck,
      map: staticP
        ? {
            id: staticP.mapId,
            meshes: staticP.meshes,
            triangles: staticP.triangles,
            materials: staticP.materials,
            shadowCasters: staticP.shadowCasters,
            dedicatedCollision: staticP.dedicatedCollision,
            notes: staticP.notes,
          }
        : null,
    }
  }
}
