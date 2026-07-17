/**
 * In-game barrier presentation: fixed no-entry signs along one face.
 * Collision is always full-wall. Signs sit on a fixed spacing grid and only
 * fade in when the player is very close — they never slide with movement.
 */
import * as THREE from 'three'
import {
  BARRIER_INFINITE_EXTENT,
  barrierToAabb,
  type BarrierWall,
} from '../maps/barriers'
import type { AABB, Vec3 } from '../core/types'

/** Fixed spacing between sign positions along the wall (metres). */
const SIGN_SPACING = 3.5
/**
 * Only consider grid signs within this half-span of the player along the wall.
 * Far plates stay dormant (not the whole wall lit at once).
 */
const ACTIVE_HALF_SPAN = 8
/** Sign diameter in world metres. */
const SIGN_SIZE = 1.05
/** Centre of the sign above the wall base. */
const SIGN_Y_OFFSET = 1.55
/** Stand-off so signs sit just outside the collision face. */
const FACE_EPS = 0.05

/** Fully visible within this distance to a sign (m). */
const PROX_FULL = 1.6
/** Invisible beyond this distance to a sign (m). */
const PROX_FADE = 3.2

/** Max concurrent active sign meshes per wall (pool). */
const POOL_SIZE = 8

const SIGN_BASE_OPACITY = 1
const SIGN_URL = '/env/no_entry.png'

type WallLayout = {
  alongX: boolean
  face: 1 | -1
  halfThin: number
  /** Half-length of the wall along its long axis. */
  halfLen: number
  cx: number
  cz: number
  signY: number
  rotY: number
}

type SignSlot = {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  /** Fixed grid parameter currently bound, or null if free. */
  gridT: number | null
  fade: number
}

type WallVisualState = {
  group: THREE.Group
  aabb: AABB
  layout: WallLayout
  signs: SignSlot[]
}

export class BarrierVisuals {
  readonly root = new THREE.Group()
  private walls = new Map<string, WallVisualState>()
  private signTex: THREE.Texture | null = null
  private signMatTemplate: THREE.MeshBasicMaterial | null = null
  private signGeo: THREE.CircleGeometry | null = null
  private pendingBarriers: BarrierWall[] | null = null
  private loadStarted = false

  constructor() {
    this.root.name = 'barrier-visuals'
  }

  sync(barriers: BarrierWall[]) {
    if (!this.signMatTemplate) {
      this.pendingBarriers = barriers.map((b) => ({ ...b }))
      this.beginLoad()
      return
    }
    this.pendingBarriers = null
    this.rebuild(barriers)
  }

  /**
   * Fade fixed grid signs by distance. Positions never follow the player —
   * only which nearby grid cells are active changes.
   */
  update(viewer: Vec3, alwaysVisible = false) {
    for (const state of this.walls.values()) {
      updateWallSigns(state, viewer, alwaysVisible)
    }
  }

  dispose() {
    for (const [id, state] of this.walls) {
      this.disposeWall(id, state)
    }
    this.walls.clear()
    this.signGeo?.dispose()
    this.signMatTemplate?.dispose()
    this.signTex?.dispose()
    this.signGeo = null
    this.signMatTemplate = null
    this.signTex = null
    this.pendingBarriers = null
    this.root.removeFromParent()
  }

  private beginLoad() {
    if (this.loadStarted) return
    this.loadStarted = true

    const loader = new THREE.TextureLoader()
    loader.load(
      SIGN_URL,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = 4
        tex.needsUpdate = true
        this.signTex = tex
        this.finishLoad(tex)
      },
      undefined,
      () => {
        this.signTex = makeNoEntryTexture()
        this.finishLoad(this.signTex)
      },
    )
  }

  private finishLoad(tex: THREE.Texture) {
    this.signMatTemplate = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: SIGN_BASE_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      toneMapped: false,
      alphaTest: 0.05,
    })
    this.signGeo = new THREE.CircleGeometry(0.5, 48)
    if (this.pendingBarriers) {
      this.rebuild(this.pendingBarriers)
      this.pendingBarriers = null
    }
  }

  private rebuild(barriers: BarrierWall[]) {
    const keep = new Set(barriers.map((b) => b.id))
    for (const [id, state] of this.walls) {
      if (!keep.has(id)) this.disposeWall(id, state)
    }
    for (const b of barriers) {
      let state = this.walls.get(b.id)
      if (state) {
        disposeSlots(state)
        clearGroup(state.group)
      } else {
        const group = new THREE.Group()
        group.name = `barrier-vis-${b.id}`
        this.root.add(group)
        state = {
          group,
          aabb: barrierToAabb(b),
          layout: layoutFromBarrier(b),
          signs: [],
        }
        this.walls.set(b.id, state)
      }
      state.aabb = barrierToAabb(b)
      state.layout = layoutFromBarrier(b)
      state.signs = createSignPool(
        state.group,
        this.signMatTemplate!,
        this.signGeo!,
      )
    }
  }

  private disposeWall(id: string, state: WallVisualState) {
    disposeSlots(state)
    clearGroup(state.group)
    this.root.remove(state.group)
    this.walls.delete(id)
  }
}

