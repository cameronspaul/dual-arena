import type { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { gameAudio } from '@/game/audio'
import type { HudSnapshot, HitEvent, PerfHud } from '@/game/types'
import { Map as MapIcon, Settings, Zap } from 'lucide-react'
import { ScopeOverlay } from './ScopeOverlay'
import {
  formatKeyCode,
  getUserSettings,
} from '@/game/core/userSettings'
import { fmtNum } from '@/game/maps'
import { icons } from '@/lib/icons'
import { cn } from '@/lib/utils'

interface GameHudProps {
  hud: HudSnapshot | null
  onOpenSettings?: () => void
  /** Return to map select (main page). */
  onExit?: () => void
  /** Pregame ready toggle (online). */
  onReady?: (ready: boolean) => void
}

/** Map cone half-angle (rad) → half-gap in px for the dynamic reticle. */
function spreadToGap(spreadRad: number): number {
  return Math.min(190, 3 + spreadRad * 820)
}

/** White hit feedback; red only on headshot. */
function hitmarkerColor(hit: HitEvent): string {
  if (hit.zone === 'head') return '#f83839'
  return '#f4f7fa'
}

/** Zone label for the hit-confirm float. */
function hitZoneLabel(hit: HitEvent): string {
  if (hit.zone === 'head') return 'HEADSHOT'
  return hit.zone.toUpperCase()
}

/**
 * Combat hit confirm — bare damage + zone text punches out from the reticle.
 * White by default, red on headshot. No panel chrome / elim stamp.
 * Lifecycle is CSS-class only (remount via key) so HUD ticks don't pulse it.
 */
function HitConfirm({ hit }: { hit: HitEvent }) {
  const head = hit.zone === 'head'
  const color = head ? 'text-[#f83839]' : 'text-white'

  return (
    <div
      className={cn(
        'hit-confirm-chip pointer-events-none absolute top-0 left-0 flex items-baseline gap-2',
        head && 'hit-confirm-chip-hard',
      )}
      aria-live="polite"
    >
      <span
        className={cn(
          'font-mono font-bold tabular-nums leading-none tracking-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]',
          color,
          head ? 'text-xl' : 'text-lg',
        )}
      >
        −{hit.damage}
      </span>
      <span
        className={cn(
          'text-[9px] font-semibold tracking-[0.18em] uppercase opacity-90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]',
          color,
        )}
      >
        {hitZoneLabel(hit)}
      </span>
    </div>
  )
}

function fpsColor(fps: number): string {
  if (fps >= 140) return 'text-arena-ok'
  if (fps >= 90) return 'text-lime-300'
  if (fps >= 55) return 'text-arena-heat'
  if (fps >= 30) return 'text-orange-400'
  return 'text-arena-danger'
}

function msColor(ms: number, budget: number): string {
  if (ms <= budget * 0.55) return 'text-arena-ok'
  if (ms <= budget * 0.85) return 'text-arena-heat'
  return 'text-arena-danger'
}

function pingColor(ping: number | null): string {
  if (ping == null) return 'text-white/35'
  if (ping < 50) return 'text-arena-ok'
  if (ping < 100) return 'text-arena-heat'
  return 'text-arena-danger'
}

function hpBarColor(hp: number): string {
  if (hp > 60) return 'bg-arena-ok shadow-[0_0_12px_var(--arena-ok)]'
  if (hp > 30) return 'bg-arena-heat shadow-[0_0_12px_var(--arena-heat)]'
  return 'bg-arena-danger shadow-[0_0_12px_var(--arena-danger)]'
}

function formatMatchClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

function matchEndTitle(reason: HudSnapshot['matchEndReason']): string {
  if (reason === 'forfeit' || reason === 'disconnect') return 'Forfeit'
  if (reason === 'time') return 'Time'
  return 'Match over'
}

function matchPhaseLabel(phase: NonNullable<HudSnapshot['matchPhase']>): string {
  switch (phase) {
    case 'waiting':
      return 'waiting'
    case 'pregame':
      return 'pregame'
    case 'countdown':
      return 'countdown'
    case 'live':
      return 'live'
    case 'round_reset':
      return 'reset'
    case 'ended':
      return 'ended'
    default:
      return phase
  }
}

/** Shared tactical glass panel used across HUD chrome. */
function HudPanel({
  children,
  className,
  accent = 'heat',
}: {
  children: ReactNode
  className?: string
  accent?: 'heat' | 'tech' | 'danger' | 'none'
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md border border-arena-panel-border bg-arena-panel shadow-lg backdrop-blur-md',
        className,
      )}
    >
      {accent !== 'none' && (
        <div
          className={cn(
            'absolute inset-y-0 left-0 w-0.5',
            accent === 'heat' && 'bg-arena-heat',
            accent === 'tech' && 'bg-arena-tech',
            accent === 'danger' && 'bg-arena-danger',
          )}
        />
      )}
      {/* Corner ticks */}
      <div className="pointer-events-none absolute top-0 left-0 h-2 w-2 border-t border-l border-white/25" />
      <div className="pointer-events-none absolute top-0 right-0 h-2 w-2 border-t border-r border-white/25" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-2 w-2 border-b border-l border-white/25" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-2 w-2 border-b border-r border-white/25" />
      {children}
    </div>
  )
}

function HudLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[9px] font-semibold tracking-[0.22em] text-white/40 uppercase">
      {children}
    </div>
  )
}

function PerfPanel({ perf, fps }: { perf: PerfHud; fps: number }) {
  const map = perf.map
  const budget = 1000 / 180
  return (
    <div className="mt-2 max-w-[22rem] space-y-1 border-t border-white/10 pt-2 text-[10px] leading-snug text-white/65">
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 tabular-nums">
        <span className={msColor(perf.frameMs, budget)}>
          {perf.frameMs.toFixed(1)}
          <span className="text-white/30"> ms</span>
        </span>
        <span className={msColor(perf.simMs, budget * 0.4)}>
          sim {perf.simMs.toFixed(1)}
        </span>
        <span className={msColor(perf.renderMs, budget * 0.6)}>
          ren {perf.renderMs.toFixed(1)}
        </span>
        <span className="text-white/40">dpr {perf.pixelRatio.toFixed(2)}</span>
      </div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 tabular-nums text-white/50">
        <span>
          draws <span className="text-white/85">{perf.draws}</span>
        </span>
        <span>
          tris <span className="text-white/85">{fmtNum(perf.triangles)}</span>
        </span>
        <span>
          col{' '}
          <span className="text-white/85">
            {perf.nearbyCollision}/{perf.collisionMeshes}
          </span>
        </span>
      </div>
      {map && (
        <div className="tabular-nums text-white/40">
          map <span className="text-white/70">{map.id}</span>
          {' · '}
          {fmtNum(map.triangles)} tris · {map.meshes} mesh ·{' '}
          {map.shadowCasters} sh ·{' '}
          {map.dedicatedCollision ? 'COL✓' : 'COL✗'}
        </div>
      )}
      <div className="text-white/45">
        <span className="text-white/30">limit </span>
        <span className={fps >= 140 ? 'text-arena-ok/90' : 'text-arena-heat/90'}>
          {perf.bottleneck}
        </span>
      </div>
      {map && map.notes[0] && (
        <div className="text-white/35" title={map.notes.join('\n')}>
          {map.notes[0]}
          {map.notes.length > 1 ? ` (+${map.notes.length - 1})` : ''}
        </div>
      )}
    </div>
  )
}

/**
 * FPS X hitmarker — artwork from public/icons/hitmarker.svg
 * (four corner diamonds). Each corner shoots in toward center.
 * Pivot is 0×0 at screen center (shared with crosshair).
 */
/** Visible lifetime of a hitmarker (must match showHit age gate + hudKey). */
export const HITMARKER_DURATION = 1.05

/** Native art size of hitmarker.svg */
const HITMARKER_SIZE = 25

/**
 * Corner paths from hitmarker.svg (coords before the art offset transform).
 * Order: top-left, bottom-left, top-right, bottom-right.
 * Shoot-in directions point outward along each corner’s diagonal.
 */
