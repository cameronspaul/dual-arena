/**
 * Visual spawn markers, barrier wall previews, + floor snap for the level editor.
 */
import * as THREE from 'three'
import type { BarrierWall } from '../maps/barriers'
import type { SpawnPoint, TeamId } from '../maps/spawns'

const TEAM_COLOR: Record<TeamId, number> = {
  blue: 0x3b82f6,
  red: 0xef4444,
}

const BARRIER_COLOR = 0xf59e0b
const BARRIER_EDGE = 0xfbbf24

const _ray = new THREE.Raycaster()
const _origin = new THREE.Vector3()
const _down = new THREE.Vector3(0, -1, 0)

export class LevelEditorSystem {
  readonly root = new THREE.Group()
  private markers = new Map<string, THREE.Object3D>()
  private barrierMeshes = new Map<string, THREE.Object3D>()
  private hitMeshes: THREE.Object3D[] = []
  private active = false

  constructor() {
    this.root.name = 'level-editor-markers'
    this.root.visible = false
    this.root.frustumCulled = false
  }

  setActive(active: boolean) {
    this.active = active
    this.root.visible = active
    // Re-assert after map loads / scene swaps so gizmos never stay hidden
    if (active) {
      this.root.frustumCulled = false
      for (const obj of this.barrierMeshes.values()) {
        obj.visible = true
        obj.frustumCulled = false
      }
      for (const obj of this.markers.values()) {
        obj.visible = true
      }
    }
  }

  isActive() {
    return this.active
  }

  setHitMeshes(meshes: THREE.Object3D[]) {
    this.hitMeshes = meshes
  }

  /**
   * Raycast down from above (x,z) for a walkable floor Y.
   * Returns null if no mesh floor (caller may keep current Y or 0).
   */
  sampleFloorY(x: number, z: number, fromY = 80): number | null {
    if (this.hitMeshes.length === 0) {
      // Procedural range: flat y=0
      return 0
    }
    _origin.set(x, fromY, z)
    _ray.set(_origin, _down)
    _ray.near = 0
    _ray.far = fromY + 40
    const hits = _ray.intersectObjects(this.hitMeshes, false)
    for (const h of hits) {
      const n = h.face?.normal
      if (n) {
        const wn = n.clone().transformDirection(h.object.matrixWorld).normalize()
        if (wn.dot(_down) > 0) wn.negate()
        if (wn.y < 0.35) continue
      }
      return Math.max(0, h.point.y)
    }
    return null
  }

  sync(spawns: SpawnPoint[]) {
    const keep = new Set(spawns.map((s) => s.id))
    for (const [id, obj] of this.markers) {
      if (!keep.has(id)) {
        this.root.remove(obj)
        disposeObject(obj)
        this.markers.delete(id)
      }
    }
    for (const s of spawns) {
      let obj = this.markers.get(s.id)
      if (!obj) {
        obj = buildMarker(s.team)
        obj.name = `spawn-${s.id}`
        this.markers.set(s.id, obj)
        this.root.add(obj)
      }
      // Update team color if changed
      setMarkerTeam(obj, s.team)
      obj.position.set(s.x, s.y, s.z)
      obj.rotation.y = s.yaw
    }
  }

  /** Soft pulse on the newest / selected marker */
  highlight(id: string | null) {
    for (const [mid, obj] of this.markers) {
      const ring = obj.getObjectByName('ring') as THREE.Mesh | undefined
      if (!ring?.material || Array.isArray(ring.material)) continue
      const mat = ring.material as THREE.MeshBasicMaterial
      mat.opacity = mid === id ? 0.95 : 0.55
    }
  }

