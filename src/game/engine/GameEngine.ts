/**
 * Thin orchestrator: owns sim state + subsystems, runs the frame loop.
 */
import * as THREE from 'three'
import { gameAudio } from '../core/audio'
import { LOOK } from '../core/config'
import { InputManager } from '../core/input'
import type { HitEvent, HudSnapshot, SniperState } from '../core/types'
import {
  buildProceduralRange,
  castMapHitscan,
  getMap,
  loadEnvForMap,
  loadGltfMap,
  type MapDef,
  type MapId,
} from '../maps'
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
  private mapHitMeshes: THREE.Object3D[] = []
  /** Live triangle collision for GLB maps (null on procedural range). */
  private meshWorld: { meshes: THREE.Object3D[] } | null = null
  private mapReady = false
  private mapLoadError: string | null = null

  constructor(container: HTMLElement, opts: GameEngineOptions = {}) {
    this.container = container
    this.mapDef = getMap(opts.mapId)

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

  private async bootstrapMap() {
    try {
      if (this.mapDef.kind === 'range') {
        const built = buildProceduralRange(this.scene)
        this.colliders = built.colliders
        this.floorMat = built.floorMat
        this.coverMat = built.coverMat
        this.mapHitMeshes = built.hitMeshes
        this.meshWorld = null
        this.applySpawn(built.spawn, built.spawnYaw)
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
        )
        this.envTextures.push(...textures)
      } else {
        const built = await loadGltfMap(this.scene, this.mapDef)
        this.colliders = built.colliders
        this.mapHitMeshes = built.hitMeshes
        // Walk / bullets use real triangle geometry
        this.meshWorld =
          built.hitMeshes.length > 0 ? { meshes: built.hitMeshes } : null
        // Place from fitted bounds (catalog coords alone are wrong for most GLBs)
        this.applySpawn(built.spawn, built.spawnYaw)
        this.dummies = createDummies({
          defs: built.dummies,
          bounds: built.dummyBounds,
        })
        if (built.bounds) {
          const span = Math.hypot(built.bounds.size.x, built.bounds.size.z)
          this.camera.far = Math.max(this.mapDef.cameraFar, span * 1.2 + 40)
          this.camera.updateProjectionMatrix()
        }
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

    this.viewFeel.samplePreStep(this.player)
    const prevMoveState = this.player.state
    stepPlayer(this.player, input, dt, this.colliders, this.meshWorld)
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
