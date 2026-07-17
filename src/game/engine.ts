import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DUMMY, LOOK, SNIPER } from './config'
import { castHitscan } from './hitscan'
import { InputManager } from './input'
import { lookDirection } from './math'
import { createPlayer, eyePosition, stepPlayer } from './player'
import {
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
  private dummyMeshes = new Map<string, THREE.Group>()
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

    // dummies as simple low-poly figures
    for (const d of this.dummies) {
      const g = this.makeDummyMesh()
      g.position.set(d.position.x, d.position.y, d.position.z)
      g.rotation.y = d.yaw
      this.scene.add(g)
      this.dummyMeshes.set(d.id, g)
    }

    // spawn pad
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 0.08, 24),
      new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.6 }),
    )
    pad.position.set(0, 0.04, 8)
    pad.receiveShadow = true
    this.scene.add(pad)
  }

  private makeDummyMesh(): THREE.Group {
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
    // simple arms
    const armGeo = new THREE.BoxGeometry(0.12, 0.55, 0.12)
    const left = new THREE.Mesh(armGeo, bodyMat)
    left.position.set(-0.4, 0.85, 0)
    const right = new THREE.Mesh(armGeo, bodyMat)
    right.position.set(0.4, 0.85, 0)
    g.add(body, head, left, right)
    g.userData.bodyMat = bodyMat
    g.userData.headMat = headMat
    return g
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
      // normalize scale
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z) || 1
      const scale = 0.55 / maxDim
      model.scale.setScalar(scale)

      const root = new THREE.Group()
      root.add(model)
      // hip offset (right-hand viewmodel)
      root.position.set(0.28, -0.28, -0.55)
      root.rotation.set(0.05, 0.15, 0.02)
      model.position.set(0, 0, 0)
      model.rotation.set(0, Math.PI, 0)

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
      gun.position.set(0.25, -0.2, -0.4)
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

    stepPlayer(this.player, input, dt, this.colliders)
    stepSniper(this.sniper, input, dt)
    stepRespawns(this.dummies, this.respawns, dt)

    if (tryFire(this.sniper, input)) {
      this.fireShot()
    }

    // camera
    const eye = eyePosition(this.player)
    this.camera.position.set(eye.x, eye.y, eye.z)
    this.camera.rotation.y = this.player.yaw
    this.camera.rotation.x = this.player.pitch

    const fov = LOOK.hipFov + (LOOK.adsFov - LOOK.hipFov) * this.sniper.adsBlend
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }

    // viewmodel pose
    if (this.viewmodel) {
      const ads = this.sniper.adsBlend
      const hip = new THREE.Vector3(0.28, -0.28, -0.55)
      const scoped = new THREE.Vector3(0.0, -0.22, -0.35)
      this.viewmodel.position.lerpVectors(hip, scoped, ads)
      this.viewmodel.rotation.set(
        0.05 - ads * 0.04 + this.sniper.recoil * SNIPER.viewmodelRecoil,
        0.15 * (1 - ads),
        0.02 * (1 - ads),
      )
      // hide gun when fully scoped (scope overlay in HUD)
      this.viewmodel.visible = ads < 0.92
    }

    // dummy visuals
    for (const d of this.dummies) {
      const mesh = this.dummyMeshes.get(d.id)
      if (!mesh) continue
      mesh.visible = d.alive
      if (d.alive) {
        const hurt = d.hp / d.maxHp
        const bodyMat = mesh.userData.bodyMat as THREE.MeshStandardMaterial
        bodyMat.color.setRGB(0.77 * hurt + 0.2, 0.36 * hurt, 0.15 * hurt)
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

    this.showTracer(origin, end)
    if (hit) this.showImpact(hit.point)

    if (hit?.hitbox) {
      const zone = hit.hitbox.zone
      const dmg = zone === 'head' ? SNIPER.headDamage : SNIPER.bodyDamage
      const result = damageDummy(this.dummies, hit.hitbox.ownerId, dmg)
      this.lastHit = {
        targetId: hit.hitbox.ownerId,
        zone,
        damage: dmg,
        killed: result.killed,
        point: hit.point,
      }
      this.lastHitAge = 0
      if (result.killed) {
        this.kills += 1
        queueRespawn(this.respawns, hit.hitbox.ownerId)
      }
    }
  }

  private showTracer(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) {
    if (!this.tracer) return
    const pos = this.tracer.geometry.attributes.position as THREE.BufferAttribute
    // slight offset from camera so it doesn't clip
    pos.setXYZ(0, from.x, from.y - 0.05, from.z)
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
