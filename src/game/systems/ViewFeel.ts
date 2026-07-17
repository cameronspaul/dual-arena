/**
 * View bob, gun sway, land spring, air float, slide cant — visual only.
 */
import * as THREE from 'three'
import { gameAudio } from '../core/audio'
import {
  GUN_SWAY,
  LOOK,
  SLIDE_GUN,
  SNIPER,
  THIRD_PERSON,
  VIEW_BOB,
} from '../core/config'
import { clamp, lookDirection } from '../core/math'
import type { PlayerBody, SniperState } from '../core/types'
import { eyePosition } from '../sim/player'
import { effectiveLook } from '../sim/sniper'
import type { ViewmodelSystem } from '../viewmodel/ViewmodelSystem'

export class ViewFeel {
  bobPhase = 0
  bobAmount = 0
  gunSwayTime = 0
  slideGunBlend = 0
  /** Smoothed 0..1 sprint FOV blend */
  sprintFovBlend = 0
  /** Smoothed 0..1 hip → run pose blend */
  runPoseBlend = 0
  /** Smoothed local move lean: +forward, +right (camera yaw basis) */
  moveLeanFwd = 0
  moveLeanRight = 0
  landOffset = 0
  landVel = 0
  airRise = 0
  wasGrounded = true
  prevVelY = 0
  private prevAdsScoped = false
  private footstepBobSign = 0

  /**
   * Sample fall speed before collision (call before stepPlayer).
   */
  samplePreStep(player: PlayerBody) {
    this.prevVelY = player.velocity.y
  }

  /**
   * Landing / ADS / jump SFX + spring integration for land dip.
   * Returns whether grounded after step (for callers).
   */
  stepLandingAndSfx(
    dt: number,
    player: PlayerBody,
    sniper: SniperState,
    prevGrounded: boolean,
    prevMoveState: PlayerBody['state'],
  ) {
    const grounded = player.grounded
    const speed = Math.hypot(player.velocity.x, player.velocity.z)

    if (prevGrounded && !grounded && player.velocity.y > 3) {
      gameAudio.play('jump', { volume: 0.5 })
    }
    if (player.state === 'slide' && prevMoveState !== 'slide') {
      gameAudio.play('slide', { volume: 0.6 })
    }

    if (grounded && !this.wasGrounded) {
      const impact = Math.max(0, -this.prevVelY)
      const peak = Math.min(
        VIEW_BOB.landMax,
        VIEW_BOB.landKick + impact * VIEW_BOB.landImpactScale,
      )
      const w = VIEW_BOB.landOmega
      this.landVel += peak * w * Math.E
      gameAudio.play('land', {
        volume: Math.min(1, 0.35 + impact * 0.08),
      })
    }
    this.wasGrounded = grounded

    const scoped = sniper.adsBlend > 0.55
    if (scoped !== this.prevAdsScoped) {
      // Tight pitch variance so clicks stay snappy, not whooshy
      const rate = 0.97 + Math.random() * 0.06
      gameAudio.play(scoped ? 'adsIn' : 'adsOut', {
        volume: scoped ? 0.6 : 0.52,
        rate,
      })
      this.prevAdsScoped = scoped
    }

    {
      const w = VIEW_BOB.landOmega
      const damp = 2 * w * VIEW_BOB.landDamp
      this.landVel += (-w * w * this.landOffset - damp * this.landVel) * dt
      this.landOffset += this.landVel * dt
      if (this.landOffset < 0) {
        this.landOffset = 0
        if (this.landVel < 0) this.landVel = 0
      }
      if (this.landOffset > VIEW_BOB.landMax) {
        this.landOffset = VIEW_BOB.landMax
        if (this.landVel > 0) this.landVel = 0
      }
    }

    return { grounded, speed }
  }

