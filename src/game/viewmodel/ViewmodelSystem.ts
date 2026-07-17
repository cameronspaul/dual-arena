/**
 * FPS viewmodel: load, config editor API, fire/bolt/reload clips, pose apply.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { SNIPER, VIEWMODEL } from '../core/config'
import type { SniperState } from '../core/types'
import {
  buildViewmodelClips,
  emptyArmSideBones,
  measureUnitAsset,
  prepareViewmesh,
  styleViewmodelLowPoly,
  type ArmSideBones,
} from './assets'
import {
  cloneViewmodelConfig,
  normalizeViewmodelConfig,
  type ViewmodelConfig,
} from './config'

export class ViewmodelSystem {
  root: THREE.Group | null = null
  private gun: THREE.Object3D | null = null
  private armBonesL: ArmSideBones = emptyArmSideBones()
  private armBonesR: ArmSideBones = emptyArmSideBones()
  private gunUnitScale = 1
  private gunCenter = new THREE.Vector3()
  /** Live config (mutated by editor). Prefer getConfig() for safe snapshots. */
  config: ViewmodelConfig = cloneViewmodelConfig(
    VIEWMODEL as unknown as ViewmodelConfig,
  )
  ready = false
  editorActive = false
  forceAds: number | null = null
  /** Editor: force hip→run blend 0..1 (null = live sprint). */
  forceRun: number | null = null
  freezeBob = false
  keepVisible = false
  armSolo: 'both' | 'left' | 'right' = 'both'
  private mixer: THREE.AnimationMixer | null = null
  private actions: {
    fire: THREE.AnimationAction | null
    bolt: THREE.AnimationAction | null
    reload: THREE.AnimationAction | null
    ready: THREE.AnimationAction | null
  } = { fire: null, bolt: null, reload: null, ready: null }
  private animPhase: string | null = null
  private currentAction: THREE.AnimationAction | null = null

  getConfig(): ViewmodelConfig {
    return cloneViewmodelConfig(this.config)
  }

  setConfig(partial: unknown, replace = false) {
    if (replace) {
      this.config = normalizeViewmodelConfig(partial)
    } else {
      this.config = normalizeViewmodelConfig({
        ...this.config,
        ...(partial as object),
        arms: {
          ...this.config.arms,
          ...((partial as ViewmodelConfig)?.arms ?? {}),
        },
      })
    }
    this.applyParts()
  }

  resetConfig() {
    this.config = cloneViewmodelConfig(
      VIEWMODEL as unknown as ViewmodelConfig,
    )
    this.applyParts()
  }

  setEditorActive(active: boolean) {
    this.editorActive = active
    if (!active) {
      this.forceAds = null
      this.forceRun = null
      this.freezeBob = false
      this.keepVisible = false
      this.armSolo = 'both'
      this.applyParts()
    }
  }

  setArmSolo(solo: 'both' | 'left' | 'right') {
    this.armSolo = solo
    this.applyParts()
  }

  hasArmBones() {
    return !!(this.armBonesL.limb.shoulder || this.armBonesR.limb.shoulder)
  }

  hasHandBones() {
    return !!(this.armBonesL.limb.wrist || this.armBonesR.limb.wrist)
  }

  applyParts() {
    const c = this.config
    if (this.gun) {
      this.gun.scale.setScalar(this.gunUnitScale * c.scale)
      this.gun.position.set(
        this.gunCenter.x * c.scale + c.gunOffset.x,
        this.gunCenter.y * c.scale + c.gunOffset.y,
        this.gunCenter.z * c.scale + c.gunOffset.z,
      )
      this.gun.rotation.set(c.modelRot.x, c.modelRot.y, c.modelRot.z)
    }
  }

  private playAction(
    next: THREE.AnimationAction | null,
    matchDuration: number | null,
  ) {
    if (!next) return
    if (this.currentAction === next && next.isRunning()) return

    if (this.currentAction && this.currentAction !== next) {
      this.currentAction.fadeOut(0.06)
    }

    next.reset()
    next.setEffectiveWeight(1)
    next.clampWhenFinished = true
    next.setLoop(THREE.LoopOnce, 1)
    if (matchDuration && next.getClip().duration > 0.001) {
      next.timeScale = next.getClip().duration / matchDuration
    } else {
      next.timeScale = 1
    }
    next.fadeIn(0.05).play()
    this.currentAction = next
  }

  /** Drive fire / bolt / reload / ready clips from sniper phase. */
  syncAnim(phase: SniperState['phase']) {
    if (phase === this.animPhase) return
    this.animPhase = phase

    if (phase === 'firing') {
      this.playAction(this.actions.fire, SNIPER.fireAnimTime)
    } else if (phase === 'bolt') {
      this.playAction(this.actions.bolt, SNIPER.boltTime)
    } else if (phase === 'reloading') {
      this.playAction(this.actions.reload, SNIPER.reloadTime)
    } else {
      this.playAction(this.actions.ready, null)
    }
  }

  updateMixer(dt: number) {
    this.mixer?.update(dt)
  }

  async load(camera: THREE.PerspectiveCamera, scene: THREE.Scene) {
    const root = new THREE.Group()
    const loader = new GLTFLoader()
    this.config = cloneViewmodelConfig(
      VIEWMODEL as unknown as ViewmodelConfig,
    )

    try {
      const gltf = await loader.loadAsync('/models/sniper_animated.glb')
      const model = gltf.scene
      prepareViewmesh(model)
      styleViewmodelLowPoly(model)

      const { modelRot } = this.config
      model.rotation.set(modelRot.x, modelRot.y, modelRot.z)
      const measured = measureUnitAsset(model)
      this.gunUnitScale = measured.unitScale
      this.gunCenter.copy(measured.center)
      this.gun = model
      root.add(model)

      const master = gltf.animations?.[0]
      if (master) {
        this.mixer = new THREE.AnimationMixer(model)
        const clips = buildViewmodelClips(master)
        const mk = (clip: THREE.AnimationClip) => {
          const a = this.mixer!.clipAction(clip)
          a.setLoop(THREE.LoopOnce, 1)
          a.clampWhenFinished = true
          return a
        }
        this.actions = {
          fire: mk(clips.fire),
          bolt: mk(clips.bolt),
          reload: mk(clips.reload),
          ready: mk(clips.ready),
        }
        this.playAction(this.actions.ready, null)
        this.animPhase = 'ready'
        console.info('Viewmodel animations ready', {
          fire: clips.fire.duration.toFixed(2),
          bolt: clips.bolt.duration.toFixed(2),
          reload: clips.reload.duration.toFixed(2),
          ready: clips.ready.duration.toFixed(2),
        })
      } else {
        console.warn('sniper_animated.glb has no animations')
      }
    } catch (e) {
      console.warn('sniper_animated.glb load failed, using placeholder', e)
      const gun = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 0.7),
        new THREE.MeshStandardMaterial({ color: 0x2a2a2a }),
      )
      const measured = measureUnitAsset(gun)
      this.gunUnitScale = measured.unitScale
      this.gunCenter.copy(measured.center)
      this.gun = gun
      root.add(gun)
    }

    this.applyParts()

    const { hipPos, hipRot } = this.config
    root.position.set(hipPos.x, hipPos.y, hipPos.z)
    root.rotation.set(hipRot.x, hipRot.y, hipRot.z)

    camera.add(root)
    scene.add(camera)
    this.root = root
    this.ready = true
  }

  /** Effective ADS blend for pose (editor force or live sniper). */
  adsBlend(sniperAds: number) {
    return this.forceAds != null ? this.forceAds : sniperAds
  }

  /**
   * Effective hip→run blend (editor force or live sprint amount).
   * ADS still wins in ViewFeel (run is applied under ADS).
   */
  runBlend(liveRun: number) {
    return this.forceRun != null ? this.forceRun : liveRun
  }
}
