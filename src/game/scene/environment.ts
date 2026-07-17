/**
 * Practice range geometry, lights, and Kenney env textures.
 *
 * Layout (player faces -Z from the firing line):
 *  - Firing bays with dividers + overhead canopy (z ≈ 6–14)
 *  - Range floor with painted lanes + distance markers (10–40 m)
 *  - Mid-range peek cover
 *  - Tall sand berm / backstop at the far end
 *  - Side walls + rear wall so the facility feels enclosed
 */
import * as THREE from 'three'
import type { AABB } from '../core/types'
import {
  isSkyboxId,
  skyboxUrl,
  SKYBOX_FOG,
  type SkyboxId,
} from './skyboxes'

export type { SkyboxId, SkyboxPreference } from './skyboxes'
export {
  SKYBOX_IDS,
  SKYBOX_LABELS,
  resolveSkyboxId,
  normalizeSkyboxPreference,
  isSkyboxId,
  isSkyboxPreference,
} from './skyboxes'

export type RangeBuildResult = {
  floorMat: THREE.MeshStandardMaterial
  coverMat: THREE.MeshStandardMaterial
  coverMeshes: THREE.Mesh[]
  /** Extra colliders added for walls (e.g. far backstop). */
  extraColliders: AABB[]
}

// ── Range layout constants (meters) ──────────────────────────────────────────
/** Firing-line Z — player stands just behind this, looking toward -Z. */
const FIRE_LINE_Z = 6
/** Outer half-width of the enclosed range. */
const HALF_W = 14
/** Far berm face (inner). */
const BERM_Z = -42
/** Rear wall behind the bays. */
const REAR_Z = 14
/** Floor plane extent. */
const FLOOR_W = 36
const FLOOR_D = 64

type BoxSpec = {
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  mat: THREE.Material
  /** When false, visual only (lane paint, signs, etc.). Default true. */
  solid?: boolean
  castShadow?: boolean
  receiveShadow?: boolean
  name?: string
}

function aabbFromBox(b: {
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
}): AABB {
  return {
    min: { x: b.x - b.w / 2, y: b.y - b.h / 2, z: b.z - b.d / 2 },
    max: { x: b.x + b.w / 2, y: b.y + b.h / 2, z: b.z + b.d / 2 },
  }
}