  /** Bob phase, sway, air rise, slide blend + camera / viewmodel pose. */
  applyCameraAndViewmodel(opts: {
    dt: number
    player: PlayerBody
    sniper: SniperState
    camera: THREE.PerspectiveCamera
    thirdPerson: boolean
    viewmodel: ViewmodelSystem
    grounded: boolean
    speed: number
  }) {
    const {
      dt,
      player: p,
      sniper,
      camera,
      thirdPerson,
      viewmodel: vm,
      grounded,
      speed,
    } = opts

    let bobTarget = 0
    if (grounded && speed > VIEW_BOB.minSpeed) {
      bobTarget = Math.min(
        1,
        (speed - VIEW_BOB.minSpeed) /
          (VIEW_BOB.fullSpeed - VIEW_BOB.minSpeed),
      )
      if (p.state === 'crouch') bobTarget *= VIEW_BOB.crouchMul
      else if (p.state === 'slide') bobTarget *= VIEW_BOB.slideMul
    } else if (!grounded) {
      bobTarget = this.bobAmount * VIEW_BOB.airMul
    }
    bobTarget *= 1 - sniper.adsBlend * (1 - VIEW_BOB.adsMul)

    const bobK = 1 - Math.exp(-VIEW_BOB.amountLerp * dt)
    this.bobAmount += (bobTarget - this.bobAmount) * bobK

    if (grounded && speed > VIEW_BOB.minSpeed) {
      const freqScale = Math.min(
        speed / VIEW_BOB.freqSpeedRef,
        VIEW_BOB.freqSpeedCap,
      )
      this.bobPhase += VIEW_BOB.frequency * freqScale * dt
      if (
        p.state !== 'slide' &&
        !vm.freezeBob &&
        sniper.adsBlend < 0.85
      ) {
        const sign = Math.sin(this.bobPhase) >= 0 ? 1 : -1
        if (this.footstepBobSign !== 0 && sign !== this.footstepBobSign) {
          gameAudio.footstep(speed, p.state === 'run')
        }
        this.footstepBobSign = sign
      }
    } else {
      this.footstepBobSign = 0
    }

    const sprintT = Math.min(
      1,
      Math.max(
        0,
        (speed - VIEW_BOB.freqSpeedRef) /
          Math.max(0.001, VIEW_BOB.fullSpeed - VIEW_BOB.freqSpeedRef),
      ),
    )
    const heavy =
      grounded && p.state !== 'crouch' && p.state !== 'slide'
        ? 1 + sprintT * (VIEW_BOB.sprintHeavyMul - 1)
        : 1

    const bobA = vm.freezeBob ? 0 : this.bobAmount
    const s1 = Math.sin(this.bobPhase)
    const s2 = Math.sin(this.bobPhase * 2)
    const c2 = Math.cos(this.bobPhase * 2)
    const bobGunX = s1 * VIEW_BOB.gunX * bobA
    const bobGunY = s2 * VIEW_BOB.gunY * bobA * heavy
    const bobGunZ = c2 * VIEW_BOB.gunZ * bobA * heavy
    const bobGunPitch = c2 * VIEW_BOB.gunPitch * bobA * heavy
    const bobGunRoll = s1 * VIEW_BOB.gunRoll * bobA

    this.gunSwayTime += dt
    const adsBlend = vm.adsBlend(sniper.adsBlend)
    let swayMul = vm.freezeBob ? 0 : 1 - adsBlend * (1 - GUN_SWAY.adsMul)
    if (speed > 1) swayMul *= GUN_SWAY.moveMul
    // Stronger idle oscillation while sprinting so the rifle feels alive
    const sprintOsc = 1 + sprintT * GUN_SWAY.sprintOscMul
    const st = this.gunSwayTime
    let swayX =
      Math.sin(st * GUN_SWAY.freqYaw) * GUN_SWAY.posX * swayMul * sprintOsc
    let swayY =
      Math.cos(st * GUN_SWAY.freqPitch) * GUN_SWAY.posY * swayMul * sprintOsc
    let swayYaw =
      Math.sin(st * GUN_SWAY.freqYaw * 0.85) *
      GUN_SWAY.yaw *
      swayMul *
      sprintOsc
    let swayPitch =
      Math.cos(st * GUN_SWAY.freqPitch * 1.1) *
      GUN_SWAY.pitch *
      swayMul *
      sprintOsc
    let swayRoll =
      Math.sin(st * GUN_SWAY.freqRoll) * GUN_SWAY.roll * swayMul * sprintOsc

    // Procedural lean into local move direction (strafe / forward / back)
    {
      let leanMul = vm.freezeBob ? 0 : 1 - adsBlend * (1 - GUN_SWAY.adsMul)
      if (p.state === 'slide') leanMul *= 0.25
      else if (p.state === 'run') leanMul *= GUN_SWAY.runLeanMul

      const sin = Math.sin(p.yaw)
      const cos = Math.cos(p.yaw)
      // Same facing basis as wishDir / locomotion
      const localFwd = -p.velocity.x * sin - p.velocity.z * cos
      const localRight = p.velocity.x * cos - p.velocity.z * sin
      const invRef = 1 / Math.max(0.001, GUN_SWAY.leanSpeedRef)
      const tgtFwd = clamp(localFwd * invRef, -1, 1) * leanMul
      const tgtRight = clamp(localRight * invRef, -1, 1) * leanMul

      const leanK = 1 - Math.exp(-GUN_SWAY.leanLerp * dt)
      this.moveLeanFwd += (tgtFwd - this.moveLeanFwd) * leanK
      this.moveLeanRight += (tgtRight - this.moveLeanRight) * leanK

      const lf = this.moveLeanFwd
      const lr = this.moveLeanRight
      // Strafe: bank + shift into the move. Forward/back: pitch + push along Z.
      swayX += lr * GUN_SWAY.leanPosX
      swayY += Math.abs(lf) * GUN_SWAY.leanPosY
      swayYaw += -lr * GUN_SWAY.leanYaw
      swayPitch += lf * GUN_SWAY.leanPitch
      swayRoll += lr * GUN_SWAY.leanRoll
      // Micro-oscillation biased by the active move axis
      const osc = swayMul * (0.35 + 0.65 * Math.hypot(lf, lr))
      swayX += Math.sin(st * GUN_SWAY.freqYaw * 1.4) * lr * 0.004 * osc
      swayRoll += Math.sin(st * GUN_SWAY.freqRoll * 1.2) * lr * 0.012 * osc
      swayPitch += Math.cos(st * GUN_SWAY.freqPitch * 1.3) * lf * 0.008 * osc
    }
    const leanPosZ = this.moveLeanFwd * GUN_SWAY.leanPosZ

    {
      let airTarget = 0
      if (!grounded && !vm.freezeBob) {
        const fall = Math.max(0, -p.velocity.y)
        const fallT = Math.min(1, fall / VIEW_BOB.airRiseFallRef)
        airTarget = Math.min(
          VIEW_BOB.airRiseMax,
          VIEW_BOB.airRise * Math.max(fallT, 0.35) +
            fall * VIEW_BOB.airRiseFallScale,
        )
        if (p.velocity.y > 0.5) {
          airTarget = Math.min(airTarget, VIEW_BOB.airRise * 0.4)
        }
        airTarget *= 1 - adsBlend * (1 - VIEW_BOB.airRiseAdsMul)
      }
      const airRate =
        airTarget > this.airRise
          ? VIEW_BOB.airRiseLerpIn
          : VIEW_BOB.airRiseLerpOut
      const airK = 1 - Math.exp(-airRate * dt)
      this.airRise += (airTarget - this.airRise) * airK
    }

    const slideTarget =
      p.state === 'slide' && !vm.freezeBob
        ? 1 - adsBlend * (1 - SLIDE_GUN.adsMul)
        : 0
    const slideK = 1 - Math.exp(-SLIDE_GUN.lerp * dt)
    this.slideGunBlend += (slideTarget - this.slideGunBlend) * slideK
    const slide = this.slideGunBlend

    // Sprint FOV + run pose — speed + run state; die under ADS / slide
    {
      const liveSprint =
        !vm.freezeBob &&
        grounded &&
        p.state === 'run' &&
        sniper.adsBlend < 0.5
          ? sprintT * (1 - sniper.adsBlend)
          : 0
      const fovK = 1 - Math.exp(-LOOK.sprintFovLerp * dt)
      this.sprintFovBlend += (liveSprint - this.sprintFovBlend) * fovK

      // Pose blend: editor force, else live sprint (ADS handled in poseViewmodel)
      const liveRunPose =
        vm.forceRun != null
          ? vm.forceRun
          : !vm.freezeBob && grounded && p.state === 'run'
            ? sprintT
            : 0
      const runK = 1 - Math.exp(-VIEW_BOB.runPoseLerp * dt)
      // When forcing in editor, still ease so it doesn't pop
      const runTarget = vm.runBlend(liveRunPose)
      this.runPoseBlend += (runTarget - this.runPoseBlend) * runK
    }

    const eye = eyePosition(p)
    const look = effectiveLook(p, sniper)
    camera.rotation.y = look.yaw
    camera.rotation.x = look.pitch

    if (thirdPerson) {
      const dir = lookDirection(look.yaw, look.pitch)
      const rightX = -Math.sin(look.yaw + Math.PI / 2)
      const rightZ = -Math.cos(look.yaw + Math.PI / 2)
      const pivotY =
        p.position.y + p.eyeHeight * THIRD_PERSON.pivotEyeFrac
      let camX =
        p.position.x -
        dir.x * THIRD_PERSON.distance +
        rightX * THIRD_PERSON.shoulder
      let camY = pivotY - dir.y * THIRD_PERSON.distance
      let camZ =
        p.position.z -
        dir.z * THIRD_PERSON.distance +
        rightZ * THIRD_PERSON.shoulder
      const floorY = p.position.y + THIRD_PERSON.minHeight
      if (camY < floorY) camY = floorY
      camera.position.set(camX, camY, camZ)
    } else {
      camera.position.set(eye.x, eye.y, eye.z)
    }

    const fov =
      LOOK.hipFov +
      (LOOK.adsFov - LOOK.hipFov) * sniper.adsBlend +
      SLIDE_GUN.fovBoost * slide +
      LOOK.sprintFovBoost * this.sprintFovBlend +
      (thirdPerson ? THIRD_PERSON.fovBoost * (1 - sniper.adsBlend) : 0)
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }

    this.poseViewmodel(vm, sniper, adsBlend, this.runPoseBlend, {
      bobGunX,
      bobGunY,
      bobGunZ: bobGunZ + leanPosZ,
      bobGunPitch,
      bobGunRoll,
      swayX,
      swayY,
      swayYaw,
      swayPitch,
      swayRoll,
      slide,
      thirdPerson,
    })
  }

  private poseViewmodel(
    vm: ViewmodelSystem,
    sniper: SniperState,
    ads: number,
    run: number,
    o: {
      bobGunX: number
      bobGunY: number
      bobGunZ: number
      bobGunPitch: number
      bobGunRoll: number
      swayX: number
      swayY: number
      swayYaw: number
      swayPitch: number
      swayRoll: number
      slide: number
      thirdPerson: boolean
    },
  ) {
    if (!vm.root) return
    if (o.thirdPerson) {
      vm.root.visible = false
      return
    }

    const { hipPos, hipRot, adsPos, adsRot, runPos, runRot, hideAds } =
      vm.config
    // hip → run (sprint), then → ads. ADS always wins over run hold.
    const runT = clamp(run, 0, 1) * (1 - ads)
    const basePos = new THREE.Vector3(
      hipPos.x + (runPos.x - hipPos.x) * runT,
      hipPos.y + (runPos.y - hipPos.y) * runT,
      hipPos.z + (runPos.z - hipPos.z) * runT,
    )
    const scoped = new THREE.Vector3(adsPos.x, adsPos.y, adsPos.z)
    const land = vm.freezeBob ? 0 : this.landOffset
    const air = vm.freezeBob ? 0 : this.airRise
    vm.root.position.lerpVectors(basePos, scoped, ads)
    vm.root.position.x += o.bobGunX + o.swayX + SLIDE_GUN.posX * o.slide
    vm.root.position.y +=
      o.bobGunY + o.swayY - land + air + SLIDE_GUN.posY * o.slide
    vm.root.position.z += o.bobGunZ + SLIDE_GUN.posZ * o.slide
    const recoilKick = vm.freezeBob
      ? 0
      : sniper.recoil * SNIPER.viewmodelRecoil
    const landPitch = land * VIEW_BOB.landPitch
    const airPitch =
      VIEW_BOB.airRiseMax > 1e-6
        ? (air / VIEW_BOB.airRiseMax) * VIEW_BOB.airRisePitch
        : 0
    const baseRotX = hipRot.x + (runRot.x - hipRot.x) * runT
    const baseRotY = hipRot.y + (runRot.y - hipRot.y) * runT
    const baseRotZ = hipRot.z + (runRot.z - hipRot.z) * runT
    vm.root.rotation.set(
      baseRotX * (1 - ads) +
        adsRot.x * ads +
        recoilKick +
        o.bobGunPitch +
        o.swayPitch +
        landPitch +
        airPitch +
        SLIDE_GUN.pitch * o.slide,
      baseRotY * (1 - ads) +
        adsRot.y * ads +
        o.swayYaw +
        SLIDE_GUN.yaw * o.slide,
      baseRotZ * (1 - ads) +
        adsRot.z * ads +
        o.bobGunRoll +
        o.swayRoll +
        SLIDE_GUN.roll * o.slide,
    )
    vm.root.visible = vm.keepVisible || ads < hideAds
  }
}
