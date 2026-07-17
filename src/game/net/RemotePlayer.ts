/**
 * Remote opponent man.glb — interpolate between server snapshots.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import {
  DUMMY,
  type MoveState,
  type PlayerSnapshot,
} from '@duel/shared'
import {
  applyDummyCrouchScale,
  fadeDummyLoco,
  getDummyActions,
  playSlideRoll,
  scrubSlideRoll,
} from '../character/dummyVisuals'
import { findClip } from '../character/locomotion'
import { MOVE } from '../core/config'

type SnapshotSample = {
  t: number
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  state: MoveState
  vx: number
  vz: number
  alive: boolean
}

const INTERP_DELAY = 0.1 // ~3 ticks at 30 Hz

export class RemotePlayerSystem {
  private scene: THREE.Scene | null = null
  private template: THREE.Object3D | null = null
  private scale = 1
  private footY = 0
  private clips: THREE.AnimationClip[] = []
  private loading: Promise<void> | null = null
  private readonly remotes = new Map<
    string,
    {
      root: THREE.Group
      mixer: THREE.AnimationMixer | null
      samples: SnapshotSample[]
    }
  >()

  async ensureLoaded(scene: THREE.Scene) {
    this.scene = scene
    if (this.template) return
    if (this.loading) return this.loading
    this.loading = this.loadMan()
    await this.loading
  }

  private async loadMan() {
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync('/models/man.glb')
    this.template = gltf.scene
    this.clips = gltf.animations ?? []
    const box = new THREE.Box3().setFromObject(this.template)
    const size = box.getSize(new THREE.Vector3())
    const targetHeight =
      DUMMY.headOffsetY + DUMMY.headRadius * DUMMY.headEgg.y
    this.scale = targetHeight / Math.max(size.y, 0.001)
    this.footY = box.min.y
  }

  /** Push a server snapshot sample for a remote player. */
  pushSnapshot(id: string, snap: PlayerSnapshot, now = performance.now() / 1000) {
    if (!this.scene || !this.template) return
    let entry = this.remotes.get(id)
    if (!entry) {
      entry = this.spawn(id)
      this.remotes.set(id, entry)
    }
    entry.samples.push({
      t: now,
      x: snap.x,
      y: snap.y,
      z: snap.z,
      yaw: snap.yaw,
      pitch: snap.pitch,
      state: snap.state,
      vx: snap.vx,
      vz: snap.vz,
      alive: snap.alive,
    })
    // Keep ~0.5 s of history
    const cutoff = now - 0.5
    while (entry.samples.length > 2 && entry.samples[0].t < cutoff) {
      entry.samples.shift()
    }
  }

  remove(id: string) {
    const entry = this.remotes.get(id)
    if (!entry || !this.scene) return
    this.scene.remove(entry.root)
    this.remotes.delete(id)
  }

  clear() {
    for (const id of [...this.remotes.keys()]) this.remove(id)
  }

  private spawn(_id: string) {
    const root = new THREE.Group()
    const model = cloneSkinned(this.template!)
    model.scale.setScalar(this.scale)
    model.position.y = -this.footY * this.scale
    root.userData.baseScale = this.scale
    root.userData.model = model
    root.userData.isMan = true
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

    let mixer: THREE.AnimationMixer | null = null
    const idleClip =
      findClip(this.clips, 'Idle_Neutral', 'Idle') ?? this.clips[0]
    if (idleClip) {
      mixer = new THREE.AnimationMixer(model)
      const mkLoop = (clip: THREE.AnimationClip | undefined) => {
        if (!clip) return null
        const a = mixer!.clipAction(clip)
        a.setLoop(THREE.LoopRepeat, Infinity)
        return a
      }
      const mkOnce = (clip: THREE.AnimationClip | undefined) => {
        if (!clip) return null
        const a = mixer!.clipAction(clip)
        a.setLoop(THREE.LoopOnce, 1)
        a.clampWhenFinished = true
        return a
      }
      const idle = mkLoop(idleClip)!
      idle.play()
      root.userData.actions = {
        idle,
        walk: mkLoop(findClip(this.clips, 'Walk') ?? undefined),
        run: mkLoop(findClip(this.clips, 'Run') ?? undefined),
        runBack: mkLoop(findClip(this.clips, 'Run_Back') ?? undefined),
        runLeft: mkLoop(findClip(this.clips, 'Run_Left') ?? undefined),
        runRight: mkLoop(findClip(this.clips, 'Run_Right') ?? undefined),
        slide: mkOnce(findClip(this.clips, 'Roll') ?? undefined),
        hit: null,
        hitAlt: null,
        death: null,
      }
    }

    root.visible = false
    this.scene!.add(root)
    return { root, mixer, samples: [] as SnapshotSample[] }
  }

  update(dt: number, now = performance.now() / 1000) {
    const renderTime = now - INTERP_DELAY
    for (const [, entry] of this.remotes) {
      const { root, mixer, samples } = entry
      if (samples.length === 0) {
        root.visible = false
        continue
      }

      let from = samples[0]
      let to = samples[samples.length - 1]
      for (let i = 0; i < samples.length - 1; i++) {
        if (samples[i].t <= renderTime && samples[i + 1].t >= renderTime) {
          from = samples[i]
          to = samples[i + 1]
          break
        }
      }

      const span = Math.max(1e-4, to.t - from.t)
      const u = Math.min(1, Math.max(0, (renderTime - from.t) / span))
      const x = from.x + (to.x - from.x) * u
      const y = from.y + (to.y - from.y) * u
      const z = from.z + (to.z - from.z) * u
      // Shortest-path yaw lerp
      let dyaw = to.yaw - from.yaw
      while (dyaw > Math.PI) dyaw -= Math.PI * 2
      while (dyaw < -Math.PI) dyaw += Math.PI * 2
      const yaw = from.yaw + dyaw * u
      const alive = u < 0.5 ? from.alive : to.alive
      const state = u < 0.5 ? from.state : to.state

      root.visible = alive
      if (!alive) continue

      root.position.set(x, y, z)
      root.rotation.y = yaw + Math.PI

      this.syncLoco(root, state, to.vx, to.vz, yaw)
      mixer?.update(dt)
    }
  }

  private syncLoco(
    root: THREE.Group,
    state: MoveState,
    vx: number,
    vz: number,
    yaw: number,
  ) {
    const actions = getDummyActions(root)
    if (!actions?.idle) return

    let want: string = state
    if (want === 'jump') {
      const hsp = Math.hypot(vx, vz)
      if (hsp > MOVE.runSpeed * 0.72) want = 'run'
      else if (hsp > 0.4) want = 'walk'
      else want = 'idle'
    }

    if (root.userData.locoState !== want) {
      root.userData.locoState = want
      if (want === 'slide' && actions.slide) {
        playSlideRoll(actions.slide, actions)
      } else if (want === 'run') {
        fadeDummyLoco(actions, actions.run ?? actions.walk ?? actions.idle)
      } else if (want === 'walk' || want === 'crouch') {
        fadeDummyLoco(actions, actions.walk ?? actions.idle)
      } else {
        fadeDummyLoco(actions, actions.idle)
      }
      applyDummyCrouchScale(root, want === 'crouch')
    }

    void yaw
    if (want === 'slide' && actions.slide) {
      scrubSlideRoll(actions.slide, 0.5)
    }
  }

  ids(): string[] {
    return [...this.remotes.keys()]
  }
}
