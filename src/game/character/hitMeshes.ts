/**
 * Character mesh hitscan surfaces, debug wireframes, and arm/chest weight splits.
 * Pure Three helpers — no GameEngine state.
 */
import * as THREE from 'three'
import { DEBUG, DUMMY, SNIPER } from '../core/config'
import type { HitZone, RayHit } from '../core/types'

/** Mesh name → damage zone. Head / legs / arms exclusive; shoulders count as chest. */
export function meshNameToZone(name: string): HitZone {
  if (/head/i.test(name)) return 'head'
  if (/leg|feet|foot/i.test(name)) return 'leg'
  if (/arm|hand|wrist|finger/i.test(name)) return 'arm'
  return 'chest'
}

/** Debug wireframe: head red · chest cyan · arms orange · legs yellow */
export function zoneWireColor(zone: HitZone): number {
  if (zone === 'head') return 0xff4466
  if (zone === 'leg') return 0xffee44
  if (zone === 'arm') return 0xff8800
  return 0x44ccff
}

export function damageForZone(zone: HitZone): number {
  if (zone === 'head') return SNIPER.headDamage
  if (zone === 'leg') return SNIPER.legDamage
  if (zone === 'arm') return SNIPER.armDamage
  return SNIPER.chestDamage
}

/**
 * Bones that count as arm surface for weight splits.
 * Shoulders stay chest — they bleed into pecs/collar.
 */
export function isArmBoneName(name: string): boolean {
  if (/shoulder/i.test(name)) return false
  return /upperarm|lowerarm|forearm|wrist|hand|thumb|index|middle|ring|pinky|finger/i.test(
    name,
  )
}

/**
 * Tag every drawable mesh as a hitscan surface.
 * Also builds a skinned wireframe overlay for debug hit zones.
 */
export function registerHitMeshes(root: THREE.Group, ownerId: string) {
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
    const zone = meshNameToZone(o.name)
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
      color: zoneWireColor(zone),
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
    o.add(wire)
    wireOverlays.push(wire)
  }

  root.userData.hitMeshes = hitMeshes
  root.userData.hitWireOverlays = wireOverlays
  // Skin paint targets (may diverge from hitMeshes after arm/chest split)
  root.userData.paintMeshes = [...hitMeshes]
}

/**
 * Partition skinned triangles: verts weighted to arm bones → arm,
 * remaining → torso. Shares original attributes; only the index buffer differs.
 */
export function splitSkinnedGeometryByArmBones(
  mesh: THREE.SkinnedMesh,
): { arm: THREE.BufferGeometry | null; torso: THREE.BufferGeometry | null } | null {
  const skel = mesh.skeleton
  const geo = mesh.geometry
  const skinIndex = geo.getAttribute('skinIndex') as THREE.BufferAttribute | null
  const skinWeight = geo.getAttribute('skinWeight') as THREE.BufferAttribute | null
  if (!skel || !skinIndex || !skinWeight) return null

  const armBoneIdx = new Set<number>()
  for (let i = 0; i < skel.bones.length; i++) {
    if (isArmBoneName(skel.bones[i].name)) armBoneIdx.add(i)
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
 * the same skeleton as the source mesh.
 */
export function makeZoneProxyMesh(
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
  hit.position.copy(source.position)
  hit.quaternion.copy(source.quaternion)
  hit.scale.copy(source.scale)

  const wireMat = new THREE.MeshBasicMaterial({
    color: zoneWireColor(zone),
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
 * man.glb skins arms into Suit_Body. Split each chest skinned mesh by arm
 * bone weights into arm + torso geometries for correct zone wireframes.
 */
export function splitChestMeshesByArmWeights(root: THREE.Group, ownerId: string) {
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

  for (let i = 0; i < hitMeshes.length; i++) {
    const m = hitMeshes[i]
    if (!toSplit.includes(m as THREE.SkinnedMesh)) {
      nextHits.push(m)
      if (wireOverlays[i]) nextWires.push(wireOverlays[i])
    }
  }

  for (const mesh of toSplit) {
    const split = splitSkinnedGeometryByArmBones(mesh)
    const wi = hitMeshes.indexOf(mesh)
    if (wi >= 0 && wireOverlays[wi]) {
      wireOverlays[wi].visible = false
      wireOverlays[wi].userData.skipHitbox = true
    }

    if (!split) {
      nextHits.push(mesh)
      if (wi >= 0 && wireOverlays[wi]) {
        wireOverlays[wi].visible = DEBUG.showHitboxes
        nextWires.push(wireOverlays[wi])
      }
      continue
    }

    mesh.userData.hitZone = undefined

    if (split.arm) {
      const armProxy = makeZoneProxyMesh(
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
      const chestProxy = makeZoneProxyMesh(
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

/** Damage tint on skin materials + toggle zone wireframe overlays. */
export function paintDummyMeshes(root: THREE.Group, hpRatio: number) {
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

/** Procedural fallback if man.glb fails to load. */
export function makePlaceholderDummy(ownerId: string): THREE.Group {
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
  registerHitMeshes(g, ownerId)
  return g
}

export type MeshHitscanScratch = {
  raycaster: THREE.Raycaster
  origin: THREE.Vector3
  dir: THREE.Vector3
}

/**
 * Hitscan against character meshes (skinned pose included).
 * Head meshes win near-ties so hairline shots still count as headshots.
 */
export function castMeshHitscan(
  scratch: MeshHitscanScratch,
  targets: THREE.Object3D[],
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  maxRange: number,
): RayHit | null {
  scratch.origin.set(origin.x, origin.y, origin.z)
  scratch.dir.set(dir.x, dir.y, dir.z).normalize()
  scratch.raycaster.set(scratch.origin, scratch.dir)
  scratch.raycaster.near = 0
  scratch.raycaster.far = maxRange

  if (targets.length === 0) return null

  const hits = scratch.raycaster.intersectObjects(targets, false)
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

  const n = best.normal ?? scratch.dir.clone().negate()
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

/** Collect visible hit meshes from alive dummy roots (updates world matrices). */
export function collectDummyHitTargets(
  dummyIds: { id: string; alive: boolean }[],
  meshes: Map<string, THREE.Group>,
): THREE.Object3D[] {
  const targets: THREE.Object3D[] = []
  for (const d of dummyIds) {
    if (!d.alive) continue
    const root = meshes.get(d.id)
    if (!root || !root.visible) continue
    root.updateWorldMatrix(true, true)
    const hitMeshes = root.userData.hitMeshes as THREE.Mesh[] | undefined
    if (!hitMeshes) continue
    for (const m of hitMeshes) {
      if (m.visible) targets.push(m)
    }
  }
  return targets
}
