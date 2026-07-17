/** Serializable first-person viewmodel pose — tuned via the in-game editor. */

export type VmVec3 = { x: number; y: number; z: number }

/** Additive pose for one joint (relative to the glTF rest pose). */
export type ArmJointPose = {
  rot: VmVec3
  pos: VmVec3
}

export type FingerId = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky'

export const FINGER_IDS: FingerId[] = [
  'thumb',
  'index',
  'middle',
  'ring',
  'pinky',
]

/** Per-finger curl/spread (radians). Curl fans across the 3 segments. */
export type FingerPose = {
  curl: number
  spread: number
}

/** Full limb: shoulder → bicep → forearm → wrist + fingers. */
export type ArmChainPose = {
  shoulder: ArmJointPose
  bicep: ArmJointPose
  forearm: ArmJointPose
  wrist: ArmJointPose
  fingers: Record<FingerId, FingerPose>
}

export type ViewmodelConfig = {
  /** Gun longest-axis target after normalize (world units). */
  scale: number
  /** Pre-normalize basis correction on the gun mesh. */
  modelRot: VmVec3
  /** Post-center local offset on the gun (grip bias). */
  gunOffset: VmVec3
  hipPos: VmVec3
  hipRot: VmVec3
  adsPos: VmVec3
  adsRot: VmVec3
  /**
   * Sprint / run hold pose (camera-local). Blended hip → run while sprinting.
   * Author in the Viewmodel editor (Run tab) and export; missing fields fall
   * back to hip so older JSON stays valid.
   */
  runPos: VmVec3
  runRot: VmVec3
  hideAds: number
  arms: {
    /** Arms longest-axis target after normalize. */
    scale: number
    pos: VmVec3
    rot: VmVec3
    /** Per-side bone offsets (radians / local units). */
    left: ArmChainPose
    right: ArmChainPose
  }
}

/** File schema written by the editor (download / paste). */
export type ViewmodelExportFile = {
  version: 1
  savedAt: string
  viewmodel: ViewmodelConfig
}

export function zeroVec3(): VmVec3 {
  return { x: 0, y: 0, z: 0 }
}

export function defaultArmJoint(): ArmJointPose {
  return { rot: zeroVec3(), pos: zeroVec3() }
}

export function defaultFinger(): FingerPose {
  return { curl: 0, spread: 0 }
}

export function defaultFingers(): Record<FingerId, FingerPose> {
  return {
    thumb: defaultFinger(),
    index: defaultFinger(),
    middle: defaultFinger(),
    ring: defaultFinger(),
    pinky: defaultFinger(),
  }
}

export function defaultArmChain(): ArmChainPose {
  return {
    shoulder: defaultArmJoint(),
    bicep: defaultArmJoint(),
    forearm: defaultArmJoint(),
    wrist: defaultArmJoint(),
    fingers: defaultFingers(),
  }
}

export function cloneVec3(v: VmVec3): VmVec3 {
  return { x: v.x, y: v.y, z: v.z }
}

export function cloneArmJoint(j: ArmJointPose): ArmJointPose {
  return { rot: cloneVec3(j.rot), pos: cloneVec3(j.pos) }
}

export function cloneFinger(f: FingerPose): FingerPose {
  return { curl: f.curl, spread: f.spread }
}

export function cloneArmChain(c: ArmChainPose): ArmChainPose {
  return {
    shoulder: cloneArmJoint(c.shoulder),
    bicep: cloneArmJoint(c.bicep),
    forearm: cloneArmJoint(c.forearm),
    wrist: cloneArmJoint(c.wrist),
    fingers: {
      thumb: cloneFinger(c.fingers.thumb),
      index: cloneFinger(c.fingers.index),
      middle: cloneFinger(c.fingers.middle),
      ring: cloneFinger(c.fingers.ring),
      pinky: cloneFinger(c.fingers.pinky),
    },
  }
}

function asVec3(v: unknown, fallback = zeroVec3()): VmVec3 {
  if (!v || typeof v !== 'object') return cloneVec3(fallback)
  const o = v as Record<string, unknown>
  return {
    x: typeof o.x === 'number' ? o.x : fallback.x,
    y: typeof o.y === 'number' ? o.y : fallback.y,
    z: typeof o.z === 'number' ? o.z : fallback.z,
  }
}

function asArmJoint(v: unknown): ArmJointPose {
  if (!v || typeof v !== 'object') return defaultArmJoint()
  const o = v as Record<string, unknown>
  return {
    rot: asVec3(o.rot),
    pos: asVec3(o.pos),
  }
}

