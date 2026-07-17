import { Link } from 'react-router-dom'
import type { HudSnapshot } from '@/game/types'
import { Crosshair, Target } from 'lucide-react'

interface GameHudProps {
  hud: HudSnapshot | null
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

  const showHit = hud.lastHit && hud.lastHitAge < 1.2
  const scoped = hud.adsBlend > 0.55

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none text-white">
      {/* Top bar */}
      <div className="pointer-events-auto absolute top-3 left-3 right-3 flex items-start justify-between gap-3">
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

      {/* Scope vignette */}
      {scoped && (
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(circle at center, transparent 18%, rgba(0,0,0,${0.35 + hud.adsBlend * 0.55}) 42%, rgba(0,0,0,${0.75 + hud.adsBlend * 0.2}) 70%)`,
          }}
        />
      )}

      {/* Crosshair */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        {scoped ? (
          <div className="relative h-48 w-48">
            <div className="absolute inset-0 rounded-full border border-white/25" />
            <div className="absolute top-1/2 left-0 h-px w-full bg-white/30" />
            <div className="absolute top-0 left-1/2 h-full w-px bg-white/30" />
            <div className="absolute top-1/2 left-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500/90" />
          </div>
        ) : (
          <Crosshair
            className="h-6 w-6 text-white/70 drop-shadow"
            strokeWidth={1.5}
          />
        )}
      </div>

      {/* Hit marker */}
      {showHit && hud.lastHit && (
        <div className="absolute top-[42%] left-1/2 -translate-x-1/2 text-center">
          <div
            className={`font-bold tracking-wide ${
              hud.lastHit.zone === 'head'
                ? 'text-yellow-300 text-lg'
                : hud.lastHit.zone === 'chest'
                  ? 'text-sky-300 text-sm'
                  : hud.lastHit.zone === 'arm'
                    ? 'text-orange-400 text-sm'
                    : 'text-amber-200 text-sm'
            }`}
          >
            {hud.lastHit.zone === 'head'
              ? 'HEADSHOT'
              : hud.lastHit.zone === 'chest'
                ? 'CHEST'
                : hud.lastHit.zone === 'arm'
                  ? 'ARM'
                  : 'LEG'}{' '}
            <span className="tabular-nums">-{hud.lastHit.damage}</span>
          </div>
          {hud.lastHit.killed && (
            <div className="text-xs font-semibold text-orange-400">ELIMINATED</div>
          )}
        </div>
      )}

      {/* Bottom HUD */}
      <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
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
