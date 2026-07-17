/**
 * Tracer streaks + impact decal pool + kill ghost silhouettes.
 *
 * Normal shots: thin needle core + tight soft halo that fades out fast.
 * Killing shots: red streak + frozen red player silhouette that stay in the world.
 */
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

const MUZZLE_SKIP = 0.4
/** How long a non-kill tracer stays visible (seconds). */
const TRANSIENT_LIFE = 0.14
const TRANSIENT_POOL = 10
/** Max kill markers kept in the environment (oldest recycled). */
const KILL_POOL = 40
/** Max red kill silhouettes kept in the environment (oldest recycled). */
const GHOST_POOL = 24
/** Brief settle time before a kill tracer freezes as a permanent mark. */
const KILL_SETTLE = 0.2

/** Hairline radii (world units) — core is a needle, glow a thin bloom. */
const NORMAL_CORE_R = 0.0038
const NORMAL_GLOW_R = 0.011
const KILL_CORE_R = 0.0055
const KILL_GLOW_R = 0.016
/** Permanent kill marks stay readable but still thin. */
const KILL_SETTLED_CORE_R = 0.0042
const KILL_SETTLED_GLOW_R = 0.012

const NORMAL_CORE = 0xfff8e8
const NORMAL_GLOW = 0xffc45a
const KILL_CORE = 0xff2840
const KILL_GLOW = 0xff5a70
const KILL_FLASH = 0xfff0f4
const GHOST_COLOR = 0xff1a2e
const GHOST_OPACITY = 0.38

type TracerVisual = {
  group: THREE.Group
  core: THREE.Mesh
  glow: THREE.Mesh
  coreMat: THREE.MeshBasicMaterial
  glowMat: THREE.MeshBasicMaterial
  /** Remaining life; Infinity once a kill tracer has settled. */
  life: number
  maxLife: number
  isKill: boolean
  active: boolean
  /** World length used when re-scaling on settle. */
  length: number
}

type GhostSlot = {
  root: THREE.Group | null
}

export class CombatFx {
  private scene: THREE.Scene | null = null
  private impactPool: THREE.Mesh[] = []
  private transient: TracerVisual[] = []
  private kills: TracerVisual[] = []
  private killCursor = 0
  private ghosts: GhostSlot[] = []
  private ghostCursor = 0

  private readonly _from = new THREE.Vector3()
  private readonly _to = new THREE.Vector3()
  private readonly _mid = new THREE.Vector3()
  private readonly _dir = new THREE.Vector3()
  private readonly _up = new THREE.Vector3(0, 1, 0)
  private readonly _axis = new THREE.Vector3(1, 0, 0)
  private readonly _cA = new THREE.Color()
  private readonly _cB = new THREE.Color()

  build(scene: THREE.Scene) {
    this.scene = scene
    // Tiny additive pin — impact pops, doesn't blob over the scene.
    const geo = new THREE.SphereGeometry(0.028, 8, 8)
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffeeaa,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(geo, mat.clone())
      m.visible = false
      m.renderOrder = 3
      scene.add(m)
      this.impactPool.push(m)
    }

