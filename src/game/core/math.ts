import type { AABB, Vec3 } from './types'

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

export function copy(a: Vec3): Vec3 {
  return { x: a.x, y: a.y, z: a.z }
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function mul(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s }
}

export function len(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z)
}

export function lenXZ(a: Vec3): number {
  return Math.hypot(a.x, a.z)
}

export function normalize(a: Vec3): Vec3 {
  const l = len(a)
  if (l < 1e-8) return v3()
  return mul(a, 1 / l)
}

export function normalizeXZ(a: Vec3): Vec3 {
  const l = lenXZ(a)
  if (l < 1e-8) return v3()
  return { x: a.x / l, y: 0, z: a.z / l }
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function clampPitch(pitch: number, max: number): number {
  return clamp(pitch, -max, max)
}

/**
 * Yaw/pitch → unit look vector matching Three.js camera with
 * rotation.order = 'YXZ', rotation.y = yaw, rotation.x = pitch.
 * At yaw=0, pitch=0 → (0, 0, -1).
 */
export function lookDirection(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch)
  return {
    x: -Math.sin(yaw) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cp,
  }
}

/**
 * COD-style random deviation inside a cone of half-angle `halfAngleRad`.
 * Samples uniformly in the angular disk (not a square), then offsets yaw/pitch.
 */
export function spreadLookDirection(
  yaw: number,
  pitch: number,
  halfAngleRad: number,
  rng: () => number = Math.random,
): Vec3 {
  if (halfAngleRad <= 1e-8) return lookDirection(yaw, pitch)
  // Uniform disk: r = sqrt(u) * radius keeps density flat in polar space.
  const r = Math.sqrt(rng()) * halfAngleRad
  const phi = rng() * Math.PI * 2
  const yawOff = r * Math.cos(phi)
  const pitchOff = r * Math.sin(phi)
  return lookDirection(yaw + yawOff, clamp(pitch + pitchOff, -1.5, 1.5))
}

/**
 * Camera-relative wish direction on XZ.
 * Must match lookDirection / Three.js camera basis or strafe/slide feel "sideways".
 * forward basis: (-sin(yaw), 0, -cos(yaw))
 * right basis:   ( cos(yaw), 0, -sin(yaw))
 */
export function wishDir(forward: number, right: number, yaw: number): Vec3 {
  if (forward === 0 && right === 0) return v3()
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  const x = -forward * sin + right * cos
  const z = -forward * cos - right * sin
  return normalizeXZ({ x, y: 0, z })
}

/** Horizontal facing (ignore pitch) — same as lookDirection on XZ. */
export function facingXZ(yaw: number): Vec3 {
  return {
    x: -Math.sin(yaw),
    y: 0,
    z: -Math.cos(yaw),
  }
}

export function aabbFromCenter(
  cx: number,
  cy: number,
  cz: number,
  hw: number,
  hh: number,
  hd: number,
): AABB {
  return {
    min: { x: cx - hw, y: cy - hh, z: cz - hd },
    max: { x: cx + hw, y: cy + hh, z: cz + hd },
  }
}

export function expandAABB(box: AABB, r: number): AABB {
  return {
    min: { x: box.min.x - r, y: box.min.y - r, z: box.min.z - r },
    max: { x: box.max.x + r, y: box.max.y + r, z: box.max.z + r },
  }
}

/** Ray vs AABB (slab). Returns distance or null. */
export function rayAABB(
  origin: Vec3,
  dir: Vec3,
  box: AABB,
  maxDist: number,
): { t: number; normal: Vec3 } | null {
  let tmin = 0
  let tmax = maxDist
  let nx = 0
  let ny = 0
  let nz = 0

  for (const axis of ['x', 'y', 'z'] as const) {
    const o = origin[axis]
    const d = dir[axis]
    const min = box.min[axis]
    const max = box.max[axis]

    if (Math.abs(d) < 1e-12) {
      if (o < min || o > max) return null
      continue
    }

    const inv = 1 / d
    let t1 = (min - o) * inv
    let t2 = (max - o) * inv
    let n = d < 0 ? 1 : -1
    if (t1 > t2) {
      const tmp = t1
      t1 = t2
      t2 = tmp
      n = -n
    }

    if (t1 > tmin) {
      tmin = t1
      nx = axis === 'x' ? n : 0
      ny = axis === 'y' ? n : 0
      nz = axis === 'z' ? n : 0
    }
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }

  if (tmin < 0 || tmin > maxDist) return null
  return { t: tmin, normal: { x: nx, y: ny, z: nz } }
}