function layoutFromBarrier(b: BarrierWall): WallLayout {
  const alongX = b.width >= b.depth
  const thin = alongX ? b.depth : b.width
  const halfThin = thin * 0.5 + FACE_EPS
  let halfLen = (alongX ? b.width : b.depth) * 0.5
  if (b.infiniteWidth) halfLen = BARRIER_INFINITE_EXTENT * 0.5

  let wallHeight = b.height
  if (b.infiniteHeight) wallHeight = Math.max(wallHeight, 3.5)
  wallHeight = Math.min(wallHeight, 5)

  const baseY = b.infiniteHeight
    ? Math.max(0, b.y - b.height * 0.5)
    : b.y - b.height * 0.5
  const signY = baseY + Math.min(SIGN_Y_OFFSET, wallHeight * 0.55)
  const face: 1 | -1 = b.signFace === -1 ? -1 : 1

  let rotY = 0
  if (alongX) {
    if (face < 0) rotY = Math.PI
  } else {
    rotY = face > 0 ? -Math.PI / 2 : Math.PI / 2
  }

  return {
    alongX,
    face,
    halfThin,
    halfLen,
    cx: b.x,
    cz: b.z,
    signY,
    rotY,
  }
}

function createSignPool(
  group: THREE.Group,
  template: THREE.MeshBasicMaterial,
  geo: THREE.CircleGeometry,
): SignSlot[] {
  const signs: SignSlot[] = []
  for (let i = 0; i < POOL_SIZE; i++) {
    const mat = template.clone()
    mat.opacity = 0
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = 'no-entry-sign'
    mesh.scale.set(SIGN_SIZE, SIGN_SIZE, 1)
    mesh.visible = false
    group.add(mesh)
    signs.push({ mesh, mat, gridT: null, fade: 0 })
  }
  return signs
}

function updateWallSigns(
  state: WallVisualState,
  viewer: Vec3,
  alwaysVisible: boolean,
) {
  const L = state.layout

  // Too far from the wall slab entirely — hide everything.
  const distPlane = distPointAabb(viewer, state.aabb)
  if (!alwaysVisible && distPlane > PROX_FADE + 0.5) {
    for (const s of state.signs) {
      s.gridT = null
      s.fade = 0
      s.mesh.visible = false
      s.mat.opacity = 0
    }
    return
  }

  // Player projection onto the long axis.
  const tView = L.alongX ? viewer.x - L.cx : viewer.z - L.cz

  // Fixed grid cells near the player (never sub-step / slide with movement).
  const wanted = fixedGridNear(tView, L.halfLen)
  const wantedSet = new Set(wanted)

  // Keep slots already bound to a wanted grid cell; free the rest for reuse.
  const usedT = new Set<number>()
  for (const slot of state.signs) {
    if (slot.gridT != null && wantedSet.has(slot.gridT)) {
      usedT.add(slot.gridT)
    } else {
      slot.gridT = null
    }
  }

  // Bind free slots to missing grid cells.
  for (const t of wanted) {
    if (usedT.has(t)) continue
    const free = state.signs.find((s) => s.gridT == null)
    if (!free) break
    free.gridT = t
    const pos = signWorldPos(L, t)
    free.mesh.position.set(pos.x, pos.y, pos.z)
    free.mesh.rotation.y = L.rotY
    free.fade = 0 // appear in place — never tween position
    usedT.add(t)
  }

  // Fade each bound sign by distance to its fixed world position.
  for (const slot of state.signs) {
    if (slot.gridT == null) {
      slot.fade = 0
      slot.mesh.visible = false
      slot.mat.opacity = 0
      continue
    }

    const pos = signWorldPos(L, slot.gridT)
    // Keep transform locked to grid (defensive — no drift)
    slot.mesh.position.set(pos.x, pos.y, pos.z)
    slot.mesh.rotation.y = L.rotY

    const dist = Math.hypot(
      viewer.x - pos.x,
      viewer.y - pos.y,
      viewer.z - pos.z,
    )
    const target = alwaysVisible
      ? Math.max(0.4, fadeFromDistance(dist * 0.5))
      : fadeFromDistance(dist)

    slot.fade += (target - slot.fade) * (alwaysVisible ? 0.35 : 0.28)
    if (slot.fade < 0.02 && target < 0.02) slot.fade = 0
    if (slot.fade > 0.99 && target > 0.99) slot.fade = 1

    slot.mesh.visible = slot.fade > 0.02
    slot.mat.opacity = SIGN_BASE_OPACITY * slot.fade
  }
}

