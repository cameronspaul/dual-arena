import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import type { HudSnapshot, HitEvent } from '@/game/types'
import { Target } from 'lucide-react'
import { ScopeOverlay } from './ScopeOverlay'

interface GameHudProps {
  hud: HudSnapshot | null
}

/** Map cone half-angle (rad) → half-gap in px for the dynamic reticle. */
function spreadToGap(spreadRad: number): number {
  // ~3.2° (0.055) hip → ~52px gap; ADS laser → ~4px rest gap
  return Math.min(90, 4 + spreadRad * 880)
}

function hitmarkerColor(hit: HitEvent): string {
  if (hit.killed) return '#ff3b3b'
  if (hit.zone === 'head') return '#ffe566'
  return '#ffffff'
}

function damageLabelColor(hit: HitEvent): string {
  if (hit.killed) return 'text-red-400'
  if (hit.zone === 'head') return 'text-yellow-300'
  if (hit.zone === 'chest') return 'text-sky-300'
  if (hit.zone === 'arm') return 'text-orange-400'
  return 'text-amber-200'
}

/** Classic FPS / Overwatch-style X hitmarker (four diagonal ticks). */
function HitMarkerX({
  color,
  kill,
  head,
}: {
  color: string
  kill: boolean
  head: boolean
}) {
  // Arm geometry: length / thickness / gap from center
  const len = kill ? 14 : head ? 12 : 10
  const thick = kill ? 3 : 2.5
  const gap = kill ? 5 : 4
  const armStyle = (rot: number): CSSProperties => ({
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: thick,
    height: len,
    marginLeft: -thick / 2,
    marginTop: -len / 2,
    background: color,
    borderRadius: 1,
    boxShadow: `0 0 ${kill ? 10 : 6}px ${color}`,
    transform: `rotate(${rot}deg) translateY(-${gap + len / 2}px)`,
    transformOrigin: 'center center',
  })

  return (
    <div className="relative h-12 w-12">
      <div style={armStyle(45)} />
      <div style={armStyle(-45)} />
      <div style={armStyle(135)} />
      <div style={armStyle(-135)} />
    </div>
  )
}

