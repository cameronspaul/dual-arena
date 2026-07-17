import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { GameEngine } from '@/game/engine'
import {
  defaultArmChain,
  downloadJson,
  FINGER_IDS,
  makeViewmodelExport,
  parseViewmodelExport,
  type ArmChainPose,
  type ArmJointPose,
  type FingerId,
  type FingerPose,
  type ViewmodelConfig,
  type VmVec3,
} from '@/game/viewmodelConfig'

type Props = {
  engine: GameEngine | null
  open: boolean
  onClose: () => void
}

type SectionId = 'hip' | 'ads' | 'run' | 'gun' | 'pair' | 'left' | 'right'
type LimbId = 'shoulder' | 'bicep' | 'forearm' | 'wrist' | 'fingers'
type PreviewPose = 'hip' | 'ads' | 'run' | 'mid' | 'live'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'hip', label: 'Hip' },
  { id: 'ads', label: 'ADS' },
  { id: 'run', label: 'Run' },
  { id: 'gun', label: 'Gun' },
  { id: 'pair', label: 'Pair' },
  { id: 'left', label: 'L Hand' },
  { id: 'right', label: 'R Hand' },
]

const LIMBS: { id: LimbId; label: string }[] = [
  { id: 'shoulder', label: 'Shoulder' },
  { id: 'bicep', label: 'Bicep' },
  { id: 'forearm', label: 'Forearm' },
  { id: 'wrist', label: 'Wrist' },
  { id: 'fingers', label: 'Fingers' },
]

function radToDeg(r: number) {
  return (r * 180) / Math.PI
}
function degToRad(d: number) {
  return (d * Math.PI) / 180
}

function fmt(n: number, digits = 4) {
  if (!Number.isFinite(n)) return '0'
  const t = Number(n.toFixed(digits))
  return Object.is(t, -0) ? '0' : String(t)
}

function toDegVec(v: VmVec3): VmVec3 {
  return { x: radToDeg(v.x), y: radToDeg(v.y), z: radToDeg(v.z) }
}
function toRadVec(v: VmVec3): VmVec3 {
  return { x: degToRad(v.x), y: degToRad(v.y), z: degToRad(v.z) }
}

