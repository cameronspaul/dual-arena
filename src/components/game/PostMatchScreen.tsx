/**
 * Full-screen post-match result + rematch / leave / change map.
 * Soft stake preview only (no escrow yet).
 */
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { gameAudio } from '@/game/audio'
import type { GameEngine } from '@/game/engine/GameEngine'
import type { HudSnapshot } from '@/game/types'
import { icons } from '@/lib/icons'
import { cn } from '@/lib/utils'

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
      <div className="pointer-events-none absolute inset-x-3 top-0 h-2 rounded-b-full bg-arena-sheen" />
      {children}
    </div>
  )
}

function matchEndTitle(reason: HudSnapshot['matchEndReason']): string {
  if (reason === 'forfeit' || reason === 'disconnect') return 'Forfeit'
  if (reason === 'draw') return 'Agreed draw'
  if (reason === 'time') return 'Time'
  return 'Match over'
}

const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-xl border-[3px] border-arena-ink bg-arena-heat px-4 py-2.5 text-xs font-extrabold tracking-wide text-arena-ink uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)] disabled:pointer-events-none disabled:opacity-50'

const secondaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-xl border-[3px] border-arena-ink bg-arena-panel px-3 py-2 text-xs font-extrabold tracking-wide text-arena-fg uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-arena-hover active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]'

export type PostMatchScreenProps = {
  hud: HudSnapshot
  engine?: GameEngine | null
  /** Soft stake from the open lobby (display-only). */
  wager?: number
  /** Leave room → map picker. */
  onLeave?: () => void
  /** Leave room → map picker (same exit; label differs). */
  onChangeMap?: () => void
}

function stakeLine(
  wager: number,
  winnerId: string | null,
  localId: string | null,
): { label: string; tone: 'win' | 'lose' | 'even' | 'none' } {
  if (!wager || wager <= 0) {
    return { label: 'No stake', tone: 'none' }
  }
  if (winnerId == null) {
    return { label: `Stake $${wager} · Even`, tone: 'even' }
  }
  if (localId && winnerId === localId) {
    return { label: `Stake $${wager} · You +$${wager}`, tone: 'win' }
  }
  return { label: `Stake $${wager} · You −$${wager}`, tone: 'lose' }
}

export function PostMatchScreen({
  hud,
  engine,
  wager = 0,
  onLeave,
  onChangeMap,
}: PostMatchScreenProps) {
  const firstTo = hud.matchFirstTo || 7
  const localId = engine?.getLocalPlayerId() ?? null
  const outcome =
    !hud.matchWinnerId
      ? 'Draw'
      : hud.matchWinnerId === localId
        ? 'You win!'
        : 'You lose'
  const stakeAmount =
    wager > 0
      ? wager
      : (engine?.getMatchEnd()?.wager ?? 0)
  const stake = stakeLine(stakeAmount, hud.matchWinnerId, localId)
  const online = Boolean(engine?.isOnlineMode())
  const canRematch = online && hud.rematchAvailable
  const localVoted = hud.localRematchReady
  const enemyVoted = hud.enemyRematchReady

  let rematchHint: string | null = null
  if (canRematch) {
    if (localVoted && enemyVoted) {
      rematchHint = 'Starting…'
    } else if (localVoted) {
      rematchHint = 'Waiting for opponent…'
    } else if (enemyVoted) {
      rematchHint = 'Opponent wants rematch'
    } else {
      rematchHint = 'Same map · same stake'
    }
  } else if (online && hud.matchEndReason === 'disconnect') {
    rematchHint = 'Opponent disconnected'
  } else if (online && !hud.rematchAvailable && hud.matchEndReason) {
    rematchHint = 'Opponent left'
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <HudPanel
        className="w-full max-w-sm px-8 py-7 text-center"
        accent={
          hud.matchEndReason === 'draw'
            ? 'tech'
            : outcome === 'You win!'
              ? 'ok'
              : outcome === 'You lose'
                ? 'danger'
                : 'heat'
        }
      >
        <GameIcon
          src={
            hud.matchEndReason === 'draw' ? icons.trade : icons.trophy
          }
          className="mx-auto size-14"
        />
        <div className="mt-2 text-xs font-extrabold tracking-wide text-arena-fg/50 uppercase">
          {matchEndTitle(hud.matchEndReason)}
        </div>
        <div className="mt-1 text-3xl font-black text-arena-heat drop-shadow-[0_2px_0_var(--arena-ink)]">
          {outcome}
        </div>
        <div className="mt-2 text-lg font-extrabold tabular-nums text-arena-fg/85">
          {hud.kills}
          <span className="mx-1.5 text-arena-fg/30">–</span>
          {hud.enemyKills}
          <span className="ml-2 text-xs font-bold text-arena-fg/40">
            (first to {firstTo})
          </span>
        </div>

        <div
          className={cn(
            'mt-3 text-sm font-extrabold tabular-nums',
            stake.tone === 'win' && 'text-arena-ok',
            stake.tone === 'lose' && 'text-arena-danger',
            stake.tone === 'even' && 'text-arena-fg/70',
            stake.tone === 'none' && 'text-arena-fg/40',
          )}
        >
          <span className="inline-flex items-center justify-center gap-1.5">
            {stake.tone !== 'none' && (
              <GameIcon src={icons.coins} className="size-5" />
            )}
            {stake.label}
          </span>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          {canRematch && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => {
                  gameAudio.uiConfirm()
                  engine?.toggleRematch()
                }}
                className={cn(
                  primaryBtn,
                  localVoted && 'bg-arena-ok/90',
                )}
              >
                <GameIcon src={icons.reberth} className="size-5" />
                {localVoted ? 'Cancel rematch' : 'Rematch'}
              </button>
              {rematchHint && (
                <div className="text-[11px] font-bold tracking-wide text-arena-fg/45 uppercase">
                  {rematchHint}
                  {enemyVoted && !localVoted && (
                    <span className="ml-1 text-arena-ok">●</span>
                  )}
                  {localVoted && !enemyVoted && (
                    <span className="ml-1 text-arena-heat">●</span>
                  )}
                </div>
              )}
            </div>
          )}

          {!canRematch && rematchHint && (
            <div className="text-[11px] font-bold tracking-wide text-arena-fg/45 uppercase">
              {rematchHint}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2">
            {onChangeMap && (
              <button
                type="button"
                onClick={() => {
                  gameAudio.uiClick()
                  onChangeMap()
                }}
                className={secondaryBtn}
              >
                <GameIcon src={icons.map} className="size-5" />
                Change map
              </button>
            )}
            {onLeave && (
              <button
                type="button"
                onClick={() => {
                  gameAudio.uiClick()
                  onLeave()
                }}
                className={secondaryBtn}
              >
                <GameIcon src={icons.house} className="size-5" />
                Leave
              </button>
            )}
          </div>
        </div>
      </HudPanel>
    </motion.div>
  )
}