const HITMARKER_CORNERS: readonly {
  d: string
  /** Unit direction away from center for shoot-in start */
  ox: number
  oy: number
}[] = [
  {
    // top-left
    d: 'M23.22,28.983C23.356,29.101 23.504,29.206 23.641,29.324C26.237,31.572 23.57,34.241 21.322,31.642C20.503,30.695 19.678,28.574 19.691,28.517C19.722,28.377 19.972,27.263 21.379,27.892C21.535,27.962 21.515,27.973 23.22,28.983Z',
    ox: -1,
    oy: -1,
  },
  {
    // bottom-left
    d: 'M20.983,48.781C21.66,48 21.496,47.782 22.483,47.449C24.568,46.745 25.3,48.753 24.144,50.217C23.344,51.23 21.624,51.999 21.379,52.108C19.972,52.737 19.723,51.623 19.692,51.483C19.644,51.272 20.869,48.992 20.983,48.781Z',
    ox: -1,
    oy: 1,
  },
  {
    // top-right
    d: 'M43.016,31.219C42.34,32 42.505,32.219 41.517,32.552C39.216,33.326 37.578,30.266 42.43,28.096C45.247,26.836 44.178,29.224 44.109,29.378C44.039,29.535 44.028,29.515 43.016,31.219Z',
    ox: 1,
    oy: -1,
  },
  {
    // bottom-right
    d: 'M40.781,51.017C39.995,50.334 39.778,50.494 39.449,49.516C38.749,47.434 40.756,46.702 42.219,47.854C43.228,48.649 43.999,50.377 44.109,50.621C44.736,52.027 43.623,52.276 43.483,52.308C43.246,52.361 41.68,51.518 41.529,51.437C41.278,51.302 41.033,51.152 40.781,51.017Z',
    ox: 1,
    oy: 1,
  },
]

