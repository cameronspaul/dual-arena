/**
 * Map / frame performance instrumentation.
 * Static GLB cost at load + live WebGL/frame breakdown for the HUD + console.
 */
import * as THREE from 'three'
import type { MapBounds } from './MapWorld'

/** One-shot cost of a loaded map (geometry / materials / collision setup). */
export type MapStaticPerf = {
  mapId: string
  meshes: number
  triangles: number
  materials: number
  textures: number
  maxTextureDim: number
  shadowCasters: number
  shadowReceivers: number
  collisionMeshes: number
  /** True when GLB has COL_/collision/UCX_ meshes (visuals not used for probes). */
  dedicatedCollision: boolean
  aabbColliders: number
  boundsSize: { x: number; y: number; z: number } | null
  /** Human-readable cost drivers for this map. */
  notes: string[]
}

/** Live frame stats (throttled for React). */
export type LivePerf = {
  /** Full frame time (ms), EMA. */
  frameMs: number
  /** Sim / systems (ms), EMA. */
  simMs: number
  /** renderer.render (ms), EMA. */
  renderMs: number
  draws: number
  triangles: number
  geometries: number
  textures: number
  collisionMeshes: number
  /** Collision meshes near the player this frame (probe radius). */
  nearbyCollision: number
  pixelRatio: number
  /** Best-guess primary limiter. */
  bottleneck: string
}

const TEX_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'displacementMap',
  'alphaMap',
  'lightMap',
  'envMap',
] as const

function triangleCount(geo: THREE.BufferGeometry): number {
  const index = geo.index
  if (index) return Math.floor(index.count / 3)
  const pos = geo.getAttribute('position')
  return pos ? Math.floor(pos.count / 3) : 0
}

function isDedicatedCollisionName(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n.includes('collision') ||
    n.includes('collider') ||
    n.startsWith('col_') ||
    n.startsWith('ucx_')
  )
}

function textureDim(tex: THREE.Texture): number {
  const img = tex.image as
    | { width?: number; height?: number; videoWidth?: number; videoHeight?: number }
    | undefined
  if (!img) return 0
  const w = img.width ?? img.videoWidth ?? 0
  const h = img.height ?? img.videoHeight ?? 0
  return Math.max(w, h)
}

/**
 * Walk a map root (or whole scene for procedural range) and tally cost.
 */
export function analyzeMapStaticPerf(opts: {
  mapId: string
  root: THREE.Object3D | null
  scene: THREE.Scene
  collisionMeshes: THREE.Object3D[]
  aabbColliders: number
  bounds: MapBounds | null
}): MapStaticPerf {
  const { mapId, root, scene, collisionMeshes, aabbColliders, bounds } = opts
  const walkRoot = root ?? scene

  let meshes = 0
  let triangles = 0
  let shadowCasters = 0
  let shadowReceivers = 0
  const matIds = new Set<string>()
  const texIds = new Set<string>()
  let maxTextureDim = 0
  let dedicatedAnywhere = false

  walkRoot.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.geometry) return
    // Skip editor / FX helpers that hang under scene when root is null
    if (!root && obj.userData?.skipMapPerf) return

    meshes++
    triangles += triangleCount(obj.geometry)
    if (obj.castShadow) shadowCasters++
    if (obj.receiveShadow) shadowReceivers++

    const name = `${obj.name || ''} ${obj.parent?.name || ''}`
    if (isDedicatedCollisionName(name)) dedicatedAnywhere = true

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m) continue
      matIds.add(m.uuid)
      for (const key of TEX_KEYS) {
        const tex = (m as unknown as Record<string, unknown>)[key]
        if (tex && tex instanceof THREE.Texture) {
          texIds.add(tex.uuid)
          maxTextureDim = Math.max(maxTextureDim, textureDim(tex))
        }
      }
    }
  })

  const dedicatedCollision =
    dedicatedAnywhere &&
    collisionMeshes.length > 0 &&
    collisionMeshes.every((m) =>
      isDedicatedCollisionName(`${m.name || ''} ${m.parent?.name || ''}`),
    )

  const notes = buildStaticNotes({
    triangles,
    meshes,
    materials: matIds.size,
    textures: texIds.size,
    maxTextureDim,
    shadowCasters,
    collisionMeshes: collisionMeshes.length,
    dedicatedCollision,
    aabbColliders,
    bounds,
  })

  return {
    mapId,
    meshes,
    triangles,
    materials: matIds.size,
    textures: texIds.size,
    maxTextureDim,
    shadowCasters,
    shadowReceivers,
    collisionMeshes: collisionMeshes.length,
    dedicatedCollision,
    aabbColliders,
    boundsSize: bounds
      ? { x: bounds.size.x, y: bounds.size.y, z: bounds.size.z }
      : null,
    notes,
  }
}

