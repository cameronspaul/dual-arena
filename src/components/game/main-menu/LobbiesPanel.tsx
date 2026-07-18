import { motion } from 'framer-motion'

import { gameAudio } from '@/game/audio'
import { isMapId } from '@/game/maps'
import { icons } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { AUTO_JOIN_SECONDS } from './constants'
import { mapLabel } from './lobbyUtils'
import type {
  LobbyRow,
  LobbyStatus,
  LobbyWatchMode,
  OnlineLobbyJoin,
} from './types'
import { Chip, GameIcon, HudPanel, SectionLabel } from './ui'

export function LobbiesPanel({
  lobbies,
  lobbyStatus,
  lobbyError,
  lobbyWatchMode,
  setWatchMode,
  notifiedLobby,
  autoJoinTarget,
  autoJoinLeft,
  serverUrl,
  onJoinOnline,
  refreshLobbies,
  handleJoinOnline,
  cancelAutoJoin,
  dismissNotify,
  setNotifiedLobby,
}: {
  lobbies: LobbyRow[]
  lobbyStatus: LobbyStatus
  lobbyError: string | null
  lobbyWatchMode: LobbyWatchMode
  setWatchMode: (mode: LobbyWatchMode) => void
  notifiedLobby: LobbyRow | null
  autoJoinTarget: LobbyRow | null
  autoJoinLeft: number
  serverUrl: string
  onJoinOnline?: (lobby: OnlineLobbyJoin) => void
  refreshLobbies: (opts?: { silent?: boolean }) => Promise<void>
  handleJoinOnline: (lobby: OnlineLobbyJoin) => void
  cancelAutoJoin: () => void
  dismissNotify: () => void
  setNotifiedLobby: (lobby: LobbyRow | null) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06, duration: 0.28 }}
      className="min-h-0 lg:col-start-3 lg:row-start-1"
    >
      <HudPanel
        className="flex h-full min-h-0 flex-col overflow-hidden p-3 sm:p-3.5"
        accent="tech"
      >
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <GameIcon src={icons.friend} className="size-4" />
            <span className="text-base font-extrabold">Lobbies</span>
          </div>
          <button
            type="button"
            onClick={() => {
              gameAudio.uiClick()
              void refreshLobbies()
            }}
            className="inline-flex h-7 items-center gap-1 rounded-lg border-[2px] border-arena-ink bg-arena-surface px-2 text-xs font-extrabold text-arena-fg/70 uppercase shadow-[1px_2px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-arena-hover hover:text-arena-fg"
          >
            <GameIcon src={icons.reberth} className="size-3" />
            Refresh
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
          {lobbyStatus === 'loading' && lobbies.length === 0 && (
            <p className="rounded-lg border-[2px] border-dashed border-arena-ink/40 bg-arena-surface/50 px-2.5 py-3 text-center text-sm font-semibold text-arena-fg/45">
              Loading lobbies…
            </p>
          )}
          {lobbyStatus === 'error' && (
            <p className="rounded-lg border-[2px] border-arena-danger/40 bg-arena-danger/10 px-2.5 py-3 text-center text-sm font-semibold text-arena-danger">
              {lobbyError ?? 'Could not reach server'}
            </p>
          )}
          {lobbyStatus === 'ok' && lobbies.length === 0 && (
            <p className="rounded-lg border-[2px] border-dashed border-arena-ink/40 bg-arena-surface/50 px-2.5 py-3 text-center text-sm font-semibold text-arena-fg/45">
              No open lobbies — host one, or turn on Auto join below.
            </p>
          )}
          {lobbies.map((lobby) => (
            <div
              key={lobby.matchId}
              className={cn(
                'flex items-center gap-2 rounded-xl border-[2.5px] border-arena-ink bg-arena-surface px-2 py-1.5 shadow-[1px_2px_0_var(--arena-ink)]',
                (autoJoinTarget?.matchId === lobby.matchId ||
                  notifiedLobby?.matchId === lobby.matchId) &&
                  'ring-2 ring-arena-heat/60',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-extrabold text-arena-fg">
                    {lobby.hostName || 'Host'}
                  </span>
                  <span className="shrink-0 rounded border border-arena-ink/50 bg-arena-panel px-1 py-px text-[10px] font-bold text-arena-fg/50 uppercase">
                    {lobby.playerCount}/{lobby.maxPlayers}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-arena-fg/50">
                  <span className="truncate text-arena-tech">
                    {mapLabel(lobby.mapId)}
                  </span>
                  {lobby.wager > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-arena-heat">
                      <GameIcon src={icons.coins} className="size-2.5" />$
                      {lobby.wager}
                    </span>
                  )}
                  <span className="truncate font-mono text-[11px] text-arena-fg/35">
                    {lobby.matchId}
                  </span>
                </div>
              </div>
              <button
                type="button"
                disabled={!onJoinOnline || !serverUrl.trim()}
                onClick={() =>
                  handleJoinOnline({
                    matchId: lobby.matchId,
                    mapId: isMapId(lobby.mapId) ? lobby.mapId : undefined,
                    wager: lobby.wager,
                  })
                }
                className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border-[2.5px] border-arena-ink bg-arena-ok px-2.5 text-xs font-black tracking-wide text-arena-ink uppercase shadow-[1px_2px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 disabled:pointer-events-none disabled:opacity-40 active:translate-y-0.5 active:shadow-none"
              >
                Join
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2 shrink-0 border-t-2 border-arena-ink/35 pt-2">
          <SectionLabel iconSrc={icons.bolt}>Auto join</SectionLabel>
          <div className="mb-1.5 flex gap-1">
            {(
              [
                { id: 'off', label: 'Off' },
                { id: 'notify', label: 'Notify' },
                { id: 'auto', label: 'Auto' },
              ] as const
            ).map((opt) => (
              <Chip
                key={opt.id}
                active={lobbyWatchMode === opt.id}
                onClick={() => setWatchMode(opt.id)}
                className="h-7 min-w-0 flex-1 px-1.5 text-xs"
                title={
                  opt.id === 'off'
                    ? 'No alerts for new lobbies'
                    : opt.id === 'notify'
                      ? 'Play a queue-pop sound when a lobby opens'
                      : 'Sound + auto-join the newest lobby in 5s'
                }
              >
                {opt.label}
              </Chip>
            ))}
          </div>

          {lobbyWatchMode === 'off' && (
            <p className="text-xs font-semibold leading-snug text-arena-fg/40">
              Silent list. Switch to Notify for a queue-pop sound, or Auto to
              join in {AUTO_JOIN_SECONDS}s.
            </p>
          )}

          {lobbyWatchMode === 'notify' &&
            !notifiedLobby &&
            !autoJoinTarget && (
              <p className="text-xs font-semibold leading-snug text-arena-fg/40">
                Live updates (even in background) — new lobbies play the queue
                sting twice and show a banner.
              </p>
            )}

          {lobbyWatchMode === 'auto' && !autoJoinTarget && (
            <p className="text-xs font-semibold leading-snug text-arena-fg/40">
              Live updates (even in background) — sting loops until join;
              auto-joins after {AUTO_JOIN_SECONDS}s (cancel anytime).
            </p>
          )}

          {autoJoinTarget && (
            <div className="mt-1.5 rounded-xl border-[2.5px] border-arena-ink bg-arena-heat/15 px-2 py-1.5 shadow-[1px_2px_0_var(--arena-ink)]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-black tracking-wide text-arena-heat uppercase">
                    Queue pop · joining in {autoJoinLeft}s
                  </p>
                  <p className="mt-0.5 truncate text-sm font-extrabold text-arena-fg">
                    {autoJoinTarget.hostName || 'Host'} ·{' '}
                    <span className="text-arena-tech">
                      {mapLabel(autoJoinTarget.mapId)}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={cancelAutoJoin}
                  className="inline-flex h-7 shrink-0 items-center justify-center rounded-lg border-[2px] border-arena-ink bg-arena-surface px-2 text-xs font-black tracking-wide text-arena-fg uppercase shadow-[1px_2px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-arena-hover"
                >
                  Cancel
                </button>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full border border-arena-ink/40 bg-arena-surface">
                <div
                  className="h-full rounded-full bg-arena-heat transition-[width] duration-1000 ease-linear"
                  style={{
                    width: `${(autoJoinLeft / AUTO_JOIN_SECONDS) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {notifiedLobby && !autoJoinTarget && (
            <div className="mt-1.5 rounded-xl border-[2.5px] border-arena-ink bg-arena-ok/15 px-2 py-1.5 shadow-[1px_2px_0_var(--arena-ink)]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-black tracking-wide text-arena-ok uppercase">
                    New lobby
                  </p>
                  <p className="mt-0.5 truncate text-sm font-extrabold text-arena-fg">
                    {notifiedLobby.hostName || 'Host'} ·{' '}
                    <span className="text-arena-tech">
                      {mapLabel(notifiedLobby.mapId)}
                    </span>
                    {notifiedLobby.wager > 0 && (
                      <span className="text-arena-heat">
                        {' '}
                        · ${notifiedLobby.wager}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={dismissNotify}
                    className="inline-flex h-7 items-center justify-center rounded-lg border-[2px] border-arena-ink bg-arena-surface px-2 text-xs font-black tracking-wide text-arena-fg/70 uppercase shadow-[1px_2px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-arena-hover"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    disabled={!onJoinOnline || !serverUrl.trim()}
                    onClick={() => {
                      setNotifiedLobby(null)
                      handleJoinOnline({
                        matchId: notifiedLobby.matchId,
                        mapId: isMapId(notifiedLobby.mapId)
                          ? notifiedLobby.mapId
                          : undefined,
                        wager: notifiedLobby.wager,
                      })
                    }}
                    className="inline-flex h-7 items-center justify-center gap-1 rounded-lg border-[2.5px] border-arena-ink bg-arena-ok px-2 text-xs font-black tracking-wide text-arena-ink uppercase shadow-[1px_2px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
                  >
                    Join
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </HudPanel>
    </motion.div>
  )
}
