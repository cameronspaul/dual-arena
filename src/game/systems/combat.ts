/**
 * Hitscan fire + sniper phase SFX.
 */
import { gameAudio } from '../core/audio'
import { SNIPER } from '../core/config'
import { spreadLookDirection } from '../core/math'
import type {
  AABB,
  DummyTarget,
  HitEvent,
  PlayerBody,
  RayHit,
  SniperState,
  Vec3,
} from '../core/types'
import { damageForZone } from '../character/hitMeshes'
import { castHitscan } from '../sim/hitscan'
import { eyePosition } from '../sim/player'
import { aimSpread, effectiveLook } from '../sim/sniper'
import {
  damageDummy,
  queueRespawn,
  type RespawnTimer,
} from '../sim/world'
import type { CombatFx } from './CombatFx'
import type { DummySystem } from './DummySystem'

export type FireResult = {
  lastHit: HitEvent | null
  killsDelta: number
}

export function fireShot(opts: {
  player: PlayerBody
  sniper: SniperState
  colliders: AABB[]
  /** Editor barrier walls — always block bullets (even on GLB mesh maps). */
  barrierColliders?: AABB[]
  dummies: DummyTarget[]
  respawns: RespawnTimer[]
  dummiesSys: DummySystem
  fx: CombatFx
  /** Optional map mesh raycast (GLB geometry) — more accurate than AABB alone */
  castWorldMesh?: (
    origin: Vec3,
    dir: Vec3,
    maxRange: number,
  ) => RayHit | null
}): FireResult {
  const {
    player,
    sniper,
    colliders,
    barrierColliders,
    dummies,
    respawns,
    dummiesSys,
    fx,
    castWorldMesh,
  } = opts

  const look = effectiveLook(player, sniper)
  const origin = eyePosition(player)
  const spread = aimSpread(sniper, player)
  const dir = spreadLookDirection(look.yaw, look.pitch, spread)

  /**
   * Hits can start slightly inside map geo (mesh floors / fat AABBs). A
   * distance-0 world hit used to clamp the dummy ray to ~0 so NPCs never
   * registered. Cast dummies at full range, ignore skin-close world hits,
   * then pick the closest valid result.
   */
  const SKIN = 0.15

  // Dummies first at full range (not limited by a bad world hit)
  const dummyHit = dummiesSys.castHitscan(
    dummies,
    origin,
    dir,
    SNIPER.maxRange,
  )

  // When mesh world is active, skip crude cover AABBs for bullets — they often
  // swallow the player and return t≈0. Barrier walls still always block.
  const useAabbWorld = !castWorldMesh
  let worldHit: RayHit | null = useAabbWorld
    ? castHitscan(origin, dir, [], colliders)
    : null
  if (worldHit && worldHit.distance < SKIN) worldHit = null

  if (barrierColliders && barrierColliders.length > 0) {
    const barrierHit = castHitscan(origin, dir, [], barrierColliders)
    if (
      barrierHit &&
      barrierHit.distance >= SKIN &&
      (!worldHit || barrierHit.distance < worldHit.distance)
    ) {
      worldHit = barrierHit
    }
  }

  let meshWorld = castWorldMesh?.(origin, dir, SNIPER.maxRange) ?? null
  if (meshWorld && meshWorld.distance < SKIN) meshWorld = null
  if (meshWorld && (!worldHit || meshWorld.distance < worldHit.distance)) {
    worldHit = meshWorld
  }

  // Closest of dummy vs world (dummy wins near-ties so cover edges still kill)
  let hit: RayHit | null = null
  if (dummyHit && worldHit) {
    hit =
      dummyHit.distance <= worldHit.distance + 0.04 ? dummyHit : worldHit
  } else {
    hit = dummyHit ?? worldHit
  }

  const end = hit
    ? hit.point
    : {
        x: origin.x + dir.x * SNIPER.maxRange,
        y: origin.y + dir.y * SNIPER.maxRange,
        z: origin.z + dir.z * SNIPER.maxRange,
      }

  gameAudio.unlock()

  let lastHit: HitEvent | null = null
  let killsDelta = 0
  let killed = false

  if (hit?.hitbox) {
    const zone = hit.hitbox.zone
    const dmg = damageForZone(zone)
    const ownerId = hit.hitbox.ownerId
    const result = damageDummy(dummies, ownerId, dmg)
    killed = result.killed
    lastHit = {
      targetId: ownerId,
      zone,
      damage: dmg,
      killed: result.killed,
      point: hit.point,
    }
    fx.showImpact(hit.point, zone === 'head' ? 'head' : 'body', result.killed)
    gameAudio.playHitConfirm({ zone, killed: result.killed })
    if (result.killed) {
      killsDelta = 1
      // 1) Face / nudge along the bullet so Death falls away from the shot.
      // 2) Freeze a red ghost of the live pose under that root.
      // 3) Play the Death clip on the real dummy.
      dummiesSys.alignDeath(ownerId, dir)
      const victim = dummiesSys.meshes.get(ownerId)
      if (victim) fx.spawnKillGhost(victim)
      dummiesSys.onDeath(ownerId)
      queueRespawn(respawns, ownerId)
    } else if (result.hp > 0) {
      dummiesSys.onHit(ownerId)
    }
  } else if (hit) {
    fx.showImpact(hit.point, 'world', false)
  }

  // Tracer after damage so kills can leave a permanent red mark.
  fx.showTracer(origin, dir, end, { killed })

  return { lastHit, killsDelta }
}

export function playSniperPhaseSfx(
  phase: SniperState['phase'],
  prevPhase: SniperState['phase'],
): SniperState['phase'] {
  if (phase === prevPhase) return prevPhase

  if (phase === 'bolt') {
    gameAudio.playBolt()
  } else if (phase === 'reloading') {
    gameAudio.playReload()
  } else if (phase === 'ready' && prevPhase === 'reloading') {
    gameAudio.play('reloadDone', { volume: 0.55 })
  }
  return phase
}