export function ViewmodelEditor({ engine, open, onClose }: Props) {
  const [cfg, setCfg] = useState<ViewmodelConfig | null>(null)
  const [section, setSection] = useState<SectionId>('left')
  const [limb, setLimb] = useState<LimbId>('wrist')
  const [preview, setPreview] = useState<PreviewPose>('hip')
  const [freezeBob, setFreezeBob] = useState(true)
  const [keepVisible, setKeepVisible] = useState(true)
  const [status, setStatus] = useState('')
  const [hasBones, setHasBones] = useState(false)
  const [hasHands, setHasHands] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const applyPreview = useCallback(
    (mode: PreviewPose) => {
      if (!engine) return
      setPreview(mode)
      if (mode === 'hip') {
        engine.setViewmodelForceAds(0)
        engine.setViewmodelForceRun(0)
      } else if (mode === 'ads') {
        engine.setViewmodelForceAds(1)
        engine.setViewmodelForceRun(0)
      } else if (mode === 'run') {
        engine.setViewmodelForceAds(0)
        engine.setViewmodelForceRun(1)
      } else if (mode === 'mid') {
        engine.setViewmodelForceAds(0.5)
        engine.setViewmodelForceRun(0)
      } else {
        engine.setViewmodelForceAds(null)
        engine.setViewmodelForceRun(null)
      }
    },
    [engine],
  )

  useEffect(() => {
    if (!open || !engine) return
    engine.setViewmodelEditorActive(true)
    engine.setViewmodelForceAds(0)
    engine.setViewmodelForceRun(0)
    engine.setViewmodelFreezeBob(true)
    engine.setViewmodelKeepVisible(true)
    engine.setViewmodelArmSolo('left')
    setPreview('hip')
    setFreezeBob(true)
    setKeepVisible(true)
    setSection('left')
    setLimb('wrist')

    let cancelled = false
    const pull = () => {
      if (cancelled) return
      if (engine.isViewmodelReady()) {
        setCfg(engine.getViewmodelConfig())
        setHasBones(engine.hasArmBones())
        setHasHands(engine.hasHandBones())
      } else {
        requestAnimationFrame(pull)
      }
    }
    pull()

    return () => {
      cancelled = true
      engine.setViewmodelEditorActive(false)
    }
  }, [open, engine])

  useEffect(() => {
    if (!open || !engine) return
    if (section === 'left') engine.setViewmodelArmSolo('left')
    else if (section === 'right') engine.setViewmodelArmSolo('right')
    else engine.setViewmodelArmSolo('both')
    // Jump preview when opening a pose tab so edits are visible immediately
    if (section === 'hip') applyPreview('hip')
    else if (section === 'ads') applyPreview('ads')
    else if (section === 'run') applyPreview('run')
  }, [section, open, engine, applyPreview])

  const push = useCallback(
    (next: ViewmodelConfig) => {
      setCfg(next)
      engine?.setViewmodelConfig(next, true)
    },
    [engine],
  )

  const patch = useCallback(
    (mut: (c: ViewmodelConfig) => void) => {
      if (!cfg) return
      const next = structuredClone(cfg) as ViewmodelConfig
      mut(next)
      push(next)
    },
    [cfg, push],
  )

  if (!open) return null

  const onExport = () => {
    if (!cfg) return
    const file = makeViewmodelExport(cfg)
    downloadJson('viewmodel-config.json', file)
    setStatus('Downloaded viewmodel-config.json — send that file over')
  }

  const onCopy = async () => {
    if (!cfg) return
    const file = makeViewmodelExport(cfg)
    try {
      await navigator.clipboard.writeText(JSON.stringify(file, null, 2))
      setStatus('Copied JSON to clipboard')
    } catch {
      setStatus('Clipboard failed — use Download instead')
    }
  }

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text()
      const parsed = parseViewmodelExport(JSON.parse(text))
      push(parsed)
      setStatus(`Imported ${file.name}`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Import failed')
    }
  }

  const onReset = () => {
    engine?.resetViewmodelConfig()
    if (engine) setCfg(engine.getViewmodelConfig())
    setStatus('Reset to code defaults')
  }

  const resetChain = (side: 'left' | 'right') => {
    patch((c) => {
      c.arms[side] = defaultArmChain()
    })
    setStatus(`Reset ${side} arm + hand to rest pose`)
  }

  return (
    <div
      className="pointer-events-auto absolute bottom-3 left-3 top-3 z-50 flex w-[min(100vw-1.5rem,23rem)] flex-col overflow-hidden rounded-xl border border-white/15 bg-black/85 text-white shadow-2xl backdrop-blur-md"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div>
          <div className="text-sm font-semibold tracking-wide">Viewmodel editor</div>
          <div className="text-[10px] text-white/50">
            Pose each hand · fingers · export JSON
          </div>
        </div>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
          onClick={onClose}
        >
          Close
        </button>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-white/10 p-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={`rounded-md px-2 py-1 text-[11px] font-medium ${
              section === s.id
                ? s.id === 'left' || s.id === 'right'
                  ? 'bg-amber-600 text-white'
                  : 'bg-sky-600 text-white'
                : 'bg-white/5 text-white/70 hover:bg-white/10'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="space-y-2 border-b border-white/10 p-3 text-[11px]">
        <label className="flex items-center justify-between gap-2">
          <span className="text-white/70">Preview pose</span>
          <select
            className="rounded border border-white/15 bg-black/60 px-2 py-1"
            value={preview}
            onChange={(e) => applyPreview(e.target.value as PreviewPose)}
          >
            <option value="hip">Hip (forced)</option>
            <option value="run">Run (forced)</option>
            <option value="ads">ADS (forced)</option>
            <option value="mid">ADS mid 50%</option>
            <option value="live">Live (sprint / RMB)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-white/70">
          <input
            type="checkbox"
            checked={freezeBob}
            onChange={(e) => {
              setFreezeBob(e.target.checked)
              engine?.setViewmodelFreezeBob(e.target.checked)
            }}
          />
          Freeze bob / recoil
        </label>
        <label className="flex items-center gap-2 text-white/70">
          <input
            type="checkbox"
            checked={keepVisible}
            onChange={(e) => {
              setKeepVisible(e.target.checked)
              engine?.setViewmodelKeepVisible(e.target.checked)
            }}
          />
          Keep mesh visible at full ADS
        </label>
        {(section === 'left' || section === 'right') && (
          <p className="rounded bg-amber-500/15 px-2 py-1 text-[10px] text-amber-100/90">
            Soloing <strong>{section === 'left' ? 'left' : 'right'}</strong> hand
            — other arm hidden. Use Pair to see both.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!cfg ? (
          <p className="text-xs text-white/50">Loading viewmodel…</p>
        ) : section === 'hip' ? (
          <>
            <Vec3Fields
              label="Hip position"
              value={cfg.hipPos}
              step={0.005}
              min={-2}
              max={2}
              onChange={(hipPos) => patch((c) => { c.hipPos = hipPos })}
            />
            <Vec3Fields
              label="Hip rotation (deg)"
              value={toDegVec(cfg.hipRot)}
              step={0.5}
              min={-180}
              max={180}
              onChange={(d) => patch((c) => { c.hipRot = toRadVec(d) })}
            />
          </>
        ) : section === 'ads' ? (
          <>
            <Vec3Fields
              label="ADS position"
              value={cfg.adsPos}
              step={0.005}
              min={-2}
              max={2}
              onChange={(adsPos) => patch((c) => { c.adsPos = adsPos })}
            />
            <Vec3Fields
              label="ADS rotation (deg)"
              value={toDegVec(cfg.adsRot)}
              step={0.5}
              min={-180}
              max={180}
              onChange={(d) => patch((c) => { c.adsRot = toRadVec(d) })}
            />
            <NumField
              label="Hide ADS threshold"
              value={cfg.hideAds}
              step={0.01}
              min={0}
              max={1}
              onChange={(hideAds) => patch((c) => { c.hideAds = hideAds })}
            />
          </>
        ) : section === 'run' ? (
          <>
            <p className="mb-2 text-[10px] leading-snug text-white/45">
              Sprint hold pose. Blends hip → run while sprinting; ADS still
              overrides. Export JSON and paste into{' '}
              <code className="text-white/60">VIEWMODEL</code> (or send the
              file) — it&apos;s plug-and-play.
            </p>
            <Vec3Fields
              label="Run position"
              value={cfg.runPos}
              step={0.005}
              min={-2}
              max={2}
              onChange={(runPos) => patch((c) => { c.runPos = runPos })}
            />
            <Vec3Fields
              label="Run rotation (deg)"
              value={toDegVec(cfg.runRot)}
              step={0.5}
              min={-180}
              max={180}
              onChange={(d) => patch((c) => { c.runRot = toRadVec(d) })}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Btn
                muted
                onClick={() =>
                  patch((c) => {
                    c.runPos = { ...c.hipPos }
                    c.runRot = { ...c.hipRot }
                  })
                }
              >
                Copy from hip
              </Btn>
            </div>
          </>
        ) : section === 'gun' ? (
          <>
            <NumField
              label="Gun scale (longest axis)"
              value={cfg.scale}
              step={0.01}
              min={0.05}
              max={3}
              onChange={(scale) => patch((c) => { c.scale = scale })}
            />
            <Vec3Fields
              label="Gun offset"
              value={cfg.gunOffset}
              step={0.005}
              min={-2}
              max={2}
              onChange={(gunOffset) => patch((c) => { c.gunOffset = gunOffset })}
            />
            <Vec3Fields
              label="Gun model rot (deg)"
              value={toDegVec(cfg.modelRot)}
              step={1}
              min={-180}
              max={180}
              onChange={(d) => patch((c) => { c.modelRot = toRadVec(d) })}
            />
          </>
        ) : section === 'pair' ? (
          <>
            <NumField
              label="Arms pair scale"
              value={cfg.arms.scale}
              step={0.01}
              min={0.05}
              max={3}
              onChange={(scale) => patch((c) => { c.arms.scale = scale })}
            />
            <Vec3Fields
              label="Pair position"
              value={cfg.arms.pos}
              step={0.005}
              min={-2}
              max={2}
              onChange={(pos) => patch((c) => { c.arms.pos = pos })}
            />
            <Vec3Fields
              label="Pair rotation (deg)"
              value={toDegVec(cfg.arms.rot)}
              step={1}
              min={-180}
              max={180}
              onChange={(d) => patch((c) => { c.arms.rot = toRadVec(d) })}
            />
            <p className="mt-2 text-[10px] text-white/40">
              Pair moves both arms together. Open <strong>L Hand</strong> /{' '}
              <strong>R Hand</strong> to pose wrists and fingers on the gun.
            </p>
          </>
        ) : (
          <HandSidePanel
            side={section}
            limb={limb}
            onLimb={setLimb}
            chain={cfg.arms[section]}
            hasBones={hasBones}
            hasHands={hasHands}
            onReset={() => resetChain(section)}
            onLimbPose={(key, mut) =>
              patch((c) => {
                mut(c.arms[section][key])
              })
            }
            onFinger={(id, mut) =>
              patch((c) => {
                mut(c.arms[section].fingers[id])
              })
            }
            onFingersPreset={(preset) =>
              patch((c) => {
                applyFingerPreset(c.arms[section], preset)
              })
            }
          />
        )}
      </div>

      <footer className="space-y-2 border-t border-white/10 p-3">
        <div className="flex flex-wrap gap-1.5">
          <Btn onClick={onExport}>Download JSON</Btn>
          <Btn onClick={() => void onCopy()}>Copy JSON</Btn>
          <Btn onClick={() => fileRef.current?.click()}>Import…</Btn>
          <Btn onClick={onReset} muted>
            Reset all
          </Btn>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onImportFile(f)
            e.target.value = ''
          }}
        />
        {status ? (
          <p className="text-[10px] leading-snug text-emerald-300/90">{status}</p>
        ) : (
          <p className="text-[10px] leading-snug text-white/40">
            Workflow: Hip → Run (sprint hold) → ADS → hands → Download JSON.
          </p>
        )}
      </footer>
    </div>
  )
}

function applyFingerPreset(chain: ArmChainPose, preset: 'open' | 'grip' | 'fist') {
  const setAll = (curl: number, thumbCurl: number, spread = 0) => {
    for (const id of FINGER_IDS) {
      chain.fingers[id] = {
        curl: id === 'thumb' ? thumbCurl : curl,
        spread: id === 'thumb' ? spread * 0.5 : spread * (id === 'pinky' ? 1.2 : 1),
      }
    }
  }
  if (preset === 'open') setAll(0, 0, 0)
  else if (preset === 'grip') setAll(degToRad(42), degToRad(28), degToRad(6))
  else setAll(degToRad(70), degToRad(45), degToRad(4))
}

function HandSidePanel({
  side,
  limb,
  onLimb,
  chain,
  hasBones,
  hasHands,
  onReset,
  onLimbPose,
  onFinger,
  onFingersPreset,
}: {
  side: 'left' | 'right'
  limb: LimbId
  onLimb: (j: LimbId) => void
  chain: ArmChainPose
  hasBones: boolean
  hasHands: boolean
  onReset: () => void
  onLimbPose: (
    key: 'shoulder' | 'bicep' | 'forearm' | 'wrist',
    mut: (joint: ArmJointPose) => void,
  ) => void
  onFinger: (id: FingerId, mut: (f: FingerPose) => void) => void
  onFingersPreset: (p: 'open' | 'grip' | 'fist') => void
}) {
  if (!hasBones) {
    return (
      <p className="text-xs text-amber-200/90">
        No arm bones found on this model — only Pair transform is available.
      </p>
    )
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold capitalize text-white/90">
          {side} hand / arm
        </div>
        <button
          type="button"
          className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/70 hover:bg-white/15"
          onClick={onReset}
        >
          Reset {side}
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {LIMBS.map((j) => (
          <button
            key={j.id}
            type="button"
            onClick={() => onLimb(j.id)}
            className={`rounded-md px-2 py-1 text-[11px] font-medium ${
              limb === j.id
                ? j.id === 'fingers' || j.id === 'wrist'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-amber-600 text-white'
                : 'bg-white/5 text-white/70 hover:bg-white/10'
            }`}
          >
            {j.label}
          </button>
        ))}
      </div>

      {limb === 'fingers' ? (
        <FingersPanel
          fingers={chain.fingers}
          hasHands={hasHands}
          onFinger={onFinger}
          onPreset={onFingersPreset}
        />
      ) : (
        <>
          <Vec3Fields
            label={`${limb} rotation (deg)`}
            value={toDegVec(chain[limb].rot)}
            step={1}
            min={-180}
            max={180}
            onChange={(d) =>
              onLimbPose(limb, (jp) => {
                jp.rot = toRadVec(d)
              })
            }
          />
          <Vec3Fields
            label={`${limb} position`}
            value={chain[limb].pos}
            step={0.002}
            min={-1}
            max={1}
            onChange={(pos) =>
              onLimbPose(limb, (jp) => {
                jp.pos = pos
              })
            }
          />
          {limb === 'wrist' && (
            <p className="text-[10px] text-white/40">
              Seat the wrist on the grip, then open <strong>Fingers</strong> to curl
              around the gun.
            </p>
          )}
        </>
      )}
    </>
  )
}

function FingersPanel({
  fingers,
  hasHands,
  onFinger,
  onPreset,
}: {
  fingers: Record<FingerId, FingerPose>
  hasHands: boolean
  onFinger: (id: FingerId, mut: (f: FingerPose) => void) => void
  onPreset: (p: 'open' | 'grip' | 'fist') => void
}) {
  if (!hasHands) {
    return (
      <p className="text-xs text-amber-200/90">
        Wrist/finger bones not found — try Pair + shoulder/forearm only.
      </p>
    )
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1">
        <Btn onClick={() => onPreset('open')} muted>
          Open
        </Btn>
        <Btn onClick={() => onPreset('grip')}>Grip</Btn>
        <Btn onClick={() => onPreset('fist')} muted>
          Fist
        </Btn>
      </div>

      {FINGER_IDS.map((id) => {
        const f = fingers[id]
        return (
          <div
            key={id}
            className="mb-3 rounded-lg border border-white/10 bg-white/[0.03] p-2"
          >
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/55">
              {id}
            </div>
            <NumField
              label="Curl (deg)"
              value={radToDeg(f.curl)}
              step={1}
              min={-20}
              max={100}
              onChange={(deg) =>
                onFinger(id, (fp) => {
                  fp.curl = degToRad(deg)
                })
              }
            />
            <NumField
              label="Spread (deg)"
              value={radToDeg(f.spread)}
              step={1}
              min={-40}
              max={40}
              onChange={(deg) =>
                onFinger(id, (fp) => {
                  fp.spread = degToRad(deg)
                })
              }
            />
          </div>
        )
      })}
      <p className="text-[10px] text-white/40">
        Curl bends all 3 finger segments. Spread angles the base joint. Use Grip as
        a starting wrap, then fine-tune.
      </p>
    </>
  )
}

function Btn({
  children,
  onClick,
  muted,
}: {
  children: ReactNode
  onClick: () => void
  muted?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
        muted
          ? 'bg-white/5 text-white/60 hover:bg-white/10'
          : 'bg-sky-600 text-white hover:bg-sky-500'
      }`}
    >
      {children}
    </button>
  )
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