/**
 * World-fixed sign anchors: multiples of SIGN_SPACING along the wall,
 * clipped to the wall length, only those near the player.
 */
function fixedGridNear(tView: number, halfLen: number): number[] {
  const lo = Math.max(-halfLen, tView - ACTIVE_HALF_SPAN)
  const hi = Math.min(halfLen, tView + ACTIVE_HALF_SPAN)
  if (hi < lo) return []

  // Inclusive grid indices covering [lo, hi]
  let i0 = Math.ceil(lo / SIGN_SPACING - 1e-6)
  let i1 = Math.floor(hi / SIGN_SPACING + 1e-6)

  // Always include at least the nearest grid cell when on a short wall
  if (i1 < i0) {
    const nearest = Math.round(clamp(tView, -halfLen, halfLen) / SIGN_SPACING)
    i0 = nearest
    i1 = nearest
  }

  const out: number[] = []
  for (let i = i0; i <= i1; i++) {
    const t = i * SIGN_SPACING
    if (t < -halfLen - 1e-4 || t > halfLen + 1e-4) continue
    out.push(t)
    if (out.length >= POOL_SIZE) break
  }

  // Short finite walls: ensure a centre sign exists near 0 if wall is tiny
  if (out.length === 0 && halfLen > 0.05) {
    out.push(0)
  }
  return out
}

function signWorldPos(L: WallLayout, t: number): Vec3 {
  if (L.alongX) {
    return {
      x: L.cx + t,
      y: L.signY,
      z: L.cz + L.face * (L.halfThin + 0.01),
    }
  }
  return {
    x: L.cx + L.face * (L.halfThin + 0.01),
    y: L.signY,
    z: L.cz + t,
  }
}

function fadeFromDistance(dist: number): number {
  if (dist >= PROX_FADE) return 0
  if (dist <= PROX_FULL) return 1
  return 1 - (dist - PROX_FULL) / (PROX_FADE - PROX_FULL)
}

function distPointAabb(p: Vec3, box: AABB): number {
  const dx = Math.max(box.min.x - p.x, 0, p.x - box.max.x)
  const dy = Math.max(box.min.y - p.y, 0, p.y - box.max.y)
  const dz = Math.max(box.min.z - p.z, 0, p.z - box.max.z)
  return Math.hypot(dx, dy, dz)
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function disposeSlots(state: WallVisualState) {
  for (const s of state.signs) {
    s.mat.dispose()
  }
  state.signs = []
}

function clearGroup(g: THREE.Group) {
  while (g.children.length > 0) g.remove(g.children[0])
}

function makeNoEntryTexture(): THREE.CanvasTexture {
  const s = 512
  const canvas = document.createElement('canvas')
  canvas.width = s
  canvas.height = s
  const ctx = canvas.getContext('2d')!
  const cx = s / 2
  const cy = s / 2
  const r = s * 0.46

  ctx.clearRect(0, 0, s, s)

  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#111111'
  ctx.fill()

  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.94, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.88, 0, Math.PI * 2)
  ctx.fillStyle = '#e30613'
  ctx.fill()

  const barW = r * 1.2
  const barH = r * 0.32
  const br = barH * 0.35
  roundRect(ctx, cx - barW / 2, cy - barH / 2, barW, barH, br)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}