export function GameHud({ hud }: GameHudProps) {
  if (!hud) return null

  const phaseLabel =
    hud.phase === 'bolt'
      ? 'BOLT'
      : hud.phase === 'reloading'
        ? 'RELOAD'
        : hud.phase === 'firing'
          ? 'FIRE'
          : 'READY'

  const showHit = Boolean(hud.lastHit && hud.lastHitAge < 0.605)
  const fullyScoped = hud.adsBlend > 0.55
  const gap = spreadToGap(hud.aimSpread)
  // Arms lengthen slightly as the cone opens so the reticle still reads.
  const arm = Math.min(14, 8 + gap * 0.06)
  const thick = 2
  // Dim chrome HUD while in the glass so the scope owns the frame.
  const chromeOpacity = fullyScoped ? 0.35 : 1
  const hit = hud.lastHit

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none text-white">
      {/* Sniper scope (blackout + housing + reticle) — jiggles during scoped reload */}
      <ScopeOverlay
        adsBlend={hud.adsBlend}
        reloadJiggleX={hud.reloadJiggleX}
        reloadJiggleY={hud.reloadJiggleY}
      />

      {/* Top bar */}
      <div
        className="pointer-events-auto absolute top-3 left-3 right-3 flex items-start justify-between gap-3 transition-opacity duration-150"
        style={{ opacity: chromeOpacity }}
      >
        <div className="rounded-lg border border-white/10 bg-black/55 px-3 py-2 backdrop-blur-sm">
          <div className="text-xs font-medium tracking-widest text-white/50 uppercase">
            Dual Arena — Range
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5 text-orange-400" />
              <span className="font-semibold tabular-nums">{hud.kills}</span>
              <span className="text-white/50">kills</span>
            </span>
            <span className="text-white/30">|</span>
            <span className="font-mono text-xs text-white/60 uppercase">
              {hud.moveState}
            </span>
            <span className="font-mono text-xs text-white/40 tabular-nums">
              {hud.speed.toFixed(1)} m/s
            </span>
          </div>
        </div>

        <Link
          to="/"
          className="rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-sm text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
        >
          Exit
        </Link>
      </div>

      {/* Hipfire crosshair — fades out as scope takes over */}
      {!fullyScoped && (
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-100"
          style={{ opacity: Math.max(0, 1 - hud.adsBlend * 1.8) }}
        >
          <div
            className="relative"
            style={{ width: gap * 2 + arm * 2 + 8, height: gap * 2 + arm * 2 + 8 }}
          >
            {/* Center micro-dot */}
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
              style={{ width: 2, height: 2 }}
            />
            {/* Top arm */}
            <div
              className="absolute left-1/2 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
              style={{
                width: thick,
                height: arm,
                top: `calc(50% - ${gap}px - ${arm}px)`,
                transition: 'top 60ms linear, height 60ms linear',
              }}
            />
            {/* Bottom arm */}
            <div
              className="absolute left-1/2 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
              style={{
                width: thick,
                height: arm,
                top: `calc(50% + ${gap}px)`,
                transition: 'top 60ms linear, height 60ms linear',
              }}
            />
            {/* Left arm */}
            <div
              className="absolute top-1/2 -translate-y-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
              style={{
                height: thick,
                width: arm,
                left: `calc(50% - ${gap}px - ${arm}px)`,
                transition: 'left 60ms linear, width 60ms linear',
              }}
            />
            {/* Right arm */}
            <div
              className="absolute top-1/2 -translate-y-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
              style={{
                height: thick,
                width: arm,
                left: `calc(50% + ${gap}px)`,
                transition: 'left 60ms linear, width 60ms linear',
              }}
            />
          </div>
        </div>
      )}

      {/* Overwatch-style center hitmarker + floating damage */}
      <AnimatePresence>
        {showHit && hit && (
          <motion.div
            key={hud.lastHitId}
            className="absolute top-1/2 left-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
            initial={{ opacity: 0, scale: 1.55 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [1.55, 0.92, 1, 1] }}
            exit={{ opacity: 0, scale: 1.15 }}
            transition={{ duration: 0.46, times: [0, 0.08, 0.55, 1], ease: 'easeOut' }}
          >
            <HitMarkerX
              color={hitmarkerColor(hit)}
              kill={hit.killed}
              head={hit.zone === 'head'}
            />

            {/* Damage / zone float */}
            <motion.div
              className={`mt-3 text-center font-bold tracking-wide drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)] ${damageLabelColor(hit)} ${
                hit.zone === 'head' || hit.killed ? 'text-base' : 'text-sm'
              }`}
              initial={{ y: 0, opacity: 1 }}
              animate={{ y: -18, opacity: 0 }}
              transition={{ duration: 0.53, ease: 'easeOut', delay: 0.05 }}
            >
              {hit.zone === 'head' ? 'HEADSHOT' : hit.zone.toUpperCase()}{' '}
              <span className="tabular-nums">-{hit.damage}</span>
            </motion.div>

            {hit.killed && (
              <motion.div
                className="mt-0.5 text-xs font-extrabold tracking-[0.2em] text-red-400 drop-shadow-[0_0_8px_rgba(255,50,50,0.65)]"
                initial={{ opacity: 0, scale: 0.7, y: 4 }}
                animate={{ opacity: [0, 1, 1, 0], scale: [0.7, 1.08, 1, 1], y: [4, -2, -6, -10] }}
                transition={{ duration: 0.605, times: [0, 0.15, 0.7, 1] }}
              >
                ELIMINATED
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom HUD */}
      <div
        className="absolute bottom-4 left-4 right-4 flex items-end justify-between transition-opacity duration-150"
        style={{ opacity: chromeOpacity }}
      >
        <div className="rounded-lg border border-white/10 bg-black/55 px-4 py-3 backdrop-blur-sm">
          <div className="text-[10px] tracking-widest text-white/40 uppercase">
            Health
          </div>
          <div className="mt-1 h-2 w-36 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${hud.hp}%` }}
            />
          </div>
          <div className="mt-1 font-mono text-sm tabular-nums">{hud.hp}</div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/55 px-5 py-3 text-right backdrop-blur-sm">
          <div className="text-[10px] tracking-widest text-white/40 uppercase">
            {phaseLabel}
          </div>
          <div className="font-mono text-3xl font-semibold leading-none tabular-nums">
            {hud.ammo}
            <span className="text-lg text-white/40">/{hud.magSize}</span>
          </div>
          <div className="mt-1 font-mono text-xs text-white/50 tabular-nums">
            RES {hud.reserve}
          </div>
        </div>
      </div>

      {/* Click to play */}
      {!hud.pointerLocked && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
          <div className="rounded-xl border border-white/15 bg-black/70 px-8 py-6 text-center backdrop-blur-md">
            <div className="text-lg font-semibold">Click to play</div>
            <div className="mt-3 space-y-1 text-sm text-white/60">
              <p>
                <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">
                  WASD
                </kbd>{' '}
                move ·{' '}
                <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">
                  Shift
                </kbd>{' '}
                sprint ·{' '}
                <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">
                  Ctrl
                </kbd>{' '}
                crouch/slide
              </p>
              <p>
                <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">
                  Space
                </kbd>{' '}
                jump ·{' '}
                <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">
                  LMB
                </kbd>{' '}
                fire ·{' '}
                <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">
                  RMB
                </kbd>{' '}
                ADS ·{' '}
                <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">
                  R
                </kbd>{' '}
                reload
              </p>
              <p className="text-white/40">
                Sprint + crouch to slide · jump out of slide to hop
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
