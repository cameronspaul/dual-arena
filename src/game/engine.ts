import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { DEBUG, DUMMY, LOOK, SNIPER, VIEW_BOB, VIEWMODEL } from './config'
import { castHitscan } from './hitscan'
import { InputManager } from './input'
import { lookDirection } from './math'
import { createPlayer, eyePosition, stepPlayer } from './player'
import {
  applyRecoil,
  createSniper,
  effectiveLook,
  stepSniper,
  tryFire,
} from './sniper'
import type {
  HitEvent,
  HudSnapshot,
  PlayerBody,
  SniperState,
} from './types'
import {
  buildWorldColliders,
  createDummies,
  damageDummy,
  dummyHitboxes,
  queueRespawn,
  stepRespawns,
  type RespawnTimer,
} from './world'

export type HudListener = (hud: HudSnapshot) => void

export class GameEngine {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private input = new InputManager()
  private player: PlayerBody = createPlayer()
  private sniper: SniperState = createSniper()
  private colliders = buildWorldColliders()
  private dummies = createDummies()
  private respawns: RespawnTimer[] = []
  private running = false
  private raf = 0
  private lastTime = 0
  private container: HTMLElement
  private viewmodel: THREE.Group | null = null
  private bobPhase = 0
  private bobAmount = 0
  private landOffset = 0
  private wasGrounded = true
  /** Fall speed sampled before collision zeros velocity.y on land. */
  private prevVelY = 0
  private dummyMeshes = new Map<string, THREE.Group>()
  private dummyMixers = new Map<string, THREE.AnimationMixer>()
  /** World-space helpers matching dummyHitboxes (axis-aligned, not yawed). */
  private dummyHitboxHelpers = new Map<string, THREE.Group>()
  private impactPool: THREE.Mesh[] = []
  private tracer: THREE.Line | null = null
  private tracerTimer = 0
  private hudListeners = new Set<HudListener>()
  private lastHit: HitEvent | null = null
  private lastHitAge = 999
  private kills = 0
  private playerHp = 100
  private clock = new THREE.Clock()
  private coverMeshes: THREE.Mesh[] = []

  constructor(container: HTMLElement) {
    this.container = container
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x87a0b8)
    this.scene.fog = new THREE.Fog(0x87a0b8, 40, 90)

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
    this.buildImpacts()
    void this.loadViewmodel()
    void this.loadDummies()
    this.input.attach(this.renderer.domElement)

