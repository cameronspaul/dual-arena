/**
 * Practice range geometry, lights, and Kenney env textures.
 *
 * Horizontal-row aim corridor (player faces −Z from spawn):
 *  - Single hall with tall side walls
 *  - Rainbow floor bands at each distance (close → far)
 *  - Dummy row left/right on each band
 *  - Spawn platform + control wall behind spawn
 *  - No parallel lane dividers / scattered cover
 */
import * as THREE from 'three'
import type { AABB } from '../core/types'
import { RANGE, rangeColX, rangeRowZ } from '../core/config'
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

/** Actions fired when the player activates a control-wall button. */
export type RangeControlAction =
  | 'mode_stationary'
  | 'mode_moving'
  | 'mode_strafing'
  | 'reset'
  | 'count'

/**
 * Button kinds share one visual/interaction language:
 * - radio: mutually exclusive mode (always one selected)
 * - action: one-shot (reset) — flash only
 * - stepper: cycles a value (rows) — face shows live value
 */
export type RangeControlKind = 'radio' | 'action' | 'stepper'

export type RangeControlButton = {
  id: RangeControlAction
  kind: RangeControlKind
  /** Visual body mesh. */
  mesh: THREE.Mesh
  /** Larger invisible mesh used for ray hits (same transform as mesh). */
  hitMesh: THREE.Mesh
  face: THREE.Mesh
  bodyMat: THREE.MeshStandardMaterial
  faceMat: THREE.MeshStandardMaterial
  /** World-space center. */
  position: THREE.Vector3
  /** Primary title drawn on the face. */
  title: string
  /** Accent color (hex number). */
  accent: number
  /** Mode this radio selects, if kind === 'radio'. */
  mode?: 'stationary' | 'moving' | 'strafing'
}

export type RangeBuildResult = {
  floorMat: THREE.MeshStandardMaterial
  coverMat: THREE.MeshStandardMaterial
  coverMeshes: THREE.Mesh[]
  /** Extra colliders added for walls / berm. */
  extraColliders: AABB[]
  /** Interactable control-wall buttons (look + fire). */
  controlButtons: RangeControlButton[]
  spawn: { x: number; y: number; z: number }
  spawnYaw: number
}

// ── Layout aliases ───────────────────────────────────────────────────────────
const FIRE_LINE_Z = RANGE.fireLineZ
const HALF_W = RANGE.halfW
const BERM_Z = RANGE.bermZ
const REAR_Z = RANGE.rearZ
const WALL_H = RANGE.wallH
const FLOOR_W = HALF_W * 2 + 2
const FLOOR_D = REAR_Z - BERM_Z + 6