/** Ray vs sphere. */
export function raySphere(
  origin: Vec3,
  dir: Vec3,
  center: Vec3,
  radius: number,
  maxDist: number,
): number | null {
  const oc = sub(origin, center)
  const b = dot(oc, dir)
  const c = dot(oc, oc) - radius * radius
  const disc = b * b - c
  if (disc < 0) return null
  const s = Math.sqrt(disc)
  const t0 = -b - s
  const t1 = -b + s
  if (t0 >= 0 && t0 <= maxDist) return t0
  if (t1 >= 0 && t1 <= maxDist) return t1
  return null
}

/**
 * Ray vs axis-aligned ellipsoid (egg head).
 * `radii` are half-extents on X/Y/Z. `dir` should be unit length.
 */
export function rayEllipsoid(
  origin: Vec3,
  dir: Vec3,
  center: Vec3,
  radii: Vec3,
  maxDist: number,
): { t: number; normal: Vec3 } | null {
  const rx = Math.max(radii.x, 1e-6)
  const ry = Math.max(radii.y, 1e-6)
  const rz = Math.max(radii.z, 1e-6)
  // Map to unit sphere space (dir is not unit there)
  const ox = (origin.x - center.x) / rx
  const oy = (origin.y - center.y) / ry
  const oz = (origin.z - center.z) / rz
  const dx = dir.x / rx
  const dy = dir.y / ry
  const dz = dir.z / rz
  const a = dx * dx + dy * dy + dz * dz
  const b = ox * dx + oy * dy + oz * dz
  const c = ox * ox + oy * oy + oz * oz - 1
  const disc = b * b - a * c
  if (disc < 0 || a < 1e-12) return null
  const s = Math.sqrt(disc)
  const t0 = (-b - s) / a
  const t1 = (-b + s) / a
  let t: number | null = null
  if (t0 >= 0 && t0 <= maxDist) t = t0
  else if (t1 >= 0 && t1 <= maxDist) t = t1
  if (t === null) return null
  const px = origin.x + dir.x * t
  const py = origin.y + dir.y * t
  const pz = origin.z + dir.z * t
  // Gradient of ellipsoid: ((x-c)/r^2, …)
  const nx = (px - center.x) / (rx * rx)
  const ny = (py - center.y) / (ry * ry)
  const nz = (pz - center.z) / (rz * rz)
  return { t, normal: normalize({ x: nx, y: ny, z: nz }) }
}

/**
 * Ray vs capsule (segment a→b thickened by radius).
 * Assumes `dir` is unit length. Returns nearest hit + outward normal.
 */
export function rayCapsule(
  origin: Vec3,
  dir: Vec3,
  a: Vec3,
  b: Vec3,
  radius: number,
  maxDist: number,
): { t: number; normal: Vec3 } | null {
  const ba = sub(b, a)
  const baba = dot(ba, ba)

  // Degenerate segment → sphere
  if (baba < 1e-12) {
    const t = raySphere(origin, dir, a, radius, maxDist)
    if (t === null) return null
    const hit = {
      x: origin.x + dir.x * t,
      y: origin.y + dir.y * t,
      z: origin.z + dir.z * t,
    }
    return { t, normal: normalize(sub(hit, a)) }
  }

  let bestT = Infinity
  let bestN = v3()

  const consider = (t: number, normal: Vec3) => {
    if (t < 0 || t > maxDist || t >= bestT) return
    bestT = t
    bestN = normal
  }

  // Infinite cylinder around AB, then accept hits whose projection lies on the segment
  const oa = sub(origin, a)
  const bard = dot(ba, dir)
  const baoa = dot(ba, oa)
  const rdoa = dot(dir, oa)
  const oaoa = dot(oa, oa)
  const aa = baba - bard * bard
  const bb = baba * rdoa - baoa * bard
  const cc = baba * oaoa - baoa * baoa - radius * radius * baba
  const disc = bb * bb - aa * cc

  if (Math.abs(aa) > 1e-12 && disc >= 0) {
    const s = Math.sqrt(disc)
    // Near root first
    for (const sign of [-1, 1] as const) {
      const t = (-bb + sign * s) / aa
      if (t < 0 || t > maxDist) continue
      const y = baoa + t * bard
      if (y <= 0 || y >= baba) continue
      const hit = {
        x: origin.x + dir.x * t,
        y: origin.y + dir.y * t,
        z: origin.z + dir.z * t,
      }
      const u = y / baba
      const axis = {
        x: a.x + ba.x * u,
        y: a.y + ba.y * u,
        z: a.z + ba.z * u,
      }
      consider(t, normalize(sub(hit, axis)))
    }
  }

  // Hemispherical caps
  for (const c of [a, b]) {
    const t = raySphere(origin, dir, c, radius, maxDist)
    if (t === null) continue
    const hit = {
      x: origin.x + dir.x * t,
      y: origin.y + dir.y * t,
      z: origin.z + dir.z * t,
    }
    consider(t, normalize(sub(hit, c)))
  }

  if (bestT === Infinity) return null
  return { t: bestT, normal: bestN }
}
