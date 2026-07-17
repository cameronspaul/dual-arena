/**
 * Client-side prediction + reconciliation for local player body.
 * HP / ammo / kills always come from server snapshots (not predicted).
 */
import type { PlayerBody, PlayerInput, PlayerSnapshot } from '@duel/shared'
import { createPlayer } from '@duel/shared'
import type { AABB } from '@duel/shared'
import { stepPlayer } from '../sim/player'
import type { MeshWorld } from '../maps/meshCollision'

export type PredictedFrame = {
  seq: number
  input: PlayerInput
}

const POS_SNAP = 0.35
const POS_SOFT = 0.08
const VEL_SNAP = 2.5

export class Prediction {
  private pending: PredictedFrame[] = []
  private maxPending = 64

  push(seq: number, input: PlayerInput) {
    this.pending.push({
      seq,
      input: { ...input },
    })
    if (this.pending.length > this.maxPending) {
      this.pending.splice(0, this.pending.length - this.maxPending)
    }
  }

  /** Drop inputs acked by the server. */
  ack(ackSeq: number) {
    this.pending = this.pending.filter((p) => p.seq > ackSeq)
  }

  /**
   * Soft-correct local body toward server snapshot, then re-simulate unacked inputs.
   */
  reconcile(opts: {
    body: PlayerBody
    server: PlayerSnapshot
    ackSeq: number
    colliders: AABB[]
    meshWorld?: MeshWorld | null
    barriers?: AABB[] | null
    dt: number
  }) {
    const { body, server, ackSeq, colliders, meshWorld, barriers, dt } = opts
    this.ack(ackSeq)

    const dx = server.x - body.position.x
    const dy = server.y - body.position.y
    const dz = server.z - body.position.z
    const dist = Math.hypot(dx, dy, dz)

    // Authoritative look is cosmetic-correct; server owns validation
    body.yaw = server.yaw
    body.pitch = server.pitch
    body.state = server.state

    if (dist > POS_SNAP) {
      body.position.x = server.x
      body.position.y = server.y
      body.position.z = server.z
      body.velocity.x = server.vx
      body.velocity.y = server.vy
      body.velocity.z = server.vz
    } else if (dist > POS_SOFT) {
      const k = 0.35
      body.position.x += dx * k
      body.position.y += dy * k
      body.position.z += dz * k
      body.velocity.x = server.vx
      body.velocity.y = server.vy
      body.velocity.z = server.vz
    } else {
      const dv = Math.hypot(
        server.vx - body.velocity.x,
        server.vy - body.velocity.y,
        server.vz - body.velocity.z,
      )
      if (dv > VEL_SNAP) {
        body.velocity.x = server.vx
        body.velocity.y = server.vy
        body.velocity.z = server.vz
      }
    }

    // Replay unacked inputs on corrected state
    for (const frame of this.pending) {
      stepPlayer(body, frame.input, dt, colliders, meshWorld, barriers)
    }
  }

  clear() {
    this.pending = []
  }
}

/** Build a PlayerBody from a net snapshot (for remotes / hard reset). */
export function bodyFromSnapshot(s: PlayerSnapshot): PlayerBody {
  const b = createPlayer({ x: s.x, y: s.y, z: s.z })
  b.velocity.x = s.vx
  b.velocity.y = s.vy
  b.velocity.z = s.vz
  b.yaw = s.yaw
  b.pitch = s.pitch
  b.state = s.state
  return b
}