    window.addEventListener('resize', this.onResize)
  }

  onHud(fn: HudListener) {
    this.hudListeners.add(fn)
    return () => this.hudListeners.delete(fn)
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
    // lights
    const hemi = new THREE.HemisphereLight(0xb8d0e8, 0x3a3028, 0.85)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.1)
    sun.position.set(20, 30, 10)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 80
    sun.shadow.camera.left = -40
    sun.shadow.camera.right = 40
    sun.shadow.camera.top = 40
    sun.shadow.camera.bottom = -40
    this.scene.add(sun)

    // floor
    const floorGeo = new THREE.PlaneGeometry(80, 80)
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x5a6b4e,
      roughness: 0.95,
    })
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.scene.add(floor)

    // grid hint
    const grid = new THREE.GridHelper(48, 24, 0x3d4a38, 0x4a5840)
    grid.position.y = 0.01
    this.scene.add(grid)

    // cover boxes
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.85,
    })
    for (const b of [
      // mirror WORLD.coverBoxes dimensions via colliders already built
      ...this.colliders.map((c) => {
        const w = c.max.x - c.min.x
        const h = c.max.y - c.min.y
        const d = c.max.z - c.min.z
        return {
          x: (c.min.x + c.max.x) / 2,
          y: (c.min.y + c.max.y) / 2,
          z: (c.min.z + c.max.z) / 2,
          w,
          h,
          d,
        }
      }),
    ]) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(b.w, b.h, b.d),
        boxMat.clone(),
      )
      mesh.position.set(b.x, b.y, b.z)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.scene.add(mesh)
      this.coverMeshes.push(mesh)
    }

    // far backstop wall
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(30, 4, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x6a5a4a, roughness: 0.9 }),
    )
    wall.position.set(0, 2, -36)
    wall.castShadow = true
    wall.receiveShadow = true
    this.scene.add(wall)
    this.colliders.push({
      min: { x: -15, y: 0, z: -36.25 },
      max: { x: 15, y: 4, z: -35.75 },
    })

    // dummies loaded async from /models/man.glb (see loadDummies)

    // spawn pad
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 0.08, 24),
      new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.6 }),
    )
    pad.position.set(0, 0.04, 8)
    pad.receiveShadow = true
    this.scene.add(pad)
  }

  /** Procedural fallback if man.glb fails to load. */
  private makePlaceholderDummy(): THREE.Group {
    const g = new THREE.Group()
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xc45c26,
      roughness: 0.7,
    })
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xe8c4a0,
      roughness: 0.6,
    })
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(
        DUMMY.bodyHalfW * 2,
        DUMMY.bodyHeight,
        DUMMY.bodyHalfD * 2,
      ),
      bodyMat,
    )
    body.position.y = DUMMY.bodyOffsetY
    body.castShadow = true
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(DUMMY.headRadius, 12, 10),
      headMat,
    )
    head.position.y = DUMMY.headOffsetY
    head.castShadow = true
    const armGeo = new THREE.BoxGeometry(0.12, 0.55, 0.12)
    const left = new THREE.Mesh(armGeo, bodyMat)
    left.position.set(-0.4, 0.85, 0)
    const right = new THREE.Mesh(armGeo, bodyMat)
    right.position.set(0.4, 0.85, 0)
    g.add(body, head, left, right)
    g.userData.mats = [bodyMat, headMat]
    g.userData.baseColors = [bodyMat.color.clone(), headMat.color.clone()]
    return g
  }

  /**
   * Visualize hitscan volumes from dummyHitboxes:
   * - head: sphere at headOffsetY / headRadius
   * - body: AABB at bodyOffsetY (axis-aligned; not rotated by dummy yaw)
   */
  private makeHitboxHelper(): THREE.Group {
    const g = new THREE.Group()
    g.renderOrder = 20

    const bodyW = DUMMY.bodyHalfW * 2
    const bodyH = DUMMY.bodyHeight
    const bodyD = DUMMY.bodyHalfD * 2
    const bodyGeo = new THREE.BoxGeometry(bodyW, bodyH, bodyD)

    const bodyFill = new THREE.Mesh(
      bodyGeo,
      new THREE.MeshBasicMaterial({
        color: 0x33aaff,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    bodyFill.position.y = DUMMY.bodyOffsetY
    bodyFill.renderOrder = 20

    const bodyWire = new THREE.LineSegments(
      new THREE.EdgesGeometry(bodyGeo),
      new THREE.LineBasicMaterial({
        color: 0x66ccff,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
      }),
    )
    bodyWire.position.y = DUMMY.bodyOffsetY
    bodyWire.renderOrder = 21

    const headGeo = new THREE.SphereGeometry(DUMMY.headRadius, 16, 12)
    const headFill = new THREE.Mesh(
      headGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff3344,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    )
    headFill.position.y = DUMMY.headOffsetY
    headFill.renderOrder = 20

    const headWire = new THREE.LineSegments(
      new THREE.WireframeGeometry(headGeo),
      new THREE.LineBasicMaterial({
        color: 0xff8899,
        transparent: true,
        opacity: 0.75,
        depthTest: true,
      }),
    )
    headWire.position.y = DUMMY.headOffsetY
    headWire.renderOrder = 21

    g.add(bodyFill, bodyWire, headFill, headWire)
    return g
  }

  /** Match clip by exact name or trailing `|Name` (Quaternius-style). */
  private findClip(
    clips: THREE.AnimationClip[],
    ...names: string[]
  ): THREE.AnimationClip | undefined {
    for (const name of names) {
      const hit = clips.find(
        (c) => c.name === name || c.name.endsWith(`|${name}`),
      )
      if (hit) return hit
    }
    return undefined
  }

  /**
   * Load public/models/man.glb once, clone per dummy (with skeleton), play Idle.
   * Falls back to a low-poly placeholder if the asset is missing.
   */
  private async loadDummies() {
    type DummyFactory = (id: string) => THREE.Group

    let factory: DummyFactory

    try {
      const loader = new GLTFLoader()
      const gltf = await loader.loadAsync('/models/man.glb')
      const source = gltf.scene
      const clips = gltf.animations ?? []

      const idleClip =
        this.findClip(clips, 'Idle_Neutral', 'Idle') ?? clips[0]
      const hitClip = this.findClip(clips, 'HitRecieve')
      const hitClipAlt = this.findClip(clips, 'HitRecieve_2')
      const deathClip = this.findClip(clips, 'Death')

      const box = new THREE.Box3().setFromObject(source)
      const size = box.getSize(new THREE.Vector3())
      const targetHeight = DUMMY.headOffsetY + DUMMY.headRadius
      const scale = targetHeight / Math.max(size.y, 0.001)
      const footY = box.min.y

      factory = (id: string) => {
        const root = new THREE.Group()
        // SkeletonUtils preserves skinned meshes / bone bindings for animation
        const model = cloneSkinned(source)
        model.scale.setScalar(scale)
        model.position.y = -footY * scale

        const mats: THREE.Material[] = []
        const baseColors: THREE.Color[] = []
        model.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return
          o.castShadow = true
          o.receiveShadow = true
          o.frustumCulled = false
          const list = Array.isArray(o.material) ? o.material : [o.material]
          const cloned = list.map((m) => {
            const c = m.clone()
            if ('color' in c && c.color instanceof THREE.Color) {
              mats.push(c)
              baseColors.push(c.color.clone())
            }
            return c
          })
          o.material = Array.isArray(o.material) ? cloned : cloned[0]
        })

        root.add(model)
        root.userData.mats = mats
        root.userData.baseColors = baseColors
        root.userData.animState = 'idle'
        root.userData.wasAlive = true

        if (idleClip) {
          const mixer = new THREE.AnimationMixer(model)
          this.dummyMixers.set(id, mixer)

          const idle = mixer.clipAction(idleClip)
          idle.setLoop(THREE.LoopRepeat, Infinity)
          idle.clampWhenFinished = false
          // desync so they don't idle in perfect unison
          idle.time = Math.random() * idleClip.duration
          idle.play()

          const hit =
            hitClip != null ? mixer.clipAction(hitClip) : null
          const hitAlt =
            hitClipAlt != null && hitClipAlt !== hitClip
              ? mixer.clipAction(hitClipAlt)
              : null
          const death =
            deathClip != null ? mixer.clipAction(deathClip) : null

          if (hit) {
            hit.setLoop(THREE.LoopOnce, 1)
            hit.clampWhenFinished = true
          }
          if (hitAlt) {
            hitAlt.setLoop(THREE.LoopOnce, 1)
            hitAlt.clampWhenFinished = true
          }
          if (death) {
            death.setLoop(THREE.LoopOnce, 1)
            death.clampWhenFinished = true
          }

          root.userData.actions = { idle, hit, hitAlt, death }

          mixer.addEventListener('finished', (e) => {
            const action = e.action as THREE.AnimationAction
            const state = root.userData.animState as string
            if (state === 'hit' && (action === hit || action === hitAlt)) {
              this.playDummyIdle(root)
            }
            // death holds last frame until respawn
          })
        }

        return root
      }
    } catch (e) {
      console.warn('Dummy model load failed, using placeholder', e)
      factory = () => this.makePlaceholderDummy()
    }

    for (const d of this.dummies) {
      const g = factory(d.id)
      g.position.set(d.position.x, d.position.y, d.position.z)
      g.rotation.y = d.yaw
      this.scene.add(g)
      this.dummyMeshes.set(d.id, g)

      if (DEBUG.showHitboxes) {
        // World-aligned like dummyHitboxes — do not inherit dummy yaw
        const hb = this.makeHitboxHelper()
        hb.position.set(d.position.x, d.position.y, d.position.z)
        this.scene.add(hb)
        this.dummyHitboxHelpers.set(d.id, hb)
      }
    }
  }

  private playDummyIdle(root: THREE.Group) {
    const actions = root.userData.actions as
      | {
          idle: THREE.AnimationAction
          hit: THREE.AnimationAction | null
          hitAlt: THREE.AnimationAction | null
          death: THREE.AnimationAction | null
        }
      | undefined
    if (!actions?.idle) return
    root.userData.animState = 'idle'
    actions.hit?.stop()
    actions.hitAlt?.stop()
    actions.death?.stop()
    actions.idle.reset().fadeIn(0.2).play()
  }

  private playDummyHit(id: string) {
    const root = this.dummyMeshes.get(id)
    const actions = root?.userData.actions as
      | {
          idle: THREE.AnimationAction
          hit: THREE.AnimationAction | null
          hitAlt: THREE.AnimationAction | null
          death: THREE.AnimationAction | null
        }
      | undefined
    if (!root || !actions) return
    // don't interrupt death
    if (root.userData.animState === 'death') return

    const pick =
      actions.hit && actions.hitAlt
        ? Math.random() < 0.5
          ? actions.hit
          : actions.hitAlt
        : (actions.hit ?? actions.hitAlt)
    if (!pick) return

    root.userData.animState = 'hit'
    actions.idle.fadeOut(0.08)
    actions.death?.stop()
    actions.hit?.stop()
    actions.hitAlt?.stop()
    pick.reset().setEffectiveWeight(1).fadeIn(0.05).play()
  }

  private playDummyDeath(id: string) {
    const root = this.dummyMeshes.get(id)
    const actions = root?.userData.actions as
      | {
          idle: THREE.AnimationAction
          hit: THREE.AnimationAction | null
          hitAlt: THREE.AnimationAction | null
          death: THREE.AnimationAction | null
        }
      | undefined
    if (!root || !actions?.death) {
      if (root) root.userData.animState = 'death'
      return
    }
    root.userData.animState = 'death'
    actions.idle.fadeOut(0.08)
    actions.hit?.stop()
    actions.hitAlt?.stop()
    actions.death.reset().setEffectiveWeight(1).fadeIn(0.05).play()
  }

  private buildImpacts() {
    const geo = new THREE.SphereGeometry(0.06, 6, 6)
    const mat = new THREE.MeshBasicMaterial({ color: 0xffee88 })
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(geo, mat.clone())
      m.visible = false
      this.scene.add(m)
      this.impactPool.push(m)
    }
    const tGeo = new THREE.BufferGeometry()
    tGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3),
    )
    this.tracer = new THREE.Line(
      tGeo,
      new THREE.LineBasicMaterial({
        color: 0xfff0a0,
        transparent: true,
        opacity: 0.85,
      }),
    )
    this.tracer.visible = false
    this.scene.add(this.tracer)
  }

  private async loadViewmodel() {
    try {
      const loader = new GLTFLoader()
      const gltf = await loader.loadAsync('/models/sniper.glb')
      const model = gltf.scene
      model.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = false
          o.frustumCulled = false
        }
      })

      // Quaternius sniper: stock→barrel is already -Z, scope +Y (camera-forward).
      // Do NOT yaw 180° — that points the muzzle at the player.
      const { modelRot } = VIEWMODEL
      model.rotation.set(modelRot.x, modelRot.y, modelRot.z)
      model.updateMatrixWorld(true)

      // Normalize size, then center AABB so hip/ADS offsets use a stable pivot.
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z) || 1
      model.scale.setScalar(VIEWMODEL.scale / maxDim)
      model.updateMatrixWorld(true)
      box.setFromObject(model)
      model.position.sub(box.getCenter(new THREE.Vector3()))

      // Bias pivot slightly toward the grip so rotation feels hand-held.
      model.position.y += VIEWMODEL.scale * 0.02
      model.position.z += VIEWMODEL.scale * 0.08

      const root = new THREE.Group()
      root.add(model)
      const { hipPos, hipRot } = VIEWMODEL
      root.position.set(hipPos.x, hipPos.y, hipPos.z)
      root.rotation.set(hipRot.x, hipRot.y, hipRot.z)

      this.camera.add(root)
      this.scene.add(this.camera)
      this.viewmodel = root
    } catch (e) {
      console.warn('Viewmodel load failed, using placeholder', e)
      const root = new THREE.Group()
      const gun = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 0.7),
        new THREE.MeshStandardMaterial({ color: 0x2a2a2a }),
      )
      gun.position.set(0.22, -0.18, -0.4)
      root.add(gun)
      this.camera.add(root)
      this.scene.add(this.camera)
      this.viewmodel = root
    }
  }

  private loop = () => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    let dt = (now - this.lastTime) / 1000
    this.lastTime = now
    // clamp big hitches
    dt = Math.min(dt, 0.05)

    this.tick(dt)
    this.renderer.render(this.scene, this.camera)
  }

  private tick(dt: number) {
    const input = this.input.sample()
    this.input.setAdsBlend(this.sniper.adsBlend)

    this.prevVelY = this.player.velocity.y
    stepPlayer(this.player, input, dt, this.colliders)
    stepSniper(this.sniper, input, dt)
    stepRespawns(this.dummies, this.respawns, dt)

    if (tryFire(this.sniper, input)) {
      // Fire with current aim (sway / existing recoil), then kick for next frames.
      this.fireShot()
      applyRecoil(this.sniper)
    }

    // --- View bob (visual only; fireShot still uses true eyePosition) ---
    const p = this.player
    const speed = Math.hypot(p.velocity.x, p.velocity.z)
    const grounded = p.grounded

    if (grounded && !this.wasGrounded) {
      const impact = Math.max(0, -this.prevVelY)
      this.landOffset = Math.min(
        0.14,
        VIEW_BOB.landKick + impact * 0.012,
      )
    }
    this.wasGrounded = grounded
    this.landOffset *= Math.exp(-VIEW_BOB.landDecay * dt)

    let bobTarget = 0
    if (grounded && speed > VIEW_BOB.minSpeed) {
      bobTarget = Math.min(
        1,
        (speed - VIEW_BOB.minSpeed) /
          (VIEW_BOB.fullSpeed - VIEW_BOB.minSpeed),
      )
      if (p.state === 'crouch') bobTarget *= VIEW_BOB.crouchMul
      else if (p.state === 'slide') bobTarget *= VIEW_BOB.slideMul
    } else if (!grounded) {
      bobTarget = this.bobAmount * VIEW_BOB.airMul
    }
    bobTarget *= 1 - this.sniper.adsBlend * (1 - VIEW_BOB.adsMul)

    const bobK = 1 - Math.exp(-VIEW_BOB.amountLerp * dt)
    this.bobAmount += (bobTarget - this.bobAmount) * bobK

    if (grounded && speed > VIEW_BOB.minSpeed) {
      this.bobPhase +=
        VIEW_BOB.frequency * (speed / VIEW_BOB.freqSpeedRef) * dt
    }

    const bobA = this.bobAmount
    const s1 = Math.sin(this.bobPhase)
    const s2 = Math.sin(this.bobPhase * 2)
    const c2 = Math.cos(this.bobPhase * 2)
    const bobCamX = s1 * VIEW_BOB.camX * bobA
    const bobCamY = s2 * VIEW_BOB.camY * bobA
    const bobGunX = s1 * VIEW_BOB.gunX * bobA
    const bobGunY = s2 * VIEW_BOB.gunY * bobA
    const bobGunZ = c2 * VIEW_BOB.gunZ * bobA
    const bobGunPitch = c2 * VIEW_BOB.gunPitch * bobA
    const bobGunRoll = s1 * VIEW_BOB.gunRoll * bobA

    // Camera matches effective aim so crosshair, tracer, and hitscan agree.
    const eye = eyePosition(this.player)
    const look = effectiveLook(this.player, this.sniper)
    // Lateral bob along camera right; vertical bob + landing dip on eye height.
    const rightX = Math.cos(look.yaw)
    const rightZ = -Math.sin(look.yaw)
    this.camera.position.set(
      eye.x + rightX * bobCamX,
      eye.y + bobCamY - this.landOffset,
      eye.z + rightZ * bobCamX,
    )
    this.camera.rotation.y = look.yaw
    this.camera.rotation.x = look.pitch

    const fov = LOOK.hipFov + (LOOK.adsFov - LOOK.hipFov) * this.sniper.adsBlend
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }

    // viewmodel pose — hip sits lower-right; ADS pulls to center then hides for scope UI
    if (this.viewmodel) {
      const ads = this.sniper.adsBlend
      const { hipPos, hipRot, adsPos, adsRot, hideAds } = VIEWMODEL
      const hip = new THREE.Vector3(hipPos.x, hipPos.y, hipPos.z)
      const scoped = new THREE.Vector3(adsPos.x, adsPos.y, adsPos.z)
      this.viewmodel.position.lerpVectors(hip, scoped, ads)
      this.viewmodel.position.x += bobGunX
      this.viewmodel.position.y +=
        bobGunY - this.landOffset * VIEW_BOB.landGunMul
      this.viewmodel.position.z += bobGunZ
      this.viewmodel.rotation.set(
        hipRot.x * (1 - ads) +
          adsRot.x * ads +
          this.sniper.recoil * SNIPER.viewmodelRecoil +
          bobGunPitch,
        hipRot.y * (1 - ads) + adsRot.y * ads,
        hipRot.z * (1 - ads) + adsRot.z * ads + bobGunRoll,
      )
      this.viewmodel.visible = ads < hideAds
    }

    // dummy mixers + visuals
    for (const mixer of this.dummyMixers.values()) {
      mixer.update(dt)
    }

    for (const d of this.dummies) {
      const mesh = this.dummyMeshes.get(d.id)
      if (!mesh) continue

      const wasAlive = mesh.userData.wasAlive !== false
      if (d.alive && !wasAlive) {
        // respawned — back to idle, full color
        this.playDummyIdle(mesh)
        const bases = mesh.userData.baseColors as THREE.Color[] | undefined
        const mats = mesh.userData.mats as THREE.Material[] | undefined
        if (mats && bases) {
          for (let i = 0; i < mats.length; i++) {
            const mat = mats[i]
            const base = bases[i]
            if (base && 'color' in mat) {
              ;(mat as THREE.MeshStandardMaterial).color.copy(base)
            }
          }
        }
      }
      mesh.userData.wasAlive = d.alive

      // stay visible during death pose until respawn; hide only if no death anim
      const dying = !d.alive && mesh.userData.animState === 'death'
      mesh.visible = d.alive || dying

      const hb = this.dummyHitboxHelpers.get(d.id)
      if (hb) {
        hb.position.set(d.position.x, d.position.y, d.position.z)
        // Match combat: only living dummies contribute hitboxes
        hb.visible = d.alive
      }

      if (!d.alive) continue

      const hurt = d.hp / d.maxHp
      const mats = mesh.userData.mats as THREE.Material[] | undefined
      const bases = mesh.userData.baseColors as THREE.Color[] | undefined
      if (!mats || !bases) continue
      for (let i = 0; i < mats.length; i++) {
        const mat = mats[i]
        const base = bases[i]
        if (!base || !('color' in mat)) continue
        const c = (mat as THREE.MeshStandardMaterial).color
        c.setRGB(
          base.r * hurt + 0.2 * (1 - hurt),
          base.g * hurt,
          base.b * hurt,
        )
      }
    }

    // tracer fade
    if (this.tracer && this.tracerTimer > 0) {
      this.tracerTimer -= dt
      if (this.tracerTimer <= 0) this.tracer.visible = false
      else {
        const mat = this.tracer.material as THREE.LineBasicMaterial
        mat.opacity = Math.min(1, this.tracerTimer * 4) * 0.85
      }
    }

    this.lastHitAge += dt
    this.emitHud()
  }

  private fireShot() {
    const look = effectiveLook(this.player, this.sniper)
    const origin = eyePosition(this.player)
    const dir = lookDirection(look.yaw, look.pitch)
    const hit = castHitscan(
      origin,
      dir,
      dummyHitboxes(this.dummies),
      this.colliders,
    )

    const end = hit
      ? hit.point
      : {
          x: origin.x + dir.x * SNIPER.maxRange,
          y: origin.y + dir.y * SNIPER.maxRange,
          z: origin.z + dir.z * SNIPER.maxRange,
        }

    this.showTracer(origin, dir, end)
    if (hit) this.showImpact(hit.point)

    if (hit?.hitbox) {
      const zone = hit.hitbox.zone
      const dmg = zone === 'head' ? SNIPER.headDamage : SNIPER.bodyDamage
      const ownerId = hit.hitbox.ownerId
      const result = damageDummy(this.dummies, ownerId, dmg)
      this.lastHit = {
        targetId: ownerId,
        zone,
        damage: dmg,
        killed: result.killed,
        point: hit.point,
      }
      this.lastHitAge = 0
      if (result.killed) {
        this.kills += 1
        this.playDummyDeath(ownerId)
        queueRespawn(this.respawns, ownerId)
      } else if (result.hp > 0) {
        this.playDummyHit(ownerId)
      }
    }
  }

  private showTracer(
    from: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
  ) {
    if (!this.tracer) return
    const pos = this.tracer.geometry.attributes.position as THREE.BufferAttribute
    // Start slightly in front of the eye along the aim ray so the line
    // projects through screen center (not world-down offset which looks off-ADS).
    const start = 0.35
    pos.setXYZ(0, from.x + dir.x * start, from.y + dir.y * start, from.z + dir.z * start)
    pos.setXYZ(1, to.x, to.y, to.z)
    pos.needsUpdate = true
    this.tracer.visible = true
    this.tracerTimer = 0.12
  }

  private showImpact(p: { x: number; y: number; z: number }) {
    const m = this.impactPool.find((x) => !x.visible) ?? this.impactPool[0]
    m.position.set(p.x, p.y, p.z)
    m.visible = true
    const mat = m.material as THREE.MeshBasicMaterial
    mat.color.setHex(0xffee88)
    window.setTimeout(() => {
      m.visible = false
    }, 200)
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
      moveState: this.player.state,
      speed,
      pointerLocked: this.input.isPointerLocked(),
      kills: this.kills,
      lastHit: this.lastHit,
      lastHitAge: this.lastHitAge,
    }
    for (const fn of this.hudListeners) fn(snap)
  }
}