    for (let i = 0; i < TRANSIENT_POOL; i++) {
      this.transient.push(this.makeTracer(scene))
    }
    for (let i = 0; i < KILL_POOL; i++) {
      this.kills.push(this.makeTracer(scene))
    }
    for (let i = 0; i < GHOST_POOL; i++) {
      this.ghosts.push({ root: null })
    }
  }

  private makeTracer(scene: THREE.Scene): TracerVisual {
    const group = new THREE.Group()
    group.visible = false
    group.renderOrder = 2

    // Needle taper: slightly fuller near muzzle (bottom / -Y when aligned),
    // hairline tip toward the impact. Scaled to length / radius per shot.
    const coreGeo = new THREE.CylinderGeometry(0.35, 1, 1, 6, 1, true)
    const glowGeo = new THREE.CylinderGeometry(0.45, 1, 1, 8, 1, true)

    const coreMat = new THREE.MeshBasicMaterial({
      color: NORMAL_CORE,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const glowMat = new THREE.MeshBasicMaterial({
      color: NORMAL_GLOW,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })

    const core = new THREE.Mesh(coreGeo, coreMat)
    const glow = new THREE.Mesh(glowGeo, glowMat)
    core.frustumCulled = false
    glow.frustumCulled = false
    group.add(glow, core)
    scene.add(group)

    return {
      group,
      core,
      glow,
      coreMat,
      glowMat,
      life: 0,
      maxLife: 0,
      isKill: false,
      active: false,
      length: 0,
    }
  }

  /**
   * Spawn a shot streak from eye/muzzle toward the hit (or max range).
   * Pass `killed: true` to leave a permanent red mark in the world.
   */
  showTracer(
    from: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    opts: { killed?: boolean } = {},
  ) {
    const killed = opts.killed === true
    const slot = killed
      ? this.kills[this.killCursor++ % this.kills.length]!
      : (this.transient.find((t) => !t.active) ?? this.transient[0]!)

    this._from.set(
      from.x + dir.x * MUZZLE_SKIP,
      from.y + dir.y * MUZZLE_SKIP,
      from.z + dir.z * MUZZLE_SKIP,
    )
    this._to.set(to.x, to.y, to.z)
    this._dir.subVectors(this._to, this._from)
    const len = this._dir.length()
    if (len < 0.08) return

    this._dir.multiplyScalar(1 / len)
    this._mid.copy(this._from).addScaledVector(this._dir, len * 0.5)

    // Avoid NaN quaternion when shooting almost straight up/down.
    const align = this._up.dot(this._dir)
    if (Math.abs(align) > 0.999) {
      if (align < 0) {
        slot.group.quaternion.setFromAxisAngle(this._axis, Math.PI)
      } else {
        slot.group.quaternion.identity()
      }
    } else {
      slot.group.quaternion.setFromUnitVectors(this._up, this._dir)
    }

    slot.group.position.copy(this._mid)
    slot.length = len

    const coreR = killed ? KILL_CORE_R : NORMAL_CORE_R
    const glowR = killed ? KILL_GLOW_R : NORMAL_GLOW_R
    slot.core.scale.set(coreR, len, coreR)
    slot.glow.scale.set(glowR, len, glowR)

    slot.isKill = killed
    slot.active = true
    slot.group.visible = true

    if (killed) {
      // Hot white flash, then settle into a thin red world mark.
      slot.coreMat.color.setHex(KILL_FLASH)
      slot.glowMat.color.setHex(KILL_CORE)
      slot.coreMat.opacity = 1
      slot.glowMat.opacity = 0.32
      slot.life = KILL_SETTLE
      slot.maxLife = KILL_SETTLE
      slot.coreMat.blending = THREE.AdditiveBlending
      slot.glowMat.blending = THREE.AdditiveBlending
    } else {
      slot.coreMat.color.setHex(NORMAL_CORE)
      slot.glowMat.color.setHex(NORMAL_GLOW)
      slot.coreMat.opacity = 0.95
      slot.glowMat.opacity = 0.16
      slot.coreMat.blending = THREE.AdditiveBlending
      slot.glowMat.blending = THREE.AdditiveBlending
      slot.life = TRANSIENT_LIFE
      slot.maxLife = TRANSIENT_LIFE
    }
  }

  /**
   * Freeze a red ghost silhouette of the victim at the moment of death.
   * Pose is snapped from the live dummy; the ghost stays in the world.
   */
  spawnKillGhost(dummyRoot: THREE.Object3D) {
    if (!this.scene) return

    dummyRoot.updateWorldMatrix(true, true)

    const model =
      (dummyRoot.userData.model as THREE.Object3D | undefined) ?? dummyRoot

    // Clone skinned hierarchy so bones keep the live kill pose.
    const ghostModel = cloneSkinned(model)

    const ghostRoot = new THREE.Group()
    ghostRoot.name = 'killGhost'
    dummyRoot.getWorldPosition(ghostRoot.position)
    dummyRoot.getWorldQuaternion(ghostRoot.quaternion)
    // Dummy roots are usually unit scale; model carries body scale.
    ghostRoot.scale.set(1, 1, 1)

    // If we cloned the inner model, keep its local offset under the root.
    // If we fell back to the whole dummy root, drop non-body children later.
    if (model !== dummyRoot) {
      ghostModel.position.copy(model.position)
      ghostModel.quaternion.copy(model.quaternion)
      ghostModel.scale.copy(model.scale)
      ghostRoot.add(ghostModel)
    } else {
      // Placeholder: use the cloned root as the ghost body.
      ghostRoot.add(ghostModel)
      ghostModel.position.set(0, 0, 0)
      ghostModel.quaternion.identity()
      ghostModel.scale.set(1, 1, 1)
    }

    this.paintGhost(ghostRoot)

    // Recycle oldest slot so the range never fills unboundedly.
    const slot = this.ghosts[this.ghostCursor++ % this.ghosts.length]!
    if (slot.root) {
      this.disposeGhost(slot.root)
    }
    slot.root = ghostRoot
    this.scene.add(ghostRoot)

    // Ensure skinned meshes pick up the frozen bone pose immediately.
    ghostRoot.updateWorldMatrix(true, true)
    ghostRoot.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) {
        o.skeleton.update()
        o.computeBoundingSphere()
      }
    })
  }

  private paintGhost(root: THREE.Object3D) {
    root.traverse((o) => {
      // Strip labels / debug wires / hitscan proxies — silhouette only.
      if (o instanceof THREE.Sprite) {
        o.visible = false
        return
      }
      if (
        o.userData.hitProxy ||
        o.name.includes('_hitWire') ||
        o.name.endsWith('hitWire')
      ) {
        o.visible = false
        return
      }
      if (!(o instanceof THREE.Mesh)) return

      const mat = new THREE.MeshBasicMaterial({
        color: GHOST_COLOR,
        transparent: true,
        opacity: GHOST_OPACITY,
        depthWrite: false,
        // Slight additive so overlapping limbs read as a soft red ghost.
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      o.material = mat
      o.castShadow = false
      o.receiveShadow = false
      o.frustumCulled = false
      o.renderOrder = 1
    })
  }

  /** Drop a ghost and free only materials we created (geometry is shared). */
  private disposeGhost(root: THREE.Object3D) {
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const list = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of list) m.dispose()
    })
    root.removeFromParent()
  }

  showImpact(
    p: { x: number; y: number; z: number },
    kind: 'world' | 'body' | 'head' = 'world',
    killed = false,
  ) {
    const m = this.impactPool.find((x) => !x.visible) ?? this.impactPool[0]!
    m.position.set(p.x, p.y, p.z)
    m.visible = true
    const mat = m.material as THREE.MeshBasicMaterial
    if (killed) mat.color.setHex(0xff4466)
    else if (kind === 'head') mat.color.setHex(0xfff0a0)
    else if (kind === 'body') mat.color.setHex(0xffaa88)
    else mat.color.setHex(0xffe8a8)
    mat.opacity = killed ? 1 : 0.9
    // Small pin flash — head/kill slightly larger, world stays subtle.
    const s = killed ? 1.55 : kind === 'head' ? 1.25 : kind === 'body' ? 1.05 : 0.85
    m.scale.setScalar(s)
    window.setTimeout(
      () => {
        m.visible = false
        m.scale.setScalar(1)
        mat.opacity = 0.95
      },
      killed ? 260 : 140,
    )
  }

  update(dt: number) {
    for (const t of this.transient) {
      if (!t.active) continue
      t.life -= dt
      if (t.life <= 0) {
        t.active = false
        t.group.visible = false
        continue
      }
      // Snap-bright then crisp ease-out; glow dies slightly faster than core.
      const k = t.life / t.maxLife
      const a = k * k
      t.coreMat.opacity = 0.95 * a
      t.glowMat.opacity = 0.16 * a * a
    }

    for (const t of this.kills) {
      if (!t.active || t.life === Infinity) continue
      t.life -= dt
      if (t.life <= 0) {
        // Freeze as a permanent thin red mark in the environment.
        t.life = Infinity
        t.coreMat.color.setHex(KILL_CORE)
        t.glowMat.color.setHex(KILL_GLOW)
        t.coreMat.opacity = 0.62
        t.glowMat.opacity = 0.14
        t.core.scale.set(KILL_SETTLED_CORE_R, t.length, KILL_SETTLED_CORE_R)
        t.glow.scale.set(KILL_SETTLED_GLOW_R, t.length, KILL_SETTLED_GLOW_R)
        // Readable at range without additive blowout.
        t.coreMat.blending = THREE.NormalBlending
        t.glowMat.blending = THREE.NormalBlending
        continue
      }
      // Lerp flash → kill red while settling; slim slightly as it freezes.
      const k = 1 - t.life / t.maxLife
      t.coreMat.color.copy(this._cA.setHex(KILL_FLASH)).lerp(this._cB.setHex(KILL_CORE), k)
      t.glowMat.color.copy(this._cA.setHex(KILL_CORE)).lerp(this._cB.setHex(KILL_GLOW), k)
      t.coreMat.opacity = 1 - 0.28 * k
      t.glowMat.opacity = 0.32 - 0.14 * k
      const coreR = KILL_CORE_R + (KILL_SETTLED_CORE_R - KILL_CORE_R) * k
      const glowR = KILL_GLOW_R + (KILL_SETTLED_GLOW_R - KILL_GLOW_R) * k
      t.core.scale.set(coreR, t.length, coreR)
      t.glow.scale.set(glowR, t.length, glowR)
    }
  }
}
