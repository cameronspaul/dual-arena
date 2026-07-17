import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { gameAudio } from '@/game/audio'
import type { HudSnapshot, HitEvent } from '@/game/types'
import { Settings, Target } from 'lucide-react'
import { ScopeOverlay } from './ScopeOverlay'
import {
  formatKeyCode,
  getUserSettings,
} from '@/game/core/userSettings'

interface GameHudProps {
  hud: HudSnapshot | null
  onOpenSettings?: () => void
}

/** Map cone half-angle (rad) → half-gap in px for the dynamic reticle. */
function spreadToGap(spreadRad: number): number {
  // Keep headroom past sprint so air/slide multipliers actually read on screen.
  // hip stand ~0.055 → ~48px, sprint ~0.14 → ~118px, air ~0.19 → ~155px, slide ~0.21 → ~174px
  return Math.min(190, 3 + spreadRad * 820)
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

/** Green when smooth, amber when soft, red when struggling. */
function fpsColor(fps: number): string {
  if (fps >= 55) return 'text-emerald-400'
  if (fps >= 30) return 'text-amber-300'
  return 'text-red-400'
}

/** Lower is better; muted when offline (no session RTT). */
function pingColor(ping: number | null): string {
  if (ping == null) return 'text-white/40'
  if (ping < 50) return 'text-emerald-400'
  if (ping < 100) return 'text-amber-300'
  return 'text-red-400'
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

export function GameHud({ hud, onOpenSettings }: GameHudProps) {
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
  const arm = Math.min(18, 8 + gap * 0.05)
  const thick = gap > 100 ? 2.5 : 2
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

        <div className="flex items-center gap-2">
          {/* Perf / net — top-right chrome next to settings */}
          <div
            className="rounded-lg border border-white/10 bg-black/55 px-3 py-2 font-mono text-xs backdrop-blur-sm"
            title={
              hud.ping == null
                ? 'Ping: offline (local range)'
                : `Ping: ${Math.round(hud.ping)} ms`
            }
          >
            <div className="flex items-baseline gap-3 tabular-nums">
              <span className={fpsColor(hud.fps)}>
                <span className="font-semibold">{hud.fps}</span>
                <span className="ml-1 text-white/40">FPS</span>
              </span>
              <span className="text-white/20">|</span>
              <span className={pingColor(hud.ping)}>
                <span className="font-semibold">
                  {hud.ping == null ? '—' : Math.round(hud.ping)}
                </span>
                <span className="ml-1 text-white/40">ms</span>
              </span>
            </div>
          </div>
          {onOpenSettings && (
            <button
              type="button"
              onClick={() => {
                gameAudio.uiClick()
                onOpenSettings()
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-sm text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
            >
              <Settings className="size-3.5" />
              Settings
            </button>
          )}
          <Link
            to="/"
            onClick={() => gameAudio.uiClick()}
            className="rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-sm text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
          >
            Exit
          </Link>
        </div>
      </div>

      {/* Hipfire crosshair — fades out as scope takes over (hidden in death cam) */}
      {!fullyScoped && !hud.spectating && (
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-100"
          style={{ opacity: Math.max(0, 1 - hud.adsBlend * 1.8) }}
        >
          <div
            className="relative"
            style={{
              width: gap * 2 + arm * 2 + 8,
              height: gap * 2 + arm * 2 + 8,
              transition: 'width 70ms linear, height 70ms linear',
            }}
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
                transition: 'top 70ms linear, height 70ms linear, width 70ms linear',
              }}
            />
            {/* Bottom arm */}
            <div
              className="absolute left-1/2 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
              style={{
                width: thick,
                height: arm,
                top: `calc(50% + ${gap}px)`,
                transition: 'top 70ms linear, height 70ms linear, width 70ms linear',
              }}
            />
            {/* Left arm */}
            <div
              className="absolute top-1/2 -translate-y-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
              style={{
                height: thick,
                width: arm,
                left: `calc(50% - ${gap}px - ${arm}px)`,
                transition: 'left 70ms linear, width 70ms linear, height 70ms linear',
              }}
            />
            {/* Right arm */}
            <div
              className="absolute top-1/2 -translate-y-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
              style={{
                height: thick,
                width: arm,
                left: `calc(50% + ${gap}px)`,
                transition: 'left 70ms linear, width 70ms linear, height 70ms linear',
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

      {/* Death free-cam spectate → round restart countdown */}
      {hud.spectating && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center">
          <div className="rounded-xl border border-red-500/40 bg-black/75 px-10 py-7 text-center shadow-[0_0_40px_rgba(255,40,40,0.2)] backdrop-blur-md">
            <div className="text-xs font-semibold tracking-[0.35em] text-red-400/90 uppercase">
              You died
            </div>
            <div className="mt-2 text-2xl font-bold tracking-wide text-white">
              {hud.deathReason === 'fall'
                ? 'Fell out of the world'
                : 'Eliminated'}
            </div>
            <div className="mt-4 font-mono text-sm text-white/70">
              Free cam · respawning in{' '}
              <span className="tabular-nums text-white">
                {Math.ceil(hud.respawnIn)}
              </span>
              s
            </div>
            <p className="mt-2 text-[11px] text-white/45">
              WASD + mouse · Space / crouch to fly · Sprint to boost
            </p>
          </div>
        </div>
      )}

      {/* Click to play */}
      {!hud.pointerLocked && !hud.spectating && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
          <div className="rounded-xl border border-white/15 bg-black/70 px-8 py-6 text-center backdrop-blur-md">
            <div className="text-lg font-semibold">Click to play</div>
            <ControlsHint />
          </div>
        </div>
      )}
    </div>
  )
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">
      {children}
    </kbd>
  )
}

/** Primary bind label (first code) for compact tips. */
function primary(codes: string[]): string {
  return formatKeyCode(codes[0] ?? '?')
}

/** Reflect live keybinds so rebound players see the right tips. */
function ControlsHint() {
  const k = getUserSettings().keybinds
  return (
    <div className="mt-3 space-y-1 text-sm text-white/60">
      <p className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1">
        <span className="inline-flex gap-0.5">
          <Kbd>{primary(k.forward)}</Kbd>
          <Kbd>{primary(k.left)}</Kbd>
          <Kbd>{primary(k.back)}</Kbd>
          <Kbd>{primary(k.right)}</Kbd>
        </span>
        <span>move ·</span>
        <Kbd>{primary(k.sprint)}</Kbd>
        <span>sprint ·</span>
        <Kbd>{primary(k.crouch)}</Kbd>
        {k.crouch.length > 1 && (
          <>
            <span>/</span>
            <Kbd>{formatKeyCode(k.crouch[1])}</Kbd>
          </>
        )}
        <span>crouch/slide</span>
      </p>
      <p className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1">
        <Kbd>{primary(k.jump)}</Kbd>
        <span>jump ·</span>
        <Kbd>{primary(k.fire)}</Kbd>
        <span>fire ·</span>
        <Kbd>{primary(k.ads)}</Kbd>
        <span>ADS ·</span>
        <Kbd>{primary(k.reload)}</Kbd>
        <span>reload</span>
      </p>
      <p className="text-white/40">
        Sprint + crouch to slide · jump out of slide to hop
      </p>
    </div>
  )
}
