/**
 * Classic sniper ADS — circular glass vignette + thin crosshairs + red center dot.
 * Reticle lives in a square matched to the clear glass diameter so arms end at
 * the circle edge (never past the rim). Outer half of each arm is slightly
 * thicker. During scoped reload the glass stays up; reticle + hole jiggle.
 */

interface ScopeOverlayProps {
  /** 0 = fully hip, 1 = fully scoped */
  adsBlend: number
  /** ~-1..1 reload kick (visual only) */
  reloadJiggleX?: number
  reloadJiggleY?: number
}

/**
 * Hard clear-glass circle, centered on screen.
 * Radius = 50vh so the top tip sits on the top of the viewport (diameter =
 * screen height). Outside the rim is solid black; soft vignette fades inward
 * from the rim into the glass. DEBUG_CIRCLE_OUTLINE = red stroke for tuning.
 */
const CLEAR_RADIUS_VH = 50
const GLASS_DIAMETER_VH = CLEAR_RADIUS_VH * 2
/** Reticle box = glass diameter so crosshair tips sit on the hard rim. */
const RETICLE_SIZE_VH = GLASS_DIAMETER_VH
/** Max pixel drift of reticle / clear hole while reloading in scope. */
const JIGGLE_PX = 26
/** Red outline of the hard clear rim — debug only. */
const DEBUG_CIRCLE_OUTLINE = false

/** Shared reticle line color — same opacity on thin + thick segments. */
const RETICLE_COLOR = 'rgba(8, 8, 10, 0.45)'

/**
 * Scope glass comes up very late in the ADS blend so aim spread is
 * essentially full ADS accuracy before the overlay reads as "scoped".
 */
const SCOPE_APPEAR_AT = 0.82
const SCOPE_FADE_SPAN = 0.16

export function ScopeOverlay({
  adsBlend,
  reloadJiggleX = 0,
  reloadJiggleY = 0,
}: ScopeOverlayProps) {
  if (adsBlend < SCOPE_APPEAR_AT) return null

  const t = Math.min(1, Math.max(0, (adsBlend - SCOPE_APPEAR_AT) / SCOPE_FADE_SPAN))
  const opacity = Math.min(1, t * 1.15)

  const jx = reloadJiggleX * JIGGLE_PX * t
  const jy = reloadJiggleY * JIGGLE_PX * t

  const reticleSize = `${RETICLE_SIZE_VH}vh`
  const glassSize = `${GLASS_DIAMETER_VH}vh`

  // Hard circle at radius 50vh (top tip = top of screen).
  // Soft vignette eases INWARD from the rim; everything outside is solid black.
  // Offset with jiggle so the glass hole tracks the reticle.
  const cx = `calc(50% + ${jx.toFixed(2)}px)`
  const cy = `calc(50% + ${jy.toFixed(2)}px)`

  // Continuous blur via box-shadow (no multi-stop gradient banding).
  // Outer spread: solid black everywhere outside the circle.
  // Inset blurs: smooth feather into the glass from the rim.
  const feather = 10 + t * 2 // vh — soft inward falloff width
  const vignetteShadow = [
    `0 0 0 200vmax #000`,
    `inset 0 0 ${feather * 0.35}vh rgba(0,0,0,0.55)`,
    `inset 0 0 ${feather * 0.65}vh rgba(0,0,0,0.7)`,
    `inset 0 0 ${feather}vh rgba(0,0,0,0.92)`,
    `inset 0 0 ${feather * 1.35}vh rgba(0,0,0,1)`,
  ].join(', ')

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ opacity, pointerEvents: 'none' }}
      aria-hidden
    >
      {/* Transparent circle hole: black outside + soft inset feather (no banding). */}
      <div
        className="absolute rounded-full"
        style={{
          width: glassSize,
          height: glassSize,
          left: cx,
          top: cy,
          transform: 'translate(-50%, -50%)',
          boxShadow: vignetteShadow,
          background: 'transparent',
        }}
      />

      {/* Debug: hard clear-rim outline (radius = CLEAR_RADIUS_VH). */}
      {DEBUG_CIRCLE_OUTLINE && (
        <div
          className="absolute rounded-full"
          style={{
            width: glassSize,
            height: glassSize,
            left: cx,
            top: cy,
            transform: 'translate(-50%, -50%)',
            boxSizing: 'border-box',
            border: '2px solid #ff2020',
            background: 'transparent',
          }}
        />
      )}

      {/* Square matched to glass diameter — arm tips meet the circle edge. */}
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
 * Crosshairs filling the glass square: tips sit on the hard circle rim.
 * Thin arms through center; thicker outer posts. Uniform opacity.
 * Red center aiming dot on top.
 */
function ScopeReticle() {
  // Skinny through center; thicker posts on the outer half toward the rim.
  const thin = 2
  const thick = 4

  // Thin half-arm = 38% of glass diameter from center (~76% of way to rim).
  // Outer thick posts fill the remaining span out to the rim (0% / 100%).
  const thinHalfOfGlass = 0.38
  const midPct = (0.5 - thinHalfOfGlass) * 100
  const mid = `${midPct}%`
  const midFar = `${100 - midPct}%`
  const innerPct = `${100 - 2 * midPct}%`

  // Shared centering: transform translate keeps lines + dot on the same
  // subpixel center (margin half-sizes + odd px sizes drift otherwise).
  const centerY = {
    top: '50%',
    transform: 'translateY(-50%)',
  } as const
  const centerX = {
    left: '50%',
    transform: 'translateX(-50%)',
  } as const

  return (
    <div className="absolute inset-0">
      {/* ── Horizontal axis ── */}
      {/* Outer left → rim (thicker) */}
      <div
        className="absolute"
        style={{
          left: 0,
          width: mid,
          height: thick,
          background: RETICLE_COLOR,
          ...centerY,
        }}
      />
      {/* Outer right → rim (thicker) */}
      <div
        className="absolute"
        style={{
          left: midFar,
          right: 0,
          height: thick,
          background: RETICLE_COLOR,
          ...centerY,
        }}
      />
      {/* Inner horizontal (thin) */}
      <div
        className="absolute"
        style={{
          left: mid,
          width: innerPct,
          height: thin,
          background: RETICLE_COLOR,
          ...centerY,
        }}
      />

      {/* ── Vertical axis ── */}
      {/* Outer top → rim (thicker) */}
      <div
        className="absolute"
        style={{
          top: 0,
          height: mid,
          width: thick,
          background: RETICLE_COLOR,
          ...centerX,
        }}
      />
      {/* Outer bottom → rim (thicker) */}
      <div
        className="absolute"
        style={{
          top: midFar,
          bottom: 0,
          width: thick,
          background: RETICLE_COLOR,
          ...centerX,
        }}
      />
      {/* Inner vertical (thin) */}
      <div
        className="absolute"
        style={{
          top: mid,
          height: innerPct,
          width: thin,
          background: RETICLE_COLOR,
          ...centerX,
        }}
      />

      {/* Red center aiming point — even px + transform so it sits on the cross */}
      <div
        className="absolute rounded-full"
        style={{
          left: '50%',
          top: '50%',
          width: 6,
          height: 6,
          transform: 'translate(-50%, -50%)',
          background:
            'radial-gradient(circle at 50% 50%, #ff5a5a 0%, #e82828 55%, #c41818 100%)',
          boxShadow: '0 0 0 0.5px rgba(0,0,0,0.25)',
        }}
      />
    </div>
  )
}
