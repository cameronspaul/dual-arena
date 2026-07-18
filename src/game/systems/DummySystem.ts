/**
 * Dummy targets: load man.glb clones, loco sync, hit/death, mesh hitscan.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import {
  applyDummyCrouchScale,
  attachDummyLabel,
  fadeDummyLoco,
  getDummyActions,
  alignDummyDeathToShot,
  playDummyDeath,
  playDummyHit,
  playDummyIdle,
  playSlideRoll,
  scrubSlideRoll,
  setDummyLabel,
} from '../character/dummyVisuals'
import {
  castMeshHitscan,
  collectDummyHitTargets,
  createMeshHitscanScratch,
  makePlaceholderDummy,
  paintDummyMeshes,
  registerHitMeshes,
  splitChestMeshesByArmWeights,
} from '../character/hitMeshes'
import { findClip } from '../character/locomotion'
import { DUMMY, MOVE } from '../core/config'
import type { CharacterAppearance } from '../character/appearance'
import type { DummyTarget, RayHit } from '../core/types'
import type { PlayerVisuals } from './PlayerVisuals'

export class DummySystem {
  meshes = new Map<string, THREE.Group>()
  private mixers = new Map<string, THREE.AnimationMixer>()
  private readonly hitscanScratch = createMeshHitscanScratch()
  /** When false, meshes stay hidden and update/hitscan are no-ops. */
  private enabled = true

  async load(
    scene: THREE.Scene,
    dummies: DummyTarget[],
    playerVisuals: PlayerVisuals,
    thirdPerson: boolean,
    playerAppearance?: CharacterAppearance,
  ) {
    type DummyFactory = (id: string) => THREE.Group
    let factory: DummyFactory

    try {
      const loader = new GLTFLoader()
      const gltf = await loader.loadAsync('/models/man.glb')
      const source = gltf.scene
      const clips = gltf.animations ?? []

      const idleClip = findClip(clips, 'Idle_Neutral', 'Idle') ?? clips[0]
      const walkClip = findClip(clips, 'Walk')
      const runClip = findClip(clips, 'Run')
      const runBackClip = findClip(clips, 'Run_Back')
      const runLeftClip = findClip(clips, 'Run_Left')
      const runRightClip = findClip(clips, 'Run_Right')
      const slideClip = findClip(clips, 'Roll')
      const hitClip = findClip(clips, 'HitRecieve')
      const hitClipAlt = findClip(clips, 'HitRecieve_2')
      const deathClip = findClip(clips, 'Death')

      console.info('Dummy locomotion clips', {
        idle: idleClip?.name,
        walk: walkClip?.name,
        run: runClip?.name,
        runBack: runBackClip?.name,
        runLeft: runLeftClip?.name,
        runRight: runRightClip?.name,
        slide: slideClip?.name,
        available: clips.map((c) => c.name),
      })

      const box = new THREE.Box3().setFromObject(source)
      const size = box.getSize(new THREE.Vector3())
      const targetHeight =
        DUMMY.headOffsetY + DUMMY.headRadius * DUMMY.headEgg.y
      const scale = targetHeight / Math.max(size.y, 0.001)
      const footY = box.min.y

      playerVisuals.attachMan(
        scene,
        source,
        clips,
        scale,
        footY,
        thirdPerson,
        playerAppearance,
      )

      factory = (id: string) => {
        const root = new THREE.Group()
        const model = cloneSkinned(source)
        model.scale.setScalar(scale)
        model.position.y = -footY * scale
        root.userData.baseScale = scale
        root.userData.footY = footY
        root.userData.model = model

        model.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return
          o.castShadow = true
          o.receiveShadow = true
          o.frustumCulled = false
          const list = Array.isArray(o.material) ? o.material : [o.material]
          const cloned = list.map((m) => m.clone())
          o.material = Array.isArray(o.material) ? cloned : cloned[0]
        })

        root.add(model)
        root.userData.animState = 'idle'
        root.userData.locoState = 'idle'
        root.userData.wasAlive = true
        registerHitMeshes(root, id)
        splitChestMeshesByArmWeights(root, id)
        attachDummyLabel(root)

        if (idleClip) {
          const mixer = new THREE.AnimationMixer(model)
          this.mixers.set(id, mixer)

          const mkLoop = (clip: THREE.AnimationClip | undefined) => {
            if (!clip) return null
            const a = mixer.clipAction(clip)
            a.setLoop(THREE.LoopRepeat, Infinity)
            a.clampWhenFinished = false
            return a
          }
          const mkOnce = (clip: THREE.AnimationClip | undefined) => {
            if (!clip) return null
            const a = mixer.clipAction(clip)
            a.setLoop(THREE.LoopOnce, 1)
            a.clampWhenFinished = true
            return a
          }

          const idle = mkLoop(idleClip)!
          idle.time = Math.random() * idleClip.duration
          idle.play()

          const walk = mkLoop(walkClip)
          const run = mkLoop(runClip)
          const runBack = mkLoop(runBackClip)
          const runLeft = mkLoop(runLeftClip)
          const runRight = mkLoop(runRightClip)
          const slide = mkOnce(slideClip)
          const hit = mkOnce(hitClip)
          const hitAlt =
            hitClipAlt != null && hitClipAlt !== hitClip
              ? mkOnce(hitClipAlt)
              : null
          const death = mkOnce(deathClip)

          root.userData.actions = {
            idle,
            walk,
            run,
            runBack,
            runLeft,
            runRight,
            slide,
            hit,
            hitAlt,
            death,
          }

          mixer.addEventListener('finished', (e) => {
            const action = e.action as THREE.AnimationAction
            const state = root.userData.animState as string
            if (state === 'hit' && (action === hit || action === hitAlt)) {
              root.userData.locoState = null
              this.syncLocomotion(id, dummies)
            }
          })
        }

        return root
      }
    } catch (e) {
      console.warn('Dummy model load failed, using placeholder', e)
      factory = (id: string) => {
        const g = makePlaceholderDummy(id)
        attachDummyLabel(g)
        return g
      }
    }

    for (const d of dummies) {
      const g = factory(d.id)
      g.position.set(d.position.x, d.position.y, d.position.z)
      g.rotation.y = d.yaw
      g.visible = this.enabled
      scene.add(g)
      this.meshes.set(d.id, g)
      g.updateWorldMatrix(true, true)
      paintDummyMeshes(g, d.hp / d.maxHp)
      setDummyLabel(g, d.state)
    }
  }

  syncLocomotion(id: string, dummies: DummyTarget[]) {
    const d = dummies.find((x) => x.id === id)
    const root = this.meshes.get(id)
    if (!d || !root || !d.alive) return
    const actions = getDummyActions(root)
    if (!actions?.idle) return

    const anim = root.userData.animState as string
    if (anim === 'hit' || anim === 'death') return

    const want = d.state
    if (root.userData.locoState !== want || anim === 'hit') {
      root.userData.locoState = want
      root.userData.animState = want

      actions.hit?.stop()
      actions.hitAlt?.stop()
      actions.death?.stop()

      if (want === 'slide') {
        const slide = actions.slide
        if (slide) {
          playSlideRoll(slide, actions)
        } else {
          fadeDummyLoco(actions, actions.run ?? actions.walk ?? actions.idle)
        }
      } else if (want === 'run') {
        fadeDummyLoco(actions, actions.run ?? actions.walk ?? actions.idle)
        if (actions.run) actions.run.setEffectiveTimeScale(1)
      } else if (want === 'walk' || want === 'crouch') {
        const walk = actions.walk ?? actions.idle
        fadeDummyLoco(actions, walk)
        if (walk && walk !== actions.idle) {
          walk.setEffectiveTimeScale(want === 'crouch' ? 0.55 : 1)
        }
      } else {
        fadeDummyLoco(actions, actions.idle)
      }

      applyDummyCrouchScale(root, want === 'crouch')
    } else {
      applyDummyCrouchScale(root, want === 'crouch')
    }

    if (want === 'slide' && actions.slide) {
      scrubSlideRoll(actions.slide, 1 - d.slideTimer / MOVE.slideDuration)
    }
  }

  /**
   * Fully enable/disable dummies (visuals + sim hooks).
   * Off = all meshes hidden; caller should also skip stepDummies.
   */
  setEnabled(enabled: boolean) {
    this.enabled = enabled
    for (const mesh of this.meshes.values()) {
      mesh.visible = enabled
    }
  }

  isEnabled() {
    return this.enabled
  }

  /** Per-frame: loco mixers + root pose/labels/paint. No-op when disabled. */
  update(dt: number, dummies: DummyTarget[], paused: boolean) {
    if (!this.enabled) return

    if (!paused) {
      for (const d of dummies) {
        if (d.alive) this.syncLocomotion(d.id, dummies)
      }
      for (const mixer of this.mixers.values()) {
        mixer.update(dt)
      }
    }

    for (const d of dummies) {
      const mesh = this.meshes.get(d.id)
      if (!mesh) continue

      const wasAlive = mesh.userData.wasAlive !== false
      if (d.alive && !wasAlive) {
        mesh.userData.locoState = null
        playDummyIdle(mesh)
        this.syncLocomotion(d.id, dummies)
      }
      mesh.userData.wasAlive = d.alive

      const dying = !d.alive && mesh.userData.animState === 'death'
      mesh.visible = d.alive || dying

      if (!d.alive && !dying) continue

      if (d.alive) {
        mesh.position.set(d.position.x, d.position.y, d.position.z)
        mesh.rotation.y = d.yaw
        if (!paused) this.syncLocomotion(d.id, dummies)
        setDummyLabel(mesh, d.state)
      } else {
        setDummyLabel(mesh, 'dead')
      }

      paintDummyMeshes(mesh, d.alive ? d.hp / d.maxHp : 0)
    }
  }

  castHitscan(
    dummies: DummyTarget[],
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxRange: number,
  ): RayHit | null {
    if (!this.enabled) return null
    const targets = collectDummyHitTargets(dummies, this.meshes)
    return castMeshHitscan(
      this.hitscanScratch,
      targets,
      origin,
      dir,
      maxRange,
    )
  }

  onHit(ownerId: string) {
    const root = this.meshes.get(ownerId)
    if (root) playDummyHit(root)
  }

  /**
   * Kill reaction: optional re-yaw / knockback from shot direction, then Death.
   * `shotDir` is world-space bullet direction (origin → impact).
   *
   * Call after freezing a kill ghost if you want the silhouette at the actual
   * hit pose; align only affects the live body for the Death fall.
   */
  alignDeath(
    ownerId: string,
    shotDir: { x: number; y: number; z: number },
  ) {
    const root = this.meshes.get(ownerId)
    if (!root) return
    alignDummyDeathToShot(root, shotDir, {
      alignYaw: DUMMY.deathAlignToShot,
      knockback: DUMMY.deathKnockback,
    })
  }

  onDeath(ownerId: string) {
    const root = this.meshes.get(ownerId)
    if (root) playDummyDeath(root)
  }
}
