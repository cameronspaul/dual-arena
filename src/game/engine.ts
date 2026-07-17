import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { DEBUG, DUMMY, LOOK, SNIPER, VIEW_BOB, VIEWMODEL } from './config'
import { castHitscan } from './hitscan'
import { InputManager } from './input'
import { lookDirection } from './math'
import {
  createPlayer,
  eyePosition,
  playerVolumes,
  stepPlayer,
} from './player'
import {
  applyRecoil,
  createSniper,
  effectiveLook,
  stepSniper,
  tryFire,
} from './sniper'
import type {
  HitEvent,
  HitZone,
  HitVolumes,
  HudSnapshot,
  PlayerBody,
  RayHit,
  SniperState,
} from './types'
import {
  cloneViewmodelConfig,
  FINGER_IDS,
  normalizeViewmodelConfig,
  type ArmChainPose,
  type ArmJointPose,
  type FingerId,
  type FingerPose,
  type ViewmodelConfig,
} from './viewmodelConfig'
import {
  buildWorldColliders,
  createDummies,
  damageDummy,
  queueRespawn,
  stepRespawns,
  type RespawnTimer,
} from './world'

type ArmLimbKey = 'shoulder' | 'bicep' | 'forearm' | 'wrist'

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
  /** Gun mesh/group after modelRot; scale + gunOffset applied live from vmConfig. */
  private vmGun: THREE.Object3D | null = null
  /** Arms scene root; scale + pos/rot applied live from vmConfig. */
  private vmArms: THREE.Object3D | null = null
  private armBonesL: ArmSideBones = emptyArmSideBones()
  private armBonesR: ArmSideBones = emptyArmSideBones()
  /** Uniform scale that makes longest axis = 1 (before target scale). */
  private gunUnitScale = 1
  private armsUnitScale = 1
  /** Center offset captured after unit normalize (position before gunOffset). */
  private gunCenter = new THREE.Vector3()
  private armsCenter = new THREE.Vector3()
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
  private readonly _tmpEuler = new THREE.Euler()
  private readonly _tmpQuat = new THREE.Quaternion()
  private bobPhase = 0
  private bobAmount = 0
  private landOffset = 0
  private wasGrounded = true
  /** Fall speed sampled before collision zeros velocity.y on land. */
  private prevVelY = 0
  private dummyMeshes = new Map<string, THREE.Group>()
  private dummyMixers = new Map<string, THREE.AnimationMixer>()
  /** Local player pose volumes (no 3rd-person mesh yet). */
  private playerHitboxHelper: THREE.Group | null = null
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
  /** Hitscan against the real skinned character meshes. */
  private readonly _raycaster = new THREE.Raycaster()
  private readonly _rayOrigin = new THREE.Vector3()
  private readonly _rayDir = new THREE.Vector3()
  private readonly _hitPoint = new THREE.Vector3()
  private readonly _bonePos = new THREE.Vector3()
  private readonly _yAxis = new THREE.Vector3(0, 1, 0)
  private readonly _capDir = new THREE.Vector3()
  private static readonly MAX_CAPSULE_HELPERS = 4
  private static readonly MAX_BODY_SPHERE_HELPERS = 0

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
    if (DEBUG.showHitboxes) {
      this.playerHitboxHelper = this.makeHitboxHelper()
      this.scene.add(this.playerHitboxHelper)
    }
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

  /** Mesh name → default zone (arms share Suit_Body; refined by bones on hit). */
  private meshNameToZone(name: string): HitZone {
    if (/head/i.test(name)) return 'head'
    if (/arm|hand|wrist/i.test(name)) return 'arm'
    if (/leg|feet|foot/i.test(name)) return 'leg'
    return 'chest'
  }

  /** Debug wireframe: head red · chest cyan · arms orange · legs yellow */
  private zoneWireColor(zone: HitZone): number {
    if (zone === 'head') return 0xff4466
    if (zone === 'arm') return 0xff8844
    if (zone === 'leg') return 0xffee44
    return 0x44ccff
  }

  private damageForZone(zone: HitZone): number {
    if (zone === 'head') return SNIPER.headDamage
    if (zone === 'arm' || zone === 'leg') return SNIPER.limbDamage
    return SNIPER.chestDamage
  }

  private findBoneNamed(
    root: THREE.Object3D,
    name: string,
  ): THREE.Bone | null {
    let found: THREE.Bone | null = null
    root.traverse((o) => {
      if (found) return
      if ((o as THREE.Bone).isBone && o.name === name) found = o as THREE.Bone
    })
    return found
  }

  /**
   * Bone markers for arm-vs-chest classification (arms are skinned into Suit_Body).
   */
  private registerZoneBones(root: THREE.Group) {
    type Marker = { zone: HitZone; bone: THREE.Bone }
    const markers: Marker[] = []
    const add = (zone: HitZone, ...names: string[]) => {
      for (const n of names) {
        const b = this.findBoneNamed(root, n)
        if (b) markers.push({ zone, bone: b })
      }
    }
    add('head', 'Head')
    add(
      'chest',
      'Hips',
      'Abdomen',
      'Torso',
      'Chest',
      'Body',
      'Neck',
    )
    add(
      'arm',
      'ShoulderL',
      'ShoulderR',
      'UpperArmL',
      'UpperArmR',
      'LowerArmL',
      'LowerArmR',
      'WristL',
      'WristR',
    )
    add(
      'leg',
      'UpperLegL',
      'UpperLegR',
      'LowerLegL',
      'LowerLegR',
      'FootL',
      'FootR',
    )
    root.userData.zoneBones = markers
  }

  /**
   * Prefer mesh name for head/legs/arms; for torso mesh, nearest bone decides
   * chest vs arm (arms are skinned into Suit_Body).
   */
  private resolveHitZone(
    root: THREE.Group,
    mesh: THREE.Object3D,
    point: THREE.Vector3,
  ): HitZone {
    const meshZone = (mesh.userData.hitZone as HitZone) ?? 'chest'
    if (meshZone === 'head' || meshZone === 'leg' || meshZone === 'arm') {
      return meshZone
    }

    const markers = root.userData.zoneBones as
      | { zone: HitZone; bone: THREE.Bone }[]
      | undefined
    if (!markers?.length) return meshZone

    let bestZone: HitZone = meshZone
    let bestD = Infinity
    for (const m of markers) {
      m.bone.getWorldPosition(this._bonePos)
      const d = this._bonePos.distanceToSquared(point)
      if (d < bestD) {
        bestD = d
        bestZone = m.zone
      }
    }
    // Head mesh already handled; if nearest bone is head while on chest mesh, treat as chest
    // (avoids stealing torso shots into the neck/head bone).
    if (bestZone === 'head') return 'chest'
    return bestZone
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
    this.registerZoneBones(root)
    this.buildArmDebugCapsules(root)
  }

  /**
   * Arms are skinned into Suit_Body (chest mesh), so they need their own
   * orange bone-chain wireframes to read as a distinct debug zone.
   */
  private buildArmDebugCapsules(root: THREE.Group) {
    const mat = new THREE.MeshBasicMaterial({
      color: this.zoneWireColor('arm'),
      wireframe: true,
      transparent: true,
      opacity: 0.9,
      depthTest: true,
      depthWrite: false,
    })
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true)
    const sphGeo = new THREE.SphereGeometry(1, 6, 5)

    const group = new THREE.Group()
    group.name = 'armDebugCaps'
    group.userData.skipHitbox = true
    group.renderOrder = 21

    const caps: THREE.Group[] = []
    // 2 arms × (upper + lower) segments
    for (let i = 0; i < 4; i++) {
      const cap = new THREE.Group()
      cap.visible = false
      const cyl = new THREE.Mesh(cylGeo, mat)
      const sA = new THREE.Mesh(sphGeo, mat)
      sA.position.y = -0.5
      const sB = new THREE.Mesh(sphGeo, mat)
      sB.position.y = 0.5
      cap.add(cyl, sA, sB)
      group.add(cap)
      caps.push(cap)
    }
    root.add(group)

    type Chain = [THREE.Bone | null, THREE.Bone | null, THREE.Bone | null]
    const chains: Chain[] = [
      [
        this.findBoneNamed(root, 'UpperArmL'),
        this.findBoneNamed(root, 'LowerArmL'),
        this.findBoneNamed(root, 'WristL'),
      ],
      [
        this.findBoneNamed(root, 'UpperArmR'),
        this.findBoneNamed(root, 'LowerArmR'),
        this.findBoneNamed(root, 'WristR'),
      ],
    ]
    root.userData.armDebugCaps = caps
    root.userData.armDebugChains = chains
  }

  private syncArmDebugCapsules(root: THREE.Group) {
    const caps = root.userData.armDebugCaps as THREE.Group[] | undefined
    const chains = root.userData.armDebugChains as
      | [THREE.Bone | null, THREE.Bone | null, THREE.Bone | null][]
      | undefined
    if (!caps || !chains) return

    if (!DEBUG.showHitboxes) {
      for (const c of caps) c.visible = false
      return
    }

    // Capsules live under root — convert bone world → root local
    const aLocal = this._rayOrigin
    const bLocal = this._bonePos
    const radius = 0.055
    let ci = 0
    for (const chain of chains) {
      for (let s = 0; s < 2; s++) {
        const cap = caps[ci++]
        const ba = chain[s]
        const bb = chain[s + 1]
        if (!cap || !ba || !bb) {
          if (cap) cap.visible = false
          continue
        }
        ba.getWorldPosition(aLocal)
        bb.getWorldPosition(bLocal)
        root.worldToLocal(aLocal)
        root.worldToLocal(bLocal)
        this.orientCapsuleHelper(
          cap,
          { x: aLocal.x, y: aLocal.y, z: aLocal.z },
          { x: bLocal.x, y: bLocal.y, z: bLocal.z },
          radius,
        )
      }
    }
  }

  /**
   * Damage tint on the real skin materials + toggle zone wireframe overlays.
   * Skin always stays visible; debug only adds the outline layer.
   */
  private paintDummyMeshes(root: THREE.Group, hpRatio: number) {
    const hitMeshes = root.userData.hitMeshes as THREE.Mesh[] | undefined
    if (!hitMeshes) return
    const hurt = Math.max(0, Math.min(1, hpRatio))
    const debug = DEBUG.showHitboxes

    for (const mesh of hitMeshes) {
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
    this.syncArmDebugCapsules(root)
  }

  /**
   * Single overlay style: wireframe only (no fill + outline double-draw).
   * Head = red sphere; body = cyan capsules / shoulder spheres.
   */
  private makeHitboxHelper(): THREE.Group {
    const g = new THREE.Group()
    g.renderOrder = 20

    const bodyMat = new THREE.MeshBasicMaterial({
      color: 0x44ccff,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })
    const headMat = new THREE.MeshBasicMaterial({
      color: 0xff4466,
      wireframe: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    })

    const headGeo = new THREE.SphereGeometry(1, 12, 10)
    const head = new THREE.Mesh(headGeo, headMat)
    head.renderOrder = 20
    head.name = 'head'
    g.add(head)

    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true)
    const sphGeo = new THREE.SphereGeometry(1, 8, 6)

    for (let i = 0; i < GameEngine.MAX_CAPSULE_HELPERS; i++) {
      const cap = new THREE.Group()
      cap.name = `cap${i}`
      cap.visible = false

      const cyl = new THREE.Mesh(cylGeo, bodyMat.clone())
      cyl.name = 'cyl'
      const sA = new THREE.Mesh(sphGeo, bodyMat.clone())
      sA.name = 'sA'
      sA.position.y = -0.5
      const sB = new THREE.Mesh(sphGeo, bodyMat.clone())
      sB.name = 'sB'
      sB.position.y = 0.5

      cap.add(cyl, sA, sB)
      g.add(cap)
    }

    for (let i = 0; i < GameEngine.MAX_BODY_SPHERE_HELPERS; i++) {
      const s = new THREE.Mesh(sphGeo, bodyMat.clone())
      s.name = `bs${i}`
      s.visible = false
      g.add(s)
    }

    return g
  }

  private orientCapsuleHelper(
    cap: THREE.Object3D,
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    radius: number,
  ) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dz = b.z - a.z
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-5 || radius < 1e-5) {
      cap.visible = false
      return
    }
    cap.visible = true
    cap.position.set((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5)
    cap.scale.set(radius, len, radius)
    this._capDir.set(dx / len, dy / len, dz / len)
    cap.quaternion.setFromUnitVectors(this._yAxis, this._capDir)
  }

  private syncHitboxHelper(g: THREE.Group, v: HitVolumes) {
    const head = g.getObjectByName('head')
    if (head) {
      head.position.set(v.headCenter.x, v.headCenter.y, v.headCenter.z)
      // Non-uniform scale → egg / ellipsoid
      head.scale.set(
        Math.max(0.01, v.headRadii.x),
        Math.max(0.01, v.headRadii.y),
        Math.max(0.01, v.headRadii.z),
      )
    }

    for (let i = 0; i < GameEngine.MAX_CAPSULE_HELPERS; i++) {
      const cap = g.getObjectByName(`cap${i}`)
      if (!cap) continue
      const c = v.capsules[i]
      if (!c) {
        cap.visible = false
        continue
      }
      this.orientCapsuleHelper(cap, c.a, c.b, c.radius)
    }

    const spheres = v.bodySpheres ?? []
    for (let i = 0; i < GameEngine.MAX_BODY_SPHERE_HELPERS; i++) {
      const s = g.getObjectByName(`bs${i}`)
      if (!s) continue
      const src = spheres[i]
      if (!src) {
        s.visible = false
        continue
      }
      s.visible = true
      s.position.set(src.center.x, src.center.y, src.center.z)
      s.scale.setScalar(Math.max(0.01, src.radius))
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

    const root = this.dummyMeshes.get(ownerId)
    this._hitPoint.copy(best.point)
    const zone = root
      ? this.resolveHitZone(root, obj, this._hitPoint)
      : ((obj.userData.hitZone as HitZone) ?? 'chest')

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
        root.userData.wasAlive = true
        // Hitscan + debug wireframe sit on these exact meshes
        this.registerHitMeshes(root, id)

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
      factory = (id: string) => this.makePlaceholderDummy(id)
    }

    for (const d of this.dummies) {
      const g = factory(d.id)
      g.position.set(d.position.x, d.position.y, d.position.z)
      g.rotation.y = d.yaw
      this.scene.add(g)
      this.dummyMeshes.set(d.id, g)
      g.updateWorldMatrix(true, true)
      this.paintDummyMeshes(g, d.hp / d.maxHp)
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

  private findBoneByName(
    root: THREE.Object3D,
    exact: string,
  ): THREE.Object3D | null {
    const want = exact.toLowerCase()
    let found: THREE.Object3D | null = null
    root.traverse((o) => {
      if (found || !o.name) return
      if (o.name.toLowerCase() === want) found = o
    })
    return found
  }

  private captureArmRest(node: THREE.Object3D | null): ArmBoneRest | null {
    if (!node) return null
    return {
      bone: node,
      pos: node.position.clone(),
      quat: node.quaternion.clone(),
      scale: node.scale.clone(),
    }
  }

  private bindSideBones(root: THREE.Object3D, side: 'l' | 'r'): ArmSideBones {
    const s = emptyArmSideBones()
    const pick = (name: string) => this.captureArmRest(this.findBoneByName(root, name))

    s.limb.shoulder = pick(`shoulder.${side}`)
    s.limb.bicep = pick(`bicep.${side}`)
    // Prefer forearm.l over forearm.Twist0.l — exact name match handles this
    s.limb.forearm = pick(`forearm.${side}`)
    s.limb.wrist = pick(`wrist.${side}`)

    for (const finger of FINGER_IDS) {
      s.fingers[finger] = [
        pick(`finger_${finger}1.${side}`),
        pick(`finger_${finger}2.${side}`),
        pick(`finger_${finger}3.${side}`),
      ]
    }
    return s
  }

  private bindArmBones(root: THREE.Object3D) {
    this.armBonesL = this.bindSideBones(root, 'l')
    this.armBonesR = this.bindSideBones(root, 'r')

    if (!this.armBonesL.limb.shoulder && !this.armBonesR.limb.shoulder) {
      console.warn(
        'Arms skeleton: no shoulder.l/r bones found — per-arm editing disabled',
      )
    } else {
      const fingers =
        this.armBonesL.fingers.index[0] || this.armBonesR.fingers.index[0]
      console.info(
        'Arms bones bound',
        {
          leftWrist: !!this.armBonesL.limb.wrist,
          rightWrist: !!this.armBonesR.limb.wrist,
          fingers: !!fingers,
        },
      )
    }
  }

  private applyJoint(
    rest: ArmBoneRest | null,
    pose: ArmJointPose,
    soloScale: number,
  ) {
    if (!rest) return
    const b = rest.bone
    b.position.set(
      rest.pos.x + pose.pos.x,
      rest.pos.y + pose.pos.y,
      rest.pos.z + pose.pos.z,
    )
    this._tmpEuler.set(pose.rot.x, pose.rot.y, pose.rot.z, 'XYZ')
    this._tmpQuat.setFromEuler(this._tmpEuler)
    b.quaternion.copy(rest.quat).multiply(this._tmpQuat)
    b.scale.set(
      rest.scale.x * soloScale,
      rest.scale.y * soloScale,
      rest.scale.z * soloScale,
    )
  }

  /**
   * Apply finger curl/spread across 3 segments.
   * Curl → local X bend; spread → local Z on the base joint only.
   * Thumb uses a slightly different spread axis (Y) for opposition.
   */
  private applyFinger(
    segs: [ArmBoneRest | null, ArmBoneRest | null, ArmBoneRest | null],
    pose: FingerPose,
    finger: FingerId,
  ) {
    const weights = [1, 0.85, 0.7]
    for (let i = 0; i < 3; i++) {
      const rest = segs[i]
      if (!rest) continue
      const curl = pose.curl * weights[i]
      const spread = i === 0 ? pose.spread : 0
      let rx = curl
      let ry = 0
      let rz = spread
      if (finger === 'thumb') {
        // Thumb opposition: curl on Y, spread on X tends to look better on many rigs
        rx = spread
        ry = curl
        rz = 0
      }
      this._tmpEuler.set(rx, ry, rz, 'XYZ')
      this._tmpQuat.setFromEuler(this._tmpEuler)
      rest.bone.position.copy(rest.pos)
      rest.bone.quaternion.copy(rest.quat).multiply(this._tmpQuat)
      rest.bone.scale.copy(rest.scale)
    }
  }

  private applyArmChain(
    bones: ArmSideBones,
    chain: ArmChainPose,
    visible: boolean,
  ) {
    // Collapse at shoulder so the whole limb disappears when soloing the other side.
    const shoulderScale = visible ? 1 : 0.001
    this.applyJoint(bones.limb.shoulder, chain.shoulder, shoulderScale)
    this.applyJoint(bones.limb.bicep, chain.bicep, 1)
    this.applyJoint(bones.limb.forearm, chain.forearm, 1)
    this.applyJoint(bones.limb.wrist, chain.wrist, 1)
    for (const finger of FINGER_IDS) {
      this.applyFinger(bones.fingers[finger], chain.fingers[finger], finger)
    }
  }

  /** Push current vmConfig onto gun / arms Object3Ds + per-arm bones. */
  private applyViewmodelParts() {
    const c = this.vmConfig
    if (this.vmGun) {
      this.vmGun.scale.setScalar(this.gunUnitScale * c.scale)
      // Center was computed at unit scale; re-center after scale change.
      this.vmGun.position.set(
        this.gunCenter.x * c.scale + c.gunOffset.x,
        this.gunCenter.y * c.scale + c.gunOffset.y,
        this.gunCenter.z * c.scale + c.gunOffset.z,
      )
      this.vmGun.rotation.set(c.modelRot.x, c.modelRot.y, c.modelRot.z)
    }
    if (this.vmArms) {
      const s = c.arms.scale
      this.vmArms.scale.setScalar(this.armsUnitScale * s)
      this.vmArms.position.set(
        this.armsCenter.x * s + c.arms.pos.x,
        this.armsCenter.y * s + c.arms.pos.y,
        this.armsCenter.z * s + c.arms.pos.z,
      )
      this.vmArms.rotation.set(c.arms.rot.x, c.arms.rot.y, c.arms.rot.z)

      const showL = this.vmArmSolo !== 'right'
      const showR = this.vmArmSolo !== 'left'
      this.applyArmChain(this.armBonesL, c.arms.left, showL)
      this.applyArmChain(this.armBonesR, c.arms.right, showR)
      this.vmArms.updateMatrixWorld(true)
    }
  }

  private async loadViewmodel() {
    const root = new THREE.Group()
    const loader = new GLTFLoader()
    this.vmConfig = cloneViewmodelConfig(
      VIEWMODEL as unknown as ViewmodelConfig,
    )

    // Gun + arms load independently so one failure still leaves a usable viewmodel.
    const [gunResult, armsResult] = await Promise.allSettled([
      loader.loadAsync('/models/sniper.glb'),
      loader.loadAsync('/models/arms.glb'),
    ])

    if (gunResult.status === 'fulfilled') {
      const model = gunResult.value.scene
      this.prepareViewmesh(model)
      // Quaternius sniper: stock→barrel is already -Z, scope +Y (camera-forward).
      model.rotation.set(0, 0, 0)
      const measured = this.measureUnitAsset(model)
      this.gunUnitScale = measured.unitScale
      this.gunCenter.copy(measured.center)
      this.vmGun = model
      root.add(model)
    } else {
      console.warn('Sniper viewmodel load failed, using placeholder', gunResult.reason)
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

    if (armsResult.status === 'fulfilled') {
      const arms = armsResult.value.scene
      this.prepareViewmesh(arms)
      arms.rotation.set(0, 0, 0)
      const measured = this.measureUnitAsset(arms)
      this.armsUnitScale = measured.unitScale
      this.armsCenter.copy(measured.center)
      this.bindArmBones(arms)
      this.vmArms = arms
      root.add(arms)
    } else {
      console.warn('Arms viewmodel load failed', armsResult.reason)
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
    stepRespawns(this.dummies, this.respawns, dt)

    // Animate before fire so skinned-mesh hitscan uses this frame's pose
    for (const mixer of this.dummyMixers.values()) {
      mixer.update(dt)
    }

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

    const bobA = this.vmFreezeBob ? 0 : this.bobAmount
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
      const ads =
        this.vmForceAds != null ? this.vmForceAds : this.sniper.adsBlend
      const { hipPos, hipRot, adsPos, adsRot, hideAds } = this.vmConfig
      const hip = new THREE.Vector3(hipPos.x, hipPos.y, hipPos.z)
      const scoped = new THREE.Vector3(adsPos.x, adsPos.y, adsPos.z)
      this.viewmodel.position.lerpVectors(hip, scoped, ads)
      this.viewmodel.position.x += bobGunX
      this.viewmodel.position.y +=
        bobGunY - this.landOffset * (this.vmFreezeBob ? 0 : VIEW_BOB.landGunMul)
      this.viewmodel.position.z += bobGunZ
      const recoilKick = this.vmFreezeBob
        ? 0
        : this.sniper.recoil * SNIPER.viewmodelRecoil
      this.viewmodel.rotation.set(
        hipRot.x * (1 - ads) + adsRot.x * ads + recoilKick + bobGunPitch,
        hipRot.y * (1 - ads) + adsRot.y * ads,
        hipRot.z * (1 - ads) + adsRot.z * ads + bobGunRoll,
      )
      this.viewmodel.visible = this.vmKeepVisible || ads < hideAds
    }

    // dummy visuals — hit surfaces ARE the model meshes
    for (const d of this.dummies) {
      const mesh = this.dummyMeshes.get(d.id)
      if (!mesh) continue

      const wasAlive = mesh.userData.wasAlive !== false
      if (d.alive && !wasAlive) {
        this.playDummyIdle(mesh)
      }
      mesh.userData.wasAlive = d.alive

      // stay visible during death pose until respawn; hide only if no death anim
      const dying = !d.alive && mesh.userData.animState === 'death'
      mesh.visible = d.alive || dying

      if (!d.alive && !dying) continue
      this.paintDummyMeshes(mesh, d.alive ? d.hp / d.maxHp : 0)
    }

    // Local player pose hitboxes (crouch / slide / jump) — debug + future 1v1
    if (this.playerHitboxHelper) {
      this.syncHitboxHelper(this.playerHitboxHelper, playerVolumes(this.player))
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