function NumField({
  label,
  value,
  onChange,
  step,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  step: number
  /** Fixed slider bounds — must be stable (not derived from value). */
  min: number
  max: number
}) {
  const sliderVal = clamp(value, min, max)
  return (
    <div className="mb-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/45">
        {label}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          className="min-w-0 flex-1 accent-sky-500"
          value={sliderVal}
          step={step}
          min={min}
          max={max}
          onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <input
          type="number"
          className="w-20 rounded border border-white/15 bg-black/50 px-1.5 py-1 text-right text-[11px] tabular-nums"
          value={fmt(value)}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange(clamp(n, min, max))
          }}
        />
      </div>
    </div>
  )
}

function Vec3Fields({
  label,
  value,
  onChange,
  step,
  min,
  max,
}: {
  label: string
  value: VmVec3
  onChange: (v: VmVec3) => void
  step: number
  /** Fixed slider bounds — must be stable (not derived from value). */
  min: number
  max: number
}) {
  const axis = (k: keyof VmVec3, color: string) => {
    const raw = value[k]
    const sliderVal = clamp(raw, min, max)
    return (
      <div key={k} className="mb-1.5 flex items-center gap-2">
        <span className={`w-3 text-[10px] font-bold ${color}`}>{k.toUpperCase()}</span>
        <input
          type="range"
          className="min-w-0 flex-1 accent-sky-500"
          value={sliderVal}
          step={step}
          min={min}
          max={max}
          onInput={(e) =>
            onChange({
              ...value,
              [k]: Number((e.target as HTMLInputElement).value),
            })
          }
          onChange={(e) =>
            onChange({ ...value, [k]: Number(e.target.value) })
          }
        />
        <input
          type="number"
          className="w-[4.5rem] rounded border border-white/15 bg-black/50 px-1.5 py-1 text-right text-[11px] tabular-nums"
          value={fmt(raw)}
          step={step}
          min={min}
          max={max}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange({ ...value, [k]: clamp(n, min, max) })
          }}
        />
        <div className="flex gap-0.5">
          <button
            type="button"
            className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] hover:bg-white/20"
            onClick={() =>
              onChange({ ...value, [k]: clamp(raw - step, min, max) })
            }
          >
            −
          </button>
          <button
            type="button"
            className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] hover:bg-white/20"
            onClick={() =>
              onChange({ ...value, [k]: clamp(raw + step, min, max) })
            }
          >
            +
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-3">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-white/45">
        {label}
      </div>
      {axis('x', 'text-red-400')}
      {axis('y', 'text-emerald-400')}
      {axis('z', 'text-sky-400')}
    </div>
  )
}
