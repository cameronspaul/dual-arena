import { GameCanvas } from '@/components/game/GameCanvas'
import { GameHud } from '@/components/game/GameHud'
import { LevelEditor } from '@/components/game/LevelEditor'
import { TutorialOverlay } from '@/components/game/TutorialOverlay'
import { ViewmodelEditor } from '@/components/game/ViewmodelEditor'
import {
  SettingsDialog,
  type SettingsSection,
} from '@/components/SettingsDialog'
import type { GameEngine } from '@/game/engine'
import type { OnlineSessionOpts } from '@/game/engine'
import { getMap, isMapId, type MapId } from '@/game/maps'
import type { SkyboxId } from '@/game/scene/skyboxes'
import type { HudSnapshot } from '@/game/types'

import { AdminToolsStrip } from './AdminToolsStrip'
import { LevelEditCrosshair } from './LevelEditCrosshair'
import { MapSessionBadge } from './MapSessionBadge'

export type PlayViewProps = {
  mapId: MapId
  sessionSkybox: SkyboxId
  onlineSession: OnlineSessionOpts | null
  hud: HudSnapshot | null
  engine: GameEngine | null
  username: string
  tutorialOpen: boolean
  settingsOpen: boolean
  settingsSection: SettingsSection | undefined
  chatOpen: boolean
  vmEdit: boolean
  levelEdit: boolean
  adminOpen: boolean
  isLocalhost: boolean
  thirdPerson: boolean
  freeCam: boolean
  dummiesEnabled: boolean
  onHud: (snap: HudSnapshot) => void
  onEngine: (eng: GameEngine | null) => void
  onChatOpenChange: (open: boolean) => void
  onOpenSettings: (section?: SettingsSection) => void
  onSettingsOpenChange: (open: boolean) => void
  onResume: () => void
  onOpenHelp?: () => void
  onExit: () => void
  onCloseTutorial: () => void
  onCloseVmEdit: () => void
  onCloseLevelEdit: () => void
  onOpenLevelEdit: () => void
  onOpenVmEdit: () => void
  onToggleThirdPerson: () => void
  onToggleFreeCam: () => void
  onToggleDummies: () => void
}

/** Full-screen play shell: canvas, HUD, editors, admin tools, settings. */
export function PlayView({
  mapId,
  sessionSkybox,
  onlineSession,
  hud,
  engine,
  username,
  tutorialOpen,
  settingsOpen,
  settingsSection,
  chatOpen,
  vmEdit,
  levelEdit,
  adminOpen,
  isLocalhost,
  thirdPerson,
  freeCam,
  dummiesEnabled,
  onHud,
  onEngine,
  onChatOpenChange,
  onOpenSettings,
  onSettingsOpenChange,
  onResume,
  onOpenHelp,
  onExit,
  onCloseTutorial,
  onCloseVmEdit,
  onCloseLevelEdit,
  onOpenLevelEdit,
  onOpenVmEdit,
  onToggleThirdPerson,
  onToggleFreeCam,
  onToggleDummies,
}: PlayViewProps) {
  const mapName = getMap(mapId).name
  const isOnline = !!onlineSession
  /** Duel arena for the open lobby (may differ from visual wait-room map). */
  const lobbyDuelMapId =
    onlineSession?.mapId && isMapId(onlineSession.mapId)
      ? onlineSession.mapId
      : mapId
  const lobbyMapName = getMap(lobbyDuelMapId).name

  return (
    <div className="relative h-svh w-full overflow-hidden bg-black">
      <GameCanvas
        mapId={mapId}
        skybox={sessionSkybox}
        online={onlineSession}
        onHud={onHud}
        onEngine={onEngine}
      />
      {!vmEdit && !levelEdit && (
        <GameHud
          hud={hud}
          engine={isOnline ? engine : null}
          chatOpen={chatOpen}
          settingsOpen={settingsOpen}
          tutorialOpen={tutorialOpen}
          onChatOpenChange={onChatOpenChange}
          onOpenSettings={() => onOpenSettings()}
          onResume={onResume}
          onOpenHelp={onOpenHelp}
          onExit={onExit}
          onReady={(ready) => engine?.setReady(ready) ?? false}
          lobby={
            isOnline && onlineSession
              ? {
                  matchId: onlineSession.matchId,
                  mapId: lobbyDuelMapId,
                  mapName: lobbyMapName,
                  wager: onlineSession.wager ?? 0,
                  createdAt: onlineSession.createdAt ?? null,
                  hostName: onlineSession.hostName,
                  waitOnRange: Boolean(onlineSession.waitOnRange),
                  localName: username.trim() || 'You',
                }
              : null
          }
        />
      )}

      {/* Guided how-to-play (offline practice range only) */}
      {!vmEdit && !levelEdit && !isOnline && mapId === 'range' && (
        <TutorialOverlay
          open={tutorialOpen}
          hud={hud}
          settingsOpen={settingsOpen}
          onOpenSettings={(section) => onOpenSettings(section)}
          onClose={onCloseTutorial}
        />
      )}

      {/* Map + sky badge — top-left; Help lives in Esc pause menu */}
      {!vmEdit && !levelEdit && !tutorialOpen && (
        <MapSessionBadge
          mapName={mapName}
          skybox={sessionSkybox}
          isOnline={isOnline}
        />
      )}

      {levelEdit && <LevelEditCrosshair />}

      {vmEdit ? (
        <ViewmodelEditor
          engine={engine}
          open={vmEdit}
          onClose={onCloseVmEdit}
        />
      ) : levelEdit ? (
        <LevelEditor
          engine={engine}
          open={levelEdit}
          mapName={mapName}
          onClose={onCloseLevelEdit}
        />
      ) : (
        isLocalhost &&
        adminOpen && (
          <AdminToolsStrip
            isOnline={isOnline}
            thirdPerson={thirdPerson}
            freeCam={freeCam}
            dummiesEnabled={dummiesEnabled}
            onBackToPicker={onExit}
            onOpenLevelEdit={onOpenLevelEdit}
            onOpenVmEdit={onOpenVmEdit}
            onToggleThirdPerson={onToggleThirdPerson}
            onToggleFreeCam={onToggleFreeCam}
            onToggleDummies={onToggleDummies}
          />
        )
      )}

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={onSettingsOpenChange}
        initialSection={settingsSection}
      />
    </div>
  )
}
