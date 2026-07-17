/**
 * Local third-person body (capsule placeholder → man.glb).
 */
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import {
  applyDummyCrouchScale,
  fadeDummyLoco,
  getDummyActions,
  playSlideRoll,
  scrubSlideRoll,
} from '../character/dummyVisuals'
import {
  findClip,
  pickDirectionalRun,
  pickWalkAction,
  resolveLocoDir,
  type DummyActions,
} from '../character/locomotion'
import { MOVE } from '../core/config'
import type { PlayerBody } from '../core/types'

export class PlayerVisuals {
  body: THREE.Group | null = null
  mixer: THREE.AnimationMixer | null = null
  isMan = false

  buildPlaceholder(scene: THREE.Scene) {
    const root = new THREE.Group()
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x3d6ea8,
      roughness: 0.55,
      metalness: 0.08,
    })
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xe8c4a0,
      roughness: 0.65,
    })

    const bodyH = MOVE.standingHeight * 0.62
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(MOVE.radius * 0.85, bodyH, 6, 12),
      bodyMat,
    )
    body.position.y = MOVE.radius * 0.85 + bodyH * 0.5
    body.castShadow = true
    body.receiveShadow = true
    body.name = 'tpBody'
    root.add(body)

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 14, 12),
      headMat,
    )
    head.position.y = MOVE.eyeStanding + 0.06
    head.castShadow = true
    head.name = 'tpHead'
    root.add(head)

    root.visible = false
    root.userData.isMan = false
    scene.add(root)
    this.body = root
    this.isMan = false
  }

  /**
   * Replace capsule with man.glb clone.
   * Player faces -Z at yaw 0; man.glb faces +Z — apply Math.PI when posing.
   */
  attachMan(
    scene: THREE.Scene,
    source: THREE.Object3D,
    clips: THREE.AnimationClip[],
    scale: number,
    footY: number,
    visible: boolean,
  ) {
    if (this.body) {
      scene.remove(this.body)
      this.body.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          const m = obj.material
          if (Array.isArray(m)) m.forEach((x) => x.dispose())
          else m.dispose()
        }
      })
      this.body = null
    }
    this.mixer = null

    const root = new THREE.Group()
    const model = cloneSkinned(source)
    model.scale.setScalar(scale)
    model.position.y = -footY * scale
    root.userData.baseScale = scale
    root.userData.footY = footY
    root.userData.model = model
    root.userData.isMan = true
    root.userData.animState = 'idle'
    root.userData.locoState = 'idle'

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

    const idleClip = findClip(clips, 'Idle_Neutral', 'Idle') ?? clips[0]
    const walkClip = findClip(clips, 'Walk')
    const runClip = findClip(clips, 'Run')
    const runBackClip = findClip(clips, 'Run_Back')
    const runLeftClip = findClip(clips, 'Run_Left')
    const runRightClip = findClip(clips, 'Run_Right')
    const slideClip = findClip(clips, 'Roll')

    if (idleClip) {
      const mixer = new THREE.AnimationMixer(model)
      this.mixer = mixer

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
      idle.play()

      root.userData.actions = {
        idle,
        walk: mkLoop(walkClip),
        run: mkLoop(runClip),
        runBack: mkLoop(runBackClip),
        runLeft: mkLoop(runLeftClip),
        runRight: mkLoop(runRightClip),
        slide: mkOnce(slideClip),
        hit: null,
        hitAlt: null,
        death: null,
      } satisfies DummyActions
    }

    root.visible = visible
    scene.add(root)
    this.body = root
    this.isMan = true
  }

  syncLocomotion(
    player: PlayerBody,
    input: { forward: number; right: number },
  ) {
    const root = this.body
    if (!root?.userData.isMan) return
    const actions = getDummyActions(root)
    if (!actions?.idle) return

    let want = player.state as string
    if (want === 'jump' || !player.grounded) {
      const hsp = Math.hypot(player.velocity.x, player.velocity.z)
      if (hsp > MOVE.runSpeed * 0.72) want = 'run'
      else if (hsp > 0.4) want = 'walk'
      else want = 'idle'
    }

    const dir = resolveLocoDir(
      input.forward,
      input.right,
      player.velocity.x,
      player.velocity.z,
      player.yaw,
      want === 'idle' || want === 'slide',
    )
    const locoKey =
      want === 'idle' || want === 'slide' ? want : `${want}_${dir}`

    if (root.userData.locoState !== locoKey) {
      root.userData.locoState = locoKey
      root.userData.animState = want

      if (want === 'slide') {
        const slide = actions.slide
        if (slide) {
          playSlideRoll(slide, actions)
        } else {
          fadeDummyLoco(
            actions,
            pickDirectionalRun(actions, dir) ?? actions.walk ?? actions.idle,
          )
        }
      } else if (want === 'run') {
        const run =
          pickDirectionalRun(actions, dir) ?? actions.walk ?? actions.idle
        fadeDummyLoco(actions, run)
        if (run && run !== actions.idle) run.setEffectiveTimeScale(1)
      } else if (want === 'walk' || want === 'crouch') {
        const { action, timeScale } = pickWalkAction(
          actions,
          dir,
          want === 'crouch' ? 0.55 : 1,
        )
        fadeDummyLoco(actions, action)
        if (action && action !== actions.idle) {
          action.setEffectiveTimeScale(timeScale)
        }
      } else {
        fadeDummyLoco(actions, actions.idle)
      }

      applyDummyCrouchScale(root, want === 'crouch')
    }

    if (player.state === 'slide' && actions.slide) {
      scrubSlideRoll(
        actions.slide,
        1 - player.slideTimer / MOVE.slideDuration,
      )
    }
  }

  updatePose(player: PlayerBody, thirdPerson: boolean) {
    if (!this.body) return
    this.body.visible = thirdPerson
    if (!thirdPerson) return

    // Tiny lift so idle clip soles don't z-fight / sink into mesh floors
    const footLift = this.isMan ? 0.03 : 0
    this.body.position.set(
      player.position.x,
      player.position.y + footLift,
      player.position.z,
    )
    if (this.isMan) {
      this.body.rotation.y = player.yaw + Math.PI
      this.body.scale.set(1, 1, 1)
    } else {
      this.body.rotation.y = player.yaw
      const heightScale = player.height / Math.max(MOVE.standingHeight, 0.01)
      this.body.scale.set(1, heightScale, 1)
    }
  }

  update(dt: number) {
    this.mixer?.update(dt)
  }
}
