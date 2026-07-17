import type { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { gameAudio } from '@/game/audio'
import type { HudSnapshot, HitEvent, PerfHud } from '@/game/types'
import { SNIPER } from '@/game/core/config'
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

/** Cartoon PNG from /public/icons — thick outline sticker set. */
function GameIcon({
  src,
  className,
}: {
  src: string
  className?: string
}) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className={cn(
        'shrink-0 object-contain select-none drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]',
        className,
      )}
    />
  )
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
 * Combat hit confirm — bare damage + zone text punches out top-right of reticle.
 * Lifecycle is CSS-class only (remount via key) so HUD ticks don't pulse it.
 */
function HitConfirm({ hit }: { hit: HitEvent }) {
  const head = hit.zone === 'head'
  const color = head ? 'text-[#f83839]' : 'text-white'

  return (
    <div
      className={cn(
        'hit-confirm-chip pointer-events-none absolute top-0 left-0 flex items-baseline gap-1.5',
        head && 'hit-confirm-chip-hard',
      )}
      aria-live="polite"
    >
      <span
        className={cn(
          'text-lg font-black tabular-nums leading-none tracking-tight drop-shadow-[0_2px_0_rgba(0,0,0,0.85)]',
          color,
          head && 'text-xl',
        )}
      >
        −{hit.damage}
      </span>
      <span
        className={cn(
          'text-[10px] font-extrabold tracking-wide uppercase drop-shadow-[0_2px_0_rgba(0,0,0,0.85)]',
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
  if (ping == null) return 'text-white/40'
  if (ping < 50) return 'text-arena-ok'
  if (ping < 100) return 'text-arena-heat'
  return 'text-arena-danger'
}

function hpBarColor(hp: number): string {
  if (hp > 60) return 'bg-arena-ok'
  if (hp > 30) return 'bg-arena-heat'
  return 'bg-arena-danger'
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

/**
 * Cartoon sticker panel — thick ink border, hard drop shadow, chunky radius.
 * Matches /public/icons outline language (not tactical glass).
 */
function HudPanel({
  children,
  className,
  accent = 'heat',
}: {
  children: ReactNode
  className?: string
  accent?: 'heat' | 'tech' | 'danger' | 'ok' | 'none'
}) {
  return (
    <div
      className={cn(
        'relative rounded-2xl border-[3px] border-arena-ink bg-arena-panel shadow-[3px_4px_0_var(--arena-ink)]',
        accent === 'heat' && 'ring-2 ring-arena-heat/50',
        accent === 'tech' && 'ring-2 ring-arena-tech/50',
        accent === 'danger' && 'ring-2 ring-arena-danger/55',
        accent === 'ok' && 'ring-2 ring-arena-ok/50',
        className,
      )}
    >
      {/* Soft top sheen like icon highlights */}
      <div className="pointer-events-none absolute inset-x-3 top-0 h-2 rounded-b-full bg-white/10" />
      {children}
    </div>
  )
}

function PerfPanel({ perf, fps }: { perf: PerfHud; fps: number }) {
  const map = perf.map
  const budget = 1000 / 180
  return (
    <div className="mt-2 max-w-[22rem] space-y-1 border-t-2 border-arena-ink/40 pt-2 text-[10px] leading-snug text-white/70">
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 font-bold tabular-nums">
        <span className={msColor(perf.frameMs, budget)}>
          {perf.frameMs.toFixed(1)}
          <span className="text-white/35"> ms</span>
        </span>
        <span className={msColor(perf.simMs, budget * 0.4)}>
          sim {perf.simMs.toFixed(1)}
        </span>
        <span className={msColor(perf.renderMs, budget * 0.6)}>
          ren {perf.renderMs.toFixed(1)}
        </span>
        <span className="text-white/40">dpr {perf.pixelRatio.toFixed(2)}</span>
      </div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 font-semibold tabular-nums text-white/55">
        <span>
          draws <span className="text-white/90">{perf.draws}</span>
        </span>
        <span>
          tris <span className="text-white/90">{fmtNum(perf.triangles)}</span>
        </span>
        <span>
          col{' '}
          <span className="text-white/90">
            {perf.nearbyCollision}/{perf.collisionMeshes}
          </span>
        </span>
      </div>
      {map && (
        <div className="font-semibold tabular-nums text-white/45">
          map <span className="text-white/75">{map.id}</span>
          {' · '}
          {fmtNum(map.triangles)} tris · {map.meshes} mesh ·{' '}
          {map.shadowCasters} sh ·{' '}
          {map.dedicatedCollision ? 'COL✓' : 'COL✗'}
        </div>
      )}
      <div className="font-semibold text-white/50">
        <span className="text-white/35">limit </span>
        <span className={fps >= 140 ? 'text-arena-ok' : 'text-arena-heat'}>
          {perf.bottleneck}
        </span>
      </div>
      {map && map.notes[0] && (
        <div className="text-white/40" title={map.notes.join('\n')}>
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

/** Chunky sticker button for HUD chrome (icon-friendly). */
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
      title={title}
      className="inline-flex size-10 items-center justify-center rounded-xl border-[3px] border-arena-ink bg-arena-panel text-white shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-white/10 hover:shadow-[2px_4px_0_var(--arena-ink)] active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]"
    >
      {children}
    </button>
  )
}

/**
 * Reload cue — ammo sticker + progress bar, bottom-right of the reticle.
 * No panel/text — just icon + bar side by side (sticker language, bare).
 */
function ReloadReticleHint({ progress }: { progress: number }) {
  const p = Math.max(0, Math.min(1, progress))
  const almostDone = p >= 0.92

  return (
    <div
      className="reload-sticker-in pointer-events-none absolute top-6 left-6 flex items-center gap-1.5"
      aria-hidden
    >
      <img
        src={icons.ammo}
        alt=""
        draggable={false}
        className="size-4 object-contain select-none drop-shadow-[0_1px_0_rgba(0,0,0,0.55)]"
      />
      <div className="h-2 w-12 overflow-hidden rounded-full border-[2px] border-arena-ink bg-black/50 shadow-[1px_2px_0_var(--arena-ink)]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${p * 100}%`,
            background: almostDone ? 'var(--arena-ok)' : 'var(--arena-heat)',
          }}
        />
      </div>
    </div>
  )
}

export function GameHud({
  hud,
  onOpenSettings,
  onExit,
  onReady,
}: GameHudProps) {
  if (!hud) return null

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
  const reloading = hud.phase === 'reloading' && !hud.spectating
  const reloadProgress = reloading
    ? Math.max(
        0,
        Math.min(1, 1 - hud.phaseTimer / Math.max(0.001, SNIPER.reloadTime)),
      )
    : 0

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
            className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-black/50"
          >
            <HudPanel className="px-8 py-6 text-center" accent="tech">
              <div className="flex items-center justify-center gap-2">
                <GameIcon src={icons.globe} className="size-6" />
                <div className="text-xs font-extrabold tracking-wide text-arena-tech uppercase">
                  Online 1v1
                </div>
              </div>
              <div className="mt-2 text-xl font-black tracking-tight">
                Waiting for opponent…
              </div>
              <div className="mt-1 text-sm font-semibold text-white/55">
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
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            className="pointer-events-none absolute bottom-24 left-1/2 z-40 w-[min(28rem,92vw)] -translate-x-1/2"
          >
            <HudPanel className="px-6 py-4 text-center" accent="tech">
              <div className="flex items-center justify-center gap-2">
                <GameIcon src={icons.fire} className="size-5" />
                <div className="text-[11px] font-extrabold tracking-wide text-arena-tech uppercase">
                  Pre-game
                </div>
              </div>
              <div className="mt-1.5 text-sm font-bold">
                Warmup — run around and shoot. First to {firstTo} when live.
              </div>
              <div className="mt-2.5 flex items-center justify-center gap-4 text-xs font-extrabold">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 uppercase tracking-wide',
                    hud.localReady ? 'text-arena-ok' : 'text-white/45',
                  )}
                >
                  {hud.localReady && (
                    <GameIcon src={icons.check} className="size-3.5" />
                  )}
                  You: {hud.localReady ? 'Ready' : 'Not ready'}
                </span>
                <span className="text-white/25">|</span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 uppercase tracking-wide',
                    hud.enemyReady ? 'text-arena-ok' : 'text-white/45',
                  )}
                >
                  {hud.enemyReady && (
                    <GameIcon src={icons.check} className="size-3.5" />
                  )}
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
                    'pointer-events-auto mt-3 inline-flex items-center gap-2 rounded-xl border-[3px] border-arena-ink px-5 py-2 text-xs font-extrabold tracking-wide uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]',
                    hud.localReady
                      ? 'bg-white/15 text-white/80 hover:bg-white/20'
                      : 'bg-arena-ok text-arena-ink hover:brightness-110',
                  )}
                >
                  <GameIcon
                    src={hud.localReady ? icons.x : icons.check}
                    className="size-4"
                  />
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
            initial={{ opacity: 0, scale: 1.2 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center"
          >
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 text-[11px] font-extrabold tracking-wide text-white/60 uppercase">
                <GameIcon src={icons.bolt} className="size-4" />
                Round starting
              </div>
              <div className="mt-1 text-8xl font-black tabular-nums text-white drop-shadow-[0_4px_0_var(--arena-ink)]">
                {countdownN}
              </div>
              <div className="mt-1 text-sm font-bold text-white/50">
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
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute top-20 left-1/2 z-40 -translate-x-1/2"
          >
            <HudPanel className="px-5 py-2.5 text-center" accent="heat">
              <div className="flex items-center justify-center gap-1.5 text-[11px] font-extrabold tracking-wide text-arena-heat uppercase">
                <GameIcon src={icons.boom} className="size-4" />
                Round over
              </div>
              <div className="mt-0.5 text-sm font-extrabold tabular-nums text-white/80">
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
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/60"
          >
            <HudPanel className="min-w-[17rem] px-8 py-7 text-center" accent="heat">
              <GameIcon src={icons.trophy} className="mx-auto size-14" />
              <div className="mt-2 text-xs font-extrabold tracking-wide text-white/50 uppercase">
                {matchEndTitle(hud.matchEndReason)}
              </div>
              <div className="mt-1 text-3xl font-black text-arena-heat drop-shadow-[0_2px_0_var(--arena-ink)]">
                {hud.matchWinnerId ? 'Winner!' : 'Draw'}
              </div>
              <div className="mt-2 text-lg font-extrabold tabular-nums text-white/85">
                {hud.kills}
                <span className="mx-1.5 text-white/30">–</span>
                {hud.enemyKills}
                <span className="ml-2 text-xs font-bold text-white/40">
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
                  className="mt-5 inline-flex items-center gap-2 rounded-xl border-[3px] border-arena-ink bg-arena-heat px-4 py-2.5 text-xs font-extrabold tracking-wide text-arena-ink uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]"
                >
                  <GameIcon src={icons.map} className="size-5" />
                  Back to maps
                </button>
              )}
            </HudPanel>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top chrome — score dead-center; utilities corners */}
      <div
        className="pointer-events-none absolute top-3 left-3 right-3 z-30 transition-opacity duration-150"
        style={{ opacity: chromeOpacity }}
      >
        {/* Scoreboard — center of screen, pure game state (0 – 2) */}
        <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2">
          <HudPanel
            className="min-w-[9.5rem] px-5 py-2 text-center"
            accent="heat"
          >
            {online ? (
              <div className="flex items-center justify-center gap-2.5">
                <span
                  className={cn(
                    'min-w-[1.6rem] text-center text-4xl font-black leading-none tabular-nums drop-shadow-[0_2px_0_var(--arena-ink)]',
                    hud.teamColor === 'blue' ? 'text-sky-300' : 'text-arena-heat',
                  )}
                >
                  {hud.kills}
                </span>
                <span className="text-xl font-black text-white/25">–</span>
                <span
                  className={cn(
                    'min-w-[1.6rem] text-center text-4xl font-black leading-none tabular-nums drop-shadow-[0_2px_0_var(--arena-ink)]',
                    hud.teamColor === 'red' ? 'text-sky-300' : 'text-white',
                  )}
                >
                  {hud.enemyKills}
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <GameIcon src={icons.aim} className="size-6" />
                <span className="text-4xl font-black leading-none tabular-nums text-arena-heat drop-shadow-[0_2px_0_var(--arena-ink)]">
                  {hud.kills}
                </span>
              </div>
            )}
            <div className="mt-0.5 flex items-center justify-center gap-2 text-[10px] font-extrabold tracking-wide text-white/45 uppercase">
              {online && <span>FT{firstTo}</span>}
              {online && hud.matchTimeLeft != null && (
                <span className="text-white/25">·</span>
              )}
              {hud.matchTimeLeft != null && (
                <span className="tabular-nums text-arena-tech">
                  {formatMatchClock(hud.matchTimeLeft)}
                </span>
              )}
              {!online && <span>elims</span>}
            </div>
          </HudPanel>
        </div>

        {/* Top-right utilities */}
        <div className="pointer-events-auto absolute top-0 right-0 flex items-start gap-2">
          <HudPanel className="px-2.5 py-1.5 text-xs" accent="tech">
            <div
              className="flex items-baseline gap-2.5 font-extrabold tabular-nums"
              title={
                hud.ping == null
                  ? 'Ping: offline (local range)'
                  : `Ping: ${Math.round(hud.ping)} ms`
              }
            >
              <span className={fpsColor(hud.fps)}>
                <span className="text-base">{hud.fps}</span>
                <span className="ml-0.5 text-[9px] font-bold text-white/40">
                  FPS
                </span>
              </span>
              {hud.ping != null && (
                <>
                  <span className="text-white/20">|</span>
                  <span className={pingColor(hud.ping)}>
                    <span className="text-base">{Math.round(hud.ping)}</span>
                    <span className="ml-0.5 text-[9px] font-bold text-white/40">
                      ms
                    </span>
                  </span>
                </>
              )}
            </div>
            {hud.perf && <PerfPanel perf={hud.perf} fps={hud.fps} />}
          </HudPanel>

          {onOpenSettings && (
            <ChromeBtn
              onClick={() => {
                gameAudio.uiClick()
                onOpenSettings()
              }}
              title="Settings"
            >
              <GameIcon src={icons.settings} className="size-5" />
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
              <GameIcon src={icons.map} className="size-5" />
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
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_2px_rgba(0,0,0,0.75)]"
                  style={{ width: 3, height: 3 }}
                />
                <div
                  className="absolute left-1/2 -translate-x-1/2 rounded-sm bg-white shadow-[0_0_0_2px_rgba(0,0,0,0.75)]"
                  style={{
                    width: thick + 0.5,
                    height: arm,
                    top: `calc(50% - ${gap}px - ${arm}px)`,
                    transition:
                      'top 70ms linear, height 70ms linear, width 70ms linear',
                  }}
                />
                <div
                  className="absolute left-1/2 -translate-x-1/2 rounded-sm bg-white shadow-[0_0_0_2px_rgba(0,0,0,0.75)]"
                  style={{
                    width: thick + 0.5,
                    height: arm,
                    top: `calc(50% + ${gap}px)`,
                    transition:
                      'top 70ms linear, height 70ms linear, width 70ms linear',
                  }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 rounded-sm bg-white shadow-[0_0_0_2px_rgba(0,0,0,0.75)]"
                  style={{
                    height: thick + 0.5,
                    width: arm,
                    left: `calc(50% - ${gap}px - ${arm}px)`,
                    transition:
                      'left 70ms linear, width 70ms linear, height 70ms linear',
                  }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 rounded-sm bg-white shadow-[0_0_0_2px_rgba(0,0,0,0.75)]"
                  style={{
                    height: thick + 0.5,
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
          Hit confirm — combat chip arcs top-right of the reticle.
          Remount key restarts CSS lifecycle once per hit id.
        */}
        {showHit && hit && (
          <HitConfirm key={`confirm-${hud.lastHitId}`} hit={hit} />
        )}

        {/*
          Reload — ammo icon + bar, bottom-right of reticle (hip + scoped).
          CSS enter only; remount once per reload so progress ticks
          don't restart keyframes.
        */}
        <AnimatePresence>
          {reloading && (
            <motion.div
              key="reload-hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.85, y: 4 }}
              transition={{ duration: 0.12 }}
              className="pointer-events-none absolute top-0 left-0"
            >
              <ReloadReticleHint progress={reloadProgress} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom chrome — health left, mag bullets right */}
      <div
        className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-4 transition-opacity duration-150"
        style={{ opacity: chromeOpacity }}
      >
        {/* Health — compact row */}
        <HudPanel className="px-3 py-2.5" accent="none">
          <div className="flex items-center gap-3">
            <GameIcon
              src={icons.heart}
              className={cn(
                'size-9 shrink-0',
                hud.hp <= 30 && 'scale-110',
              )}
            />
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span
                  className={cn(
                    'text-2xl font-black leading-none tabular-nums drop-shadow-[0_2px_0_var(--arena-ink)]',
                    hud.hp <= 30 && 'text-arena-danger',
                  )}
                >
                  {hud.hp}
                </span>
              </div>
              <div className="mt-1.5 h-2.5 w-36 overflow-hidden rounded-full border-[2.5px] border-arena-ink bg-black/55 shadow-[inset_0_1px_3px_rgba(0,0,0,0.45)]">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-200',
                    hpBarColor(hud.hp),
                    'shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]',
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, hud.hp))}%` }}
                />
              </div>
            </div>
          </div>
        </HudPanel>

        {/* Mag — bullet icons + infinite reserve (reloads always refill) */}
        <HudPanel
          className={cn(
            'px-3.5 py-2.5',
            emptyMag && 'ring-2 ring-arena-danger/60',
          )}
          accent={lowAmmo || emptyMag ? 'danger' : 'none'}
        >
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1" title="Magazine">
              {Array.from({ length: hud.magSize }).map((_, i) => {
                // Fill from the right so remaining rounds read left→right
                const filled = i >= hud.magSize - hud.ammo
                return (
                  <GameIcon
                    key={i}
                    src={icons.ammo}
                    className={cn(
                      'size-8 transition-all duration-150',
                      filled
                        ? lowAmmo
                          ? 'opacity-100 drop-shadow-[0_0_6px_var(--arena-heat)]'
                          : 'opacity-100'
                        : 'scale-90 opacity-20 grayscale',
                      emptyMag && 'opacity-25 grayscale',
                    )}
                  />
                )
              })}
            </div>
            <span
              className="select-none text-lg font-black leading-none text-white/35"
              aria-hidden
            >
              /
            </span>
            <span
              className="select-none text-2xl font-black leading-none tracking-tight text-white drop-shadow-[0_2px_0_var(--arena-ink)]"
              title="Infinite reserve ammo"
              aria-label="Infinite reserve ammo"
            >
              ∞
            </span>
          </div>
        </HudPanel>
      </div>

      {/* Death free-cam spectate */}
      {hud.spectating && !hud.alive && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center">
          <HudPanel className="px-12 py-8 text-center" accent="danger">
            <GameIcon src={icons.shocked} className="mx-auto size-12" />
            <div className="mt-2 text-[11px] font-extrabold tracking-wide text-arena-danger uppercase">
              Knocked out
            </div>
            <div className="mt-1 text-2xl font-black tracking-tight text-white">
              {hud.deathReason === 'fall'
                ? 'Fell out of the world'
                : 'Eliminated'}
            </div>
            <div className="mt-4 text-sm font-bold text-white/70">
              Free cam · respawning in{' '}
              <span className="text-2xl font-black tabular-nums text-arena-heat drop-shadow-[0_2px_0_var(--arena-ink)]">
                {Math.ceil(hud.respawnIn)}
              </span>
              s
            </div>
            <p className="mt-3 text-xs font-semibold text-white/45">
              WASD + mouse · Space / crouch to fly · Sprint to boost
            </p>
            <p className="mt-1 text-xs font-semibold text-white/35">
              Toggle Free cam off (bottom left) to respawn now
            </p>
          </HudPanel>
        </div>
      )}

      {/* Voluntary free-cam */}
      {hud.spectating && hud.alive && (
        <div className="pointer-events-none absolute top-16 left-1/2 z-20 -translate-x-1/2">
          <HudPanel className="px-5 py-2.5 text-center" accent="tech">
            <div className="flex items-center justify-center gap-1.5 text-[11px] font-extrabold tracking-wide text-arena-tech uppercase">
              <GameIcon src={icons.jetpack} className="size-4" />
              Free cam
            </div>
            <p className="mt-1 text-[11px] font-semibold text-white/55">
              WASD + mouse · Space / crouch fly · Sprint boost
            </p>
          </HudPanel>
        </div>
      )}

      {/* Click to play */}
      {!hud.pointerLocked && !(!hud.alive && hud.spectating) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45">
          <HudPanel className="px-10 py-8 text-center" accent="heat">
            <GameIcon src={icons.aim} className="mx-auto size-12" />
            <div className="mt-2 text-[11px] font-extrabold tracking-wide text-arena-heat uppercase">
              Ready
            </div>
            <div className="mt-1 text-2xl font-black tracking-tight">
              {hud.spectating ? 'Click to look' : 'Click to play'}
            </div>
            <ControlsHint />
          </HudPanel>
        </div>
      )}
    </div>
  )
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded-lg border-[2px] border-arena-ink bg-white/15 px-1.5 py-0.5 text-[11px] font-extrabold text-white shadow-[1px_2px_0_var(--arena-ink)]">
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
    <div className="mt-5 space-y-2 text-sm font-semibold text-white/60">
      <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1.5">
        <span className="inline-flex gap-0.5">
          <Kbd>{primary(k.forward)}</Kbd>
          <Kbd>{primary(k.left)}</Kbd>
          <Kbd>{primary(k.back)}</Kbd>
          <Kbd>{primary(k.right)}</Kbd>
        </span>
        <span className="text-white/40">move</span>
        <span className="text-white/20">·</span>
        <Kbd>{primary(k.sprint)}</Kbd>
        <span className="text-white/40">sprint</span>
        <span className="text-white/20">·</span>
        <Kbd>{primary(k.crouch)}</Kbd>
        {k.crouch.length > 1 && (
          <>
            <span className="text-white/20">/</span>
            <Kbd>{formatKeyCode(k.crouch[1])}</Kbd>
          </>
        )}
        <span className="text-white/40">crouch</span>
      </p>
      <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1.5">
        <Kbd>{primary(k.jump)}</Kbd>
        <span className="text-white/40">jump</span>
        <span className="text-white/20">·</span>
        <Kbd>{primary(k.fire)}</Kbd>
        <span className="text-white/40">fire</span>
        <span className="text-white/20">·</span>
        <Kbd>{primary(k.ads)}</Kbd>
        <span className="text-white/40">ADS</span>
        <span className="text-white/20">·</span>
        <Kbd>{primary(k.reload)}</Kbd>
        <span className="text-white/40">reload</span>
      </p>
      <p className="text-[11px] font-bold tracking-wide text-white/35">
        Sprint + crouch to slide · jump out of slide to hop
      </p>
    </div>
  )
}
