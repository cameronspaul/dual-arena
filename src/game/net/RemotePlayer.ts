/**
 * Remote opponent man.glb — interpolate between server snapshots.
 * Sample times come from server tick indices (not receive time) so packet
 * clumping doesn't collapse the interpolation window.
 *
 * Locomotion mirrors PlayerVisuals / DummySystem: directional walk/run,
 * scrubbed slide (Roll), and one-shot hit/death reactions.
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
  alignDummyDeathToShot,
  applyDummyCrouchScale,
  fadeDummyLoco,
  getDummyActions,
  playDummyDeath,
  playDummyHit,
  playDummyIdle,
  playSlideRoll,
  scrubSlideRoll,
} from '../character/dummyVisuals'
import {
  findClip,
  pickDirectionalRun,
  pickWalkAction,
  resolveLocoDir,
} from '../character/locomotion'
import { MOVE } from '../core/config'
import {
  sampleMeshFloorY,
  type MeshWorld,
} from '../maps/meshCollision'

type SnapshotSample = {
  /** Server timeline seconds (tick / tickRate). */
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

type RemoteEntry = {
  root: THREE.Group
  mixer: THREE.AnimationMixer | null
  samples: SnapshotSample[]
  /** Last known plant pose (held through death). */
  lastX: number
  lastY: number
  lastZ: number
  lastYaw: number
  wasAlive: boolean
}

/** Render remote ~3 ticks behind latest sample. */
const INTERP_DELAY_TICKS = 3

export class RemotePlayerSystem {
  private scene: THREE.Scene | null = null
  private template: THREE.Object3D | null = null
  private scale = 1
  private footY = 0
  private clips: THREE.AnimationClip[] = []
  private loading: Promise<void> | null = null
  private tickRate = 60
  private meshWorld: MeshWorld | null = null
  /** Visual lift so soles clear mesh floors / animation sink. */
  private readonly footLift = 0.03
  private readonly remotes = new Map<string, RemoteEntry>()

