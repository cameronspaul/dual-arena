import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { gameAudio } from '@/game/audio'
import type { GameEngine } from '@/game/engine/GameEngine'
import type { HudSnapshot } from '@/game/types'
import { icons } from '@/lib/icons'
import { cn } from '@/lib/utils'

/** Lobby details for the online waiting / host chrome (from page state). */
export type GameHudLobbyInfo = {
  matchId: string
  mapId: string
  mapName: string
  wager: number
  /** Wall-clock ms when the lobby was created; null if unknown. */
  createdAt: number | null
  hostName?: string
  /** Host is hanging on the practice range until someone joins. */
  waitOnRange?: boolean
  /** Local player display name. */
  localName?: string
}

/** Cartoon sticker panel — matches GameHud chrome. */
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

function formatLobbyAge(createdAt: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - createdAt) / 1000))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h ${rm}m`
}

function formatMatchClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

function localScoreColor(team: HudSnapshot['teamColor']): string {
  if (team === 'blue') return 'text-sky-300'
  if (team === 'red') return 'text-arena-heat'
  return 'text-arena-heat'
}

function enemyScoreColor(team: HudSnapshot['teamColor']): string {
  // Opponent is the other side of the local team color.
  if (team === 'blue') return 'text-arena-heat'
  if (team === 'red') return 'text-sky-300'
  return 'text-arena-fg'
}

function resolveEnemyName(
  lobby: GameHudLobbyInfo | null | undefined,
  localName: string,
  waiting: boolean,
): string {
  if (waiting) return '…'
  const host = lobby?.hostName?.trim()
  if (host && host.toLowerCase() !== localName.toLowerCase()) return host
  return 'Opponent'
}

export type LobbyHudProps = {
  hud: HudSnapshot
  lobby?: GameHudLobbyInfo | null
  /** Local display name (from settings / username). */
  localName?: string
  onReady?: (ready: boolean) => boolean | void
  engine?: GameEngine | null
  className?: string
}

/**
 * Top-center lobby / match HUD — score, matchup, ready-up, and phase status.
 * Replaces the old floating waiting / pregame / round-over panels.
 */
export function LobbyHud({
  hud,
  lobby = null,
  localName: localNameProp,
  onReady,
  engine = null,
  className,
}: LobbyHudProps) {
  const [now, setNow] = useState(() => Date.now())

  const online = hud.matchPhase != null
  const waiting = Boolean(hud.matchWaiting)
  const inPregame = hud.matchPhase === 'pregame'
  const inCountdown = hud.matchPhase === 'countdown'
  const inRoundReset = hud.matchPhase === 'round_reset'
  const inRejoin = hud.matchPhase === 'rejoin'
  const phaseTimer = Math.max(0, Math.ceil(hud.matchPhaseTimer))
  const firstTo = hud.matchFirstTo || 7
  /** Dead free-cam (knocked out) — owns the status strip over round-reset etc. */
  const eliminated = Boolean(hud.spectating && !hud.alive)
  /** Voluntary free-cam while still alive. */
  const freeCam = Boolean(hud.spectating && hud.alive)
  const respawnIn = Math.max(0, Math.ceil(hud.respawnIn))

  const localName =
    (localNameProp ?? lobby?.localName)?.trim() || 'You'
  const enemyName = resolveEnemyName(lobby, localName, waiting)

  useEffect(() => {
    if (!waiting || !lobby?.createdAt) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [waiting, lobby?.createdAt])

  const lobbyAge =
    lobby?.createdAt != null ? formatLobbyAge(lobby.createdAt, now) : null

  const panelAccent: 'heat' | 'tech' | 'danger' | 'ok' =
    eliminated || inRejoin
      ? 'danger'
      : freeCam || waiting || inPregame
        ? 'tech'
        : inRoundReset
          ? 'heat'
          : 'heat'

  const localId = engine?.getLocalPlayerId() ?? null
  const drawFromId = hud.pendingDrawFromId
  const showDraw =
    online &&
    Boolean(drawFromId) &&
    !hud.matchEndReason &&
    !waiting &&
    !eliminated
  const drawFromSelf = Boolean(localId && drawFromId === localId)

  // Offline practice: elims chip, expands when dead / free-cam.
  if (!online) {
    return (
      <div className={cn('pointer-events-none', className)}>
        <HudPanel
          className={cn(
            'px-5 py-2 text-center',
            eliminated || freeCam
              ? 'min-w-[min(20rem,92vw)] max-w-[min(26rem,94vw)]'
              : 'min-w-[9.5rem]',
          )}
          accent={panelAccent}
        >
          <div className="flex items-center justify-center gap-2">
            <GameIcon src={icons.aim} className="size-6" />
            <span className="text-4xl font-black leading-none tabular-nums text-arena-heat drop-shadow-[0_2px_0_var(--arena-ink)]">
              {hud.kills}
            </span>
          </div>
          <div className="mt-0.5 text-[10px] font-extrabold tracking-wide text-arena-fg/45 uppercase">
            elims
          </div>
          <AnimatePresence mode="wait">
            {eliminated && (
              <EliminatedStatus
                key="elim-offline"
                deathReason={hud.deathReason}
                respawnIn={respawnIn}
              />
            )}
            {freeCam && !eliminated && (
              <FreeCamStatus key="freecam-offline" />
            )}
          </AnimatePresence>
        </HudPanel>
      </div>
    )
  }

  return (
    <div className={cn('pointer-events-none', className)}>
      <HudPanel
        className="min-w-[min(22rem,92vw)] max-w-[min(28rem,94vw)] px-4 py-2.5 text-center"
        accent={panelAccent}
      >
        {/* Matchup row — names over scores */}
        <div className="flex items-stretch justify-center gap-2 sm:gap-3">
          {/* Local */}
          <div className="flex min-w-0 flex-1 flex-col items-center justify-center">
            <div
              className={cn(
                'max-w-full truncate text-[10px] font-extrabold tracking-wide uppercase',
                localScoreColor(hud.teamColor),
              )}
              title={localName}
            >
              {localName}
            </div>
            <div
              className={cn(
                'mt-0.5 text-4xl font-black leading-none tabular-nums drop-shadow-[0_2px_0_var(--arena-ink)]',
                localScoreColor(hud.teamColor),
              )}
            >
              {waiting ? '–' : hud.kills}
            </div>
            {(inPregame || waiting) && (
              <ReadyPill
                ready={waiting ? false : hud.localReady}
                label={waiting ? 'Host' : hud.localReady ? 'Ready' : 'Not ready'}
                active={!waiting && hud.localReady}
              />
            )}
          </div>

          {/* Center divider */}
          <div className="flex shrink-0 flex-col items-center justify-center px-0.5">
            <span className="text-lg font-black text-arena-fg/25">vs</span>
            <span className="mt-0.5 text-xl font-black text-arena-fg/20">–</span>
          </div>

          {/* Enemy */}
          <div className="flex min-w-0 flex-1 flex-col items-center justify-center">
            <div
              className={cn(
                'max-w-full truncate text-[10px] font-extrabold tracking-wide uppercase',
                waiting ? 'text-arena-fg/40' : enemyScoreColor(hud.teamColor),
              )}
              title={enemyName}
            >
              {enemyName}
            </div>
            <div
              className={cn(
                'mt-0.5 text-4xl font-black leading-none tabular-nums drop-shadow-[0_2px_0_var(--arena-ink)]',
                waiting ? 'text-arena-fg/25' : enemyScoreColor(hud.teamColor),
              )}
            >
              {waiting ? '–' : hud.enemyKills}
            </div>
            {(inPregame || waiting) && (
              <ReadyPill
                ready={waiting ? false : hud.enemyReady}
                label={
                  waiting
                    ? 'Open'
                    : hud.enemyReady
                      ? 'Ready'
                      : 'Not ready'
                }
                active={!waiting && hud.enemyReady}
              />
            )}
          </div>
        </div>

        {/* Meta strip — first-to, clock, map */}
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[10px] font-extrabold tracking-wide text-arena-fg/45 uppercase">
          <span>FT{firstTo}</span>
          {hud.matchTimeLeft != null && !waiting && !inPregame && (
            <>
              <span className="text-arena-fg/25">·</span>
              <span className="tabular-nums text-arena-tech">
                {formatMatchClock(hud.matchTimeLeft)}
              </span>
            </>
          )}
          {lobby?.mapName && (waiting || inPregame) && (
            <>
              <span className="text-arena-fg/25">·</span>
              <span className="inline-flex max-w-[8rem] items-center gap-0.5 truncate normal-case tracking-normal text-arena-tech">
                <GameIcon src={icons.map} className="size-3" />
                {lobby.mapName}
              </span>
            </>
          )}
          {lobby && lobby.wager > 0 && (waiting || inPregame) && (
            <>
              <span className="text-arena-fg/25">·</span>
              <span className="inline-flex items-center gap-0.5 tabular-nums text-arena-heat">
                <GameIcon src={icons.coins} className="size-3" />${lobby.wager}
              </span>
            </>
          )}
        </div>

        {/* Phase / action body — eliminated owns the strip while dead */}
        <AnimatePresence mode="wait">
          {eliminated && (
            <EliminatedStatus
              key="elim"
              deathReason={hud.deathReason}
              respawnIn={respawnIn}
            />
          )}

          {freeCam && !eliminated && <FreeCamStatus key="freecam" />}

          {waiting && !eliminated && (
            <motion.div
              key="waiting"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-2 border-t-2 border-arena-ink/30 pt-2">
                <div className="flex items-center justify-center gap-1.5">
                  <span className="size-1.5 animate-pulse rounded-full bg-arena-ok" />
                  <span className="text-[11px] font-extrabold tracking-wide text-arena-tech uppercase">
                    Waiting for opponent
                  </span>
                </div>
                {lobby?.waitOnRange && (
                  <p className="mt-0.5 text-[10px] font-semibold text-arena-fg/45">
                    Warm up on the range — duel starts when they join.
                  </p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[10px] font-semibold text-arena-fg/45">
                  {lobby?.matchId && (
                    <span className="inline-flex items-center gap-1">
                      <GameIcon src={icons.link} className="size-3" />
                      <span className="font-mono text-arena-fg/70">
                        {lobby.matchId}
                      </span>
                    </span>
                  )}
                  {lobbyAge && (
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <GameIcon src={icons.bolt} className="size-3" />
                      {lobbyAge}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {inPregame && !waiting && !eliminated && (
            <motion.div
              key="pregame"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-2 border-t-2 border-arena-ink/30 pt-2">
                <div className="flex items-center justify-center gap-1.5 text-[11px] font-extrabold tracking-wide text-arena-tech uppercase">
                  <GameIcon src={icons.fire} className="size-3.5" />
                  Pre-game warmup
                </div>
                <p className="mt-0.5 text-[10px] font-semibold text-arena-fg/50">
                  Free fire — first to {firstTo} when both ready.
                </p>
                {onReady && (
                  <button
                    type="button"
                    title={hud.localReady ? 'Unready (Y)' : 'Ready up (Y)'}
                    onClick={() => {
                      if (onReady(!hud.localReady) !== false) {
                        gameAudio.uiConfirm()
                      }
                    }}
                    className={cn(
                      'pointer-events-auto mt-2 inline-flex items-center gap-1.5 rounded-xl border-[3px] border-arena-ink px-4 py-1.5 text-[11px] font-extrabold tracking-wide uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]',
                      hud.localReady
                        ? 'bg-arena-sheen text-arena-fg/80 hover:bg-arena-hover'
                        : 'bg-arena-ok text-arena-ink hover:brightness-110',
                    )}
                  >
                    <GameIcon
                      src={hud.localReady ? icons.x : icons.check}
                      className="size-3.5"
                    />
                    {hud.localReady ? 'Unready' : 'Ready up'}
                    <kbd className="ml-0.5 rounded border-2 border-arena-ink/40 bg-black/15 px-1 py-0.5 text-[9px] font-black tracking-normal normal-case opacity-80">
                      Y
                    </kbd>
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {inRoundReset && !eliminated && (
            <motion.div
              key="round-reset"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-2 border-t-2 border-arena-ink/30 pt-2">
                <div className="flex items-center justify-center gap-1.5 text-[11px] font-extrabold tracking-wide text-arena-heat uppercase">
                  <GameIcon src={icons.boom} className="size-3.5" />
                  Round over
                </div>
                <div className="mt-0.5 text-sm font-extrabold tabular-nums text-arena-fg/80">
                  Reset in {phaseTimer}s
                </div>
              </div>
            </motion.div>
          )}

          {inCountdown && phaseTimer > 0 && !eliminated && (
            <motion.div
              key={`cd-${phaseTimer}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-2 border-t-2 border-arena-ink/30 pt-2">
                <div className="flex items-center justify-center gap-1.5 text-[11px] font-extrabold tracking-wide text-arena-fg/60 uppercase">
                  <GameIcon src={icons.bolt} className="size-3.5" />
                  Round starting
                </div>
                <div className="text-3xl font-black tabular-nums text-arena-fg drop-shadow-[0_2px_0_var(--arena-ink)]">
                  {phaseTimer}
                </div>
              </div>
            </motion.div>
          )}

          {inRejoin && !waiting && !eliminated && (
            <motion.div
              key="rejoin"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-2 border-t-2 border-arena-ink/30 pt-2">
                <div className="flex items-center justify-center gap-1.5 text-[11px] font-extrabold tracking-wide text-arena-danger uppercase">
                  <GameIcon src={icons.globe} className="size-3.5" />
                  Match paused
                </div>
                <div className="mt-0.5 text-sm font-extrabold text-arena-fg/90">
                  Opponent reconnecting…
                </div>
                <div className="mt-0.5 text-[10px] font-semibold text-arena-fg/50">
                  Forfeit in{' '}
                  <span className="font-black tabular-nums text-arena-heat">
                    {formatMatchClock(phaseTimer)}
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          {showDraw && (
            <motion.div
              key="draw"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="pointer-events-auto mt-2 border-t-2 border-arena-ink/30 pt-2">
                <div className="flex items-center justify-center gap-1.5 text-[11px] font-extrabold tracking-wide text-arena-fg/60 uppercase">
                  <GameIcon src={icons.trade} className="size-3.5" />
                  {drawFromSelf ? 'Draw offered' : 'Draw offer'}
                </div>
                {drawFromSelf ? (
                  <>
                    <p className="mt-0.5 text-[11px] font-extrabold text-arena-fg/80">
                      Waiting for opponent…
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        gameAudio.uiClick()
                        engine?.cancelDraw()
                      }}
                      className="mt-1.5 inline-flex items-center gap-1 rounded-lg border-2 border-arena-ink bg-arena-panel px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-arena-fg uppercase shadow-[2px_2px_0_var(--arena-ink)] hover:bg-arena-hover"
                    >
                      <GameIcon src={icons.x} className="size-3" />
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <p className="mt-0.5 text-[11px] font-extrabold text-arena-fg/80">
                      Opponent offers a draw
                    </p>
                    <div className="mt-1.5 flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          gameAudio.uiConfirm()
                          engine?.acceptDraw()
                        }}
                        title="Accept draw (Y)"
                        className="inline-flex items-center gap-1 rounded-lg border-2 border-arena-ink bg-arena-heat px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-arena-ink uppercase shadow-[2px_2px_0_var(--arena-ink)] hover:brightness-110"
                      >
                        <GameIcon src={icons.check} className="size-3" />
                        Accept
                        <span className="rounded border border-arena-ink/40 bg-black/10 px-1 py-px text-[9px] font-black leading-none tracking-normal normal-case">
                          Y
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          gameAudio.uiClick()
                          engine?.declineDraw()
                        }}
                        title="Decline draw (N)"
                        className="inline-flex items-center gap-1 rounded-lg border-2 border-arena-ink bg-arena-panel px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-arena-fg uppercase shadow-[2px_2px_0_var(--arena-ink)] hover:bg-arena-danger/15"
                      >
                        <GameIcon src={icons.x} className="size-3" />
                        Decline
                        <span className="rounded border border-arena-ink/40 bg-black/10 px-1 py-px text-[9px] font-black leading-none tracking-normal normal-case">
                          N
                        </span>
                      </button>
                    </div>
                    <p className="mt-1 text-[9px] font-semibold text-arena-fg/40">
                      Or open Esc menu
                    </p>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </HudPanel>
    </div>
  )
}

