import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import {
  DEBUG,
  DUMMY,
  GUN_SWAY,
  LOOK,
  SLIDE_GUN,
  SNIPER,
  VIEW_BOB,
  VIEWMODEL,
} from './config'
import { castHitscan } from './hitscan'
import { InputManager } from './input'
import { spreadLookDirection } from './math'
import {
  createPlayer,
  eyePosition,
  stepPlayer,
} from './player'
import {
  aimSpread,
  applyRecoil,
  createSniper,
  effectiveLook,
  stepSniper,
  tryFire,
} from './sniper'
import type {
  HitEvent,
  HitZone,
  HudSnapshot,
  PlayerBody,
  RayHit,
  SniperState,
} from './types'
import {
  cloneViewmodelConfig,
  normalizeViewmodelConfig,
  type FingerId,
  type ViewmodelConfig,
} from './viewmodelConfig'
import {
  buildWorldColliders,
  createDummies,
  damageDummy,
  queueRespawn,
  stepDummies,
  stepRespawns,
  type RespawnTimer,
} from './world'

type ArmLimbKey = 'shoulder' | 'bicep' | 'forearm' | 'wrist'

type DummyActions = {
  idle: THREE.AnimationAction
  walk: THREE.AnimationAction | null
  run: THREE.AnimationAction | null
  slide: THREE.AnimationAction | null
  hit: THREE.AnimationAction | null
  hitAlt: THREE.AnimationAction | null
  death: THREE.AnimationAction | null
}

type ArmBoneRest = {
  bone: THREE.Object3D
  pos: THREE.Vector3
  quat: THREE.Quaternion
  scale: THREE.Vector3
}

type ArmSideBones = {
  limb: Record<ArmLimbKey, ArmBoneRest | null>
  fingers: Record<
    FingerId,
    [ArmBoneRest | null, ArmBoneRest | null, ArmBoneRest | null]
  >
}