  /** Client map collision — used to plant feet (server is flat y=0 only). */
  setMeshWorld(meshWorld: MeshWorld | null) {
    this.meshWorld = meshWorld
  }

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
  pushSnapshot(
    id: string,
    snap: PlayerSnapshot,
    tick: number,
    tickRate = 60,
  ) {
    if (!this.scene || !this.template) return
    this.tickRate = tickRate
    let entry = this.remotes.get(id)
    if (!entry) {
      entry = this.spawn(id)
      this.remotes.set(id, entry)
    }
    const t = tick / tickRate
    // Ignore out-of-order / duplicate ticks
    const last = entry.samples[entry.samples.length - 1]
    if (last && t <= last.t) return

    entry.samples.push({
      t,
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
    const cutoff = t - 0.5
    while (entry.samples.length > 2 && entry.samples[0].t < cutoff) {
      entry.samples.shift()
    }
  }

  /** Play hit-react on a remote (non-lethal). */
  onHit(id: string) {
    const entry = this.remotes.get(id)
    if (!entry) return
    if ((entry.root.userData.animState as string) === 'death') return
    playDummyHit(entry.root)
  }

  /**
   * Play death reaction. Optional world-space shot direction aligns the fall
   * (same as DummySystem).
   */
  /** World root for a remote (pose at kill for silhouettes). */
  getRoot(id: string): THREE.Group | null {
    return this.remotes.get(id)?.root ?? null
  }

  /**
   * Face + nudge along the shot before freezing a kill ghost of the live pose.
   */
  alignDeath(
    id: string,
    shotDir: { x: number; y: number; z: number },
  ) {
    const entry = this.remotes.get(id)
    if (!entry) return
    alignDummyDeathToShot(entry.root, shotDir, {
      alignYaw: DUMMY.deathAlignToShot,
      knockback: DUMMY.deathKnockback,
    })
  }

  onDeath(
    id: string,
    shotDir?: { x: number; y: number; z: number },
  ) {
    const entry = this.remotes.get(id)
    if (!entry) return
    if (shotDir) {
      alignDummyDeathToShot(entry.root, shotDir, {
        alignYaw: DUMMY.deathAlignToShot,
        knockback: DUMMY.deathKnockback,
      })
    }
    playDummyDeath(entry.root)
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

  private spawn(_id: string): RemoteEntry {
    const root = new THREE.Group()
    const model = cloneSkinned(this.template!)
    model.scale.setScalar(this.scale)
    model.position.y = -this.footY * this.scale
    root.userData.baseScale = this.scale
    root.userData.footY = this.footY
    root.userData.model = model
    root.userData.isMan = true
    root.userData.locoState = 'idle'
    root.userData.animState = 'idle'
    root.userData.slideProgress = 0

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
    const hitClip = findClip(this.clips, 'HitRecieve')
    const hitClipAlt = findClip(this.clips, 'HitRecieve_2')
    const deathClip = findClip(this.clips, 'Death')

    if (idleClip) {
      mixer = new THREE.AnimationMixer(model)
      const mkLoop = (clip: THREE.AnimationClip | undefined) => {
        if (!clip) return null
        const a = mixer!.clipAction(clip)
        a.setLoop(THREE.LoopRepeat, Infinity)
        a.clampWhenFinished = false
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
      const hit = mkOnce(hitClip)
      const hitAlt =
        hitClipAlt != null && hitClipAlt !== hitClip
          ? mkOnce(hitClipAlt)
          : null
      const death = mkOnce(deathClip)
      root.userData.actions = {
        idle,
        walk: mkLoop(findClip(this.clips, 'Walk') ?? undefined),
        run: mkLoop(findClip(this.clips, 'Run') ?? undefined),
        runBack: mkLoop(findClip(this.clips, 'Run_Back') ?? undefined),
        runLeft: mkLoop(findClip(this.clips, 'Run_Left') ?? undefined),
        runRight: mkLoop(findClip(this.clips, 'Run_Right') ?? undefined),
        slide: mkOnce(findClip(this.clips, 'Roll') ?? undefined),
        hit,
        hitAlt,
        death,
      }

      // After hit one-shot, resume locomotion from current state.
      mixer.addEventListener('finished', (e) => {
        const action = e.action as THREE.AnimationAction
        const anim = root.userData.animState as string
        if (anim === 'hit' && (action === hit || action === hitAlt)) {
          root.userData.locoState = null
          root.userData.animState = 'idle'
        }
      })
    }

    root.visible = false
    this.scene!.add(root)
    return {
      root,
      mixer,
      samples: [],
      lastX: 0,
      lastY: 0,
      lastZ: 0,
      lastYaw: 0,
      wasAlive: true,
    }
  }

  update(dt: number) {
    const delay = INTERP_DELAY_TICKS / this.tickRate
    for (const [, entry] of this.remotes) {
      const { root, mixer, samples } = entry
      if (samples.length === 0) {
        root.visible = false
        continue
      }

      const latestT = samples[samples.length - 1].t
      const renderTime = latestT - delay

      let from = samples[0]
      let to = samples[samples.length - 1]
      let found = false
      for (let i = 0; i < samples.length - 1; i++) {
        if (samples[i].t <= renderTime && samples[i + 1].t >= renderTime) {
          from = samples[i]
          to = samples[i + 1]
          found = true
          break
        }
      }

      // Before first sample or between gaps: hold / extrapolate lightly
      if (!found) {
        if (renderTime <= samples[0].t) {
          from = to = samples[0]
        } else {
          // Past last sample — hold latest (no extrapolate jitter)
          from = to = samples[samples.length - 1]
        }
      }

      const span = Math.max(1e-4, to.t - from.t)
      const u =
        from === to ? 1 : Math.min(1, Math.max(0, (renderTime - from.t) / span))
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

      const anim = (root.userData.animState as string) || 'idle'
      const dying = anim === 'death'

      // Respawn: reset loco after death / hide
      if (alive && !entry.wasAlive) {
        playDummyIdle(root)
        root.userData.locoState = null
        root.userData.slideProgress = 0
      }
      entry.wasAlive = alive

      // Stay visible during death clip; hide when fully dead without reaction
      root.visible = alive || dying
      if (!alive && !dying) {
        mixer?.update(dt)
        continue
      }

      // Server stores client-validated Y. Only nudge to local mesh when a few
      // cm off — never snap onto a different floor/roof under their XZ.
      let plantY = y
      const meshY = sampleMeshFloorY(this.meshWorld, x, z, y + 1.5, 3)
      if (meshY != null && state !== 'jump' && alive) {
        const gap = y - meshY
        if (gap > -0.15 && gap < 0.35) plantY = meshY
      }

      if (alive) {
        entry.lastX = x
        entry.lastY = plantY
        entry.lastZ = z
        entry.lastYaw = yaw
        root.position.set(x, plantY + this.footLift, z)
        // Death may have re-yawed the body; only overwrite while alive
        if (anim !== 'death') {
          root.rotation.y = yaw + Math.PI
        }
        this.syncLoco(root, state, to.vx, to.vz, yaw, dt)
      } else {
        // Hold death pose at last plant; mixer advances Death clip
        root.position.set(
          entry.lastX,
          entry.lastY + this.footLift,
          entry.lastZ,
        )
      }

      mixer?.update(dt)
    }
  }

  private syncLoco(
    root: THREE.Group,
    state: MoveState,
    vx: number,
    vz: number,
    yaw: number,
    dt: number,
  ) {
    const actions = getDummyActions(root)
    if (!actions?.idle) return

    const anim = (root.userData.animState as string) || 'idle'
    // Don't interrupt hit/death one-shots with locomotion
    if (anim === 'hit' || anim === 'death') return

    let want: string = state
    if (want === 'jump') {
      const hsp = Math.hypot(vx, vz)
      if (hsp > MOVE.runSpeed * 0.72) want = 'run'
      else if (hsp > 0.4) want = 'walk'
      else want = 'idle'
    }

    // Direction from velocity relative to facing (no input keys on remotes)
    const dir = resolveLocoDir(
      0,
      0,
      vx,
      vz,
      yaw,
      want === 'idle' || want === 'slide',
    )
    const locoKey =
      want === 'idle' || want === 'slide' ? want : `${want}_${dir}`

    if (root.userData.locoState !== locoKey) {
      root.userData.locoState = locoKey
      root.userData.animState = want

      actions.hit?.stop()
      actions.hitAlt?.stop()
      actions.death?.stop()

      if (want === 'slide') {
        root.userData.slideProgress = 0
        if (actions.slide) {
          playSlideRoll(actions.slide, actions)
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

    // Map full Roll clip across slide duration (was stuck at mid-frame)
    if (want === 'slide' && actions.slide) {
      const progress = Math.min(
        1,
        (root.userData.slideProgress as number) + dt / MOVE.slideDuration,
      )
      root.userData.slideProgress = progress
      scrubSlideRoll(actions.slide, progress)
    }
  }

  ids(): string[] {
    return [...this.remotes.keys()]
  }
}
