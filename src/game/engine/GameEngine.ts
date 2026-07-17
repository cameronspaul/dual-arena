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
import {
  NetClient,
  Prediction,
  RemotePlayerSystem,
} from '../net'
import {
  effectiveLook,
  eyePosition as eyePosShared,
  MATCH,
  SNIPER,
  spreadLookDirection,
  aimSpread as aimSpreadShared,
  pickTeamSpawn,
  TICK_RATE,
  type MatchEndMessage,
  type MatchPhase,
  type NetHitEvent,
  type NetShotEvent,
  type SnapshotMessage,
  type WelcomeMessage,
} from '@duel/shared'

export type HudListener = (hud: HudSnapshot) => void

export type OnlineSessionOpts = {
  /** WebSocket URL, e.g. ws://localhost:2567 */
  serverUrl: string
  matchId: string
  /** Auth / identity token (opaque for now). */
  token?: string
}

export type GameEngineOptions = {
  mapId?: MapId | string
  /**
   * Concrete skybox for this session (already resolved — not `"random"`).
   * Shared via URL / match config so all players see the same sky.
   */
  skybox?: SkyboxId
  /**
   * Offline practice range (default) vs ranked/wagered duel through the server.
   * Online: no local kill authority; dummies off; inputs → server.
   */
  mode?: 'offline' | 'online'
  online?: OnlineSessionOpts
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
   * Last measured RTT to the game server (ms).
   * Null while offline / not yet ponged.
   */
  private pingMs: number | null = null
  private container: HTMLElement

  private viewmodel = new ViewmodelSystem()
  private dummiesSys = new DummySystem()
  private playerVisuals = new PlayerVisuals()
  private combatFx = new CombatFx()
  private barrierVisuals = new BarrierVisuals()
  private viewFeel = new ViewFeel()

  /** Online 1v1 — null when offline practice. */
  private readonly isOnline: boolean
  private net: NetClient | null = null
  private prediction = new Prediction()
  private remotes = new RemotePlayerSystem()
  private localPlayerId: string | null = null
  private onlineStatus = 'idle'
  private matchEnd: MatchEndMessage | null = null
  private pendingSnapshots: SnapshotMessage[] = []
  private serverTickRate = TICK_RATE
  private matchTimeLeft: number | null = null
  private matchWaiting = false
  private matchPhase: MatchPhase | null = null
  private matchPhaseTimer = 0
  private matchFirstTo: number = MATCH.firstTo
  private localReady = false
  private enemyReady = false
  private enemyKills = 0
  private teamColor: 'blue' | 'red' | null = null
  private serverRespawnIn = 0
  /** Last phase we saw — used to clear tracers on round transitions. */
  private lastMatchPhase: MatchPhase | null = null
  /**
   * True after welcome applied the authoritative team pad.
   * Prevents map bootstrap from overwriting it with solo pickPlaySpawn.
   */
  private onlineTeamSpawnReady = false

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
  /**
   * Voluntary free-cam (bottom-left toggle). Independent of death:
   * when on while alive, fly without combat; death still forces free-cam.
   */
  private voluntaryFreeCam = false
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
    this.isOnline = opts.mode === 'online' && !!opts.online?.serverUrl
    this.spawnLayout = loadSpawnLayout(this.mapDef.id)
    this.barrierLayout = loadBarrierLayout(this.mapDef.id)
    this.rebuildBarrierColliders()

    if (this.isOnline) {
      // Ranked room: no practice dummies, no local kill inventing
      this.dummiesEnabled = false
    }

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

    if (this.isOnline && opts.online) {
      void this.remotes.ensureLoaded(this.scene)
      this.connectOnline(opts.online)
    }

    window.addEventListener('resize', this.onResize)
  }

  private connectOnline(online: OnlineSessionOpts) {
    const token =
      online.token?.trim() ||
      `p-${Math.random().toString(36).slice(2, 10)}`
    this.net = new NetClient({
      url: online.serverUrl,
      matchId: online.matchId,
      token,
      mapId: this.mapDef.id,
      handlers: {
        onWelcome: (w) => this.onNetWelcome(w),
        onSnapshot: (s) => this.pendingSnapshots.push(s),
        onMatchEnd: (m) => {
          this.matchEnd = m
        },
        onPong: (rtt) => {
          this.pingMs = rtt
        },
        onStatus: (status, detail) => {
          this.onlineStatus = detail ? `${status}: ${detail}` : status
          console.info('[net]', status, detail ?? '')
        },
        onError: (e) => {
          console.warn('[net] error', e.code, e.message)
        },
      },
    })
    this.net.connect()
  }

  private onNetWelcome(w: WelcomeMessage) {
    this.localPlayerId = w.playerId
    this.serverTickRate = w.tickRate || TICK_RATE
    this.matchFirstTo = w.firstTo ?? MATCH.firstTo
    this.teamColor = w.teamColor ?? (w.team === 0 ? 'blue' : 'red')
    // Prefer server-provided pad (map blue/red); fallback to shared table
    const spawn =
      w.spawn ??
      pickTeamSpawn(w.mapId || this.mapDef.id, w.team)
    this.applySpawn(
      { x: spawn.x, y: spawn.y, z: spawn.z },
      spawn.yaw,
    )
    this.playSpawn = {
      spawn: { x: spawn.x, y: spawn.y, z: spawn.z },
      spawnYaw: spawn.yaw,
    }
    this.onlineTeamSpawnReady = true
    this.rebuildFallKillY()
    this.playerHp = PLAYER.maxHp
    this.playerAlive = true
    this.kills = 0
    this.enemyKills = 0
    this.localReady = false
    this.enemyReady = false
    this.prediction.clear()
    console.info(
      '[net] welcome',
      w.playerId,
      this.teamColor,
      'map',
      w.mapId,
      'teamSpawn',
      spawn,
      'firstTo',
      this.matchFirstTo,
    )
  }

  isOnlineMode() {
    return this.isOnline
  }

  getOnlineStatus() {
    return this.onlineStatus
  }

  getMatchEnd() {
    return this.matchEnd
  }

  /** Pregame ready toggle — both players must ready to start the countdown. */
  setReady(ready: boolean) {
    if (!this.isOnline || !this.net) return
    if (this.matchPhase !== 'pregame' && this.matchPhase !== 'waiting') return
    this.localReady = ready
    this.net.sendReady(ready)
    this.emitHud()
  }

  toggleReady() {
    this.setReady(!this.localReady)
  }

  isLocalReady() {
    return this.localReady
  }

  getMatchPhase() {
    return this.matchPhase
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

  /**
   * After GLB/range load: offline uses solo play pad; online keeps the
   * server team pad from welcome (map load must not stomp it).
   */
  private applyMapLoadSpawn(
    catalogSpawn: { x: number; y: number; z: number },
    catalogYaw: number,
  ) {
    if (this.isOnline && this.onlineTeamSpawnReady) {
      this.applySpawn(this.playSpawn.spawn, this.playSpawn.spawnYaw)
      this.rebuildFallKillY()
      return
    }
    if (this.isOnline) {
      // Welcome not yet — park at catalog; welcome will re-place on team pad
      this.playSpawn = {
        spawn: { ...catalogSpawn },
        spawnYaw: catalogYaw,
      }
      this.applySpawn(catalogSpawn, catalogYaw)
      this.rebuildFallKillY()
      return
    }
    this.applyPlaySpawn({ spawn: catalogSpawn, spawnYaw: catalogYaw })
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
    // Death cam is not voluntary — keep the flag so UI can still show Free cam on.
    this.voluntaryFreeCam = true
    this.enterFreeCam()

    gameAudio.unlock()
    gameAudio.playHitConfirm({ zone: 'body', killed: true })
  }

  /** Respawn at play pad, full HP / mag, exit free-cam. Keeps match kills. */
  private restartRound() {
    this.playerAlive = true
    this.playerHp = PLAYER.maxHp
    this.deathReason = null
    this.spectateTimer = 0
    this.voluntaryFreeCam = false
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
    return this.freeCam !== null
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
        this.remotes.setMeshWorld(null)
        this.levelEditor.setHitMeshes(built.hitMeshes)
        // procedural range: no triangle walk world
        this.applyMapLoadSpawn(built.spawn, built.spawnYaw)
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
        this.remotes.setMeshWorld(this.meshWorld)
        this.levelEditor.setHitMeshes(built.hitMeshes)
        // Online: keep welcome team pad. Offline: authored/editor play pad.
        this.applyMapLoadSpawn(built.spawn, built.spawnYaw)
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
    // Free-cam hides the body and viewmodel entirely.
    if (this.freeCam) {
      if (this.playerVisuals.body) this.playerVisuals.body.visible = false
      if (this.viewmodel.root) this.viewmodel.root.visible = false
      return
    }
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
   * Enter / exit free-cam spectate (fly + look, no combat).
   * While alive: toggle explore mode. While dead: turning off respawns early.
   */
  setFreeCam(enabled: boolean) {
    if (this.levelEditorActive) return
    // Ranked: no free-cam / noclip while match is live
    if (this.isOnline && enabled && this.playerAlive) return

    if (enabled) {
      this.voluntaryFreeCam = true
      this.enterFreeCam()
      return
    }

    this.voluntaryFreeCam = false
    if (!this.playerAlive) {
      // Skip remaining death countdown and restart the round.
      this.restartRound()
      return
    }
    this.exitFreeCam()
  }

  /** True while free-cam is active (voluntary or death). */
  isFreeCam() {
    return this.freeCam !== null
  }

  isVoluntaryFreeCam() {
    return this.voluntaryFreeCam
  }

  /** Detach camera into free-fly from the current eye (idempotent). */
  private enterFreeCam() {
    this.player.velocity.x = 0
    this.player.velocity.y = 0
    this.player.velocity.z = 0
    this.sniper.ads = false
    this.sniper.adsBlend = 0

    if (!this.freeCam) {
      const eye = eyePosition(this.player)
      this.freeCam = createFreeCam(eye, this.player.yaw, this.player.pitch)
    }

    // Ghost mode — no body or gun while flying.
    if (this.playerVisuals.body) this.playerVisuals.body.visible = false
    if (this.viewmodel.root) this.viewmodel.root.visible = false
  }

  /** Return to player-controlled camera after voluntary free-cam. */
  private exitFreeCam() {
    if (this.freeCam) {
      this.player.yaw = this.freeCam.yaw
      this.player.pitch = this.freeCam.pitch
      this.freeCam = null
    }
    if (this.playerVisuals.body) {
      this.playerVisuals.body.visible = this.thirdPerson
    }
    if (this.viewmodel.root && !this.thirdPerson) {
      this.viewmodel.root.visible = true
    }
  }

  /**
   * Toggle practice dummies fully on/off.
   * Off skips AI, respawns, animation mixers, mesh updates, and hitscan.
   */
  setDummiesEnabled(enabled: boolean) {
    if (this.isOnline) return // no practice dummies in duel rooms
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
      this.voluntaryFreeCam = false
      this.freeCam = null
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
    this.net?.disconnect()
    this.net = null
    this.remotes.clear()
    this.prediction.clear()
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
      // Editor locked out of ranked rooms
      if (this.isOnline) {
        this.levelEditorActive = false
      } else {
        this.tickLevelEditor(dt, input)
        return
      }
    }

    // Drain network snapshots before sim so reconcile is fresh
    if (this.isOnline) {
      this.flushNetSnapshots(dt)
    }

    // Online death: free-cam spectate, wait for server respawn (no local restart)
    if (this.isOnline && !this.playerAlive) {
      this.tickOnlineDead(dt, input)
      return
    }

    // Free-cam (death or voluntary toggle): world still runs, no combat / player move.
    // Online: no voluntary free-cam cheat path while match is live
    if (!this.playerAlive || (!this.isOnline && this.voluntaryFreeCam)) {
      this.tickSpectate(dt, input)
      return
    }

    if (this.isOnline) {
      this.tickOnline(dt, input)
      return
    }

    this.tickOffline(dt, input)
  }

  /** Online: dead until server respawns — free-cam spectate, no local restart. */
  private tickOnlineDead(
    dt: number,
    input: import('../core/types').PlayerInput,
  ) {
    this.sniper.ads = false
    this.sniper.adsBlend = Math.max(0, this.sniper.adsBlend - dt * 8)
    this.viewmodel.syncAnim(this.sniper.phase)
    this.viewmodel.updateMixer(dt)
    if (this.viewmodel.root) this.viewmodel.root.visible = false
    if (this.playerVisuals.body) this.playerVisuals.body.visible = false

    if (!this.freeCam) this.enterFreeCam()
    if (this.freeCam) {
      stepFreeCam(this.freeCam, input, dt)
      this.camera.position.set(
        this.freeCam.position.x,
        this.freeCam.position.y,
        this.freeCam.position.z,
      )
      this.camera.rotation.order = 'YXZ'
      this.camera.rotation.y = this.freeCam.yaw
      this.camera.rotation.x = this.freeCam.pitch
    }

    this.camera.fov = LOOK.hipFov
    this.camera.updateProjectionMatrix()

    this.remotes.update(dt)
    this.combatFx.update(dt)
    this.barrierVisuals.update(
      this.freeCam?.position ?? this.player.position,
    )
    this.lastHitAge += dt
    this.spectateTimer = this.serverRespawnIn
    // Keep sending pose so server ack doesn't stall (dead body frozen server-side)
    if (this.net && this.localPlayerId) {
      this.net.maybeSendInput(
        { ...input, fire: false, jump: false },
        dt,
        this.player,
      )
    }
    this.emitHud()
  }

  /** Offline practice range — client-authoritative combat OK. */
  private tickOffline(
    dt: number,
    input: import('../core/types').PlayerInput,
  ) {
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
      // Full camera shake when fire kicks us out of ADS (bolt); soft only if still scoped (last-round reload).
      this.viewFeel.punchShot(
        this.sniper.adsBlend,
        this.sniper.ads ? this.sniper.adsBlend : 0,
      )
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
   * Online duel — client-authoritative movement (same sim as offline).
   * Sends claimed pose each input packet; server validates / rejects cheats.
   * Snapshots only drive HP / ammo / score / remotes — never local position.
   */
  private tickOnline(
    dt: number,
    input: import('../core/types').PlayerInput,
  ) {
    this.viewFeel.samplePreStep(this.player)
    const prevMoveState = this.player.state

    // Countdown: freeze feet on team pad — look only until go.
    const movementLocked = this.matchPhase === 'countdown'
    const fireAllowed =
      this.playerAlive &&
      !movementLocked &&
      (this.matchPhase === 'pregame' ||
        this.matchPhase === 'live' ||
        this.matchPhase === 'waiting' ||
        this.matchPhase == null)

    if (movementLocked) {
      // Hold pad position; mouse look still updates yaw/pitch
      this.player.velocity.x = 0
      this.player.velocity.y = 0
      this.player.velocity.z = 0
      this.player.grounded = true
      this.player.state = 'idle'
      this.player.slideTimer = 0
      this.player.yaw = input.yaw
      this.player.pitch = input.pitch
    } else {
      // Same movement as offline practice — no fixed-step / no reconcile
      stepPlayer(
        this.player,
        input,
        dt,
        this.colliders,
        this.meshWorld,
        this.barrierColliders,
      )
    }

    // Cosmetic sniper step (server overwrites ammo/phase on snapshot)
    stepSniper(this.sniper, input, dt)

    // Send pose + buttons (force on combat edges so rate limit never drops fire)
    if (this.net && this.localPlayerId) {
      const sendInput =
        movementLocked || !fireAllowed
          ? {
              ...input,
              forward: movementLocked ? 0 : input.forward,
              right: movementLocked ? 0 : input.right,
              jump: false,
              sprint: movementLocked ? false : input.sprint,
              fire: fireAllowed ? input.fire : false,
            }
          : input
      const edge = sendInput.fire || sendInput.reload || sendInput.jump
      if (edge) this.net.sendInputNow(sendInput, this.player)
      else this.net.maybeSendInput(sendInput, dt, this.player)
    }

    if (this.playerVisuals.isMan) {
      this.playerVisuals.syncLocomotion(
        this.player,
        movementLocked
          ? { ...input, forward: 0, right: 0, jump: false, sprint: false }
          : input,
      )
      this.playerVisuals.update(dt)
    }
    this.viewmodel.syncAnim(this.sniper.phase)
    this.viewmodel.updateMixer(dt)

    const prevGrounded = this.viewFeel.wasGrounded
    // Optimistic fire FX only — damage comes from server HitEvents.
    // Non-kill tracers blink only; kills upgrade to permanent red + silhouette.
    const fireInput = fireAllowed ? input : { ...input, fire: false }
    const fireResult = tryFire(this.sniper, fireInput)
    if (fireResult === 'shot') {
      gameAudio.playFire()
      // Aim sample BEFORE recoil — matches offline fireShot + server resolveFire.
      // Applying recoil first was kicking the optimistic tracer ~recoilKick above the crosshair.
      const look = effectiveLook(this.player, this.sniper)
      const origin = eyePosShared(this.player)
      const spread = aimSpreadShared(this.sniper, this.player)
      const dir = spreadLookDirection(look.yaw, look.pitch, spread)
      const end = {
        x: origin.x + dir.x * SNIPER.maxRange,
        y: origin.y + dir.y * SNIPER.maxRange,
        z: origin.z + dir.z * SNIPER.maxRange,
      }
      this.combatFx.showTracer(origin, dir, end, { killed: false })
      applyRecoil(this.sniper)
      // Full camera shake when fire kicks us out of ADS (bolt); soft only if still scoped (last-round reload).
      this.viewFeel.punchShot(
        this.sniper.adsBlend,
        this.sniper.ads ? this.sniper.adsBlend : 0,
      )
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
    this.remotes.update(dt)
    this.combatFx.update(dt)
    this.barrierVisuals.update(this.player.position)

    this.lastHitAge += dt
    this.emitHud()
  }

  private flushNetSnapshots(_dt: number) {
    if (!this.pendingSnapshots.length) return
    const snaps = this.pendingSnapshots
    this.pendingSnapshots = []

    // Push EVERY snapshot into remote interp (dropping intermediates made
    // other players teleport / sit in wrong lobby poses).
    for (const snap of snaps) {
      for (const shot of snap.shots ?? []) this.applyNetShotEvent(shot)
      for (const ev of snap.events) this.applyNetHitEvent(ev)
      this.pushRemoteSnapshots(snap)
    }

    // Latest only for local combat HUD / respawn
    this.applyLocalSnapshot(snaps[snaps.length - 1])
  }

  private pushRemoteSnapshots(snap: SnapshotMessage) {
    const selfId = this.localPlayerId
    for (const p of snap.players) {
      if (selfId && p.id === selfId) continue
      this.remotes.pushSnapshot(p.id, p, snap.tick, this.serverTickRate)
    }
  }

  private applyLocalSnapshot(snap: SnapshotMessage) {
    const selfId = this.localPlayerId
    const seen = new Set<string>()
    const prevPhase = this.lastMatchPhase

    this.matchTimeLeft = snap.timeLeft ?? null
    this.matchWaiting = snap.phase === 'waiting'
    this.matchPhase = snap.phase
    this.matchPhaseTimer = snap.phaseTimer ?? 0
    this.matchFirstTo = snap.firstTo ?? this.matchFirstTo

    // Clear kill tracers + silhouettes when a new round starts
    if (
      snap.phase === 'countdown' &&
      (prevPhase === 'round_reset' || prevPhase === 'pregame')
    ) {
      this.combatFx.clearTracers()
    }

    // Full look+pose snap when first entering countdown / respawning
    const enteringCountdown =
      snap.phase === 'countdown' &&
      (prevPhase === 'round_reset' ||
        prevPhase === 'pregame' ||
        prevPhase === null)

    this.lastMatchPhase = snap.phase

    for (const p of snap.players) {
      if (selfId && p.id === selfId) {
        const wasAlive = this.playerAlive
        // Authoritative combat state only — never local pose
        this.playerHp = p.hp
        this.playerAlive = p.alive
        this.kills = p.kills
        this.serverRespawnIn = p.respawnIn ?? 0
        this.localReady = p.ready === true
        this.sniper.ammo = p.ammo
        this.sniper.magSize = p.magSize
        if (p.phase !== this.sniper.phase) {
          this.sniper.phase = p.phase
          if (p.phase === 'ready') this.sniper.phaseTimer = 0
        }
        this.sniper.ads = p.ads
        this.sniper.adsBlend = p.adsBlend

        const respawning = Boolean(wasAlive === false && p.alive)
        // Whole countdown: pin feet to server team pad (movement locked)
        const pinToPad = p.alive && snap.phase === 'countdown'
        const fullSnap =
          p.alive && (respawning || enteringCountdown)

        if (!p.alive) {
          this.deathReason = 'combat'
          this.spectateTimer = p.respawnIn ?? 0
        } else if (fullSnap || pinToPad) {
          this.deathReason = null
          this.spectateTimer = 0
          this.freeCam = null
          this.voluntaryFreeCam = false
          if (fullSnap) this.prediction.clear()
          // Always pin feet/vel to server pad during countdown
          this.player.position.x = p.x
          this.player.position.y = p.y
          this.player.position.z = p.z
          this.player.velocity.x = 0
          this.player.velocity.y = 0
          this.player.velocity.z = 0
          this.player.grounded = true
          this.player.state = 'idle'
          this.playSpawn = {
            spawn: { x: p.x, y: p.y, z: p.z },
            spawnYaw: p.yaw,
          }
          // Only force look on full snap so player can aim around during countdown
          if (fullSnap) {
            this.player.yaw = p.yaw
            this.player.pitch = p.pitch
            this.input.setLook(p.yaw, p.pitch)
          }
          if (this.viewmodel.root && !this.thirdPerson) {
            this.viewmodel.root.visible = true
          }
        }
      } else {
        seen.add(p.id)
        this.enemyKills = p.kills
        this.enemyReady = p.ready === true
      }
    }

    for (const id of this.remotes.ids()) {
      if (!seen.has(id)) this.remotes.remove(id)
    }
  }

  /**
   * Authoritative shot tracers for remotes. Non-kills blink; kills stay red
   * until round reset. Skip local shooter — optimistic tracer already drawn.
   */
  private applyNetShotEvent(shot: NetShotEvent) {
    if (shot.shooterId === this.localPlayerId) return
    const killed = shot.hit?.killed === true
    this.combatFx.showTracer(shot.origin, shot.dir, shot.end, {
      killed,
      permanent: killed,
    })
  }

  private applyNetHitEvent(ev: NetHitEvent) {
    const hit: HitEvent = {
      targetId: ev.targetId,
      zone: ev.zone,
      damage: ev.damage,
      killed: ev.killed,
      point: { ...ev.point },
    }
    // Local player was shooter or victim → hitmarker / impact
    if (
      ev.shooterId === this.localPlayerId ||
      ev.targetId === this.localPlayerId
    ) {
      this.lastHit = hit
      this.lastHitAge = 0
      this.lastHitId += 1
      gameAudio.playHitConfirm({ zone: ev.zone, killed: ev.killed })
    }
    this.combatFx.showImpact(
      ev.point,
      ev.zone === 'head' ? 'head' : 'body',
      ev.killed,
    )

    // Our kill: permanent red tracer + silhouette until round reset
    if (
      ev.killed &&
      ev.shooterId === this.localPlayerId &&
      ev.origin &&
      ev.dir &&
      ev.end
    ) {
      this.combatFx.showTracer(ev.origin, ev.dir, ev.end, {
        killed: true,
        permanent: true,
      })
    }

    // Remote body reactions (local player is first-person — no body clip)
    if (ev.targetId !== this.localPlayerId) {
      const shotDir = this.estimateShotDir(ev)
      if (ev.killed) {
        // Align live pose → freeze red silhouette (our kills only) → death anim.
        // Align once before the ghost so the silhouette matches the fall direction.
        if (shotDir) this.remotes.alignDeath(ev.targetId, shotDir)
        if (ev.shooterId === this.localPlayerId) {
          const victim = this.remotes.getRoot(ev.targetId)
          if (victim) {
            this.combatFx.spawnKillGhost(victim, { permanent: true })
          }
        }
        // Already aligned above — don't knock again.
        this.remotes.onDeath(ev.targetId)
      } else {
        this.remotes.onHit(ev.targetId)
      }
    }
  }

  /** Bullet direction for death fall: shooter → impact point when possible. */
  private estimateShotDir(
    ev: NetHitEvent,
  ): { x: number; y: number; z: number } | undefined {
    let ox: number | null = null
    let oy: number | null = null
    let oz: number | null = null
    if (ev.shooterId === this.localPlayerId) {
      const eye = eyePosShared(this.player)
      ox = eye.x
      oy = eye.y
      oz = eye.z
    }
    if (ox == null) return undefined
    const dx = ev.point.x - ox
    const dy = ev.point.y - oy!
    const dz = ev.point.z - oz!
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-4) return undefined
    return { x: dx / len, y: dy / len, z: dz / len }
  }

  /**
   * Free-cam spectate: fly + look, world/dummies/FX keep updating.
   * After death, restarts the round when the countdown ends.
   * Voluntary free-cam has no timer (toggle off to exit).
   */
  private tickSpectate(
    dt: number,
    input: import('../core/types').PlayerInput,
  ) {
    if (!this.freeCam) {
      this.enterFreeCam()
    }
    if (!this.freeCam) return

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
    // Keep player model hidden for the whole free-cam session.
    if (this.playerVisuals.body) this.playerVisuals.body.visible = false

    if (this.dummiesEnabled) {
      stepDummies(this.dummies, dt)
      stepRespawns(this.dummies, this.respawns, dt)
      this.dummiesSys.update(dt, this.dummies, false)
    }
    this.combatFx.update(dt)
    this.barrierVisuals.update(this.freeCam.position)

    this.lastHitAge += dt

    if (!this.playerAlive) {
      this.spectateTimer = Math.max(0, this.spectateTimer - dt)
      this.emitHud()
      if (this.spectateTimer <= 0) {
        this.restartRound()
      }
      return
    }

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
    const freecam = this.freeCam !== null
    const speed =
      this.playerAlive && !freecam
        ? Math.hypot(this.player.velocity.x, this.player.velocity.z)
        : 0
    const snap: HudSnapshot = {
      hp: this.playerHp,
      ammo: this.sniper.ammo,
      magSize: this.sniper.magSize,
      phase: this.sniper.phase,
      ads: this.playerAlive && !freecam ? this.sniper.ads : false,
      adsBlend: this.playerAlive && !freecam ? this.sniper.adsBlend : 0,
      reloadJiggleX: this.sniper.reloadJiggleX,
      reloadJiggleY: this.sniper.reloadJiggleY,
      aimSpread:
        this.playerAlive && !freecam
          ? aimSpread(this.sniper, this.player)
          : 0,
      moveState:
        this.playerAlive && !freecam ? this.player.state : 'idle',
      speed,
      pointerLocked: this.input.isPointerLocked(),
      kills: this.kills,
      lastHit: this.lastHit,
      lastHitAge: this.lastHitAge,
      lastHitId: this.lastHitId,
      alive: this.playerAlive,
      spectating: freecam || (this.isOnline && !this.playerAlive),
      respawnIn: this.playerAlive
        ? 0
        : this.isOnline
          ? this.serverRespawnIn
          : this.spectateTimer,
      deathReason: this.deathReason,
      fps: this.fps,
      ping: this.pingMs,
      perf: this.buildPerfHud(),
      matchTimeLeft: this.isOnline ? this.matchTimeLeft : null,
      matchWinnerId: this.matchEnd?.winnerId ?? null,
      matchEndReason: this.matchEnd?.reason ?? null,
      matchWaiting: this.isOnline && this.matchWaiting,
      matchPhase: this.isOnline ? this.matchPhase : null,
      matchPhaseTimer: this.isOnline ? this.matchPhaseTimer : 0,
      matchFirstTo: this.isOnline ? this.matchFirstTo : MATCH.firstTo,
      localReady: this.isOnline && this.localReady,
      enemyReady: this.isOnline && this.enemyReady,
      enemyKills: this.isOnline ? this.enemyKills : 0,
      teamColor: this.isOnline ? this.teamColor : null,
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
