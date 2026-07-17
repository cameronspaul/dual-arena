import { SNIPER } from './config'
import { mul, rayAABB, rayCapsule, rayEllipsoid, raySphere } from './math'
import type { AABB, Hitbox, RayHit, Vec3 } from './types'

export function castHitscan(
  origin: Vec3,
  direction: Vec3,
  hitboxes: Hitbox[],
  world: AABB[],
  maxRange = SNIPER.maxRange,
): RayHit | null {
  const dir = direction
  let best: RayHit | null = null

  // world first (blocks shots)
  for (const box of world) {
    const hit = rayAABB(origin, dir, box, maxRange)
    if (!hit) continue
    if (!best || hit.t < best.distance) {
      best = {
        point: {
          x: origin.x + dir.x * hit.t,
          y: origin.y + dir.y * hit.t,
          z: origin.z + dir.z * hit.t,
        },
        distance: hit.t,
        normal: hit.normal,
        world: true,
      }
    }
  }

  const range = best ? best.distance : maxRange

  // prefer head over body at similar distance (check all, pick closest; head wins ties within epsilon)
  type Cand = { t: number; hb: Hitbox; normal: Vec3 }
  const cands: Cand[] = []

  for (const hb of hitboxes) {
    if (hb.sphere) {
      const t = raySphere(
        origin,
        dir,
        hb.sphere.center,
        hb.sphere.radius,
        range,
      )
      if (t !== null) {
        cands.push({
          t,
          hb,
          normal: mul(
            {
              x: origin.x + dir.x * t - hb.sphere.center.x,
              y: origin.y + dir.y * t - hb.sphere.center.y,
              z: origin.z + dir.z * t - hb.sphere.center.z,
            },
            1,
          ),
        })
      }
    }
    if (hb.ellipsoid) {
      const hit = rayEllipsoid(
        origin,
        dir,
        hb.ellipsoid.center,
        hb.ellipsoid.radii,
        range,
      )
      if (hit) {
        cands.push({ t: hit.t, hb, normal: hit.normal })
      }
    }
    if (hb.aabb) {
      const hit = rayAABB(origin, dir, hb.aabb, range)
      if (hit) {
        cands.push({ t: hit.t, hb, normal: hit.normal })
      }
    }
    if (hb.capsule) {
      const hit = rayCapsule(
        origin,
        dir,
        hb.capsule.a,
        hb.capsule.b,
        hb.capsule.radius,
        range,
      )
      if (hit) {
        cands.push({ t: hit.t, hb, normal: hit.normal })
      }
    }
  }

  if (cands.length === 0) return best

  cands.sort((a, b) => {
    if (Math.abs(a.t - b.t) < 0.05) {
      // head priority on near-ties
      if (a.hb.zone === 'head' && b.hb.zone !== 'head') return -1
      if (b.hb.zone === 'head' && a.hb.zone !== 'head') return 1
    }
    return a.t - b.t
  })

  const c = cands[0]
  // normalize sphere normal
  let n = c.normal
  const nl = Math.hypot(n.x, n.y, n.z)
  if (nl > 1e-6) n = { x: n.x / nl, y: n.y / nl, z: n.z / nl }

  return {
    point: {
      x: origin.x + dir.x * c.t,
      y: origin.y + dir.y * c.t,
      z: origin.z + dir.z * c.t,
    },
    distance: c.t,
    normal: n,
    hitbox: c.hb,
  }
}