function asFinger(v: unknown): FingerPose {
  if (!v || typeof v !== 'object') return defaultFinger()
  const o = v as Record<string, unknown>
  return {
    curl: typeof o.curl === 'number' ? o.curl : 0,
    spread: typeof o.spread === 'number' ? o.spread : 0,
  }
}

function asArmChain(v: unknown): ArmChainPose {
  if (!v || typeof v !== 'object') return defaultArmChain()
  const o = v as Record<string, unknown>
  // Legacy upper/lower/hand → shoulder/forearm/wrist
  const shoulder = asArmJoint(o.shoulder ?? o.upper)
  const bicep = asArmJoint(o.bicep)
  const forearm = asArmJoint(o.forearm ?? o.lower)
  const wrist = asArmJoint(o.wrist ?? o.hand)
  const fingersIn = (o.fingers as Record<string, unknown> | undefined) ?? {}
  return {
    shoulder,
    bicep,
    forearm,
    wrist,
    fingers: {
      thumb: asFinger(fingersIn.thumb),
      index: asFinger(fingersIn.index),
      middle: asFinger(fingersIn.middle),
      ring: asFinger(fingersIn.ring),
      pinky: asFinger(fingersIn.pinky),
    },
  }
}

export function cloneViewmodelConfig(c: ViewmodelConfig): ViewmodelConfig {
  return {
    scale: c.scale,
    modelRot: cloneVec3(c.modelRot),
    gunOffset: cloneVec3(c.gunOffset),
    hipPos: cloneVec3(c.hipPos),
    hipRot: cloneVec3(c.hipRot),
    adsPos: cloneVec3(c.adsPos),
    adsRot: cloneVec3(c.adsRot),
    runPos: cloneVec3(c.runPos),
    runRot: cloneVec3(c.runRot),
    hideAds: c.hideAds,
    arms: {
      scale: c.arms.scale,
      pos: cloneVec3(c.arms.pos),
      rot: cloneVec3(c.arms.rot),
      left: cloneArmChain(c.arms.left ?? defaultArmChain()),
      right: cloneArmChain(c.arms.right ?? defaultArmChain()),
    },
  }
}

/**
 * Resolve run pose from flat runPos/runRot or nested `run: { pos, rot }`.
 * Falls back to hip when absent (legacy exports).
 */
function asRunPose(
  vm: Record<string, unknown>,
  hipPos: VmVec3,
  hipRot: VmVec3,
): { pos: VmVec3; rot: VmVec3 } {
  const nested =
    vm.run && typeof vm.run === 'object'
      ? (vm.run as Record<string, unknown>)
      : null
  const posSrc = vm.runPos ?? nested?.pos
  const rotSrc = vm.runRot ?? nested?.rot
  return {
    pos: asVec3(posSrc, hipPos),
    rot: asVec3(rotSrc, hipRot),
  }
}

/** Normalize partial / legacy exports into a full config. */
export function normalizeViewmodelConfig(raw: unknown): ViewmodelConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid JSON')
  }
  const obj = raw as Record<string, unknown>
  const vm = (obj.viewmodel ?? obj) as Record<string, unknown>
  if (typeof vm.scale !== 'number' || !vm.hipPos || !vm.arms) {
    throw new Error('Missing viewmodel fields (need scale, hipPos, arms, …)')
  }
  const arms = vm.arms as Record<string, unknown>
  const hipPos = asVec3(vm.hipPos)
  const hipRot = asVec3(vm.hipRot)
  const run = asRunPose(vm, hipPos, hipRot)
  return {
    scale: vm.scale as number,
    modelRot: asVec3(vm.modelRot),
    gunOffset: asVec3(vm.gunOffset),
    hipPos,
    hipRot,
    adsPos: asVec3(vm.adsPos),
    adsRot: asVec3(vm.adsRot),
    runPos: run.pos,
    runRot: run.rot,
    hideAds: typeof vm.hideAds === 'number' ? vm.hideAds : 0.92,
    arms: {
      scale: typeof arms.scale === 'number' ? arms.scale : 0.72,
      pos: asVec3(arms.pos),
      rot: asVec3(arms.rot),
      left: asArmChain(arms.left),
      right: asArmChain(arms.right),
    },
  }
}

export function makeViewmodelExport(cfg: ViewmodelConfig): ViewmodelExportFile {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    viewmodel: cloneViewmodelConfig(cfg),
  }
}

export function parseViewmodelExport(raw: unknown): ViewmodelConfig {
  return normalizeViewmodelConfig(raw)
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