type BoxSpec = {
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  mat: THREE.Material
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

/**
 * Shared face texture for control buttons.
 * Keep styling identical so every button feels like the same widget.
 */
export function makeButtonLabel(
  title: string,
  sub?: string,
  opts?: { accent?: string; selected?: boolean },
): THREE.CanvasTexture {
  const accent = opts?.accent ?? '#7ec8f0'
  const selected = opts?.selected ?? false
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const ctx = c.getContext('2d')!
  ctx.fillStyle = selected ? '#1a2836' : '#121820'
  ctx.fillRect(0, 0, 256, 128)
  ctx.strokeStyle = accent
  ctx.lineWidth = selected ? 10 : 6
  ctx.strokeRect(4, 4, 248, 120)
  if (selected) {
    ctx.fillStyle = accent
    ctx.globalAlpha = 0.12
    ctx.fillRect(8, 8, 240, 112)
    ctx.globalAlpha = 1
  }
  ctx.fillStyle = '#f0f4f8'
  ctx.font = 'bold 34px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (sub) {
    ctx.fillText(title, 128, 46)
    ctx.font = 'bold 24px system-ui, sans-serif'
    ctx.fillStyle = accent
    ctx.fillText(sub, 128, 88)
  } else {
    ctx.fillText(title, 128, 64)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Replace a button face map (disposes previous canvas texture). */
export function setButtonFaceLabel(
  faceMat: THREE.MeshStandardMaterial,
  title: string,
  sub?: string,
  opts?: { accent?: string; selected?: boolean },
) {
  const prev = faceMat.map
  faceMat.map = makeButtonLabel(title, sub, opts)
  faceMat.needsUpdate = true
  prev?.dispose()
}

/** Lights, rainbow corridor floor, side walls, berm, spawn, control wall. */
export function buildRange(
  scene: THREE.Scene,
  colliders: AABB[],
): RangeBuildResult {
  // ── Lighting ─────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(0xd0dce8, 0x4a4844, 0.95)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xfff5e8, 1.05)
  sun.position.set(8, 28, 10)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 100
  sun.shadow.camera.left = -30
  sun.shadow.camera.right = 30
  sun.shadow.camera.top = 50
  sun.shadow.camera.bottom = -50
  sun.shadow.bias = -0.0003
  sun.shadow.normalBias = 0.03
  scene.add(sun)

  const fill = new THREE.DirectionalLight(0xb0c4e0, 0.35)
  fill.position.set(-10, 16, -18)
  scene.add(fill)

  // ── Materials ────────────────────────────────────────────────────────────
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x8a8a8a,
    roughness: 0.92,
    metalness: 0.05,
  })
  const coverMat = new THREE.MeshStandardMaterial({
    color: 0x7a7a78,
    roughness: 0.88,
    metalness: 0.05,
  })
  // Light grid walls (aim-trainer hall feel)
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xc8cdd4,
    roughness: 0.88,
    metalness: 0.04,
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
  const hazardMat = new THREE.MeshStandardMaterial({
    color: 0xd4a017,
    roughness: 0.7,
    metalness: 0.05,
  })
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x3a6ea5,
    roughness: 0.55,
    metalness: 0.15,
  })
  const impactMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2e,
    roughness: 0.98,
    metalness: 0.02,
  })
  const bermMat = new THREE.MeshStandardMaterial({
    color: 0x3d3d42,
    roughness: 0.95,
    metalness: 0,
  })
  const podiumMat = new THREE.MeshStandardMaterial({
    color: 0x3a4048,
    roughness: 0.7,
    metalness: 0.2,
  })
  const gridLineMat = new THREE.MeshStandardMaterial({
    color: 0xa8b0ba,
    roughness: 0.9,
    metalness: 0,
  })

  const coverMeshes: THREE.Mesh[] = []
  const extraColliders: AABB[] = []
  const controlButtons: RangeControlButton[] = []
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

  // Catalog cover (normally empty)
  for (const c of colliders) {
    const w = c.max.x - c.min.x
    const h = c.max.y - c.min.y
    const d = c.max.z - c.min.z
    const x = (c.min.x + c.max.x) / 2
    const y = (c.min.y + c.max.y) / 2
    const z = (c.min.z + c.max.z) / 2
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), coverMat)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    root.add(mesh)
    coverMeshes.push(mesh)
  }

  // ── Base floor (under rainbow bands) ─────────────────────────────────────
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR_W, FLOOR_D),
    floorMat,
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, 0, (REAR_Z + BERM_Z) / 2)
  floor.receiveShadow = true
  floor.name = 'range-floor'
  root.add(floor)

  // ── Rainbow horizontal distance bands ────────────────────────────────────
  // Band edges along Z: fire line → midpoints between rows → berm
  const rowZs = RANGE.rowDist.map((_, i) => rangeRowZ(i))
  const bandEdges: number[] = [FIRE_LINE_Z]
  for (let i = 0; i < rowZs.length - 1; i++) {
    bandEdges.push((rowZs[i] + rowZs[i + 1]) / 2)
  }
  // Last dummy band ends halfway to berm; final dark band fills to berm
  const lastRow = rowZs[rowZs.length - 1]
  bandEdges.push((lastRow + BERM_Z) / 2)
  bandEdges.push(BERM_Z + 1.5)

  for (let i = 0; i < bandEdges.length - 1; i++) {
    const zNear = bandEdges[i]
    const zFar = bandEdges[i + 1]
    const depth = Math.abs(zNear - zFar)
    const zMid = (zNear + zFar) / 2
    const color =
      RANGE.bandColors[i] ??
      RANGE.bandColors[RANGE.bandColors.length - 1]
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.88,
      metalness: 0.02,
    })
    addBox({
      x: 0,
      y: 0.015,
      z: zMid,
      w: HALF_W * 2 - 0.35,
      h: 0.03,
      d: depth,
      mat,
      solid: false,
      castShadow: false,
      name: `band-${i}`,
    })
    // Subtle grid lines on each band (stud-like feel)
    const step = 1.5
    for (let gx = -HALF_W + 1.5; gx < HALF_W - 1; gx += step) {
      addBox({
        x: gx,
        y: 0.028,
        z: zMid,
        w: 0.04,
        h: 0.01,
        d: depth * 0.96,
        mat: gridLineMat,
        solid: false,
        castShadow: false,
        receiveShadow: false,
        name: `band-grid-x-${i}-${gx}`,
      })
    }
  }

  // ── Tall corridor side walls ──────────────────────────────────────────────
  const wallT = 0.4
  const rangeMidZ = (REAR_Z + BERM_Z) / 2
  const rangeDepth = REAR_Z - BERM_Z + 1

  addBox({
    x: -HALF_W,
    y: WALL_H / 2,
    z: rangeMidZ,
    w: wallT,
    h: WALL_H,
    d: rangeDepth,
    mat: wallMat,
    name: 'wall-left',
  })
  addBox({
    x: HALF_W,
    y: WALL_H / 2,
    z: rangeMidZ,
    w: wallT,
    h: WALL_H,
    d: rangeDepth,
    mat: wallMat,
    name: 'wall-right',
  })
  addBox({
    x: 0,
    y: WALL_H / 2,
    z: REAR_Z,
    w: HALF_W * 2 + wallT,
    h: WALL_H,
    d: wallT,
    mat: wallMat,
    name: 'wall-rear',
  })

  // Wall grid accents (vertical seams)
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 8; i++) {
      const z = FIRE_LINE_Z - 2 - i * 5.5
      if (z < BERM_Z + 2) break
      addBox({
        x: side * (HALF_W - wallT / 2 - 0.02),
        y: WALL_H / 2,
        z,
        w: 0.04,
        h: WALL_H - 0.2,
        d: 0.06,
        mat: gridLineMat,
        solid: false,
        castShadow: false,
        name: `wall-seam-${side > 0 ? 'r' : 'l'}-${i}`,
      })
    }
  }

  // ── Backstop ─────────────────────────────────────────────────────────────
  addBox({
    x: 0,
    y: WALL_H / 2,
    z: BERM_Z - 0.3,
    w: HALF_W * 2 - 0.2,
    h: WALL_H,
    d: 1.2,
    mat: bermMat,
    name: 'berm-body',
  })
  addBox({
    x: 0,
    y: WALL_H / 2,
    z: BERM_Z + 0.4,
    w: HALF_W * 2 - 0.6,
    h: WALL_H - 0.4,
    d: 0.25,
    mat: impactMat,
    name: 'berm-impact',
  })

  // ── Fire line ────────────────────────────────────────────────────────────
  addBox({
    x: 0,
    y: 0.03,
    z: FIRE_LINE_Z,
    w: HALF_W * 2 - 0.5,
    h: 0.04,
    d: 0.22,
    mat: hazardMat,
    solid: false,
    castShadow: false,
    name: 'fire-line',
  })

  // ── Row floor marks + dummy pads (no distance posts / placards) ──────────
  for (let row = 0; row < RANGE.rowDist.length; row++) {
    const m = RANGE.rowDist[row]
    const z = rangeRowZ(row)

    // Thin cross-line at dummy feet
    addBox({
      x: 0,
      y: 0.032,
      z,
      w: HALF_W * 2 - 0.8,
      h: 0.025,
      d: 0.1,
      mat: hazardMat,
      solid: false,
      castShadow: false,
      name: `row-line-${m}`,
    })

    // Target pads under each column on this band
    for (let col = 0; col < RANGE.colsPerRow; col++) {
      const x = rangeColX(col)
      addBox({
        x,
        y: 0.035,
        z,
        w: 0.9,
        h: 0.05,
        d: 0.55,
        mat: darkConcreteMat,
        solid: false,
        castShadow: false,
        name: `target-pad-c${col}-r${row}`,
      })
    }
  }

  // ── Spawn platform ───────────────────────────────────────────────────────
  const spawnX = RANGE.spawnX
  const spawnZ = RANGE.spawnZ

  addBox({
    x: spawnX,
    y: 0.06,
    z: spawnZ,
    w: 3.4,
    h: 0.12,
    d: 2.8,
    mat: darkConcreteMat,
    solid: false,
    castShadow: false,
    name: 'spawn-platform',
  })
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(1.15, 1.15, 0.1, 28),
    padMat,
  )
  pad.position.set(spawnX, 0.12, spawnZ)
  pad.receiveShadow = true
  pad.name = 'spawn-pad'
  root.add(pad)
  const padRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.05, 0.04, 8, 32),
    new THREE.MeshStandardMaterial({
      color: 0x7eb8e8,
      roughness: 0.4,
      metalness: 0.3,
    }),
  )
  padRing.rotation.x = Math.PI / 2
  padRing.position.set(spawnX, 0.18, spawnZ)
  root.add(padRing)
  // Chevron pointing downrange
  addBox({
    x: spawnX,
    y: 0.14,
    z: spawnZ - 0.75,
    w: 0.32,
    h: 0.04,
    d: 0.5,
    mat: hazardMat,
    solid: false,
    castShadow: false,
    name: 'spawn-chevron',
  })

  // ── Control wall (behind spawn) ──────────────────────────────────────────
  const wallZ = RANGE.controlWallZ
  const btnY = RANGE.controlButtonY

  addBox({
    x: 0,
    y: 0.45,
    z: wallZ + 0.15,
    w: 5.4,
    h: 0.9,
    d: 0.9,
    mat: podiumMat,
    name: 'control-podium',
  })
  addBox({
    x: 0,
    y: 1.55,
    z: wallZ + 0.35,
    w: 5.0,
    h: 1.5,
    d: 0.18,
    mat: metalMat,
    name: 'control-panel',
  })
  {
    const tex = makeFacilityLabel('RANGE CONTROLS', {
      sub: 'LOOK + FIRE  ·  ROWS MOVES SQUAD',
      bg: '#152028',
      fg: '#7ec8f0',
    })
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.7),
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.65,
        metalness: 0.1,
      }),
    )
    sign.position.set(0, 2.15, wallZ + 0.24)
    sign.rotation.y = Math.PI
    root.add(sign)
  }

  type BtnSpec = {
    id: RangeControlAction
    kind: RangeControlKind
    title: string
    sub: string
    accent: string
    x: number
    mode?: 'stationary' | 'moving' | 'strafing'
  }
  // Even spacing across the panel; identical widget size for every action
  const btnSpecs: BtnSpec[] = [
    {
      id: 'mode_stationary',
      kind: 'radio',
      title: 'STILL',
      sub: 'Hold',
      accent: '#6ecf8e',
      x: -1.9,
      mode: 'stationary',
    },
    {
      id: 'mode_moving',
      kind: 'radio',
      title: 'MOVE',
      sub: 'Wander',
      accent: '#7ec8f0',
      x: -0.95,
      mode: 'moving',
    },
    {
      id: 'mode_strafing',
      kind: 'radio',
      title: 'STRAFE',
      sub: 'Side',
      accent: '#e0a84a',
      x: 0,
      mode: 'strafing',
    },
    {
      id: 'reset',
      kind: 'action',
      title: 'RESET',
      sub: 'Home',
      accent: '#e07070',
      x: 0.95,
    },
    {
      id: 'count',
      kind: 'stepper',
      title: 'ROWS',
      sub: `${RANGE.rowDist[0]}m`,
      accent: '#c9a0e8',
      x: 1.9,
    },
  ]

  // Thin divider between mode radios and action/stepper
  addBox({
    x: 0.48,
    y: btnY,
    z: wallZ + 0.28,
    w: 0.06,
    h: 0.7,
    d: 0.08,
    mat: railMat,
    solid: false,
    castShadow: false,
    name: 'ctrl-divider',
  })

  for (const spec of btnSpecs) {
    const faceZ = wallZ + 0.24
    const accentNum = parseInt(spec.accent.slice(1), 16)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1a222c,
      roughness: 0.55,
      metalness: 0.25,
      emissive: 0x000000,
      emissiveIntensity: 0,
    })
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.56, 0.14),
      bodyMat,
    )
    body.position.set(spec.x, btnY, faceZ)
    body.castShadow = true
    body.name = `ctrl-${spec.id}`
    body.userData.rangeAction = spec.id
    root.add(body)
    coverMeshes.push(body)

    // Generous hit volume so aim doesn't need pixel-perfect center
    const hitMat = new THREE.MeshBasicMaterial({
      visible: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const hitMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.7, 0.35),
      hitMat,
    )
    hitMesh.position.set(spec.x, btnY, faceZ - 0.05)
    hitMesh.name = `ctrl-hit-${spec.id}`
    hitMesh.userData.rangeAction = spec.id
    root.add(hitMesh)

    const selected = spec.mode === 'stationary'
    const faceMat = new THREE.MeshStandardMaterial({
      map: makeButtonLabel(spec.title, spec.sub, {
        accent: spec.accent,
        selected,
      }),
      roughness: 0.55,
      metalness: 0.05,
      side: THREE.DoubleSide,
      emissive: 0x000000,
      emissiveIntensity: 0,
    })
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.5), faceMat)
    // Plane default faces +Z; rotate so labels face spawn (−Z from wall)
    face.position.set(spec.x, btnY, faceZ - 0.075)
    face.rotation.y = Math.PI
    face.name = `ctrl-face-${spec.id}`
    face.userData.rangeAction = spec.id
    root.add(face)

    controlButtons.push({
      id: spec.id,
      kind: spec.kind,
      mesh: body,
      hitMesh,
      face,
      bodyMat,
      faceMat,
      position: body.position.clone(),
      title: spec.title,
      accent: accentNum,
      mode: spec.mode,
    })
  }

  // Facility title on rear wall
  {
    const tex = makeFacilityLabel('PRACTICE RANGE', {
      sub: 'HORIZONTAL ROWS  ·  CLOSE → LONG',
      bg: '#152028',
      fg: '#7ec8f0',
    })
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.8, 1.1),
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.65,
        metalness: 0.1,
      }),
    )
    sign.position.set(0, WALL_H - 1.2, REAR_Z - 0.28)
    sign.rotation.y = Math.PI
    root.add(sign)
  }

  // Soft lights along corridor
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 6; i++) {
      const z = FIRE_LINE_Z - 1 - i * 7
      if (z < BERM_Z + 3) break
      const lamp = new THREE.PointLight(0xfff0d8, 0.35, 12, 2)
      lamp.position.set(side * (HALF_W - 0.5), WALL_H - 0.8, z)
      root.add(lamp)
      addBox({
        x: side * (HALF_W - 0.28),
        y: WALL_H - 0.8,
        z,
        w: 0.2,
        h: 0.14,
        d: 0.28,
        mat: metalMat,
        solid: false,
        castShadow: false,
        name: `lamp-${side > 0 ? 'r' : 'l'}-${i}`,
      })
    }
  }
  const ctrlLight = new THREE.PointLight(0xc8e0ff, 0.6, 8, 2)
  ctrlLight.position.set(0, 2.4, wallZ - 0.5)
  root.add(ctrlLight)

  return {
    floorMat,
    coverMat,
    coverMeshes,
    extraColliders,
    controlButtons,
    spawn: { x: spawnX, y: 0, z: spawnZ },
    spawnYaw: 0,
  }
}

/**
 * Kenney CC0 sky (equirect) + optional prototype floor/cover textures.
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
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.setHex(SKYBOX_FOG[skyId])
    }
    loaded.push(sky)
  } catch {
    // keep solid background
  }

  if (!loadFloorTextures) return loaded

  // Corridor uses solid rainbow bands — skip grid texture on floor so colors
  // stay clean. Cover texture still available if catalog boxes exist.
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
    void floorMat
    void renderer
  } catch {
    // keep solid cover
  }

  return loaded
}
