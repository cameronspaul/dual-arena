/**
 * Dummy label sprites, locomotion fade/scrub, and hit/death one-shots.
 */
import * as THREE from 'three'
import { DUMMY } from '../core/config'
import {
  type DummyActions,
  locoLoopActions,
} from './locomotion'

export type DummyLabel = {
  sprite: THREE.Sprite
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  tex: THREE.CanvasTexture
  text: string
}

/** Floating state label for reviewing locomotion clips. */
export function attachDummyLabel(root: THREE.Group) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(1.6, 0.4, 1)
  sprite.position.y = DUMMY.labelY
  sprite.renderOrder = 10
  root.add(sprite)
  root.userData.label = { sprite, canvas, ctx, tex, text: '' } satisfies DummyLabel
}

export function setDummyLabel(root: THREE.Group, state: string) {
  const label = root.userData.label as DummyLabel | undefined
  if (!label) return
  const text = state.toUpperCase()
  if (label.text === text) return
  label.text = text
  const { canvas, ctx, tex } = label
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(8, 8, canvas.width - 16, canvas.height - 16)
  ctx.font = 'bold 28px system-ui,Segoe UI,sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle =
    state === 'slide' ? '#ffd27a' : state === 'crouch' ? '#9ad0ff' : '#ffffff'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
  tex.needsUpdate = true
}

export function getDummyActions(root: THREE.Group): DummyActions | undefined {
  return root.userData.actions as DummyActions | undefined
}

export function fadeDummyLoco(
  actions: DummyActions,
  next: THREE.AnimationAction | null,
  fade = 0.18,
) {
  if (!next) return
  for (const a of locoLoopActions(actions)) {
    if (!a || a === next) continue
    if (a.isRunning()) a.fadeOut(fade)
  }
  // Slide is scrubbed at timeScale 0 — isRunning() is false, so always fade it
  if (actions.slide && actions.slide !== next) {
    actions.slide.fadeOut(fade * 0.5)
  }
  const ts = next.getEffectiveTimeScale()
  next.reset().setEffectiveWeight(1).setEffectiveTimeScale(ts).fadeIn(fade).play()
}

/**
 * Start man.glb Roll as a one-shot. Playback is driven by scrubSlideRoll
 * so the full clip maps onto slide duration.
 */
export function playSlideRoll(slide: THREE.AnimationAction) {
  slide.enabled = true
  slide.paused = false
  slide.setLoop(THREE.LoopOnce, 1)
  slide.clampWhenFinished = true
  slide.reset()
  slide.timeScale = 0
  slide.time = 0
  slide.setEffectiveWeight(1)
  slide.play()
}

/** 0 = slide start, 1 = slide end → corresponding Roll keyframe. */
export function scrubSlideRoll(
  slide: THREE.AnimationAction,
  progress01: number,
) {
  const dur = slide.getClip().duration
  if (dur <= 0.001) return
  const t = Math.min(1, Math.max(0, progress01)) * dur
  slide.enabled = true
  slide.paused = false
  slide.timeScale = 0
  slide.time = t
  if (slide.weight < 1) slide.weight = 1
  if (!slide.isRunning() && slide.getEffectiveWeight() <= 0) {
    slide.setEffectiveWeight(1)
    slide.play()
  }
}

/** Mild Y squash so crouch is readable without a crouch clip. */
export function applyDummyCrouchScale(root: THREE.Group, crouch: boolean) {
  const model = root.userData.model as THREE.Object3D | undefined
  const base = (root.userData.baseScale as number | undefined) ?? 1
  if (!model) return
  const yMul = crouch ? DUMMY.crouchScaleY : 1
  model.scale.set(base, base * yMul, base)
}

export function playDummyIdle(root: THREE.Group) {
  const actions = getDummyActions(root)
  if (!actions?.idle) return
  root.userData.animState = 'idle'
  root.userData.locoState = 'idle'
  actions.hit?.stop()
  actions.hitAlt?.stop()
  actions.death?.stop()
  actions.slide?.stop()
  for (const a of locoLoopActions(actions)) {
    if (a && a !== actions.idle) a.stop()
  }
  actions.idle.reset().fadeIn(0.2).play()
  applyDummyCrouchScale(root, false)
}

export function playDummyHit(root: THREE.Group) {
  const actions = getDummyActions(root)
  if (!actions) return
  if (root.userData.animState === 'death') return

  const pick =
    actions.hit && actions.hitAlt
      ? Math.random() < 0.5
        ? actions.hit
        : actions.hitAlt
      : (actions.hit ?? actions.hitAlt)
  if (!pick) return

  root.userData.animState = 'hit'
  for (const a of locoLoopActions(actions)) {
    if (a?.isRunning()) a.fadeOut(0.08)
  }
  if (actions.slide?.isRunning()) actions.slide.fadeOut(0.08)
  actions.hit?.stop()
  actions.hitAlt?.stop()
  pick.reset().setEffectiveWeight(1).fadeIn(0.05).play()
}

export function playDummyDeath(root: THREE.Group) {
  const actions = getDummyActions(root)
  if (!actions?.death) {
    root.userData.animState = 'death'
    return
  }
  root.userData.animState = 'death'
  root.userData.locoState = null
  for (const a of locoLoopActions(actions)) {
    if (a?.isRunning()) a.fadeOut(0.08)
  }
  if (actions.slide?.isRunning()) actions.slide.fadeOut(0.08)
  actions.hit?.stop()
  actions.hitAlt?.stop()
  actions.death.reset().setEffectiveWeight(1).fadeIn(0.05).play()
  applyDummyCrouchScale(root, false)
}