function emptyArmSideBones(): ArmSideBones {
  return {
    limb: {
      shoulder: null,
      bicep: null,
      forearm: null,
      wrist: null,
    },
    fingers: {
      thumb: [null, null, null],
      index: [null, null, null],
      middle: [null, null, null],
      ring: [null, null, null],
      pinky: [null, null, null],
    },
  }
}

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
  /** Full FPS viewmodel (sniper_animated.glb — arms + gun). */
  private vmGun: THREE.Object3D | null = null
  private armBonesL: ArmSideBones = emptyArmSideBones()
  private armBonesR: ArmSideBones = emptyArmSideBones()
  /** Uniform scale that makes longest axis = 1 (before target scale). */
  private gunUnitScale = 1
  /** Center offset captured after unit normalize (position before gunOffset). */
  private gunCenter = new THREE.Vector3()
  private vmConfig: ViewmodelConfig = cloneViewmodelConfig(
    VIEWMODEL as unknown as ViewmodelConfig,
  )
  private vmReady = false
  private vmEditorActive = false
  /** null = live ADS from input; otherwise force hip(0)…ads(1). */
  private vmForceAds: number | null = null
  private vmFreezeBob = false
  private vmKeepVisible = false
  /** Editor-only: collapse the other arm while posing one side. */
  private vmArmSolo: 'both' | 'left' | 'right' = 'both'
  /** Animation mixer for sniper_animated.glb */
  private vmMixer: THREE.AnimationMixer | null = null
  private vmActions: {
    fire: THREE.AnimationAction | null
    bolt: THREE.AnimationAction | null
    reload: THREE.AnimationAction | null
    ready: THREE.AnimationAction | null
  } = { fire: null, bolt: null, reload: null, ready: null }
  private vmAnimPhase: string | null = null
  private vmCurrentAction: THREE.AnimationAction | null = null
  private bobPhase = 0
  private bobAmount = 0
  private gunSwayTime = 0
  /** 0..1 smoothed Apex-style slide cant for the viewmodel */
  private slideGunBlend = 0
  /** Viewmodel land dip (positive = down). Spring-integrated, never snapped. */
  private landOffset = 0
  /** Rate of landOffset — impulse on impact, spring-damped toward rest. */
  private landVel = 0
  /**
   * Viewmodel float while airborne (positive = up). Smoothed toward a
   * fall-speed target so the gun lifts in freefall and eases down on land.
   */
  private airRise = 0
  private wasGrounded = true
  /** Fall speed sampled before collision zeros velocity.y on land. */
  private prevVelY = 0
  private dummyMeshes = new Map<string, THREE.Group>()
  private dummyMixers = new Map<string, THREE.AnimationMixer>()
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
  private floorMat: THREE.MeshStandardMaterial | null = null
  private coverMat: THREE.MeshStandardMaterial | null = null
  private envTextures: THREE.Texture[] = []
  /** Hitscan against the real skinned character meshes. */
  private readonly _raycaster = new THREE.Raycaster()
  private readonly _rayOrigin = new THREE.Vector3()
  private readonly _rayDir = new THREE.Vector3()

  constructor(container: HTMLElement) {
    this.container = container
    this.scene = new THREE.Scene()
    // Solid fallback until Kenney equirect sky loads
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
    this.buildImpacts()
    void this.loadEnvironment()
    // Never draw pose hitboxes on the local FP player — they sit in camera
    // space and block the view. DEBUG.showHitboxes only applies to dummies.
    void this.loadViewmodel()
    void this.loadDummies()
    this.input.attach(this.renderer.domElement)

    window.addEventListener('resize', this.onResize)
  }

  onHud(fn: HudListener) {
    this.hudListeners.add(fn)
    return () => this.hudListeners.delete(fn)
  }

  isViewmodelReady() {
    return this.vmReady
  }

  getViewmodelConfig(): ViewmodelConfig {
    return cloneViewmodelConfig(this.vmConfig)
  }

  /**
   * Apply a full or partial config from the editor. Recomputes gun/arms transforms.
   * Pass `replace: true` when importing a full JSON file.
   */
  setViewmodelConfig(partial: unknown, replace = false) {
    if (replace) {
      this.vmConfig = normalizeViewmodelConfig(partial)
    } else {
      // Merge via normalize of current + shallow top-level overrides
      this.vmConfig = normalizeViewmodelConfig({
        ...this.vmConfig,
        ...(partial as object),
        arms: {
          ...this.vmConfig.arms,
          ...((partial as ViewmodelConfig)?.arms ?? {}),
        },
      })
    }
    this.applyViewmodelParts()
  }

  resetViewmodelConfig() {
    this.vmConfig = cloneViewmodelConfig(
      VIEWMODEL as unknown as ViewmodelConfig,
    )
    this.applyViewmodelParts()
  }

  setViewmodelEditorActive(active: boolean) {
    this.vmEditorActive = active
    this.input.setGameplayEnabled(!active)
    if (!active) {
      this.vmForceAds = null
      this.vmFreezeBob = false
      this.vmKeepVisible = false
      this.vmArmSolo = 'both'
      this.applyViewmodelParts()
    }
  }

  /** Solo one arm while editing (collapses the other via bone scale). */
  setViewmodelArmSolo(solo: 'both' | 'left' | 'right') {
    this.vmArmSolo = solo
    this.applyViewmodelParts()
  }

  getViewmodelArmSolo() {
    return this.vmArmSolo
  }

  hasArmBones() {
    return !!(this.armBonesL.limb.shoulder || this.armBonesR.limb.shoulder)
  }

  hasHandBones() {
    return !!(this.armBonesL.limb.wrist || this.armBonesR.limb.wrist)
  }

  isViewmodelEditorActive() {
    return this.vmEditorActive
  }

  setViewmodelForceAds(value: number | null) {
    this.vmForceAds = value
  }

  getViewmodelForceAds() {
    return this.vmForceAds
  }

  setViewmodelFreezeBob(freeze: boolean) {
    this.vmFreezeBob = freeze
  }

  getViewmodelFreezeBob() {
    return this.vmFreezeBob
  }

  setViewmodelKeepVisible(keep: boolean) {
    this.vmKeepVisible = keep
  }

  getViewmodelKeepVisible() {
    return this.vmKeepVisible
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
    // lights
    const hemi = new THREE.HemisphereLight(0xb8d0e8, 0x3a3028, 0.85)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.15)
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

    // floor — prototype grid map applied in loadEnvironment()
    this.floorMat = new THREE.MeshStandardMaterial({
      color: 0x6a6a6a,
      roughness: 0.92,
      metalness: 0.05,
    })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), this.floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.scene.add(floor)

    // cover boxes — checker map applied in loadEnvironment()
    this.coverMat = new THREE.MeshStandardMaterial({
      color: 0x8a8a8a,
      roughness: 0.88,
      metalness: 0.05,
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
        this.coverMat,
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
      this.coverMat,
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

  /**
   * Kenney CC0 sky (equirect) + prototype floor/cover textures.
   * Falls back silently to solid materials if assets fail to load.
   */
  private async loadEnvironment() {
    const loader = new THREE.TextureLoader()

    const loadTex = (url: string) =>
      new Promise<THREE.Texture>((resolve, reject) => {
        loader.load(url, resolve, undefined, reject)
      })

    try {
      const sky = await loadTex('/env/skyboxes/skybox-day.png')
      sky.mapping = THREE.EquirectangularReflectionMapping
      sky.colorSpace = THREE.SRGBColorSpace
      this.scene.background = sky
      this.envTextures.push(sky)
    } catch {
      // keep solid background
    }

    try {
      const floorMap = await loadTex('/env/floor/grid.png')
      floorMap.wrapS = THREE.RepeatWrapping
      floorMap.wrapT = THREE.RepeatWrapping
      floorMap.repeat.set(20, 20)
      floorMap.anisotropy = Math.min(
        8,
        this.renderer.capabilities.getMaxAnisotropy(),
      )
      floorMap.colorSpace = THREE.SRGBColorSpace
      if (this.floorMat) {
        this.floorMat.map = floorMap
        this.floorMat.color.set(0xffffff)
        this.floorMat.needsUpdate = true
      }
      this.envTextures.push(floorMap)
    } catch {
      // keep solid floor
    }

    try {
      const coverMap = await loadTex('/env/floor/check.png')
      coverMap.wrapS = THREE.RepeatWrapping
      coverMap.wrapT = THREE.RepeatWrapping
      coverMap.repeat.set(2, 2)
      coverMap.colorSpace = THREE.SRGBColorSpace
      if (this.coverMat) {
        this.coverMat.map = coverMap
        this.coverMat.color.set(0xffffff)
        this.coverMat.needsUpdate = true
      }
      this.envTextures.push(coverMap)
    } catch {
      // keep solid cover
    }
  }

  /** Procedural fallback if man.glb fails to load. */
  private makePlaceholderDummy(ownerId: string): THREE.Group {
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
    body.name = 'Body'
    body.position.y = DUMMY.bodyOffsetY
    body.castShadow = true
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(DUMMY.headRadius, 12, 10),
      headMat,
    )
    head.name = 'Head'
    head.position.y = DUMMY.headOffsetY
    head.castShadow = true
    const armGeo = new THREE.BoxGeometry(0.12, 0.55, 0.12)
    const left = new THREE.Mesh(armGeo, bodyMat.clone())
    left.name = 'ArmL'
    left.position.set(-0.4, 0.85, 0)
    const right = new THREE.Mesh(armGeo, bodyMat.clone())
    right.name = 'ArmR'
    right.position.set(0.4, 0.85, 0)
    g.add(body, head, left, right)
    this.registerHitMeshes(g, ownerId)
    return g
  }

  /**
   * Mesh name → zone.
   * Head / legs / arms are exclusive (like Suit_Legs vs Suit_Body).
   * Arms never share the cyan chest wireframe.
   */
  private meshNameToZone(name: string): HitZone {
    if (/head/i.test(name)) return 'head'
    if (/leg|feet|foot/i.test(name)) return 'leg'
    // Arm / hand / wrist / finger (shoulders count as chest)
    if (/arm|hand|wrist|finger/i.test(name)) return 'arm'
    return 'chest'
  }

  /** Debug wireframe: head red · chest cyan · arms orange · legs yellow */
  private zoneWireColor(zone: HitZone): number {
    if (zone === 'head') return 0xff4466
    if (zone === 'leg') return 0xffee44
    if (zone === 'arm') return 0xff8800
    return 0x44ccff
  }

  private damageForZone(zone: HitZone): number {
    if (zone === 'head') return SNIPER.headDamage
    if (zone === 'leg') return SNIPER.legDamage
    if (zone === 'arm') return SNIPER.armDamage
    return SNIPER.chestDamage
  }

  /**
   * Tag every drawable mesh as a hitscan surface.
   * Also builds a skinned wireframe overlay so debug can show hit zones
   * on top of the real textured skin.
   */
  private registerHitMeshes(root: THREE.Group, ownerId: string) {
    const hitMeshes: THREE.Mesh[] = []
    const wireOverlays: THREE.Mesh[] = []

    // Collect first — overlays parented mid-traverse would re-enter traverse
    const candidates: THREE.Mesh[] = []
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      if (o.userData.skipHitbox) return
      candidates.push(o)
    })

    for (const o of candidates) {
      const zone = this.meshNameToZone(o.name)
      o.userData.hitZone = zone
      o.userData.ownerId = ownerId

      const list = Array.isArray(o.material) ? o.material : [o.material]
      const baseColors: THREE.Color[] = []
      for (const m of list) {
        if ('color' in m && m.color instanceof THREE.Color) {
          baseColors.push(m.color.clone())
        } else {
          baseColors.push(new THREE.Color(0xffffff))
        }
      }
      o.userData.baseColors = baseColors
      hitMeshes.push(o)

      // Wireframe twin: same geo (+ skeleton) so debug outlines track the pose
      const wireMat = new THREE.MeshBasicMaterial({
        color: this.zoneWireColor(zone),
        wireframe: true,
        transparent: true,
        opacity: zone === 'head' ? 0.95 : 0.85,
        depthTest: true,
        depthWrite: false,
      })
      let wire: THREE.Mesh
      if (o instanceof THREE.SkinnedMesh) {
        const sk = new THREE.SkinnedMesh(o.geometry, wireMat)
        sk.bind(o.skeleton, o.bindMatrix)
        sk.bindMode = o.bindMode
        wire = sk
      } else {
        wire = new THREE.Mesh(o.geometry, wireMat)
      }
      wire.name = `${o.name || 'mesh'}_hitWire`
      wire.userData.skipHitbox = true
      wire.renderOrder = 20
      wire.frustumCulled = false
      wire.castShadow = false
      wire.receiveShadow = false
      wire.visible = DEBUG.showHitboxes
      // Identity local — parented to the skinned mesh so TRS matches
      o.add(wire)
      wireOverlays.push(wire)
    }

    root.userData.hitMeshes = hitMeshes
    root.userData.hitWireOverlays = wireOverlays
    // Skin paint targets (may diverge from hitMeshes after arm/chest split)
    root.userData.paintMeshes = [...hitMeshes]
  }

  /**
   * Bones that count as arm surface for weight splits.
   * Shoulders stay chest — they bleed into pecs/collar and made orange spill onto torso.
   */
  private isArmBoneName(name: string): boolean {
    if (/shoulder/i.test(name)) return false
    return /upperarm|lowerarm|forearm|wrist|hand|thumb|index|middle|ring|pinky|finger/i.test(
      name,
    )
  }

  /**
   * man.glb skins arms into Suit_Body (no separate arm mesh like Suit_Legs).
   * Split each chest skinned mesh by arm bone weights into arm + torso
   * geometries so orange/cyan wireframes sit on the real asset triangles —
   * same style as head (red) and legs (yellow).
   */
  private splitChestMeshesByArmWeights(root: THREE.Group, ownerId: string) {
    const hitMeshes = root.userData.hitMeshes as THREE.Mesh[] | undefined
    const wireOverlays = root.userData.hitWireOverlays as THREE.Mesh[] | undefined
    if (!hitMeshes || !wireOverlays) return

    const toSplit: THREE.SkinnedMesh[] = []
    for (const m of hitMeshes) {
      if (!(m instanceof THREE.SkinnedMesh)) continue
      if ((m.userData.hitZone as HitZone) !== 'chest') continue
      if (!m.skeleton || !m.geometry.getAttribute('skinIndex')) continue
      toSplit.push(m)
    }
    if (toSplit.length === 0) return

    const nextHits: THREE.Mesh[] = []
    const nextWires: THREE.Mesh[] = []

    // Keep non-chest meshes as-is
    for (let i = 0; i < hitMeshes.length; i++) {
      const m = hitMeshes[i]
      if (!toSplit.includes(m as THREE.SkinnedMesh)) {
        nextHits.push(m)
        if (wireOverlays[i]) nextWires.push(wireOverlays[i])
      }
    }

    for (const mesh of toSplit) {
      const split = this.splitSkinnedGeometryByArmBones(mesh)
      // Hide the full-body cyan wire (would paint arms blue)
      const wi = hitMeshes.indexOf(mesh)
      if (wi >= 0 && wireOverlays[wi]) {
        wireOverlays[wi].visible = false
        wireOverlays[wi].userData.skipHitbox = true
      }

      if (!split) {
        // No arm weights — keep whole mesh as chest
        nextHits.push(mesh)
        if (wi >= 0 && wireOverlays[wi]) {
          wireOverlays[wi].visible = DEBUG.showHitboxes
          nextWires.push(wireOverlays[wi])
        }
        continue
      }

      // Original stays for textured skin + damage tint only (not hitscan)
      mesh.userData.hitZone = undefined

      if (split.arm) {
        const armProxy = this.makeZoneProxyMesh(
          mesh,
          split.arm,
          'arm',
          `${mesh.name || 'Body'}_Arm`,
          ownerId,
        )
        nextHits.push(armProxy.hit)
        nextWires.push(armProxy.wire)
      }
      if (split.torso) {
        const chestProxy = this.makeZoneProxyMesh(
          mesh,
          split.torso,
          'chest',
          `${mesh.name || 'Body'}_Chest`,
          ownerId,
        )
        nextHits.push(chestProxy.hit)
        nextWires.push(chestProxy.wire)
      }
    }

    root.userData.hitMeshes = nextHits
    root.userData.hitWireOverlays = nextWires
  }

  /**
   * Partition skinned triangles: verts weighted to arm bones → arm,
   * remaining → torso. Shares original attributes; only the index buffer
   * differs so skinning still tracks the live pose.
   */
  private splitSkinnedGeometryByArmBones(
    mesh: THREE.SkinnedMesh,
  ): { arm: THREE.BufferGeometry | null; torso: THREE.BufferGeometry | null } | null {
    const skel = mesh.skeleton
    const geo = mesh.geometry
    const skinIndex = geo.getAttribute('skinIndex') as THREE.BufferAttribute | null
    const skinWeight = geo.getAttribute('skinWeight') as THREE.BufferAttribute | null
    if (!skel || !skinIndex || !skinWeight) return null

    const armBoneIdx = new Set<number>()
    for (let i = 0; i < skel.bones.length; i++) {
      if (this.isArmBoneName(skel.bones[i].name)) armBoneIdx.add(i)
    }
    if (armBoneIdx.size === 0) return null

    const vCount = skinIndex.count
    const isArmVert = new Uint8Array(vCount)
    for (let i = 0; i < vCount; i++) {
      let armW = 0
      let otherW = 0
      for (let j = 0; j < 4; j++) {
        const bi = skinIndex.getComponent(i, j)
        const bw = skinWeight.getComponent(i, j)
        if (armBoneIdx.has(bi)) armW += bw
        else otherW += bw
      }
      // Strict: mostly limb influence, not chest/shoulder bleed
      isArmVert[i] = armW >= 0.55 && armW > otherW ? 1 : 0
    }

    const index = geo.index
    const armIdx: number[] = []
    const torsoIdx: number[] = []

    // All 3 verts must be arm — stops orange fringe on collar / chest
    const armVotesNeeded = 3

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i)
        const b = index.getX(i + 1)
        const c = index.getX(i + 2)
        const votes = isArmVert[a] + isArmVert[b] + isArmVert[c]
        if (votes >= armVotesNeeded) {
          armIdx.push(a, b, c)
        } else {
          torsoIdx.push(a, b, c)
        }
      }
    } else {
      for (let i = 0; i < vCount; i += 3) {
        const votes = isArmVert[i] + isArmVert[i + 1] + isArmVert[i + 2]
        if (votes >= armVotesNeeded) {
          armIdx.push(i, i + 1, i + 2)
        } else {
          torsoIdx.push(i, i + 1, i + 2)
        }
      }
    }

    if (armIdx.length === 0 && torsoIdx.length === 0) return null

    const make = (indices: number[]) => {
      if (indices.length === 0) return null
      // Share vertex attributes with the source so we don't duplicate buffers;
      // only the face list differs.
      const g = new THREE.BufferGeometry()
      for (const name of Object.keys(geo.attributes)) {
        g.setAttribute(name, geo.getAttribute(name))
      }
      if (geo.morphAttributes) {
        g.morphAttributes = geo.morphAttributes
        g.morphTargetsRelative = geo.morphTargetsRelative
      }
      g.setIndex(indices)
      g.boundingSphere = geo.boundingSphere?.clone() ?? null
      g.boundingBox = geo.boundingBox?.clone() ?? null
      return g
    }

    return { arm: make(armIdx), torso: make(torsoIdx) }
  }

  /**
   * Invisible skinned hit surface + colored wireframe overlay that tracks
   * the same skeleton as the source mesh (sits on the asset like head/legs).
   */
  private makeZoneProxyMesh(
    source: THREE.SkinnedMesh,
    geometry: THREE.BufferGeometry,
    zone: HitZone,
    name: string,
    ownerId: string,
  ): { hit: THREE.SkinnedMesh; wire: THREE.Mesh } {
    const hitMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const hit = new THREE.SkinnedMesh(geometry, hitMat)
    hit.name = name
    hit.frustumCulled = false
    hit.castShadow = false
    hit.receiveShadow = false
    hit.bind(source.skeleton, source.bindMatrix)
    hit.bindMode = source.bindMode
    hit.userData.hitZone = zone
    hit.userData.ownerId = ownerId
    hit.userData.hitProxy = true
    // Match source local transform (usually identity under the model root)
    hit.position.copy(source.position)
    hit.quaternion.copy(source.quaternion)
    hit.scale.copy(source.scale)

    const wireMat = new THREE.MeshBasicMaterial({
      color: this.zoneWireColor(zone),
      wireframe: true,
      transparent: true,
      opacity: zone === 'arm' ? 0.95 : 0.85,
      depthTest: true,
      depthWrite: false,
    })
    const wire = new THREE.SkinnedMesh(geometry, wireMat)
    wire.name = `${name}_hitWire`
    wire.bind(source.skeleton, source.bindMatrix)
    wire.bindMode = source.bindMode
    wire.userData.skipHitbox = true
    wire.renderOrder = 20
    wire.frustumCulled = false
    wire.castShadow = false
    wire.receiveShadow = false
    wire.visible = DEBUG.showHitboxes
    hit.add(wire)

    const parent = source.parent
    if (parent) parent.add(hit)
    else source.add(hit)

    return { hit, wire }
  }

  /**
   * Damage tint on the real skin materials + toggle zone wireframe overlays.
   * Skin always stays visible; debug only adds the outline layer.
   */
  private paintDummyMeshes(root: THREE.Group, hpRatio: number) {
    const paintMeshes =
      (root.userData.paintMeshes as THREE.Mesh[] | undefined) ??
      (root.userData.hitMeshes as THREE.Mesh[] | undefined)
    if (!paintMeshes) return
    const hurt = Math.max(0, Math.min(1, hpRatio))
    const debug = DEBUG.showHitboxes

    for (const mesh of paintMeshes) {
      if (mesh.userData.hitProxy) continue
      const bases = mesh.userData.baseColors as THREE.Color[] | undefined
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (let i = 0; i < list.length; i++) {
        const mat = list[i]
        if (!('color' in mat) || !(mat.color instanceof THREE.Color)) continue
        // Never force wireframe on the skin — overlays handle debug outlines
        if ('wireframe' in mat) {
          ;(mat as THREE.MeshStandardMaterial).wireframe = false
        }
        const base = bases?.[i]
        if (base) {
          const c = mat.color as THREE.Color
          c.setRGB(
            base.r * hurt + 0.2 * (1 - hurt),
            base.g * hurt,
            base.b * hurt,
          )
        }
      }
    }

    const overlays = root.userData.hitWireOverlays as THREE.Mesh[] | undefined
    if (overlays) {
      for (const w of overlays) {
        w.visible = debug
      }
    }
  }

  /**
   * Hitscan against the real character meshes (skinned pose included).
   * Head meshes win near-ties so hairline shots still count as headshots.
   */
  private castMeshHitscan(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxRange: number,
  ): RayHit | null {
    this._rayOrigin.set(origin.x, origin.y, origin.z)
    this._rayDir.set(dir.x, dir.y, dir.z).normalize()
    this._raycaster.set(this._rayOrigin, this._rayDir)
    this._raycaster.near = 0
    this._raycaster.far = maxRange

    const targets: THREE.Object3D[] = []
    for (const d of this.dummies) {
      if (!d.alive) continue
      const root = this.dummyMeshes.get(d.id)
      if (!root || !root.visible) continue
      // Skinned raycast needs up-to-date bone world matrices
      root.updateWorldMatrix(true, true)
      const meshes = root.userData.hitMeshes as THREE.Mesh[] | undefined
      if (!meshes) continue
      for (const m of meshes) {
        if (m.visible) targets.push(m)
      }
    }
    if (targets.length === 0) return null

    const hits = this._raycaster.intersectObjects(targets, false)
    if (hits.length === 0) return null

    const closest = hits[0].distance
    const near = hits.filter((h) => h.distance - closest < 0.05)
    const headHit = near.find(
      (h) => (h.object.userData.hitZone as HitZone) === 'head',
    )
    const best = headHit ?? hits[0]
    const obj = best.object
    const ownerId = obj.userData.ownerId as string
    if (!ownerId) return null

    const zone = (obj.userData.hitZone as HitZone) ?? 'chest'

    const n = best.normal ?? this._rayDir.clone().negate()
    const nl = Math.hypot(n.x, n.y, n.z) || 1

    return {
      point: { x: best.point.x, y: best.point.y, z: best.point.z },
      distance: best.distance,
      normal: { x: n.x / nl, y: n.y / nl, z: n.z / nl },
      hitbox: {
        id: `${ownerId}-${zone}`,
        ownerId,
        zone,
      },
    }
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
   * Load public/models/man.glb once, clone per dummy (with skeleton).
   * Clips: Idle / Walk / Run / Roll (slide) + hit / death.
   * Crouch reuses Walk (no crouch clip in this asset).
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
      const walkClip = this.findClip(clips, 'Walk')
      const runClip = this.findClip(clips, 'Run')
      // man.glb has no slide — Roll is the closest one-shot dive/dodge
      const slideClip = this.findClip(clips, 'Roll')
      const hitClip = this.findClip(clips, 'HitRecieve')
      const hitClipAlt = this.findClip(clips, 'HitRecieve_2')
      const deathClip = this.findClip(clips, 'Death')

      console.info('Dummy locomotion clips', {
        idle: idleClip?.name,
        walk: walkClip?.name,
        run: runClip?.name,
        slide: slideClip?.name,
        available: clips.map((c) => c.name),
      })

      const box = new THREE.Box3().setFromObject(source)
      const size = box.getSize(new THREE.Vector3())
      // Full character height: head center + vertical egg half
      const targetHeight =
        DUMMY.headOffsetY + DUMMY.headRadius * DUMMY.headEgg.y
      const scale = targetHeight / Math.max(size.y, 0.001)
      const footY = box.min.y

      factory = (id: string) => {
        const root = new THREE.Group()
        // SkeletonUtils preserves skinned meshes / bone bindings for animation
        const model = cloneSkinned(source)
        model.scale.setScalar(scale)
        model.position.y = -footY * scale
        root.userData.baseScale = scale
        root.userData.model = model

        model.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return
          o.castShadow = true
          o.receiveShadow = true
          // Skinned pose can leave AABB stale — don't cull mid-animation
          o.frustumCulled = false
          const list = Array.isArray(o.material) ? o.material : [o.material]
          const cloned = list.map((m) => m.clone())
          o.material = Array.isArray(o.material) ? cloned : cloned[0]
        })

        root.add(model)
        root.userData.animState = 'idle'
        root.userData.locoState = 'idle'
        root.userData.wasAlive = true
        // Hitscan + debug wireframe sit on these exact meshes
        this.registerHitMeshes(root, id)
        // Suit_Body includes skinned arms — split faces onto arm/chest like legs
        this.splitChestMeshesByArmWeights(root, id)
        this.attachDummyLabel(root)

        if (idleClip) {
          const mixer = new THREE.AnimationMixer(model)
          this.dummyMixers.set(id, mixer)

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
            slide,
            hit,
            hitAlt,
            death,
          }

          mixer.addEventListener('finished', (e) => {
            const action = e.action as THREE.AnimationAction
            const state = root.userData.animState as string
            if (state === 'hit' && (action === hit || action === hitAlt)) {
              // Resume whatever locomotion the sim is on
              root.userData.locoState = null
              this.syncDummyLocomotion(id)
            }
            // slide/death hold last frame until state machine advances
          })
        }

        return root
      }
    } catch (e) {
      console.warn('Dummy model load failed, using placeholder', e)
      factory = (id: string) => {
        const g = this.makePlaceholderDummy(id)
        this.attachDummyLabel(g)
        return g
      }
    }

    for (const d of this.dummies) {
      const g = factory(d.id)
      g.position.set(d.position.x, d.position.y, d.position.z)
      g.rotation.y = d.yaw
      this.scene.add(g)
      this.dummyMeshes.set(d.id, g)
      g.updateWorldMatrix(true, true)
      this.paintDummyMeshes(g, d.hp / d.maxHp)
      this.setDummyLabel(g, d.state)
    }
  }

  /** Floating state label for reviewing locomotion clips. */
  private attachDummyLabel(root: THREE.Group) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(1.6, 0.4, 1)
    sprite.position.y = DUMMY.labelY
    sprite.renderOrder = 10
    root.add(sprite)
    root.userData.label = { sprite, canvas, ctx, tex, text: '' }
  }

  private setDummyLabel(root: THREE.Group, state: string) {
    const label = root.userData.label as
      | {
          sprite: THREE.Sprite
          canvas: HTMLCanvasElement
          ctx: CanvasRenderingContext2D
          tex: THREE.CanvasTexture
          text: string
        }
      | undefined
    if (!label) return
    const text = state.toUpperCase()
    if (label.text === text) return
    label.text = text
    const { canvas, ctx, tex } = label
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(8, 8, canvas.width - 16, canvas.height - 16)
    ctx.font = 'bold 28px system-ui,Segoe UI,sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = state === 'slide' ? '#ffd27a' : state === 'crouch' ? '#9ad0ff' : '#ffffff'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    tex.needsUpdate = true
  }

  private getDummyActions(root: THREE.Group): DummyActions | undefined {
    return root.userData.actions as DummyActions | undefined
  }

  private fadeDummyLoco(
    actions: DummyActions,
    next: THREE.AnimationAction | null,
    fade = 0.18,
  ) {
    if (!next) return
    const loops = [actions.idle, actions.walk, actions.run]
    for (const a of loops) {
      if (!a || a === next) continue
      if (a.isRunning()) a.fadeOut(fade)
    }
    if (actions.slide && actions.slide !== next && actions.slide.isRunning()) {
      actions.slide.fadeOut(fade * 0.5)
    }
    next.reset().setEffectiveWeight(1).fadeIn(fade).play()
  }

  /** Match sim move state → Walk / Run / Idle / Roll clips. */
  private syncDummyLocomotion(id: string) {
    const d = this.dummies.find((x) => x.id === id)
    const root = this.dummyMeshes.get(id)
    if (!d || !root || !d.alive) return
    const actions = this.getDummyActions(root)
    if (!actions?.idle) return

    // Don't interrupt hit / death
    const anim = root.userData.animState as string
    if (anim === 'hit' || anim === 'death') return

    const want = d.state
    if (root.userData.locoState === want && anim !== 'hit') {
      this.applyDummyCrouchScale(root, want === 'crouch')
      return
    }
    root.userData.locoState = want
    root.userData.animState = want

    // Stop one-shots when leaving them
    actions.hit?.stop()
    actions.hitAlt?.stop()
    actions.death?.stop()

    if (want === 'slide') {
      const slide = actions.slide
      if (slide) {
        const loops = [actions.idle, actions.walk, actions.run]
        for (const a of loops) {
          if (a?.isRunning()) a.fadeOut(0.08)
        }
        slide.reset().setEffectiveWeight(1).fadeIn(0.05).play()
      } else {
        // No Roll clip — fall back to run
        this.fadeDummyLoco(actions, actions.run ?? actions.walk ?? actions.idle)
      }
    } else if (want === 'run') {
      this.fadeDummyLoco(actions, actions.run ?? actions.walk ?? actions.idle)
      if (actions.run) actions.run.setEffectiveTimeScale(1)
    } else if (want === 'walk' || want === 'crouch') {
      const walk = actions.walk ?? actions.idle
      this.fadeDummyLoco(actions, walk)
      // Crouch: slower walk cycle (no dedicated crouch clip in man.glb)
      if (walk && walk !== actions.idle) {
        walk.setEffectiveTimeScale(want === 'crouch' ? 0.55 : 1)
      }
    } else {
      this.fadeDummyLoco(actions, actions.idle)
    }

    this.applyDummyCrouchScale(root, want === 'crouch')
  }

  /** Mild Y squash so crouch is readable without a crouch clip. */
  private applyDummyCrouchScale(root: THREE.Group, crouch: boolean) {
    const model = root.userData.model as THREE.Object3D | undefined
    const base = (root.userData.baseScale as number | undefined) ?? 1
    if (!model) return
    const yMul = crouch ? DUMMY.crouchScaleY : 1
    model.scale.set(base, base * yMul, base)
  }

  private playDummyIdle(root: THREE.Group) {
    const actions = this.getDummyActions(root)
    if (!actions?.idle) return
    root.userData.animState = 'idle'
    root.userData.locoState = 'idle'
    actions.hit?.stop()
    actions.hitAlt?.stop()
    actions.death?.stop()
    actions.slide?.stop()
    actions.walk?.stop()
    actions.run?.stop()
    actions.idle.reset().fadeIn(0.2).play()
    this.applyDummyCrouchScale(root, false)
  }

  private playDummyHit(id: string) {
    const root = this.dummyMeshes.get(id)
    if (!root) return
    const actions = this.getDummyActions(root)
    if (!actions) return
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
    const loops = [actions.idle, actions.walk, actions.run, actions.slide]
    for (const a of loops) {
      if (a?.isRunning()) a.fadeOut(0.08)
    }
    actions.hit?.stop()
    actions.hitAlt?.stop()
    pick.reset().setEffectiveWeight(1).fadeIn(0.05).play()
  }

  private playDummyDeath(id: string) {
    const root = this.dummyMeshes.get(id)
    if (!root) return
    const actions = this.getDummyActions(root)
    if (!actions?.death) {
      root.userData.animState = 'death'
      return
    }
    root.userData.animState = 'death'
    root.userData.locoState = null
    const loops = [actions.idle, actions.walk, actions.run, actions.slide]
    for (const a of loops) {
      if (a?.isRunning()) a.fadeOut(0.08)
    }
    actions.hit?.stop()
    actions.hitAlt?.stop()
    actions.death.reset().setEffectiveWeight(1).fadeIn(0.05).play()
    this.applyDummyCrouchScale(root, false)
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

  /** Disable shadows / frustum cull on viewmodel meshes. */
  private prepareViewmesh(root: THREE.Object3D) {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.SkinnedMesh) {
        o.castShadow = false
        o.receiveShadow = false
        o.frustumCulled = false
      }
    })
  }

  /**
   * Restyle sniper_animated.glb toward man.glb's low-poly look while
   * keeping albedo color: flat shading + baseColor map, drop detail maps.
   * Geometry + skins + animations are left intact.
   */
  private styleViewmodelLowPoly(root: THREE.Object3D) {
    const seenMats = new Set<THREE.Material>()
    const dropTex = new Set<THREE.Texture>()
    const oldMats: THREE.Material[] = []

    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.SkinnedMesh)) {
        return
      }

      const prevList = Array.isArray(o.material) ? o.material : [o.material]
      const nextList = prevList.map((raw) => {
        if (!seenMats.has(raw)) {
          seenMats.add(raw)
          oldMats.push(raw)
        }

        const src = raw as THREE.MeshStandardMaterial
        const mat = src.clone() as THREE.MeshStandardMaterial

        // Keep albedo (map / color); strip detail PBR maps for a flatter look
        for (const key of [
          'normalMap',
          'roughnessMap',
          'metalnessMap',
          'aoMap',
          'emissiveMap',
          'bumpMap',
          'displacementMap',
        ] as const) {
          const tex = mat[key]
          if (tex) {
            dropTex.add(tex)
            mat[key] = null
          }
        }

        mat.flatShading = true
        // Simple constants so shading reads like low-poly, not realistic metal
        if (mat.metalnessMap == null) mat.metalness = 0.2
        if (mat.roughnessMap == null) mat.roughness = 0.55

        const name = o.name.toLowerCase()
        if (name.includes('glass') || name.includes('lens')) {
          mat.transparent = true
          mat.opacity = Math.min(mat.opacity, 0.5)
          mat.side = THREE.DoubleSide
          mat.depthWrite = false
          mat.metalness = 0
          mat.roughness = 0.35
        }

        mat.needsUpdate = true
        return mat
      })

      o.material = Array.isArray(o.material) ? nextList : nextList[0]
    })

    // Free original materials + detail maps (keep albedo maps still in use)
    const keepTex = new Set<THREE.Texture>()
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.SkinnedMesh)) {
        return
      }
      const list = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of list) {
        const std = m as THREE.MeshStandardMaterial
        if (std.map) keepTex.add(std.map)
      }
    })

    for (const tex of dropTex) {
      if (!keepTex.has(tex)) tex.dispose()
    }
    for (const m of oldMats) {
      m.dispose()
    }
  }

  /**
   * Bake model to unit scale (longest axis = 1) and capture center.
   * Live target scale / offsets are applied via applyViewmodelParts().
   */
  private measureUnitAsset(obj: THREE.Object3D): {
    unitScale: number
    center: THREE.Vector3
  } {
    obj.scale.set(1, 1, 1)
    obj.position.set(0, 0, 0)
    obj.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(obj)
    const size = box.getSize(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    const unitScale = 1 / maxDim
    obj.scale.setScalar(unitScale)
    obj.updateMatrixWorld(true)
    box.setFromObject(obj)
    const center = box.getCenter(new THREE.Vector3())
    // Keep mesh centered at origin for now; applyViewmodelParts adds offset.
    obj.position.copy(center).multiplyScalar(-1)
    const storedCenter = obj.position.clone()
    return { unitScale, center: storedCenter }
  }

  /** Push current vmConfig onto the viewmodel root mesh. */
  private applyViewmodelParts() {
    const c = this.vmConfig
    if (this.vmGun) {
      this.vmGun.scale.setScalar(this.gunUnitScale * c.scale)
      this.vmGun.position.set(
        this.gunCenter.x * c.scale + c.gunOffset.x,
        this.gunCenter.y * c.scale + c.gunOffset.y,
        this.gunCenter.z * c.scale + c.gunOffset.z,
      )
      this.vmGun.rotation.set(c.modelRot.x, c.modelRot.y, c.modelRot.z)
    }
  }

  /**
   * DJMaesen sniper_animated "allanims" frame map (30 fps):
   * 0–11 fire · 12–60 bolt · 61–115 reload · 116–127 hide · 127–142 ready
   */
  private buildViewmodelClips(master: THREE.AnimationClip) {
    const FPS = 30
    const sub = (name: string, start: number, end: number) =>
      THREE.AnimationUtils.subclip(master, name, start, end, FPS)

    return {
      fire: sub('fire', 0, 12),
      bolt: sub('bolt', 12, 61),
      reload: sub('reload', 61, 116),
      ready: sub('ready', 127, 143),
    }
  }

  private playViewmodelAction(
    next: THREE.AnimationAction | null,
    matchDuration: number | null,
  ) {
    if (!next) return
    if (this.vmCurrentAction === next && next.isRunning()) return

    if (this.vmCurrentAction && this.vmCurrentAction !== next) {
      this.vmCurrentAction.fadeOut(0.06)
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
    this.vmCurrentAction = next
  }

  /** Drive fire / bolt / reload / ready clips from sniper phase. */
  private syncViewmodelAnim() {
    const phase = this.sniper.phase
    if (phase === this.vmAnimPhase) return
    this.vmAnimPhase = phase

    if (phase === 'firing') {
      this.playViewmodelAction(this.vmActions.fire, SNIPER.fireAnimTime)
    } else if (phase === 'bolt') {
      this.playViewmodelAction(this.vmActions.bolt, SNIPER.boltTime)
    } else if (phase === 'reloading') {
      this.playViewmodelAction(this.vmActions.reload, SNIPER.reloadTime)
    } else {
      // ready — settle into hold pose
      this.playViewmodelAction(this.vmActions.ready, null)
    }
  }

  private async loadViewmodel() {
    const root = new THREE.Group()
    const loader = new GLTFLoader()
    this.vmConfig = cloneViewmodelConfig(
      VIEWMODEL as unknown as ViewmodelConfig,
    )

    try {
      const gltf = await loader.loadAsync('/models/sniper_animated.glb')
      const model = gltf.scene
      this.prepareViewmesh(model)
      this.styleViewmodelLowPoly(model)

      // Apply basis correction before measuring so center matches final pose
      const { modelRot } = this.vmConfig
      model.rotation.set(modelRot.x, modelRot.y, modelRot.z)
      const measured = this.measureUnitAsset(model)
      this.gunUnitScale = measured.unitScale
      this.gunCenter.copy(measured.center)
      this.vmGun = model
      root.add(model)

      // --- Animations (single packed clip → subclips) ---
      const master = gltf.animations?.[0]
      if (master) {
        this.vmMixer = new THREE.AnimationMixer(model)
        const clips = this.buildViewmodelClips(master)
        const mk = (clip: THREE.AnimationClip) => {
          const a = this.vmMixer!.clipAction(clip)
          a.setLoop(THREE.LoopOnce, 1)
          a.clampWhenFinished = true
          return a
        }
        this.vmActions = {
          fire: mk(clips.fire),
          bolt: mk(clips.bolt),
          reload: mk(clips.reload),
          ready: mk(clips.ready),
        }
        // Idle hold on ready pose
        this.playViewmodelAction(this.vmActions.ready, null)
        this.vmAnimPhase = 'ready'
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
      const measured = this.measureUnitAsset(gun)
      this.gunUnitScale = measured.unitScale
      this.gunCenter.copy(measured.center)
      this.vmGun = gun
      root.add(gun)
    }

    this.applyViewmodelParts()

    const { hipPos, hipRot } = this.vmConfig
    root.position.set(hipPos.x, hipPos.y, hipPos.z)
    root.rotation.set(hipRot.x, hipRot.y, hipRot.z)

    this.camera.add(root)
    this.scene.add(this.camera)
    this.viewmodel = root
    this.vmReady = true
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
    stepDummies(this.dummies, dt)
    stepRespawns(this.dummies, this.respawns, dt)

    // Animate before fire so skinned-mesh hitscan uses this frame's pose
    for (const mixer of this.dummyMixers.values()) {
      mixer.update(dt)
    }
    this.syncViewmodelAnim()
    this.vmMixer?.update(dt)

    if (tryFire(this.sniper, input)) {
      // Fire with current aim (sway / existing recoil), then kick for next frames.
      this.fireShot()
      applyRecoil(this.sniper)
    }

    // --- View bob (visual only; fireShot still uses true eyePosition) ---
    const p = this.player
    const speed = Math.hypot(p.velocity.x, p.velocity.z)
    const grounded = p.grounded

    // Landing kick is viewmodel-only (camera stays on true eye for aim parity).
    // Impulse into a spring — offset ramps smoothly instead of snapping.
    if (grounded && !this.wasGrounded) {
      const impact = Math.max(0, -this.prevVelY)
      const peak = Math.min(
        VIEW_BOB.landMax,
        VIEW_BOB.landKick + impact * VIEW_BOB.landImpactScale,
      )
      // Critically damped peak ≈ v0 / (ω e) with x0=0 → v0 = peak · ω · e
      const w = VIEW_BOB.landOmega
      this.landVel += peak * w * Math.E
    }
    this.wasGrounded = grounded
    {
      const w = VIEW_BOB.landOmega
      const damp = 2 * w * VIEW_BOB.landDamp
      this.landVel += (-w * w * this.landOffset - damp * this.landVel) * dt
      this.landOffset += this.landVel * dt
      // Only dip down — no overshoot float above rest
      if (this.landOffset < 0) {
        this.landOffset = 0
        if (this.landVel < 0) this.landVel = 0
      }
      if (this.landOffset > VIEW_BOB.landMax) {
        this.landOffset = VIEW_BOB.landMax
        if (this.landVel > 0) this.landVel = 0
      }
    }

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
      // Soft-cap phase rate so sprint stays deliberate, not a buzz.
      const freqScale = Math.min(
        speed / VIEW_BOB.freqSpeedRef,
        VIEW_BOB.freqSpeedCap,
      )
      this.bobPhase += VIEW_BOB.frequency * freqScale * dt
    }

    // Sprint weight: deeper vertical / pitch, not faster cycle.
    const sprintT = Math.min(
      1,
      Math.max(
        0,
        (speed - VIEW_BOB.freqSpeedRef) /
          Math.max(0.001, VIEW_BOB.fullSpeed - VIEW_BOB.freqSpeedRef),
      ),
    )
    const heavy =
      grounded && p.state !== 'crouch' && p.state !== 'slide'
        ? 1 + sprintT * (VIEW_BOB.sprintHeavyMul - 1)
        : 1

    const bobA = this.vmFreezeBob ? 0 : this.bobAmount
    const s1 = Math.sin(this.bobPhase)
    const s2 = Math.sin(this.bobPhase * 2)
    const c2 = Math.cos(this.bobPhase * 2)
    // Camera stays locked to true eye — only the viewmodel bobs / sways.
    // Lateral/roll stay lighter; Y + pitch carry the heavy sprint feel.
    const bobGunX = s1 * VIEW_BOB.gunX * bobA
    const bobGunY = s2 * VIEW_BOB.gunY * bobA * heavy
    const bobGunZ = c2 * VIEW_BOB.gunZ * bobA * heavy
    const bobGunPitch = c2 * VIEW_BOB.gunPitch * bobA * heavy
    const bobGunRoll = s1 * VIEW_BOB.gunRoll * bobA

    this.gunSwayTime += dt
    const adsBlend =
      this.vmForceAds != null ? this.vmForceAds : this.sniper.adsBlend
    let swayMul = this.vmFreezeBob
      ? 0
      : 1 - adsBlend * (1 - GUN_SWAY.adsMul)
    if (speed > 1) swayMul *= GUN_SWAY.moveMul
    const st = this.gunSwayTime
    const swayX =
      Math.sin(st * GUN_SWAY.freqYaw) * GUN_SWAY.posX * swayMul
    const swayY =
      Math.cos(st * GUN_SWAY.freqPitch) * GUN_SWAY.posY * swayMul
    const swayYaw =
      Math.sin(st * GUN_SWAY.freqYaw * 0.85) * GUN_SWAY.yaw * swayMul
    const swayPitch =
      Math.cos(st * GUN_SWAY.freqPitch * 1.1) * GUN_SWAY.pitch * swayMul
    const swayRoll =
      Math.sin(st * GUN_SWAY.freqRoll) * GUN_SWAY.roll * swayMul

    // Freefall float: gun rises with fall speed (weightless arms), eases out on land.
    {
      let airTarget = 0
      if (!grounded && !this.vmFreezeBob) {
        const fall = Math.max(0, -p.velocity.y)
        const fallT = Math.min(1, fall / VIEW_BOB.airRiseFallRef)
        // Rise builds as you fall harder; small hold near apex so it doesn't pop.
        airTarget = Math.min(
          VIEW_BOB.airRiseMax,
          VIEW_BOB.airRise * Math.max(fallT, 0.35) +
            fall * VIEW_BOB.airRiseFallScale,
        )
        // Ascending jump: only a light float (not full freefall lift).
        if (p.velocity.y > 0.5) {
          airTarget = Math.min(airTarget, VIEW_BOB.airRise * 0.4)
        }
        airTarget *= 1 - adsBlend * (1 - VIEW_BOB.airRiseAdsMul)
      }
      const airRate =
        airTarget > this.airRise
          ? VIEW_BOB.airRiseLerpIn
          : VIEW_BOB.airRiseLerpOut
      const airK = 1 - Math.exp(-airRate * dt)
      this.airRise += (airTarget - this.airRise) * airK
    }

    // Apex-style left cant while sliding (viewmodel only; smooth in/out).
    const slideTarget =
      p.state === 'slide' && !this.vmFreezeBob
        ? 1 - adsBlend * (1 - SLIDE_GUN.adsMul)
        : 0
    const slideK = 1 - Math.exp(-SLIDE_GUN.lerp * dt)
    this.slideGunBlend += (slideTarget - this.slideGunBlend) * slideK
    const slide = this.slideGunBlend

    // Camera matches effective aim so crosshair, tracer, and hitscan agree.
    // No landOffset on the camera — viewmodel is camera-local, so a camera dip
    // was double-counted with the gun kick and felt like a jolt + crawl-up.
    const eye = eyePosition(this.player)
    const look = effectiveLook(this.player, this.sniper)
    this.camera.position.set(eye.x, eye.y, eye.z)
    this.camera.rotation.y = look.yaw
    this.camera.rotation.x = look.pitch

    const fov =
      LOOK.hipFov +
      (LOOK.adsFov - LOOK.hipFov) * this.sniper.adsBlend +
      SLIDE_GUN.fovBoost * slide
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }

    // viewmodel pose — hip sits lower-right; ADS pulls to center then hides for scope UI
    if (this.viewmodel) {
      const ads = adsBlend
      const { hipPos, hipRot, adsPos, adsRot, hideAds } = this.vmConfig
      const hip = new THREE.Vector3(hipPos.x, hipPos.y, hipPos.z)
      const scoped = new THREE.Vector3(adsPos.x, adsPos.y, adsPos.z)
      const land = this.vmFreezeBob ? 0 : this.landOffset
      const air = this.vmFreezeBob ? 0 : this.airRise
      this.viewmodel.position.lerpVectors(hip, scoped, ads)
      this.viewmodel.position.x += bobGunX + swayX + SLIDE_GUN.posX * slide
      this.viewmodel.position.y +=
        bobGunY + swayY - land + air + SLIDE_GUN.posY * slide
      this.viewmodel.position.z += bobGunZ + SLIDE_GUN.posZ * slide
      const recoilKick = this.vmFreezeBob
        ? 0
        : this.sniper.recoil * SNIPER.viewmodelRecoil
      const landPitch = land * VIEW_BOB.landPitch
      // airRisePitch is negative → muzzle lifts as the gun floats up
      const airPitch =
        VIEW_BOB.airRiseMax > 1e-6
          ? (air / VIEW_BOB.airRiseMax) * VIEW_BOB.airRisePitch
          : 0
      this.viewmodel.rotation.set(
        hipRot.x * (1 - ads) +
          adsRot.x * ads +
          recoilKick +
          bobGunPitch +
          swayPitch +
          landPitch +
          airPitch +
          SLIDE_GUN.pitch * slide,
        hipRot.y * (1 - ads) +
          adsRot.y * ads +
          swayYaw +
          SLIDE_GUN.yaw * slide,
        hipRot.z * (1 - ads) +
          adsRot.z * ads +
          bobGunRoll +
          swayRoll +
          SLIDE_GUN.roll * slide,
      )
      this.viewmodel.visible = this.vmKeepVisible || ads < hideAds
    }

    // dummy visuals — hit surfaces ARE the model meshes
    for (const d of this.dummies) {
      const mesh = this.dummyMeshes.get(d.id)
      if (!mesh) continue

      const wasAlive = mesh.userData.wasAlive !== false
      if (d.alive && !wasAlive) {
        mesh.userData.locoState = null
        this.playDummyIdle(mesh)
        this.syncDummyLocomotion(d.id)
      }
      mesh.userData.wasAlive = d.alive

      // stay visible during death pose until respawn; hide only if no death anim
      const dying = !d.alive && mesh.userData.animState === 'death'
      mesh.visible = d.alive || dying

      if (!d.alive && !dying) continue

      // Sync root pose to sim (dummies wander for locomotion review)
      if (d.alive) {
        mesh.position.set(d.position.x, d.position.y, d.position.z)
        mesh.rotation.y = d.yaw
        this.syncDummyLocomotion(d.id)
        this.setDummyLabel(mesh, d.state)
      } else {
        this.setDummyLabel(mesh, 'dead')
      }

      this.paintDummyMeshes(mesh, d.alive ? d.hp / d.maxHp : 0)
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
    // Cone sample — hipfire is loose, ADS is near-laser (COD-style accuracy).
    const spread = aimSpread(this.sniper, this.player)
    const dir = spreadLookDirection(look.yaw, look.pitch, spread)

    // World cover blocks first (AABB), then ray vs real character meshes
    const worldHit = castHitscan(origin, dir, [], this.colliders)
    const range = worldHit?.distance ?? SNIPER.maxRange
    const meshHit = this.castMeshHitscan(origin, dir, range)
    const hit = meshHit ?? worldHit

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
      const dmg = this.damageForZone(zone)
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
      aimSpread: aimSpread(this.sniper, this.player),
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