/** Canvas texture for distance placards ("10m", "20m", …). */
function makeDistanceLabel(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(0, 0, 256, 128)
  ctx.strokeStyle = '#f0c040'
  ctx.lineWidth = 8
  ctx.strokeRect(6, 6, 244, 116)
  ctx.fillStyle = '#f5f0e0'
  ctx.font = 'bold 72px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 68)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** "PRACTICE RANGE" / bay number style placard. */
function makeFacilityLabel(
  text: string,
  opts?: { sub?: string; bg?: string; fg?: string },
): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 128
  const ctx = c.getContext('2d')!
  ctx.fillStyle = opts?.bg ?? '#1e2a38'
  ctx.fillRect(0, 0, 512, 128)
  ctx.strokeStyle = opts?.fg ?? '#5a9fd4'
  ctx.lineWidth = 6
  ctx.strokeRect(4, 4, 504, 120)
  ctx.fillStyle = opts?.fg ?? '#e8f0f8'
  ctx.font = 'bold 48px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (opts?.sub) {
    ctx.fillText(text, 256, 48)
    ctx.font = '28px system-ui, sans-serif'
    ctx.fillStyle = '#9ab0c4'
    ctx.fillText(opts.sub, 256, 92)
  } else {
    ctx.fillText(text, 256, 64)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Lights, floor, cover boxes, facility structure, spawn pad. */
export function buildRange(
  scene: THREE.Scene,
  colliders: AABB[],
): RangeBuildResult {
  // ── Lighting ─────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(0xb8d0e8, 0x3a3028, 0.85)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.15)
  sun.position.set(18, 36, 14)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 100
  sun.shadow.camera.left = -45
  sun.shadow.camera.right = 45
  sun.shadow.camera.top = 45
  sun.shadow.camera.bottom = -45
  sun.shadow.bias = -0.0003
  sun.shadow.normalBias = 0.03
  scene.add(sun)

  // Soft fill so the berm / bays aren't pure black
  const fill = new THREE.DirectionalLight(0xa8c4e8, 0.28)
  fill.position.set(-12, 18, -20)
  scene.add(fill)

  // ── Materials ────────────────────────────────────────────────────────────
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x6a6a6a,
    roughness: 0.92,
    metalness: 0.05,
  })
  /** Primary solid (walls, cover) — may get check.png from env load. */
  const coverMat = new THREE.MeshStandardMaterial({
    color: 0x7a7a78,
    roughness: 0.88,
    metalness: 0.05,
  })
  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x6e6c68,
    roughness: 0.94,
    metalness: 0.02,
  })
  const darkConcreteMat = new THREE.MeshStandardMaterial({
    color: 0x4a4844,
    roughness: 0.9,
    metalness: 0.04,
  })
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x3a3e44,
    roughness: 0.45,
    metalness: 0.55,
  })
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x2a2e32,
    roughness: 0.5,
    metalness: 0.4,
  })
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xc9a227,
    roughness: 0.55,
    metalness: 0.15,
  })
  const hazardMat = new THREE.MeshStandardMaterial({
    color: 0xd4a017,
    roughness: 0.7,
    metalness: 0.05,
  })
  const paintMat = new THREE.MeshStandardMaterial({
    color: 0xe8d48a,
    roughness: 0.85,
    metalness: 0,
  })
  const laneMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
  })
  const bermMat = new THREE.MeshStandardMaterial({
    color: 0x5a6a48,
    roughness: 0.98,
    metalness: 0,
  })
  const bermTopMat = new THREE.MeshStandardMaterial({
    color: 0x6b7a52,
    roughness: 0.97,
    metalness: 0,
  })
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x6b4e32,
    roughness: 0.9,
    metalness: 0,
  })
  const rubberMat = new THREE.MeshStandardMaterial({
    color: 0x2c2c2c,
    roughness: 0.95,
    metalness: 0,
  })
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x3a6ea5,
    roughness: 0.55,
    metalness: 0.15,
  })
  const impactMat = new THREE.MeshStandardMaterial({
    color: 0x3d342c,
    roughness: 0.98,
    metalness: 0.02,
  })

  const coverMeshes: THREE.Mesh[] = []
  const extraColliders: AABB[] = []
  const root = new THREE.Group()
  root.name = 'practice-range'
  scene.add(root)

  const addBox = (spec: BoxSpec) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(spec.w, spec.h, spec.d),
      spec.mat,
    )
    mesh.position.set(spec.x, spec.y, spec.z)
    mesh.castShadow = spec.castShadow ?? true
    mesh.receiveShadow = spec.receiveShadow ?? true
    if (spec.name) mesh.name = spec.name
    root.add(mesh)
    coverMeshes.push(mesh)
    if (spec.solid !== false) {
      extraColliders.push(aabbFromBox(spec))
    }
    return mesh
  }

  // ── Floor ────────────────────────────────────────────────────────────────
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_W, FLOOR_D), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, 0, (REAR_Z + BERM_Z) / 2)
  floor.receiveShadow = true
  floor.name = 'range-floor'
  root.add(floor)

  // Slightly raised bay slab under the firing line (visual only —
  // solid wide floor AABBs fight the capsule resolver; range uses y=0 floor).
  addBox({
    x: 0,
    y: 0.04,
    z: (FIRE_LINE_Z + REAR_Z) / 2,
    w: HALF_W * 2 - 0.4,
    h: 0.08,
    d: REAR_Z - FIRE_LINE_Z + 0.4,
    mat: darkConcreteMat,
    solid: false,
    castShadow: false,
    name: 'bay-slab',
  })

  // ── Perimeter walls ──────────────────────────────────────────────────────
  const wallH = 3.2
  const wallT = 0.45
  // Left
  addBox({
    x: -HALF_W,
    y: wallH / 2,
    z: (REAR_Z + BERM_Z) / 2,
    w: wallT,
    h: wallH,
    d: REAR_Z - BERM_Z + 1,
    mat: concreteMat,
    name: 'wall-left',
  })
  // Right
  addBox({
    x: HALF_W,
    y: wallH / 2,
    z: (REAR_Z + BERM_Z) / 2,
    w: wallT,
    h: wallH,
    d: REAR_Z - BERM_Z + 1,
    mat: concreteMat,
    name: 'wall-right',
  })
  // Rear (behind bays)
  addBox({
    x: 0,
    y: wallH / 2,
    z: REAR_Z,
    w: HALF_W * 2 + wallT,
    h: wallH,
    d: wallT,
    mat: concreteMat,
    name: 'wall-rear',
  })

  // Side rail caps (visual accent on walls)
  for (const side of [-1, 1] as const) {
    addBox({
      x: side * HALF_W,
      y: wallH + 0.08,
      z: (REAR_Z + BERM_Z) / 2,
      w: 0.55,
      h: 0.16,
      d: REAR_Z - BERM_Z + 1.1,
      mat: accentMat,
      solid: false,
      castShadow: false,
      name: `rail-cap-${side > 0 ? 'r' : 'l'}`,
    })
  }

  // ── Backstop berm ────────────────────────────────────────────────────────
  // Stepped sand berm + rubber impact face
  addBox({
    x: 0,
    y: 2.6,
    z: BERM_Z - 1.2,
    w: HALF_W * 2 - 0.5,
    h: 5.2,
    d: 3.2,
    mat: bermMat,
    name: 'berm-body',
  })
  addBox({
    x: 0,
    y: 5.4,
    z: BERM_Z - 0.4,
    w: HALF_W * 2 - 0.8,
    h: 0.5,
    d: 2.4,
    mat: bermTopMat,
    name: 'berm-top',
  })
  // Dark impact face (bullet sponge)
  addBox({
    x: 0,
    y: 2.4,
    z: BERM_Z + 0.35,
    w: HALF_W * 2 - 1.2,
    h: 4.6,
    d: 0.35,
    mat: impactMat,
    name: 'berm-impact',
  })
  // Low sand lip at base
  addBox({
    x: 0,
    y: 0.35,
    z: BERM_Z + 1.4,
    w: HALF_W * 2 - 1,
    h: 0.7,
    d: 1.6,
    mat: bermTopMat,
    name: 'berm-lip',
  })

  // ── Firing bays ──────────────────────────────────────────────────────────
  const bayCount = 5
  const bayPitch = (HALF_W * 2 - 2) / bayCount
  const bayStartX = -HALF_W + 1 + bayPitch / 2
  const dividerH = 1.55
  const dividerZ = (FIRE_LINE_Z + REAR_Z) / 2
  const dividerD = REAR_Z - FIRE_LINE_Z - 0.6

  // Firing rest / sandbag wall across the line
  addBox({
    x: 0,
    y: 0.45,
    z: FIRE_LINE_Z,
    w: HALF_W * 2 - 1.2,
    h: 0.9,
    d: 0.55,
    mat: rubberMat,
    name: 'firing-rest',
  })
  // Yellow hazard stripe on the rest
  addBox({
    x: 0,
    y: 0.92,
    z: FIRE_LINE_Z,
    w: HALF_W * 2 - 1.4,
    h: 0.06,
    d: 0.58,
    mat: hazardMat,
    solid: false,
    castShadow: false,
    name: 'firing-rest-stripe',
  })

  for (let i = 0; i <= bayCount; i++) {
    const x = bayStartX - bayPitch / 2 + i * bayPitch
    // Vertical divider panels between bays
    addBox({
      x,
      y: dividerH / 2,
      z: dividerZ,
      w: 0.12,
      h: dividerH,
      d: dividerD,
      mat: metalMat,
      name: `bay-div-${i}`,
    })
    // Post at fire line
    addBox({
      x,
      y: 1.1,
      z: FIRE_LINE_Z + 0.05,
      w: 0.18,
      h: 2.2,
      d: 0.18,
      mat: railMat,
      name: `bay-post-${i}`,
    })
  }

  // Bay numbers on fire-line posts (center of each bay)
  for (let i = 0; i < bayCount; i++) {
    const x = bayStartX + i * bayPitch
    const tex = makeFacilityLabel(`${i + 1}`, {
      bg: '#1a2430',
      fg: '#f0c040',
    })
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.28),
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.7,
        metalness: 0.1,
      }),
    )
    plate.position.set(x, 2.05, FIRE_LINE_Z + 0.16)
    plate.castShadow = false
    root.add(plate)
  }

  // Overhead canopy over the bays
  addBox({
    x: 0,
    y: 3.35,
    z: dividerZ,
    w: HALF_W * 2 - 0.6,
    h: 0.18,
    d: dividerD + 1.2,
    mat: metalMat,
    name: 'canopy',
  })
  // Canopy support beams
  for (const side of [-1, 1] as const) {
    addBox({
      x: side * (HALF_W - 0.9),
      y: 2.4,
      z: dividerZ,
      w: 0.22,
      h: 1.9,
      d: 0.22,
      mat: railMat,
      name: `canopy-post-${side > 0 ? 'r' : 'l'}`,
    })
  }
  // Cross beams under canopy
  for (let i = 0; i < 3; i++) {
    const z = FIRE_LINE_Z + 1.2 + i * 2.4
    addBox({
      x: 0,
      y: 3.18,
      z,
      w: HALF_W * 2 - 1.2,
      h: 0.12,
      d: 0.14,
      mat: railMat,
      solid: false,
      castShadow: true,
      name: `canopy-beam-${i}`,
    })
  }

  // Facility sign on rear wall
  {
    const tex = makeFacilityLabel('PRACTICE RANGE', {
      sub: 'LIVE FIRE  ·  EYES & EARS',
      bg: '#152028',
      fg: '#7ec8f0',
    })
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 1.3),
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.65,
        metalness: 0.1,
      }),
    )
    sign.position.set(0, 2.4, REAR_Z - 0.28)
    sign.rotation.y = Math.PI
    root.add(sign)
  }

  // Spawn pad — center bay
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.15, 0.1, 28),
    padMat,
  )
  pad.position.set(0, 0.1, FIRE_LINE_Z + 2.4)
  pad.receiveShadow = true
  pad.name = 'spawn-pad'
  root.add(pad)
  // Inner ring
  const padRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.05, 0.04, 8, 32),
    new THREE.MeshStandardMaterial({
      color: 0x7eb8e8,
      roughness: 0.4,
      metalness: 0.3,
    }),
  )
  padRing.rotation.x = Math.PI / 2
  padRing.position.set(0, 0.16, FIRE_LINE_Z + 2.4)
  root.add(padRing)

  // ── Lane paint + distance markers ────────────────────────────────────────
  // Vertical lane lines downrange
  for (let i = 0; i <= bayCount; i++) {
    const x = bayStartX - bayPitch / 2 + i * bayPitch
    addBox({
      x,
      y: 0.02,
      z: (FIRE_LINE_Z + BERM_Z) / 2,
      w: 0.08,
      h: 0.03,
      d: FIRE_LINE_Z - BERM_Z - 2,
      mat: laneMat,
      solid: false,
      castShadow: false,
      receiveShadow: false,
      name: `lane-line-${i}`,
    })
  }

  // Center dashed aim line
  {
    const z0 = FIRE_LINE_Z - 1
    const z1 = BERM_Z + 3
    const dash = 1.2
    const gap = 0.8
    let z = z0
    let n = 0
    while (z > z1) {
      const len = Math.min(dash, z - z1)
      addBox({
        x: 0,
        y: 0.025,
        z: z - len / 2,
        w: 0.12,
        h: 0.03,
        d: len,
        mat: paintMat,
        solid: false,
        castShadow: false,
        receiveShadow: false,
        name: `center-dash-${n++}`,
      })
      z -= dash + gap
    }
  }

  // Distance rings + placards at 10 / 20 / 30 / 40 m from fire line
  const distances = [10, 20, 30, 40] as const
  for (const m of distances) {
    const z = FIRE_LINE_Z - m
    // Painted cross-line
    addBox({
      x: 0,
      y: 0.022,
      z,
      w: HALF_W * 2 - 1.5,
      h: 0.03,
      d: 0.14,
      mat: m % 20 === 0 ? hazardMat : paintMat,
      solid: false,
      castShadow: false,
      receiveShadow: false,
      name: `dist-line-${m}`,
    })

    // Side posts + placards
    for (const side of [-1, 1] as const) {
      const px = side * (HALF_W - 1.1)
      addBox({
        x: px,
        y: 0.9,
        z,
        w: 0.14,
        h: 1.8,
        d: 0.14,
        mat: railMat,
        name: `dist-post-${m}-${side > 0 ? 'r' : 'l'}`,
      })
      // Small base
      addBox({
        x: px,
        y: 0.08,
        z,
        w: 0.4,
        h: 0.16,
        d: 0.4,
        mat: concreteMat,
        name: `dist-base-${m}-${side > 0 ? 'r' : 'l'}`,
      })

      const tex = makeDistanceLabel(`${m}m`)
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, 0.45),
        new THREE.MeshStandardMaterial({
          map: tex,
          roughness: 0.65,
          metalness: 0.05,
        }),
      )
      // Face toward firing line (+Z)
      plate.position.set(px + side * 0.12, 1.55, z)
      plate.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2
      root.add(plate)
    }
  }

  // ── Target stands (visual frames near dummy homes) ───────────────────────
  const standPositions: { x: number; z: number }[] = [
    { x: 0, z: FIRE_LINE_Z - 12 },
    { x: -5.5, z: FIRE_LINE_Z - 18 },
    { x: 5.5, z: FIRE_LINE_Z - 18 },
    { x: -3.5, z: FIRE_LINE_Z - 28 },
    { x: 4, z: FIRE_LINE_Z - 35 },
  ]
  for (let i = 0; i < standPositions.length; i++) {
    const p = standPositions[i]
    // Base plate
    addBox({
      x: p.x,
      y: 0.06,
      z: p.z + 0.35,
      w: 0.9,
      h: 0.12,
      d: 0.55,
      mat: metalMat,
      name: `stand-base-${i}`,
    })
    // Uprights
    for (const sx of [-0.32, 0.32]) {
      addBox({
        x: p.x + sx,
        y: 0.95,
        z: p.z + 0.35,
        w: 0.08,
        h: 1.8,
        d: 0.08,
        mat: woodMat,
        name: `stand-post-${i}-${sx > 0 ? 'r' : 'l'}`,
      })
    }
    // Top crossbar
    addBox({
      x: p.x,
      y: 1.85,
      z: p.z + 0.35,
      w: 0.75,
      h: 0.08,
      d: 0.08,
      mat: woodMat,
      name: `stand-bar-${i}`,
    })
  }

  // ── Mid-range peek cover (from catalog cover boxes + extras) ─────────────
  // Convert catalog colliders into meshes with mixed materials
  for (const c of colliders) {
    const w = c.max.x - c.min.x
    const h = c.max.y - c.min.y
    const d = c.max.z - c.min.z
    const x = (c.min.x + c.max.x) / 2
    const y = (c.min.y + c.max.y) / 2
    const z = (c.min.z + c.max.z) / 2
    // Taller pieces look like walls; short ones like crates
    const mat = h > 1.4 ? coverMat : h < 0.7 ? rubberMat : darkConcreteMat
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    root.add(mesh)
    coverMeshes.push(mesh)
  }

  // Extra low walls / sandbag rows for peek practice (solid)
  const peekPieces: Omit<BoxSpec, 'mat'>[] = [
    // Left peek wall mid
    { x: -7, y: 0.7, z: FIRE_LINE_Z - 15, w: 0.4, h: 1.4, d: 2.4 },
    // Right crate stack
    { x: 7.5, y: 0.5, z: FIRE_LINE_Z - 14, w: 1.2, h: 1.0, d: 1.2 },
    { x: 7.5, y: 1.35, z: FIRE_LINE_Z - 14, w: 0.9, h: 0.7, d: 0.9 },
    // Center low barricade
    { x: 0, y: 0.4, z: FIRE_LINE_Z - 22, w: 3.2, h: 0.8, d: 0.5 },
    // Far left wall segment
    { x: -8, y: 0.85, z: FIRE_LINE_Z - 30, w: 0.45, h: 1.7, d: 1.8 },
    // Far right sandbag
    { x: 6.5, y: 0.45, z: FIRE_LINE_Z - 26, w: 2.0, h: 0.9, d: 0.7 },
  ]
  for (let i = 0; i < peekPieces.length; i++) {
    const p = peekPieces[i]
    addBox({
      ...p,
      mat: i % 2 === 0 ? coverMat : rubberMat,
      name: `peek-${i}`,
    })
  }

  // Corner watch towers (short elevated platforms — visual + light cover)
  for (const side of [-1, 1] as const) {
    const x = side * (HALF_W - 2.2)
    const z = FIRE_LINE_Z + 3.5
    addBox({
      x,
      y: 0.75,
      z,
      w: 1.6,
      h: 1.5,
      d: 1.6,
      mat: concreteMat,
      name: `tower-base-${side > 0 ? 'r' : 'l'}`,
    })
    addBox({
      x,
      y: 1.62,
      z,
      w: 1.75,
      h: 0.12,
      d: 1.75,
      mat: metalMat,
      name: `tower-deck-${side > 0 ? 'r' : 'l'}`,
    })
    // Railings
    for (const [ox, oz] of [
      [0, 0.8],
      [0, -0.8],
      [0.8, 0],
      [-0.8, 0],
    ] as const) {
      addBox({
        x: x + ox * (Math.abs(ox) > Math.abs(oz) ? 1 : 0.55),
        y: 2.0,
        z: z + oz * (Math.abs(oz) > Math.abs(ox) ? 1 : 0.55),
        w: Math.abs(ox) > Math.abs(oz) ? 0.08 : 1.5,
        h: 0.55,
        d: Math.abs(oz) > Math.abs(ox) ? 0.08 : 1.5,
        mat: railMat,
        solid: false,
        castShadow: true,
        name: `tower-rail-${side > 0 ? 'r' : 'l'}`,
      })
    }
  }

  // Side benches along walls (decoration + light cover)
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i++) {
      const z = FIRE_LINE_Z - 8 - i * 10
      addBox({
        x: side * (HALF_W - 0.85),
        y: 0.28,
        z,
        w: 0.55,
        h: 0.55,
        d: 1.8,
        mat: woodMat,
        name: `bench-${side > 0 ? 'r' : 'l'}-${i}`,
      })
    }
  }

  // ── Safety lights along side walls ───────────────────────────────────────
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 5; i++) {
      const z = FIRE_LINE_Z - 2 - i * 9
      const lamp = new THREE.PointLight(0xffe8c0, 0.45, 12, 2)
      lamp.position.set(side * (HALF_W - 0.55), 2.7, z)
      root.add(lamp)
      // Fixture housing
      addBox({
        x: side * (HALF_W - 0.35),
        y: 2.7,
        z,
        w: 0.25,
        h: 0.18,
        d: 0.35,
        mat: metalMat,
        solid: false,
        castShadow: false,
        name: `lamp-${side > 0 ? 'r' : 'l'}-${i}`,
      })
    }
  }

  return { floorMat, coverMat, coverMeshes, extraColliders }
}