function ReadyPill({
  ready,
  label,
  active,
}: {
  ready: boolean
  label: string
  active: boolean
}) {
  return (
    <span
      className={cn(
        'mt-1 inline-flex max-w-full items-center gap-0.5 truncate rounded-md border px-1.5 py-0.5 text-[8px] font-extrabold tracking-wide uppercase',
        active || ready
          ? 'border-arena-ok/60 bg-arena-ok/15 text-arena-ok'
          : 'border-arena-ink/40 bg-arena-surface/80 text-arena-fg/45',
      )}
    >
      {(active || ready) && <GameIcon src={icons.check} className="size-2.5" />}
      {label}
    </span>
  )
}

function EliminatedStatus({
  deathReason,
  respawnIn,
}: {
  deathReason: HudSnapshot['deathReason']
  respawnIn: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="mt-2 border-t-2 border-arena-ink/30 pt-2">
        <div className="flex items-center justify-center gap-1.5 text-[11px] font-extrabold tracking-wide text-arena-danger uppercase">
          <GameIcon src={icons.shocked} className="size-3.5" />
          Knocked out
        </div>
        <div className="mt-0.5 text-sm font-extrabold tracking-tight text-arena-fg">
          {deathReason === 'fall' ? 'Fell out of the world' : 'Eliminated'}
        </div>
        <div className="mt-1 text-[11px] font-bold text-arena-fg/70">
          Free cam · respawn in{' '}
          <span className="text-base font-black tabular-nums text-arena-heat drop-shadow-[0_2px_0_var(--arena-ink)]">
            {respawnIn}
          </span>
          s
        </div>
        <p className="mt-0.5 text-[10px] font-semibold text-arena-fg/40">
          WASD + mouse · Space / crouch fly · Sprint boost
        </p>
      </div>
    </motion.div>
  )
}

function FreeCamStatus() {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="mt-2 border-t-2 border-arena-ink/30 pt-2">
        <div className="flex items-center justify-center gap-1.5 text-[11px] font-extrabold tracking-wide text-arena-tech uppercase">
          <GameIcon src={icons.jetpack} className="size-3.5" />
          Free cam
        </div>
        <p className="mt-0.5 text-[10px] font-semibold text-arena-fg/50">
          WASD + mouse · Space / crouch fly · Sprint boost
        </p>
      </div>
    </motion.div>
  )
}
