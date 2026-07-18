import { motion } from 'framer-motion'

import { gameAudio } from '@/game/audio'
import { icons, WAGER_ICONS } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { ServerRegion, WagerAmount } from '@/stores/useAppStore'

import { WAGER_OPTIONS } from './constants'
import { GameIcon, HudPanel, SectionLabel } from './ui'

type MapInfo = {
  name: string
  thumbUrl?: string
}

export function HostDuelPanel({
  selected,
  canHostDuel,
  serverRegion,
  setServerRegion,
  wagerAmount,
  setWagerAmount,
  serverUrl,
  setServerUrl,
  onHostOnline,
  onHost,
}: {
  selected: MapInfo
  canHostDuel: boolean
  serverRegion: ServerRegion
  setServerRegion: (r: ServerRegion) => void
  wagerAmount: WagerAmount
  setWagerAmount: (w: WagerAmount) => void
  serverUrl: string
  setServerUrl: (url: string) => void
  onHostOnline?: () => void
  onHost: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04, duration: 0.28 }}
      className="min-h-0 lg:col-start-2 lg:row-start-1"
    >
      <HudPanel
        className="flex h-full min-h-0 flex-col overflow-hidden p-0"
        accent="ok"
      >
        {/* Header strip */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b-[3px] border-arena-ink/80 bg-gradient-to-r from-arena-ok/20 via-arena-ok/10 to-transparent px-3 py-2.5 sm:px-3.5">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border-[2.5px] border-arena-ink bg-arena-ok shadow-[1px_2px_0_var(--arena-ink)]">
              <GameIcon src={icons.flag} className="size-4" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-black tracking-tight text-arena-fg">
                Host duel
              </h2>
              <p className="text-[11px] font-bold tracking-wide text-arena-fg/40 uppercase">
                Open lobby · first to 5
              </p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border-[2px] border-arena-ink bg-arena-panel px-1.5 py-0.5 text-[11px] font-extrabold text-arena-ok uppercase shadow-[1px_1px_0_var(--arena-ink)]">
            <GameIcon src={icons.fire} className="size-3" />
            1v1
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3 sm:p-3.5">
          {/* Match preview — map art + stake summary */}
          <div
            className={cn(
              'relative shrink-0 overflow-hidden rounded-xl border-[2.5px] shadow-[2px_3px_0_var(--arena-ink)]',
              canHostDuel ? 'border-arena-ink' : 'border-arena-danger/60',
            )}
          >
            <div className="relative h-[4.75rem] w-full sm:h-[5.25rem]">
              {selected.thumbUrl ? (
                <img
                  src={selected.thumbUrl}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-slate-600 via-slate-700 to-slate-900" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-arena-ink/90 via-arena-ink/45 to-arena-ink/10" />
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5">
                <div className="min-w-0">
                  <p className="text-[10px] font-extrabold tracking-wider text-white/55 uppercase">
                    Arena
                  </p>
                  <p className="truncate text-sm font-black text-white drop-shadow-sm">
                    {selected.name}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={cn(
                      'rounded-md border-[2px] border-white/25 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide uppercase backdrop-blur-sm',
                      canHostDuel
                        ? 'bg-arena-ok/90 text-arena-ink'
                        : 'bg-arena-danger/90 text-white',
                    )}
                  >
                    {canHostDuel ? 'Ready' : 'Training only'}
                  </span>
                  <span className="inline-flex items-center gap-0.5 rounded-md border-[2px] border-white/20 bg-black/45 px-1.5 py-0.5 text-[11px] font-black text-arena-heat backdrop-blur-sm">
                    <GameIcon src={icons.coins} className="size-2.5" />$
                    {wagerAmount}
                  </span>
                </div>
              </div>
            </div>
            {!canHostDuel && (
              <p className="border-t-[2px] border-arena-danger/40 bg-arena-danger/15 px-2.5 py-1.5 text-xs font-semibold text-arena-danger">
                Pick a duel arena below — Practice Range can&apos;t host 1v1.
              </p>
            )}
          </div>

          {/* Region */}
          <div className="shrink-0">
            <SectionLabel iconSrc={icons.location}>Region</SectionLabel>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  {
                    id: 'us-east' as ServerRegion,
                    label: 'US East',
                    sub: 'Low ping Americas',
                  },
                  {
                    id: 'eu' as ServerRegion,
                    label: 'EU',
                    sub: 'Europe & nearby',
                  },
                ] as const
              ).map((r) => {
                const active = serverRegion === r.id
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      gameAudio.uiClick()
                      setServerRegion(r.id)
                    }}
                    className={cn(
                      'flex flex-col items-start rounded-xl border-[2.5px] border-arena-ink px-2.5 py-1.5 text-left transition-all',
                      active
                        ? 'bg-arena-tech text-arena-ink shadow-[2px_3px_0_var(--arena-ink)]'
                        : 'bg-arena-surface text-arena-fg shadow-[1px_2px_0_var(--arena-ink)] hover:-translate-y-0.5 hover:bg-arena-hover',
                    )}
                  >
                    <span className="text-sm font-black tracking-wide uppercase">
                      {r.label}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] font-bold leading-tight',
                        active ? 'text-arena-ink/65' : 'text-arena-fg/40',
                      )}
                    >
                      {r.sub}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Stake chips */}
          <div className="shrink-0">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <GameIcon src={icons.trade} className="size-3.5" />
                <span className="text-xs font-extrabold tracking-wide text-arena-fg/45 uppercase">
                  Stake
                </span>
              </div>
              <span className="text-[11px] font-bold text-arena-fg/35">
                Soft currency
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {WAGER_OPTIONS.map((w, i) => {
                const active = wagerAmount === w
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => {
                      gameAudio.uiClick()
                      setWagerAmount(w)
                    }}
                    className={cn(
                      'flex flex-col items-center justify-center gap-0.5 rounded-xl border-[2.5px] border-arena-ink py-1.5 transition-all',
                      active
                        ? 'bg-arena-heat text-arena-ink shadow-[2px_3px_0_var(--arena-ink)]'
                        : 'bg-arena-surface text-arena-fg/70 shadow-[1px_2px_0_var(--arena-ink)] hover:-translate-y-0.5 hover:bg-arena-hover hover:text-arena-fg',
                    )}
                  >
                    <GameIcon
                      src={WAGER_ICONS[i] ?? icons.coins}
                      className="size-4"
                    />
                    <span className="text-sm font-black tabular-nums">
                      ${w}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Server URL — compact advanced row */}
          <div className="shrink-0">
            <SectionLabel iconSrc={icons.globe}>Server</SectionLabel>
            <div className="flex items-center gap-1.5 rounded-xl border-[2.5px] border-arena-ink bg-arena-surface px-2 py-1 shadow-[1px_2px_0_var(--arena-ink)] focus-within:border-arena-tech">
              <GameIcon src={icons.link} className="size-3.5 opacity-50" />
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent py-1 font-mono text-xs text-arena-fg outline-none placeholder:text-arena-fg/30"
                placeholder="ws://localhost:2567"
              />
            </div>
          </div>
        </div>

        {/* Footer CTA */}
        <div className="shrink-0 border-t-[3px] border-arena-ink/80 bg-arena-surface/60 px-3 py-2.5 sm:px-3.5">
          <p className="mb-2 text-center text-[11px] font-semibold leading-snug text-arena-fg/40">
            Wait on the range — duel map loads when someone joins.
          </p>
          <button
            type="button"
            disabled={!onHostOnline || !serverUrl.trim() || !canHostDuel}
            onClick={onHost}
            title={
              !canHostDuel
                ? 'Select a 1v1 map — Practice Range is training only'
                : `Host ${selected.name} · $${wagerAmount} stake`
            }
            className="group inline-flex h-12 w-full shrink-0 items-center justify-between gap-2 rounded-xl border-[3px] border-arena-ink bg-arena-ok px-3 text-arena-ink shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 disabled:pointer-events-none disabled:opacity-40 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]"
          >
            <span className="flex items-center gap-2">
              <GameIcon src={icons.flag} className="size-5" />
              <span className="text-sm font-black tracking-wide uppercase">
                Host duel
              </span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg border-[2px] border-arena-ink/30 bg-black/10 px-2 py-0.5 text-xs font-black tabular-nums">
              <GameIcon src={icons.coins} className="size-3" />${wagerAmount}
            </span>
          </button>
        </div>
      </HudPanel>
    </motion.div>
  )
}
