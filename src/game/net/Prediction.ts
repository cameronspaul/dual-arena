/**
 * Client-side prediction + reconciliation for local player body.
 * HP / ammo / kills always come from server snapshots (not predicted).
 *
 * Server movement is AABB + infinite floor at y=0. Client uses triangle mesh
 * floors that are often 0.1–2 m higher. Applying server Y at all while walking
 * feels like a constant "pull down". Vertical is client-owned except respawn
 * / void / hard teleports.
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

/** Ignore tiny XZ error to kill micro-jitter while standing. */
const HORIZ_EPS = 0.02
/**
 * Only accept server Y when this far below/above local (void / teleport).
 * Normal mesh-vs-flat mismatch is well under this.
 */
const Y_TELEPORT = 4

export class Prediction {
  private pending: PredictedFrame[] = []
  private maxPending = 96

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
   * Correct local body to server snapshot at ackSeq, then re-simulate unacked
   * inputs. Caller must restore local look (yaw/pitch) after this.
   *
   * @param forceServerY — respawn / hard reset; take full server pose including Y.
   */
  reconcile(opts: {
    body: PlayerBody
    server: PlayerSnapshot
    ackSeq: number
    colliders: AABB[]
    meshWorld?: MeshWorld | null
    barriers?: AABB[] | null
    dt: number
    forceServerY?: boolean
  }) {
    const {
      body,
      server,
      ackSeq,
      colliders,
      meshWorld,
      barriers,
      dt,
      forceServerY = false,
    } = opts
    this.ack(ackSeq)

    const clientY = body.position.y
    const clientVy = body.velocity.y
    const clientGrounded = body.grounded
    const clientState = body.state
    const dx = server.x - body.position.x
    const dz = server.z - body.position.z
    const horiz = Math.hypot(dx, dz)
    const dy = Math.abs(server.y - clientY)

    // --- XZ (server-authoritative) ---
    if (horiz > HORIZ_EPS) {
      body.position.x = server.x
      body.position.z = server.z
      body.velocity.x = server.vx
      body.velocity.z = server.vz
    } else if (Math.hypot(server.vx, server.vz) < 0.08) {
      body.velocity.x = 0
      body.velocity.z = 0
    } else {
      body.velocity.x = server.vx
      body.velocity.z = server.vz
    }

    // --- Y (client-authoritative with mesh floors) ---
    // Never use server.y/vy for normal play — server flat floor is lower and
    // often reports jump + negative vy, which continuously drags the camera down.
    const voidOrTeleport = dy > Y_TELEPORT
    if (forceServerY || voidOrTeleport) {
      body.position.y = server.y
      body.velocity.y = server.vy
      body.grounded = server.state !== 'jump' && Math.abs(server.vy) < 0.5
      body.state = server.state
    } else {
      body.position.y = clientY
      // Keep local vertical motion (jumps); don't inject server gravity
      body.velocity.y = clientVy
      body.grounded = clientGrounded
      // Don't overwrite local move state with server "jump" (server often
      // thinks everyone is airborne because it has no mesh floor).
      if (server.state === 'crouch' || server.state === 'slide') {
        body.state = server.state
      } else if (clientState === 'jump') {
        body.state = 'jump'
      } else if (
        server.state === 'walk' ||
        server.state === 'run' ||
        server.state === 'idle'
      ) {
        // Prefer local state if we have one for feel; fall back to server horiz
        if (
          clientState === 'idle' ||
          clientState === 'walk' ||
          clientState === 'run' ||
          clientState === 'crouch' ||
          clientState === 'slide'
        ) {
          body.state = clientState
        } else {
          body.state = server.state
        }
      }
    }

    // Replay unacked inputs at server fixed dt (mesh collision keeps local floor)
    for (const frame of this.pending) {
      stepPlayer(body, frame.input, dt, colliders, meshWorld, barriers)
    }

    // If replay somehow sank us while we weren't jumping, restore floor height
    if (
      !forceServerY &&
      !voidOrTeleport &&
      clientState !== 'jump' &&
      body.position.y < clientY - 0.01
    ) {
      body.position.y = clientY
      body.velocity.y = 0
      body.grounded = true
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