function buildStaticNotes(s: {
  triangles: number
  meshes: number
  materials: number
  textures: number
  maxTextureDim: number
  shadowCasters: number
  collisionMeshes: number
  dedicatedCollision: boolean
  aabbColliders: number
  bounds: MapBounds | null
}): string[] {
  const notes: string[] = []
  if (s.triangles >= 500_000) {
    notes.push(`Very high tris (${fmtNum(s.triangles)}) — GPU fill/vertex bound`)
  } else if (s.triangles >= 150_000) {
    notes.push(`High tris (${fmtNum(s.triangles)}) — expect GPU cost vs range`)
  }
  if (s.meshes >= 400) {
    notes.push(`Many draw-call candidates (${s.meshes} meshes) — batching weak`)
  } else if (s.meshes >= 150) {
    notes.push(`Elevated mesh count (${s.meshes})`)
  }
  if (s.shadowCasters >= 80) {
    notes.push(
      `${s.shadowCasters} shadow casters — still high; large props only should cast`,
    )
  } else if (s.shadowCasters >= 40) {
    notes.push(`${s.shadowCasters} shadow casters (capped)`)
  }
  if (!s.dedicatedCollision && s.collisionMeshes >= 80) {
    notes.push(
      `No COL_ hull — ${s.collisionMeshes} walk colliders (filtered visuals); author COL_ for best CPU`,
    )
  } else if (!s.dedicatedCollision && s.collisionMeshes > 0) {
    notes.push(
      `Walk uses ${s.collisionMeshes} visual colliders (no COL_); still OK if nearby stays low`,
    )
  } else if (s.dedicatedCollision) {
    notes.push(
      `Dedicated collision layer (${s.collisionMeshes} meshes) — good for CPU`,
    )
  }
  if (s.maxTextureDim >= 2048) {
    notes.push(`Large textures (max ${s.maxTextureDim}px) — VRAM + bandwidth`)
  }
  if (s.bounds) {
    const span = Math.hypot(s.bounds.size.x, s.bounds.size.z)
    if (span > 120) {
      notes.push(
        `Large footprint (~${span.toFixed(0)} m span) — long far plane / more in view`,
      )
    }
  }
  if (notes.length === 0) {
    notes.push('Map cost looks light — if FPS is low, check DPR/shadows/monitor Hz')
  }
  return notes
}

export function logMapStaticPerf(p: MapStaticPerf): void {
  const size = p.boundsSize
    ? `${p.boundsSize.x.toFixed(1)}×${p.boundsSize.y.toFixed(1)}×${p.boundsSize.z.toFixed(1)} m`
    : 'n/a'
  console.info(
    `[map-perf] ${p.mapId}`,
    {
      meshes: p.meshes,
      triangles: p.triangles,
      materials: p.materials,
      textures: p.textures,
      maxTextureDim: p.maxTextureDim,
      shadowCasters: p.shadowCasters,
      collisionMeshes: p.collisionMeshes,
      dedicatedCollision: p.dedicatedCollision,
      aabbColliders: p.aabbColliders,
      bounds: size,
    },
    '\n  notes:',
    p.notes,
  )
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`
  return String(Math.round(n))
}

/**
 * Guess primary limiter from live timings + static map cost.
 * simMs high → collision/CPU; renderMs high → GPU; both high → overall heavy map.
 */
export function inferBottleneck(opts: {
  frameMs: number
  simMs: number
  renderMs: number
  draws: number
  triangles: number
  nearbyCollision: number
  collisionMeshes: number
  dedicatedCollision: boolean
  pixelRatio: number
  staticTriangles: number
  shadowCasters: number
}): string {
  const {
    frameMs,
    simMs,
    renderMs,
    draws,
    nearbyCollision,
    collisionMeshes,
    dedicatedCollision,
    pixelRatio,
    staticTriangles,
    shadowCasters,
  } = opts

  // 180 FPS budget ≈ 5.56 ms; 144 ≈ 6.9; 60 ≈ 16.7
  if (frameMs < 5.8) return 'headroom (≤180 Hz budget)'
  if (frameMs < 7.2) return 'near 144 Hz budget'

  const simShare = simMs / Math.max(frameMs, 0.001)
  const renderShare = renderMs / Math.max(frameMs, 0.001)

  if (simShare > 0.45 && nearbyCollision > 40) {
    return dedicatedCollision
      ? 'CPU: mesh collision probes (many nearby COL meshes)'
      : 'CPU: mesh collision (visual tris as colliders — add COL_ hull)'
  }
  if (simShare > 0.4) {
    return 'CPU: sim/collision/systems'
  }
  if (renderShare > 0.55 && (draws > 200 || staticTriangles > 200_000)) {
    return shadowCasters > 80
      ? 'GPU: draw + soft shadows on dense casters'
      : 'GPU: draw calls / triangle throughput'
  }
  if (renderShare > 0.55 && pixelRatio >= 1.75) {
    return `GPU: fill-rate (pixel ratio ${pixelRatio.toFixed(2)})`
  }
  if (renderShare > 0.5) {
    return 'GPU: render (shaders / fill / shadows)'
  }
  if (collisionMeshes > 150 && !dedicatedCollision && simShare > 0.3) {
    return 'mixed: walk colliders + render'
  }
  if (frameMs > 7 && draws < 120 && renderShare < 0.45 && simShare < 0.35) {
    return 'overhead / vsync / browser (sim+ren under budget)'
  }
  return 'mixed / other (vsync? browser? thermal?)'
}

/** Exponential moving average helper. */
export function ema(prev: number, sample: number, alpha = 0.15): number {
  return prev * (1 - alpha) + sample * alpha
}
