/**
 * Level-editor movement: free look with map collision + gravity.
 * You can walk floors, rest feet for spawns, and still fly up/down.
 */
import { MOVE } from '../core/config'
import { lookDirection, wishDir } from '../core/math'
import type { AABB, PlayerBody, PlayerInput } from '../core/types'
import type { MeshWorld } from '../maps/meshCollision'
import { resolvePlayerWorldCollisions } from '../sim/player'

/** Base editor move speed (m/s); sprint multiplies. */
export const EDITOR_MOVE = {
  speed: 8,
  sprintMul: 2.4,
  /** Vertical when holding jump / crouch (fly) */
  flySpeed: 7,
} as const

/**
 * Editor camera body:
 * - WASD relative to look (horizontal on ground; full look-dir while flying)
 * - Gravity pulls you onto walkable floors / mesh
 * - Space = fly up (cancels gravity), crouch = fly / drop down
 * - Collides with triangle meshes (GLB) or cover AABBs (range)
 */
export function stepEditorMove(
  p: PlayerBody,
  input: PlayerInput,
  dt: number,
  worldColliders: AABB[],
  meshWorld?: MeshWorld | null,
  extraColliders?: AABB[] | null,
) {
  p.yaw = input.yaw
  p.pitch = input.pitch
  p.height = MOVE.standingHeight
  p.eyeHeight = MOVE.eyeStanding
  p.slideTimer = 0
  p.slideCd = 0
  p.slideSpeed = 0

  const speed =
    EDITOR_MOVE.speed * (input.sprint ? EDITOR_MOVE.sprintMul : 1)
  const fly = input.jump || input.crouch

  if (fly) {
    // Free 3D move along look + strafe, still clipped by geometry
    const look = lookDirection(input.yaw, input.pitch)
    const rx = Math.cos(input.yaw)
    const rz = -Math.sin(input.yaw)

    let mx = look.x * input.forward + rx * input.right
    let my = look.y * input.forward
    let mz = look.z * input.forward + rz * input.right

    if (input.jump) my += 1
    if (input.crouch) my -= 1

    const len = Math.hypot(mx, my, mz)
    if (len > 1e-6) {
      mx /= len
      my /= len
      mz /= len
    }

    const flySp =
      EDITOR_MOVE.flySpeed * (input.sprint ? EDITOR_MOVE.sprintMul : 1)
    p.velocity.x = mx * flySp
    p.velocity.y = my * flySp
    p.velocity.z = mz * flySp
    p.state = 'jump'
    p.grounded = false
  } else {
    // Walk / run on floors — same horizontal wish as gameplay, with gravity
    const wish = wishDir(input.forward, input.right, input.yaw)
    const wlen = Math.hypot(wish.x, wish.z)

    p.velocity.x = wish.x * speed
    p.velocity.z = wish.z * speed
    // Gravity so feet settle onto mesh floors
    p.velocity.y += MOVE.gravity * dt

    if (wlen > 0.01) {
      p.state = input.sprint ? 'run' : 'walk'
    } else {
      p.state = p.grounded ? 'idle' : 'jump'
    }
  }

  resolvePlayerWorldCollisions(
    p,
    worldColliders,
    meshWorld,
    dt,
    extraColliders,
  )

  // Kill residual slide when standing still on ground
  if (p.grounded && !fly && Math.hypot(input.forward, input.right) < 0.01) {
    p.velocity.x = 0
    p.velocity.z = 0
    if (p.velocity.y < 0) p.velocity.y = 0
    p.state = 'idle'
  }

  if (p.position.y < -50) {
    p.position.y = 0
    p.velocity.y = 0
    p.grounded = true
  }
}