function HitMarkerX({
  color,
  kill,
  head,
}: {
  color: string
  kill: boolean
  head: boolean
}) {
  // Display size (art is 25×25). Slightly larger on head/kill for readability only.
  const size = kill ? 28 : head ? 26 : 24
  // How far each corner starts outside its rest pose (px in SVG space)
  const shootPx = 16
  // Fade in while still offset, then punch into rest (numeric animate values so
  // HUD re-renders do not restart keyframe arrays as a pulse).
  const fadeDur = 0.07
  const shootDur = 0.09
  const stagger = 0.01
  /** Fade first, then accelerate into place */
  const fadeEase = [0.2, 0.8, 0.3, 1] as const
  const shootEase = [0.55, 0.02, 0.35, 1] as const
  // White body / red head only (hitmarkerColor)
  const fill = color

  return (
    // Center the 25×25 art on the shared reticle pivot
    <div
      className="absolute top-0 left-0"
      style={{
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
      }}
      aria-hidden
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${HITMARKER_SIZE} ${HITMARKER_SIZE}`}
        className="block overflow-visible"
        style={{
          fillRule: 'evenodd',
          clipRule: 'evenodd',
          strokeLinejoin: 'round',
          strokeMiterlimit: 2,
        }}
      >
        <g transform="translate(-19.690239,-27.701106)">
          {HITMARKER_CORNERS.map((c, i) => {
            const delay = i * stagger
            return (
              <motion.path
                key={i}
                d={c.d}
                fill={fill}
                initial={{
                  x: c.ox * shootPx,
                  y: c.oy * shootPx,
                  opacity: 0,
                }}
                animate={{ x: 0, y: 0, opacity: 1 }}
                transition={{
                  opacity: {
                    duration: fadeDur,
                    ease: fadeEase,
                    delay,
                  },
                  x: {
                    duration: shootDur,
                    ease: shootEase,
                    // Start travel once fade is mostly done so corners
                    // appear out wide, then speed into rest.
                    delay: delay + fadeDur * 0.55,
                  },
                  y: {
                    duration: shootDur,
                    ease: shootEase,
                    delay: delay + fadeDur * 0.55,
                  },
                }}
              />
            )
          })}
        </g>
      </svg>
    </div>
  )
}

function ChromeBtn({
  children,
  onClick,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-arena-panel-border bg-arena-panel px-3 py-2 text-xs font-medium tracking-wide text-white/75 shadow-md backdrop-blur-md transition-all hover:border-arena-heat/40 hover:bg-white/10 hover:text-white"
      title={title}
    >
      {children}
    </button>
  )
}

export function GameHud({
  hud,
  onOpenSettings,
  onExit,
  onReady,
}: GameHudProps) {
  if (!hud) return null

  const phaseLabel =
    hud.phase === 'bolt'
      ? 'BOLT'
      : hud.phase === 'reloading'
        ? 'RELOAD'
        : hud.phase === 'firing'
          ? 'FIRE'
          : 'READY'

  const phaseHot =
    hud.phase === 'reloading' || hud.phase === 'bolt' || hud.phase === 'firing'
  const showHit = Boolean(hud.lastHit && hud.lastHitAge < HITMARKER_DURATION)
  const fullyScoped = hud.adsBlend > 0.55
  const gap = spreadToGap(hud.aimSpread)
  const arm = Math.min(18, 8 + gap * 0.05)
  const thick = gap > 100 ? 2.5 : 2
  const chromeOpacity = fullyScoped ? 0.32 : 1
  const hit = hud.lastHit
  /**
   * Reticle displacement only (offset + rotate, then ease home — no shake):
   * 1) Confirmed hit (farther on head/kill)
   * 2) Fire even on misses
   * 3) Held offset while bolting
   */
  const reticleDisplaceClass = showHit && hit
    ? hit.killed || hit.zone === 'head'
      ? 'reticle-displace-hard'
      : 'reticle-displace'
    : hud.phase === 'firing'
      ? 'reticle-displace-fire'
      : hud.phase === 'bolt'
        ? 'reticle-displace-bolt'
        : undefined
  /** Remount key so displacement restarts on hit / shot / bolt, not every frame. */
  const reticleKey = showHit
    ? `hit-${hud.lastHitId}`
    : hud.phase === 'firing'
      ? `fire-${hud.ammo}`
      : hud.phase === 'bolt'
        ? `bolt-${hud.ammo}`
        : 'reticle-idle'
  const lowAmmo = hud.ammo <= 1
  const emptyMag = hud.ammo === 0
  const online = hud.matchPhase != null
  const inPregame = hud.matchPhase === 'pregame'
  const inCountdown = hud.matchPhase === 'countdown'
  const inRoundReset = hud.matchPhase === 'round_reset'
  const countdownN = Math.max(0, Math.ceil(hud.matchPhaseTimer))
  const firstTo = hud.matchFirstTo || 7

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none text-white">
      <ScopeOverlay
        adsBlend={hud.adsBlend}
        reloadJiggleX={hud.reloadJiggleX}
        reloadJiggleY={hud.reloadJiggleY}
      />

      {/* Waiting for opponent */}
      <AnimatePresence>
        {hud.matchWaiting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-black/45"
          >
            <HudPanel className="px-8 py-6 text-center" accent="tech">
              <div className="text-xs tracking-[0.2em] text-arena-tech uppercase">
                Online 1v1
              </div>
              <div className="mt-2 text-lg font-semibold">
                Waiting for opponent…
              </div>
              <div className="mt-1 text-xs text-white/45">
                Share the same match id — first to {firstTo} wins.
              </div>
            </HudPanel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pregame: free fire until both ready */}
      <AnimatePresence>
        {inPregame && !hud.matchWaiting && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="pointer-events-none absolute bottom-24 left-1/2 z-40 w-[min(28rem,92vw)] -translate-x-1/2"
          >
            <HudPanel className="px-6 py-4 text-center" accent="tech">
              <div className="text-[10px] font-semibold tracking-[0.28em] text-arena-tech uppercase">
                Pre-game
              </div>
              <div className="mt-1 text-sm font-semibold">
                Warmup — run around and shoot. First to {firstTo} when live.
              </div>
              <div className="mt-2 flex items-center justify-center gap-4 text-xs">
                <span
                  className={cn(
                    'font-mono uppercase tracking-wide',
                    hud.localReady ? 'text-arena-ok' : 'text-white/45',
                  )}
                >
                  You: {hud.localReady ? 'Ready' : 'Not ready'}
                </span>
                <span className="text-white/20">|</span>
                <span
                  className={cn(
                    'font-mono uppercase tracking-wide',
                    hud.enemyReady ? 'text-arena-ok' : 'text-white/45',
                  )}
                >
                  Opp: {hud.enemyReady ? 'Ready' : 'Not ready'}
                </span>
              </div>
              {onReady && (
                <button
                  type="button"
                  onClick={() => {
                    gameAudio.uiConfirm()
                    onReady(!hud.localReady)
                  }}
                  className={cn(
                    'pointer-events-auto mt-3 inline-flex items-center gap-2 rounded-md border px-5 py-2 text-xs font-semibold tracking-wide uppercase transition-colors',
                    hud.localReady
                      ? 'border-white/20 bg-white/10 text-white/70 hover:bg-white/15'
                      : 'border-arena-ok/50 bg-arena-ok/20 text-arena-ok hover:bg-arena-ok/30',
                  )}
                >
                  {hud.localReady ? 'Unready' : 'Ready up'}
                </button>
              )}
            </HudPanel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Round countdown */}
      <AnimatePresence>
        {inCountdown && countdownN > 0 && (
          <motion.div
            key={`cd-${countdownN}`}
            initial={{ opacity: 0, scale: 1.15 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center"
          >
            <div className="text-center">
              <div className="text-[10px] font-semibold tracking-[0.35em] text-white/50 uppercase">
                Round starting
              </div>
              <div className="mt-1 font-mono text-7xl font-bold tabular-nums text-white drop-shadow-[0_0_24px_rgba(255,120,40,0.55)]">
                {countdownN}
              </div>
              <div className="mt-1 text-xs text-white/40">
                Weapons locked until go
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Round reset after kill */}
      <AnimatePresence>
        {inRoundReset && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute top-20 left-1/2 z-40 -translate-x-1/2"
          >
            <HudPanel className="px-5 py-2.5 text-center" accent="heat">
              <div className="text-[10px] font-semibold tracking-[0.25em] text-arena-heat uppercase">
                Round over
              </div>
              <div className="mt-0.5 font-mono text-sm tabular-nums text-white/70">
                Reset in {countdownN}s
              </div>
            </HudPanel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Match end */}
      <AnimatePresence>
        {hud.matchEndReason && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/55"
          >
            <HudPanel className="min-w-[16rem] px-8 py-7 text-center" accent="heat">
              <div className="text-xs tracking-[0.2em] text-white/45 uppercase">
                {matchEndTitle(hud.matchEndReason)}
              </div>
              <div className="mt-2 text-2xl font-bold text-arena-heat">
                {hud.matchWinnerId ? 'Winner decided' : 'Draw'}
              </div>
              <div className="mt-2 font-mono text-sm text-white/70">
                {hud.kills} – {hud.enemyKills}
                <span className="ml-2 text-white/40">
                  (first to {firstTo})
                </span>
              </div>
              {onExit && (
                <button
                  type="button"
                  onClick={() => {
                    gameAudio.uiConfirm()
                    onExit()
                  }}
                  className="mt-5 inline-flex items-center gap-2 rounded-md border border-arena-heat/40 bg-arena-heat/15 px-4 py-2 text-xs font-semibold tracking-wide text-arena-heat uppercase transition-colors hover:bg-arena-heat/25"
                >
                  <MapIcon className="size-3.5" />
                  Back to maps
                </button>
              )}
            </HudPanel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top chrome */}
      <div
        className="pointer-events-auto absolute top-3 left-3 right-3 flex items-start justify-between gap-3 transition-opacity duration-150"
        style={{ opacity: chromeOpacity }}
      >
        {/* Score / status */}
        <HudPanel className="min-w-[11rem] px-3.5 py-2.5 pl-4" accent="heat">
          <div className="flex items-center gap-2">
            <img
              src={icons.aim}
              alt=""
              aria-hidden
              className="size-4 object-contain drop-shadow-sm"
            />
            <HudLabel>
              {online
                ? hud.teamColor === 'red'
                  ? 'Red'
                  : hud.teamColor === 'blue'
                    ? 'Blue'
                    : 'Dual Arena'
                : 'Dual Arena'}
            </HudLabel>
          </div>
          <div className="mt-2 flex items-end gap-3">
            <div>
              {online ? (
                <>
                  <div className="font-mono text-3xl font-bold leading-none tracking-tight tabular-nums">
                    <span className="text-arena-heat drop-shadow-[0_0_12px_var(--arena-heat-dim)]">
                      {hud.kills}
                    </span>
                    <span className="mx-1 text-lg text-white/25">–</span>
                    <span className="text-white/80">{hud.enemyKills}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] tracking-widest text-white/45 uppercase">
                    First to {firstTo}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-mono text-3xl font-bold leading-none tracking-tight tabular-nums text-arena-heat drop-shadow-[0_0_12px_var(--arena-heat-dim)]">
                    {hud.kills}
                  </div>
                  <div className="mt-0.5 text-[10px] tracking-widest text-white/45 uppercase">
                    Elims
                  </div>
                </>
              )}
            </div>
            <div className="mb-0.5 h-8 w-px bg-white/10" />
            <div className="min-w-0 pb-0.5">
              <div className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-white/70 uppercase">
                <Zap className="size-3 text-arena-tech" />
                {online && hud.matchPhase
                  ? matchPhaseLabel(hud.matchPhase)
                  : hud.moveState}
              </div>
              <div className="mt-0.5 font-mono text-[11px] tabular-nums text-white/40">
                {hud.speed.toFixed(1)} m/s
              </div>
              {hud.matchTimeLeft != null && (
                <div className="mt-0.5 font-mono text-[11px] tabular-nums text-arena-tech/90">
                  {formatMatchClock(hud.matchTimeLeft)}
                </div>
              )}
            </div>
          </div>
        </HudPanel>

        <div className="flex items-start gap-2">
          <HudPanel className="px-3 py-2 font-mono text-xs" accent="tech">
            <div
              className="flex items-baseline gap-3 tabular-nums"
              title={
                hud.ping == null
                  ? 'Ping: offline (local range)'
                  : `Ping: ${Math.round(hud.ping)} ms`
              }
            >
              <span className={fpsColor(hud.fps)}>
                <span className="text-base font-semibold">{hud.fps}</span>
                <span className="ml-1 text-[10px] text-white/35">FPS</span>
              </span>
              <span className="text-white/15">|</span>
              <span className={pingColor(hud.ping)}>
                <span className="text-base font-semibold">
                  {hud.ping == null ? '—' : Math.round(hud.ping)}
                </span>
                <span className="ml-1 text-[10px] text-white/35">ms</span>
              </span>
            </div>
            {hud.perf && <PerfPanel perf={hud.perf} fps={hud.fps} />}
          </HudPanel>

          {onOpenSettings && (
            <ChromeBtn
              onClick={() => {
                gameAudio.uiClick()
                onOpenSettings()
              }}
            >
              <Settings className="size-3.5" />
              Settings
            </ChromeBtn>
          )}
          {onExit && (
            <ChromeBtn
              onClick={() => {
                gameAudio.uiClick()
                onExit()
              }}
              title="Return to map select"
            >
              <MapIcon className="size-3.5" />
              Maps
            </ChromeBtn>
          )}
        </div>
      </div>

      {/*
        Shared reticle origin — exact screen center (0×0 pivot).
        Hipfire crosshair + hitmarker both hang off this point so they
        cannot drift relative to each other.
      */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 z-20 h-0 w-0">
        {/*
          Displacement on the whole reticle group (crosshair + hitmarker):
          fire / bolt / hit offset+rotate only. Remount key restarts CSS
          without fighting per-frame HUD ticks. Hit confirm chip stays outside.
        */}
        <div key={reticleKey} className={cn(reticleDisplaceClass)}>
          {/* Hipfire crosshair — box centered on the pivot */}
          {!fullyScoped && !hud.spectating && (
            <div
              className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-100"
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
                <div
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
                  style={{ width: 2, height: 2 }}
                />
                <div
                  className="absolute left-1/2 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
                  style={{
                    width: thick,
                    height: arm,
                    top: `calc(50% - ${gap}px - ${arm}px)`,
                    transition:
                      'top 70ms linear, height 70ms linear, width 70ms linear',
                  }}
                />
                <div
                  className="absolute left-1/2 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
                  style={{
                    width: thick,
                    height: arm,
                    top: `calc(50% + ${gap}px)`,
                    transition:
                      'top 70ms linear, height 70ms linear, width 70ms linear',
                  }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
                  style={{
                    height: thick,
                    width: arm,
                    left: `calc(50% - ${gap}px - ${arm}px)`,
                    transition:
                      'left 70ms linear, width 70ms linear, height 70ms linear',
                  }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
                  style={{
                    height: thick,
                    width: arm,
                    left: `calc(50% + ${gap}px)`,
                    transition:
                      'left 70ms linear, width 70ms linear, height 70ms linear',
                  }}
                />
              </div>
            </div>
          )}

          {/*
            Lifecycle via static CSS classes (theme.css). HUD re-renders every
            frame; framer keyframe arrays / inline animation styles restart and
            read as a pulse. Class animations only restart on remount (new key).
          */}
          {showHit && hit && (
            <div className="hitmarker-life absolute top-0 left-0">
              <HitMarkerX
                color={hitmarkerColor(hit)}
                kill={hit.killed}
                head={hit.zone === 'head'}
              />
            </div>
          )}
        </div>

        {/*
          Hit confirm — combat chip arcs off the reticle (not a static caption).
          Remount key restarts CSS lifecycle once per hit id.
        */}
        {showHit && hit && (
          <HitConfirm key={`confirm-${hud.lastHitId}`} hit={hit} />
        )}
      </div>

      {/* Bottom chrome — vitals + ammo */}
      <div
        className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-4 transition-opacity duration-150"
        style={{ opacity: chromeOpacity }}
      >
        {/* Health */}
        <HudPanel className="min-w-[13rem] px-4 py-3 pl-4" accent="none">
          <div className="flex items-center justify-between gap-3">
            <HudLabel>Integrity</HudLabel>
            <div className="flex items-center gap-1.5">
              <img
                src={icons.heart}
                alt=""
                aria-hidden
                className={cn(
                  'size-5 object-contain drop-shadow-sm transition-opacity',
                  hud.hp <= 30 && 'opacity-90',
                )}
              />
              <span className="font-mono text-lg font-semibold leading-none tabular-nums">
                {hud.hp}
              </span>
            </div>
          </div>
          <div className="mt-2.5 h-2 w-44 overflow-hidden rounded-sm bg-black/50 ring-1 ring-white/10">
            <div
              className={cn(
                'h-full rounded-sm transition-all duration-200',
                hpBarColor(hud.hp),
              )}
              style={{ width: `${Math.max(0, Math.min(100, hud.hp))}%` }}
            />
          </div>
          {/* Segment ticks */}
          <div className="relative mt-1 flex w-44 justify-between px-px">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-1 w-px bg-white/20" />
            ))}
          </div>
        </HudPanel>

        {/* Weapon / ammo */}
        <HudPanel
          className={cn(
            'min-w-[10.5rem] px-5 py-3 text-right',
            emptyMag && 'border-arena-danger/40',
          )}
          accent={phaseHot || lowAmmo ? 'danger' : 'tech'}
        >
          <div className="flex items-center justify-end gap-2">
            <img
              src={icons.ammo}
              alt=""
              aria-hidden
              className={cn(
                'size-5 object-contain drop-shadow-sm',
                emptyMag && 'opacity-50 grayscale',
                lowAmmo && !emptyMag && 'opacity-90',
              )}
            />
            <HudLabel>
              <span
                className={cn(
                  phaseHot && 'text-arena-danger',
                  !phaseHot && 'text-arena-tech/80',
                )}
              >
                {phaseLabel}
              </span>
            </HudLabel>
          </div>
          <div
            className={cn(
              'mt-1 font-mono text-4xl font-bold leading-none tracking-tighter tabular-nums',
              emptyMag
                ? 'text-arena-danger'
                : lowAmmo
                  ? 'text-arena-heat'
                  : 'text-white',
            )}
          >
            {hud.ammo}
            <span className="text-xl font-semibold text-white/35">
              /{hud.magSize}
            </span>
          </div>
          {/* Mag segment bar */}
          <div className="mt-2 flex justify-end gap-0.5">
            {Array.from({ length: hud.magSize }).map((_, i) => {
              const filled = i < hud.ammo
              return (
                <div
                  key={i}
                  className={cn(
                    'h-1 w-2.5 rounded-[1px] transition-colors',
                    filled
                      ? lowAmmo
                        ? 'bg-arena-heat'
                        : 'bg-arena-tech'
                      : 'bg-white/10',
                  )}
                />
              )
            })}
          </div>
        </HudPanel>
      </div>

      {/* Death free-cam spectate */}
      {hud.spectating && !hud.alive && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center">
          <div className="relative overflow-hidden rounded-lg border border-arena-danger/45 bg-black/80 px-12 py-8 text-center shadow-[0_0_60px_rgba(255,40,40,0.18)] backdrop-blur-md">
            <div className="pointer-events-none absolute top-0 left-0 h-3 w-3 border-t-2 border-l-2 border-arena-danger/70" />
            <div className="pointer-events-none absolute top-0 right-0 h-3 w-3 border-t-2 border-r-2 border-arena-danger/70" />
            <div className="pointer-events-none absolute bottom-0 left-0 h-3 w-3 border-b-2 border-l-2 border-arena-danger/70" />
            <div className="pointer-events-none absolute bottom-0 right-0 h-3 w-3 border-b-2 border-r-2 border-arena-danger/70" />
            <div className="text-[10px] font-bold tracking-[0.4em] text-arena-danger uppercase">
              KIA
            </div>
            <div className="mt-2 text-2xl font-bold tracking-wide text-white">
              {hud.deathReason === 'fall'
                ? 'Fell out of the world'
                : 'Eliminated'}
            </div>
            <div className="mt-5 font-mono text-sm text-white/65">
              Free cam · respawning in{' '}
              <span className="text-lg font-semibold tabular-nums text-arena-heat">
                {Math.ceil(hud.respawnIn)}
              </span>
              s
            </div>
            <p className="mt-3 text-[11px] text-white/40">
              WASD + mouse · Space / crouch to fly · Sprint to boost
            </p>
            <p className="mt-1 text-[11px] text-white/30">
              Toggle Free cam off (bottom left) to respawn now
            </p>
          </div>
        </div>
      )}

      {/* Voluntary free-cam */}
      {hud.spectating && hud.alive && (
        <div className="pointer-events-none absolute top-16 left-1/2 z-20 -translate-x-1/2">
          <HudPanel className="px-5 py-2.5 text-center" accent="tech">
            <div className="text-[10px] font-semibold tracking-[0.25em] text-arena-tech uppercase">
              Free cam
            </div>
            <p className="mt-1 text-[11px] text-white/50">
              WASD + mouse · Space / crouch fly · Sprint boost
            </p>
          </HudPanel>
        </div>
      )}

      {/* Click to play */}
      {!hud.pointerLocked && !(!hud.alive && hud.spectating) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
          <div className="relative overflow-hidden rounded-lg border border-arena-panel-border bg-arena-panel px-10 py-8 text-center shadow-2xl backdrop-blur-md">
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-arena-heat/60 to-transparent" />
            <div className="pointer-events-none absolute top-0 left-0 h-3 w-3 border-t-2 border-l-2 border-arena-heat/50" />
            <div className="pointer-events-none absolute top-0 right-0 h-3 w-3 border-t-2 border-r-2 border-arena-heat/50" />
            <div className="pointer-events-none absolute bottom-0 left-0 h-3 w-3 border-b-2 border-l-2 border-arena-heat/50" />
            <div className="pointer-events-none absolute bottom-0 right-0 h-3 w-3 border-b-2 border-r-2 border-arena-heat/50" />
            <div className="text-[10px] font-semibold tracking-[0.35em] text-arena-heat uppercase">
              Ready
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight">
              {hud.spectating ? 'Click to look' : 'Click to engage'}
            </div>
            <ControlsHint />
          </div>
        </div>
      )}
    </div>
  )
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded-sm border border-white/15 bg-white/8 px-1.5 py-0.5 font-mono text-[11px] text-white/80 shadow-sm">
      {children}
    </kbd>
  )
}

function primary(codes: string[]): string {
  return formatKeyCode(codes[0] ?? '?')
}

function ControlsHint() {
  const k = getUserSettings().keybinds
  return (
    <div className="mt-5 space-y-2 text-sm text-white/55">
      <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1.5">
        <span className="inline-flex gap-0.5">
          <Kbd>{primary(k.forward)}</Kbd>
          <Kbd>{primary(k.left)}</Kbd>
          <Kbd>{primary(k.back)}</Kbd>
          <Kbd>{primary(k.right)}</Kbd>
        </span>
        <span className="text-white/35">move</span>
        <span className="text-white/20">·</span>
        <Kbd>{primary(k.sprint)}</Kbd>
        <span className="text-white/35">sprint</span>
        <span className="text-white/20">·</span>
        <Kbd>{primary(k.crouch)}</Kbd>
        {k.crouch.length > 1 && (
          <>
            <span className="text-white/20">/</span>
            <Kbd>{formatKeyCode(k.crouch[1])}</Kbd>
          </>
        )}
        <span className="text-white/35">crouch</span>
      </p>
      <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1.5">
        <Kbd>{primary(k.jump)}</Kbd>
        <span className="text-white/35">jump</span>
        <span className="text-white/20">·</span>
        <Kbd>{primary(k.fire)}</Kbd>
        <span className="text-white/35">fire</span>
        <span className="text-white/20">·</span>
        <Kbd>{primary(k.ads)}</Kbd>
        <span className="text-white/35">ADS</span>
        <span className="text-white/20">·</span>
        <Kbd>{primary(k.reload)}</Kbd>
        <span className="text-white/35">reload</span>
      </p>
      <p className="text-[11px] tracking-wide text-white/30">
        Sprint + crouch to slide · jump out of slide to hop
      </p>
    </div>
  )
}
