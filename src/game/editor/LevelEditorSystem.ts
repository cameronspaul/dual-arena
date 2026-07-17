/**
 * Visual spawn markers + floor snap for the level editor.
 */
import * as THREE from 'three'
import type { SpawnPoint, TeamId } from '../maps/spawns'

const TEAM_COLOR: Record<TeamId, number> = {
  blue: 0x3b82f6,
  red: 0xef4444,
}

const _ray = new THREE.Raycaster()
const _origin = new THREE.Vector3()
const _down = new THREE.Vector3(0, -1, 0)

export class LevelEditorSystem {
  readonly root = new THREE.Group()
  private markers = new Map<string, THREE.Object3D>()
  private hitMeshes: THREE.Object3D[] = []
  private active = false

  constructor() {
    this.root.name = 'level-editor-markers'
    this.root.visible = false
  }

  setActive(active: boolean) {
    this.active = active
    this.root.visible = active
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

  dispose() {
    for (const obj of this.markers.values()) {
      this.root.remove(obj)
      disposeObject(obj)
    }
    this.markers.clear()
    this.root.removeFromParent()
  }
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
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    const m = child.material
    if (Array.isArray(m)) m.forEach((x) => x.dispose())
    else m.dispose()
  })
}
