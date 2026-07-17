/**
 * Free-cam spectate — fly anywhere, look freely, no collision.
 * Used after death (countdown then respawn) and via the Free cam
 * toggle (bottom-left) for voluntary exploration.
 */
import { DEATH, MOVE } from '../core/config'
import { clampPitch, lookDirection } from '../core/math'
import type { PlayerInput, Vec3 } from '../core/types'

export interface FreeCamState {
  position: Vec3
  yaw: number
  pitch: number
}

export function createFreeCam(
  position: Vec3,
  yaw: number,
  pitch: number,
): FreeCamState {
  return {
    position: { x: position.x, y: position.y, z: position.z },
    yaw,
    pitch: clampPitch(pitch, MOVE.maxPitch),
  }
}

/**
 * WASD along look + strafe, Space (held) up / crouch down, sprint to boost.
 * No gravity, no world collision — pure free-cam.
 */
export function stepFreeCam(
  cam: FreeCamState,
  input: PlayerInput,
  dt: number,
) {
  cam.yaw = input.yaw
  cam.pitch = clampPitch(input.pitch, MOVE.maxPitch)

  const look = lookDirection(cam.yaw, cam.pitch)
  const rx = Math.cos(cam.yaw)
  const rz = -Math.sin(cam.yaw)

  let mx = look.x * input.forward + rx * input.right
  let my = look.y * input.forward
  let mz = look.z * input.forward + rz * input.right

  // jump is edge-triggered for gameplay; freecam needs continuous hold (Space).
  if (input.jumpHeld || input.jump) my += 1
  if (input.crouch) my -= 1

  const len = Math.hypot(mx, my, mz)
  if (len > 1e-6) {
    mx /= len
    my /= len
    mz /= len
  } else {
    mx = 0
    my = 0
    mz = 0
  }

  const speed =
    DEATH.freeCamSpeed * (input.sprint ? DEATH.freeCamSprintMul : 1)
  cam.position.x += mx * speed * dt
  cam.position.y += my * speed * dt
  cam.position.z += mz * speed * dt
}