/**
 * Kenney CC0 sky (equirect) + optional prototype floor/cover textures.
 * Falls back silently to solid materials if assets fail to load.
 *
 * @param skybox Concrete skybox for this match (default day). Resolve
 *   `"random"` once at session start so every client shares the same id.
 * @param loadFloorTextures Range-only grid/check materials; skip on GLB maps.
 */
export async function loadEnvironmentTextures(opts: {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  floorMat: THREE.MeshStandardMaterial | null
  coverMat: THREE.MeshStandardMaterial | null
  skybox?: SkyboxId
  loadFloorTextures?: boolean
}): Promise<THREE.Texture[]> {
  const {
    scene,
    renderer,
    floorMat,
    coverMat,
    skybox = 'day',
    loadFloorTextures = true,
  } = opts
  const loaded: THREE.Texture[] = []
  const loader = new THREE.TextureLoader()
  const skyId: SkyboxId = isSkyboxId(skybox) ? skybox : 'day'

  const loadTex = (url: string) =>
    new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(url, resolve, undefined, reject)
    })

  try {
    const sky = await loadTex(skyboxUrl(skyId))
    sky.mapping = THREE.EquirectangularReflectionMapping
    sky.colorSpace = THREE.SRGBColorSpace
    scene.background = sky
    // Soft fog under the equirect so horizon edges blend a bit
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.setHex(SKYBOX_FOG[skyId])
    }
    loaded.push(sky)
  } catch {
    // keep solid background
  }

  if (!loadFloorTextures) return loaded

  try {
    const floorMap = await loadTex('/env/floor/grid.png')
    floorMap.wrapS = THREE.RepeatWrapping
    floorMap.wrapT = THREE.RepeatWrapping
    floorMap.repeat.set(18, 32)
    floorMap.anisotropy = Math.min(
      8,
      renderer.capabilities.getMaxAnisotropy(),
    )
    floorMap.colorSpace = THREE.SRGBColorSpace
    if (floorMat) {
      floorMat.map = floorMap
      floorMat.color.set(0xffffff)
      floorMat.needsUpdate = true
    }
    loaded.push(floorMap)
  } catch {
    // keep solid floor
  }

  try {
    const coverMap = await loadTex('/env/floor/check.png')
    coverMap.wrapS = THREE.RepeatWrapping
    coverMap.wrapT = THREE.RepeatWrapping
    coverMap.repeat.set(2, 2)
    coverMap.colorSpace = THREE.SRGBColorSpace
    if (coverMat) {
      coverMat.map = coverMap
      coverMat.color.set(0xffffff)
      coverMat.needsUpdate = true
    }
    loaded.push(coverMap)
  } catch {
    // keep solid cover
  }

  return loaded
}