  syncBarriers(barriers: BarrierWall[]) {
    const keep = new Set(barriers.map((b) => b.id))
    for (const [id, obj] of this.barrierMeshes) {
      if (!keep.has(id)) {
        this.root.remove(obj)
        disposeObject(obj)
        this.barrierMeshes.delete(id)
      }
    }
    for (const b of barriers) {
      let obj = this.barrierMeshes.get(b.id)
      if (!obj) {
        obj = buildBarrierMesh()
        obj.name = `barrier-${b.id}`
        this.barrierMeshes.set(b.id, obj)
        this.root.add(obj)
      }
      // Unit cube scaled to wall extents — keep culled off so thin slabs
      // never drop out of the frustum from bad local bounds.
      obj.position.set(b.x, b.y, b.z)
      obj.scale.set(
        Math.max(0.05, b.width),
        Math.max(0.05, b.height),
        Math.max(0.05, b.depth),
      )
      obj.visible = true
      obj.updateMatrixWorld(true)
    }
  }

  highlightBarrier(id: string | null) {
    for (const [bid, obj] of this.barrierMeshes) {
      const selected = bid === id
      const fill = obj.getObjectByName('fill') as THREE.Mesh | undefined
      if (fill?.material && !Array.isArray(fill.material)) {
        const mat = fill.material as THREE.MeshBasicMaterial
        mat.opacity = selected ? 0.55 : 0.38
      }
      const edges = obj.getObjectByName('edges') as THREE.LineSegments | undefined
      if (edges?.material && !Array.isArray(edges.material)) {
        const mat = edges.material as THREE.LineBasicMaterial
        mat.opacity = selected ? 1 : 0.95
        mat.linewidth = 1
      }
    }
  }

  dispose() {
    for (const obj of this.markers.values()) {
      this.root.remove(obj)
      disposeObject(obj)
    }
    this.markers.clear()
    for (const obj of this.barrierMeshes.values()) {
      this.root.remove(obj)
      disposeObject(obj)
    }
    this.barrierMeshes.clear()
    this.root.removeFromParent()
  }
}

function buildBarrierMesh(): THREE.Group {
  const g = new THREE.Group()
  // Editor gizmo: always draw on top of map geo so thin walls stay visible
  // (fog / depth / translucency used to hide them intermittently).
  g.renderOrder = 1000
  g.frustumCulled = false

  const boxGeo = new THREE.BoxGeometry(1, 1, 1)

  const fill = new THREE.Mesh(
    boxGeo,
    new THREE.MeshBasicMaterial({
      color: BARRIER_COLOR,
      transparent: true,
      opacity: 0.38,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    }),
  )
  fill.name = 'fill'
  fill.renderOrder = 1000
  fill.frustumCulled = false
  g.add(fill)

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(boxGeo),
    new THREE.LineBasicMaterial({
      color: BARRIER_EDGE,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  )
  edges.name = 'edges'
  edges.renderOrder = 1001
  edges.frustumCulled = false
  g.add(edges)

  // Extra mid-plane so edge-on thin walls still read as a solid strip
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: BARRIER_EDGE,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    }),
  )
  stripe.name = 'stripe'
  stripe.renderOrder = 1002
  stripe.frustumCulled = false
  g.add(stripe)

  return g
}

function buildMarker(team: TeamId): THREE.Group {
  const g = new THREE.Group()
  const color = TEAM_COLOR[team]

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 1.6, 10),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthTest: true,
    }),
  )
  pole.position.y = 0.8
  pole.name = 'pole'
  g.add(pole)

  // Arrow / facing indicator
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.45, 8),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
    }),
  )
  arrow.position.set(0, 1.55, -0.35)
  arrow.rotation.x = -Math.PI / 2
  arrow.name = 'arrow'
  g.add(arrow)

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.5, 24),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.03
  ring.name = 'ring'
  g.add(ring)

  // Small team plate
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(0.32, 20),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  pad.rotation.x = -Math.PI / 2
  pad.position.y = 0.02
  pad.name = 'pad'
  g.add(pad)

  return g
}

function setMarkerTeam(obj: THREE.Object3D, team: TeamId) {
  const color = TEAM_COLOR[team]
  obj.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const m = child.material
    if (m && !Array.isArray(m) && 'color' in m) {
      ;(m as THREE.MeshBasicMaterial).color.setHex(color)
    }
  })
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose()
      const m = child.material
      if (Array.isArray(m)) m.forEach((x) => x.dispose())
      else m.dispose()
    }
  })
}
