import { useEffect, useMemo, useState } from 'react'

import {
  SettingsDialog,
  type SettingsSection,
} from '@/components/SettingsDialog'
import { gameAudio } from '@/game/audio'
import { isDuelMapId, MAP_LIST } from '@/game/maps'
import { useAppStore } from '@/stores/useAppStore'
import { cn } from '@/lib/utils'

import { BalancePanel } from './BalancePanel'
import { PICKER_MAPS } from './constants'
import { HostDuelPanel } from './HostDuelPanel'
import { LobbiesPanel } from './LobbiesPanel'
import { MainMenuBackdrop } from './MainMenuBackdrop'
import { MainMenuHeader } from './MainMenuHeader'
import { MapSelectPanel } from './MapSelectPanel'
import { OperatorPanel } from './OperatorPanel'
import type { MainMenuProps } from './types'
import { useLobbyBrowser } from './useLobbyBrowser'

export function MainMenu({
  selectedId,
  onSelect,
  skybox,
  onSkyboxChange,
  onPlay,
  onPracticeRange,
  onTutorial,
  onHostOnline,
  onJoinOnline,
  onRejoinOnline,
}: MainMenuProps) {
  const {
    theme,
    toggleTheme,
    username,
    setUsername,
    characterAppearance,
    serverRegion,
    setServerRegion,
    wagerAmount,
    setWagerAmount,
    balance,
    serverUrl,
    setServerUrl,
    setMatchId,
    rejoinSession,
    clearRejoinSession,
  } = useAppStore()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<
    SettingsSection | undefined
  >(undefined)
  /** Seconds left on the homepage rejoin CTA (ticks every 250ms). */
  const [rejoinLeft, setRejoinLeft] = useState(0)

  const lobby = useLobbyBrowser({
    serverUrl,
    onJoinOnline,
    setMatchId,
  })

  // Practice range is never a selectable picker state — fall back to first arena
  const selected =
    PICKER_MAPS.find((m) => m.id === selectedId) ??
    PICKER_MAPS[0] ??
    MAP_LIST.find((m) => m.duelEligible)!
  const canHostDuel = isDuelMapId(selectedId)

  /** Lobby backdrop: selected map art when available, else a duel-map thumb. */
  const backdropUrl = useMemo(() => {
    if (selected.thumbUrl) return selected.thumbUrl
    const withThumb = PICKER_MAPS.find((m) => m.thumbUrl)
    return withThumb?.thumbUrl ?? '/maps/thumbs/arena-v3.png'
  }, [selected.thumbUrl])

  // Tick rejoin countdown; drop stale sessions when the window ends.
  useEffect(() => {
    const tick = () => {
      const exp = rejoinSession?.expiresAt
      if (exp == null) {
        setRejoinLeft(0)
        return
      }
      const left = Math.max(0, Math.ceil((exp - Date.now()) / 1000))
      setRejoinLeft(left)
      if (left <= 0) clearRejoinSession()
    }
    tick()
    const id = window.setInterval(tick, 250)
    return () => window.clearInterval(id)
  }, [rejoinSession, clearRejoinSession])

  const canRejoin =
    Boolean(onRejoinOnline) &&
    rejoinSession != null &&
    rejoinSession.expiresAt != null &&
    rejoinLeft > 0

  const handleRejoin = () => {
    if (!canRejoin) return
    gameAudio.uiConfirm()
    onRejoinOnline?.()
  }

  const handleHostOnline = () => {
    if (!canHostDuel) return
    gameAudio.uiConfirm()
    onHostOnline?.()
  }

  return (
    <div className="relative flex h-svh w-full flex-col overflow-hidden bg-arena-void text-arena-fg">
      <MainMenuBackdrop backdropUrl={backdropUrl} />

      <MainMenuHeader
        theme={theme}
        toggleTheme={toggleTheme}
        canRejoin={canRejoin}
        rejoinLeft={rejoinLeft}
        rejoinMatchId={rejoinSession?.matchId}
        onRejoin={handleRejoin}
        onOpenSettings={() => {
          setSettingsSection(undefined)
          setSettingsOpen(true)
        }}
      />

      {/*
        Layout (lg+):
          [ Balance ] [ Host duel ] [ Lobbies ] [ Operator ]
          [ Map 1×2 + sky ………………… ]           [ Community ]
      */}
      <main
        className={cn(
          'relative z-10 mx-auto grid min-h-0 w-full max-w-[90rem] flex-1 gap-2.5 overflow-hidden p-2.5 sm:gap-3 sm:p-3 md:p-4',
          'grid-cols-1',
          'lg:grid-cols-[minmax(10rem,12.5rem)_minmax(13rem,1fr)_minmax(14rem,1.15fr)_minmax(15rem,18rem)]',
          'lg:grid-rows-[minmax(0,1fr)_auto]',
        )}
      >
        <BalancePanel balance={balance} />

        <HostDuelPanel
          selected={selected}
          canHostDuel={canHostDuel}
          serverRegion={serverRegion}
          setServerRegion={setServerRegion}
          wagerAmount={wagerAmount}
          setWagerAmount={setWagerAmount}
          serverUrl={serverUrl}
          setServerUrl={setServerUrl}
          onHostOnline={onHostOnline}
          onHost={handleHostOnline}
        />

        <LobbiesPanel
          lobbies={lobby.lobbies}
          lobbyStatus={lobby.lobbyStatus}
          lobbyError={lobby.lobbyError}
          lobbyWatchMode={lobby.lobbyWatchMode}
          setWatchMode={lobby.setWatchMode}
          notifiedLobby={lobby.notifiedLobby}
          autoJoinTarget={lobby.autoJoinTarget}
          autoJoinLeft={lobby.autoJoinLeft}
          serverUrl={serverUrl}
          onJoinOnline={onJoinOnline}
          refreshLobbies={lobby.refreshLobbies}
          handleJoinOnline={lobby.handleJoinOnline}
          cancelAutoJoin={lobby.cancelAutoJoin}
          dismissNotify={lobby.dismissNotify}
          setNotifiedLobby={lobby.setNotifiedLobby}
        />

        <MapSelectPanel
          selectedId={selectedId}
          onSelect={onSelect}
          skybox={skybox}
          onSkyboxChange={onSkyboxChange}
          onPlay={onPlay}
          onPracticeRange={onPracticeRange}
          onTutorial={onTutorial}
        />

        <OperatorPanel
          username={username}
          setUsername={setUsername}
          characterAppearance={characterAppearance}
          onOpenCharacterSettings={(section) => {
            setSettingsSection(section)
            setSettingsOpen(true)
          }}
        />
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialSection={settingsSection}
      />
    </div>
  )
}
