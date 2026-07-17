import { DUMMY, WORLD } from './config'
import { aabbFromCenter } from './math'
import type { AABB, DummyTarget, Hitbox, Vec3 } from './types'

export function buildWorldColliders(): AABB[] {
  return WORLD.coverBoxes.map((b) =>
    aabbFromCenter(b.x, b.y, b.z, b.w / 2, b.h / 2, b.d / 2),
  )
}

export function createDummies(): DummyTarget[] {
  return WORLD.dummies.map((d) => ({
    id: d.id,
    position: { x: d.x, y: 0, z: d.z },
    hp: DUMMY.maxHp,
    maxHp: DUMMY.maxHp,
    alive: true,
    yaw: d.yaw,
  }))
}

export function dummyHitboxes(dummies: DummyTarget[]): Hitbox[] {
  const boxes: Hitbox[] = []
  for (const d of dummies) {
    if (!d.alive) continue
    const p = d.position
    boxes.push({
      id: `${d.id}-head`,
      ownerId: d.id,
      zone: 'head',
      sphere: {
        center: {
          x: p.x,
          y: p.y + DUMMY.headOffsetY,
          z: p.z,
        },
        radius: DUMMY.headRadius,
      },
    })
    boxes.push({
      id: `${d.id}-body`,
      ownerId: d.id,
      zone: 'body',
      aabb: aabbFromCenter(
        p.x,
        p.y + DUMMY.bodyOffsetY,
        p.z,
        DUMMY.bodyHalfW,
        DUMMY.bodyHeight / 2,
        DUMMY.bodyHalfD,
      ),
    })
  }
  return boxes
}

export interface RespawnTimer {
  id: string
  remaining: number
}

export function damageDummy(
  dummies: DummyTarget[],
  id: string,
  damage: number,
): { killed: boolean; hp: number } {
  const d = dummies.find((x) => x.id === id)
  if (!d || !d.alive) return { killed: false, hp: 0 }
  d.hp = Math.max(0, d.hp - damage)
  if (d.hp <= 0) {
    d.alive = false
    return { killed: true, hp: 0 }
  }
  return { killed: false, hp: d.hp }
}

export function stepRespawns(
  dummies: DummyTarget[],
  timers: RespawnTimer[],
  dt: number,
): void {
  for (const t of timers) {
    t.remaining -= dt
  }
  for (let i = timers.length - 1; i >= 0; i--) {
    if (timers[i].remaining > 0) continue
    const d = dummies.find((x) => x.id === timers[i].id)
    if (d) {
      d.alive = true
      d.hp = d.maxHp
    }
    timers.splice(i, 1)
  }
}

export function queueRespawn(timers: RespawnTimer[], id: string) {
  if (timers.some((t) => t.id === id)) return
  timers.push({ id, remaining: DUMMY.respawnTime })
}

export function dummyBodyCenter(d: DummyTarget): Vec3 {
  return {
    x: d.position.x,
    y: d.position.y + DUMMY.bodyOffsetY,
    z: d.position.z,
  }
}
