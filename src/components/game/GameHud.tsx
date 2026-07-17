import type { CSSProperties, ReactNode } from 'react'
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
}

/** Map cone half-angle (rad) → half-gap in px for the dynamic reticle. */
function spreadToGap(spreadRad: number): number {
  return Math.min(190, 3 + spreadRad * 820)
}

function hitmarkerColor(hit: HitEvent): string {
  if (hit.killed) return '#ff3b3b'
  if (hit.zone === 'head') return '#ffd45a'
  return '#e8f7ff'
}

function damageLabelColor(hit: HitEvent): string {
  if (hit.killed) return 'text-arena-danger'
  if (hit.zone === 'head') return 'text-arena-heat'
  if (hit.zone === 'chest') return 'text-arena-tech'
  if (hit.zone === 'arm') return 'text-orange-400'
  return 'text-amber-200'
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

/** Classic FPS X hitmarker (four diagonal ticks). */
function HitMarkerX({
  color,
  kill,
  head,
}: {
  color: string
  kill: boolean
  head: boolean
}) {
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

export function GameHud({ hud, onOpenSettings, onExit }: GameHudProps) {
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
  const showHit = Boolean(hud.lastHit && hud.lastHitAge < 0.605)
  const fullyScoped = hud.adsBlend > 0.55
  const gap = spreadToGap(hud.aimSpread)
  const arm = Math.min(18, 8 + gap * 0.05)
  const thick = gap > 100 ? 2.5 : 2
  const chromeOpacity = fullyScoped ? 0.32 : 1
  const hit = hud.lastHit
  const lowAmmo = hud.ammo <= 1
  const emptyMag = hud.ammo === 0

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
                Share the same match id — first to score wins.
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
                Your elims: {hud.kills}
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
            <HudLabel>Dual Arena</HudLabel>
          </div>
          <div className="mt-2 flex items-end gap-3">
            <div>
              <div className="font-mono text-3xl font-bold leading-none tracking-tight tabular-nums text-arena-heat drop-shadow-[0_0_12px_var(--arena-heat-dim)]">
                {hud.kills}
              </div>
              <div className="mt-0.5 text-[10px] tracking-widest text-white/45 uppercase">
                Elims
              </div>
            </div>
            <div className="mb-0.5 h-8 w-px bg-white/10" />
            <div className="min-w-0 pb-0.5">
              <div className="flex items-center gap-1.5 font-mono text-[11px] tracking-wide text-white/70 uppercase">
                <Zap className="size-3 text-arena-tech" />
                {hud.moveState}
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

      {/* Hipfire crosshair */}
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
                transition: 'top 70ms linear, height 70ms linear, width 70ms linear',
              }}
            />
            <div
              className="absolute left-1/2 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
              style={{
                width: thick,
                height: arm,
                top: `calc(50% + ${gap}px)`,
                transition: 'top 70ms linear, height 70ms linear, width 70ms linear',
              }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
              style={{
                height: thick,
                width: arm,
                left: `calc(50% - ${gap}px - ${arm}px)`,
                transition: 'left 70ms linear, width 70ms linear, height 70ms linear',
              }}
            />
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

      {/* Hitmarker + damage float */}
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
            <motion.div
              className={cn(
                'mt-3 text-center font-bold tracking-wide drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]',
                damageLabelColor(hit),
                hit.zone === 'head' || hit.killed ? 'text-base' : 'text-sm',
              )}
              initial={{ y: 0, opacity: 1 }}
              animate={{ y: -18, opacity: 0 }}
              transition={{ duration: 0.53, ease: 'easeOut', delay: 0.05 }}
            >
              {hit.zone === 'head' ? 'HEADSHOT' : hit.zone.toUpperCase()}{' '}
              <span className="tabular-nums">-{hit.damage}</span>
            </motion.div>
            {hit.killed && (
              <motion.div
                className="mt-0.5 text-xs font-extrabold tracking-[0.28em] text-arena-danger drop-shadow-[0_0_10px_var(--arena-danger)]"
                initial={{ opacity: 0, scale: 0.7, y: 4 }}
                animate={{
                  opacity: [0, 1, 1, 0],
                  scale: [0.7, 1.08, 1, 1],
                  y: [4, -2, -6, -10],
                }}
                transition={{ duration: 0.605, times: [0, 0.15, 0.7, 1] }}
              >
                ELIMINATED
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

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
