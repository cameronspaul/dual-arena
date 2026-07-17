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
  SniperState,
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
  dummies: DummyTarget[]
  respawns: RespawnTimer[]
  dummiesSys: DummySystem
  fx: CombatFx
}): FireResult {
  const {
    player,
    sniper,
    colliders,
    dummies,
    respawns,
    dummiesSys,
    fx,
  } = opts

  const look = effectiveLook(player, sniper)
  const origin = eyePosition(player)
  const spread = aimSpread(sniper, player)
  const dir = spreadLookDirection(look.yaw, look.pitch, spread)

  const worldHit = castHitscan(origin, dir, [], colliders)
  const range = worldHit?.distance ?? SNIPER.maxRange
  const meshHit = dummiesSys.castHitscan(dummies, origin, dir, range)
  const hit = meshHit ?? worldHit

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
      // Freeze silhouette from the live pose, then play death on the real dummy.
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
