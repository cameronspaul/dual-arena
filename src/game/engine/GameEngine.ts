/**
 * Thin orchestrator: owns sim state + subsystems, runs the frame loop.
 */
import * as THREE from 'three'
import { gameAudio } from '../core/audio'
import { LOOK } from '../core/config'
import { InputManager } from '../core/input'
import type { HitEvent, HudSnapshot, SniperState } from '../core/types'
import {
  buildRange as buildRangeScene,
  loadEnvironmentTextures,
} from '../scene/environment'
import { createPlayer, stepPlayer } from '../sim/player'
import {
  aimSpread,
  applyRecoil,
  createSniper,
  stepSniper,
  tryFire,
} from '../sim/sniper'
import {
  buildWorldColliders,
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

export class GameEngine {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private input = new InputManager()
  private player = createPlayer()
  private sniper = createSniper()
  private colliders = buildWorldColliders()
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

  constructor(container: HTMLElement) {
    this.container = container
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x87a0b8)
    this.scene.fog = new THREE.Fog(0xa8c4e0, 45, 100)

    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight
    this.camera = new THREE.PerspectiveCamera(LOOK.hipFov, w / h, 0.05, 200)
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

    this.buildRange()
    this.combatFx.build(this.scene)
    this.playerVisuals.buildPlaceholder(this.scene)
    void this.loadEnvironment()
    void this.viewmodel.load(this.camera, this.scene)
    void this.dummiesSys.load(
      this.scene,
      this.dummies,
      this.playerVisuals,
      this.thirdPerson,
    )
    this.input.attach(this.renderer.domElement)

    window.addEventListener('resize', this.onResize)
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

  private buildRange() {
    const built = buildRangeScene(this.scene, this.colliders)
    this.floorMat = built.floorMat
    this.coverMat = built.coverMat
    this.colliders.push(...built.extraColliders)
  }

  private async loadEnvironment() {
    const textures = await loadEnvironmentTextures({
      scene: this.scene,
      renderer: this.renderer,
      floorMat: this.floorMat,
      coverMat: this.coverMat,
    })
    this.envTextures.push(...textures)
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
    stepPlayer(this.player, input, dt, this.colliders)
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
      })
      if (result.lastHit) {
        this.lastHit = result.lastHit
        this.lastHitAge = 0
        this.lastHitId += 1
      }
      this.kills += result.killsDelta
      applyRecoil(this.sniper)
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
