/**
 * Classic sniper ADS — circular glass vignette + thin crosshairs + red center dot.
 * Matches a simple optic: continuous thin arms through center, small red aim point.
 * During scoped reload the glass stays up; reticle + hole jiggle for feedback.
 */

interface ScopeOverlayProps {
  /** 0 = fully hip, 1 = fully scoped */
  adsBlend: number
  /** ~-1..1 reload kick (visual only) */
  reloadJiggleX?: number
  reloadJiggleY?: number
}

/** Reticle box diameter — vignette clear hole = half of this. */
const RETICLE_VMIN = 42
const RETICLE_MAX_VW = 52
/** Half-size: where crosshair arms end / vignette darkening begins. */
const CLEAR_VMIN = RETICLE_VMIN / 2
const CLEAR_MAX_VW = RETICLE_MAX_VW / 2
/** Max pixel drift of reticle / clear hole while reloading in scope. */
const JIGGLE_PX = 26

export function ScopeOverlay({
  adsBlend,
  reloadJiggleX = 0,
  reloadJiggleY = 0,
}: ScopeOverlayProps) {
  if (adsBlend < 0.08) return null

  const t = Math.min(1, Math.max(0, (adsBlend - 0.08) / 0.72))
  const opacity = Math.min(1, t * 1.15)

  const jx = reloadJiggleX * JIGGLE_PX * t
  const jy = reloadJiggleY * JIGGLE_PX * t

  const reticleSize = `min(${RETICLE_VMIN}vmin, ${RETICLE_MAX_VW}vw)`
  // Clear circular glass, soft rim falloff into solid black outside.
  // Offset the vignette center with the reticle so the glass hole tracks jiggle.
  const cx = `calc(50% + ${jx.toFixed(2)}px)`
  const cy = `calc(50% + ${jy.toFixed(2)}px)`
  const r0 = `min(${CLEAR_VMIN}vmin, ${CLEAR_MAX_VW}vw)`
  const r1 = `min(${CLEAR_VMIN + 1.2}vmin, ${CLEAR_MAX_VW + 1.5}vw)`
  const r2 = `min(${CLEAR_VMIN + 3.5}vmin, ${CLEAR_MAX_VW + 4.2}vw)`
  const r3 = `min(${CLEAR_VMIN + 7}vmin, ${CLEAR_MAX_VW + 8.5}vw)`
  const r4 = `min(${CLEAR_VMIN + 12}vmin, ${CLEAR_MAX_VW + 14}vw)`

  const vignette = `radial-gradient(
    circle at ${cx} ${cy},
    transparent 0,
    transparent ${r0},
    rgba(0,0,0,${0.18 + t * 0.1}) ${r1},
    rgba(0,0,0,${0.55 + t * 0.12}) ${r2},
    rgba(0,0,0,${0.88 + t * 0.06}) ${r3},
    rgba(0,0,0,0.98) ${r4},
    rgba(0,0,0,1) 100%
  )`

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ opacity, pointerEvents: 'none' }}
      aria-hidden
    >
      <div className="absolute inset-0" style={{ background: vignette }} />

      <div
        className="absolute top-1/2 left-1/2"
        style={{
          width: reticleSize,
          height: reticleSize,
          transform: `translate(calc(-50% + ${jx.toFixed(2)}px), calc(-50% + ${jy.toFixed(2)}px))`,
        }}
      >
        <ScopeReticle />
      </div>
    </div>
  )
}

/**
 * Simple optic: thin continuous crosshairs spanning the glass diameter,
 * with a small red center aiming dot — no duplex posts or ranging hashes.
 */
function ScopeReticle() {
  const ink = 'rgba(8, 8, 10, 0.95)'
  const lineW = 0.38
  // Arms stop just short of the viewBox edge so tips sit inside the soft rim.
  const tip = 1.5
  // Red center dot (slightly larger than line width for readability).
  const dotR = 0.72

  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
    >
      <g fill="none" stroke={ink} strokeLinecap="butt" strokeWidth={lineW}>
        {/* Vertical crosshair */}
        <line x1="50" y1={tip} x2="50" y2={100 - tip} />
        {/* Horizontal crosshair */}
        <line x1={tip} y1="50" x2={100 - tip} y2="50" />
      </g>

      {/* Red center aiming point */}
      <circle cx="50" cy="50" r={dotR} fill="#e82828" />
      {/* Slight highlight so the dot reads on dark targets */}
      <circle cx="50" cy="50" r={dotR * 0.45} fill="#ff5a5a" opacity="0.85" />
    </svg>
  )
}
