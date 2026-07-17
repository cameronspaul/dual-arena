/**
 * Classic sniper ADS — soft vignette + duplex reticle.
 * Vignette clear radius matches the outer tips of the reticle lines.
 */

interface ScopeOverlayProps {
  /** 0 = fully hip, 1 = fully scoped */
  adsBlend: number
}

/** Reticle box diameter — vignette clear hole = half of this. */
const RETICLE_VMIN = 38
const RETICLE_MAX_VW = 48
/** Half-size: where crosshair arms end / vignette darkening begins. */
const CLEAR_VMIN = RETICLE_VMIN / 2
const CLEAR_MAX_VW = RETICLE_MAX_VW / 2

export function ScopeOverlay({ adsBlend }: ScopeOverlayProps) {
  if (adsBlend < 0.08) return null

  const t = Math.min(1, Math.max(0, (adsBlend - 0.08) / 0.72))
  const opacity = Math.min(1, t * 1.15)

  const reticleSize = `min(${RETICLE_VMIN}vmin, ${RETICLE_MAX_VW}vw)`
  // Clear out to the arm tips, then a long smooth falloff to full black.
  const r0 = `min(${CLEAR_VMIN}vmin, ${CLEAR_MAX_VW}vw)`
  const r1 = `min(${CLEAR_VMIN + 4}vmin, ${CLEAR_MAX_VW + 5}vw)`
  const r2 = `min(${CLEAR_VMIN + 10}vmin, ${CLEAR_MAX_VW + 12}vw)`
  const r3 = `min(${CLEAR_VMIN + 18}vmin, ${CLEAR_MAX_VW + 22}vw)`
  const r4 = `min(${CLEAR_VMIN + 28}vmin, ${CLEAR_MAX_VW + 34}vw)`
  const r5 = `min(${CLEAR_VMIN + 40}vmin, ${CLEAR_MAX_VW + 48}vw)`

  const vignette = `radial-gradient(
    circle at center,
    transparent 0,
    transparent ${r0},
    rgba(0,0,0,${0.12 + t * 0.08}) ${r1},
    rgba(0,0,0,${0.32 + t * 0.12}) ${r2},
    rgba(0,0,0,${0.55 + t * 0.12}) ${r3},
    rgba(0,0,0,${0.78 + t * 0.1}) ${r4},
    rgba(0,0,0,${0.92 + t * 0.05}) ${r5},
    rgba(0,0,0,0.97) 100%
  )`

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ opacity, pointerEvents: 'none' }}
      aria-hidden
    >
      <div className="absolute inset-0" style={{ background: vignette }} />

      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: reticleSize, height: reticleSize }}
      >
        <ScopeReticle />
      </div>
    </div>
  )
}

/**
 * Duplex-style optic: thick outer posts + thin lines that connect through
 * the center, with hash marks along each axis.
 * Arms extend to the viewBox edge so tips sit on the vignette start.
 */
function ScopeReticle() {
  const ink = 'rgba(10, 10, 12, 0.92)'
  const halo = 'rgba(255, 255, 255, 0.26)'

  // Tips at viewBox edge (0 / 100) → align with vignette clear radius.
  const tip = 0
  const thinOuter = 50
  // Thick posts on the outer third.
  const postInner = 28
  const hashes = [5, 9, 13, 17, 21]
  const thinW = 0.42
  const thickW = 1.15
  const majorHalf = 2.1
  const minorHalf = 1.25

  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <filter id="scope-halo" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow
            dx="0"
            dy="0"
            stdDeviation="0.32"
            floodColor={halo}
            floodOpacity="1"
          />
        </filter>
      </defs>

      <g
        filter="url(#scope-halo)"
        fill="none"
        stroke={ink}
        strokeLinecap="butt"
      >
        {/* Thick outer posts */}
        <line
          x1="50"
          y1={tip}
          x2="50"
          y2={50 - postInner}
          strokeWidth={thickW}
        />
        <line
          x1="50"
          y1={50 + postInner}
          x2="50"
          y2={100 - tip}
          strokeWidth={thickW}
        />
        <line
          x1={tip}
          y1="50"
          x2={50 - postInner}
          y2="50"
          strokeWidth={thickW}
        />
        <line
          x1={50 + postInner}
          y1="50"
          x2={100 - tip}
          y2="50"
          strokeWidth={thickW}
        />

        {/* Thin cross — full span, connects through center */}
        <line
          x1="50"
          y1={50 - thinOuter}
          x2="50"
          y2={50 + thinOuter}
          strokeWidth={thinW}
        />
        <line
          x1={50 - thinOuter}
          y1="50"
          x2={50 + thinOuter}
          y2="50"
          strokeWidth={thinW}
        />

        {/* Ranging hash marks */}
        {hashes.map((d, i) => {
          const isMajor = i % 2 === 1
          const h = isMajor ? majorHalf : minorHalf
          return (
            <g key={d} strokeWidth={thinW}>
              <line x1={50 + d} y1={50 - h} x2={50 + d} y2={50 + h} />
              <line x1={50 - d} y1={50 - h} x2={50 - d} y2={50 + h} />
              <line x1={50 - h} y1={50 + d} x2={50 + h} y2={50 + d} />
              <line x1={50 - h} y1={50 - d} x2={50 + h} y2={50 - d} />
            </g>
          )
        })}
      </g>
    </svg>
  )
}
