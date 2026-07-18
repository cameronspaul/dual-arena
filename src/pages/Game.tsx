import { MainMenu } from '@/components/game/main-menu'
import { PlayView } from '@/components/game/PlayView'
import { DEFAULT_MAP_ID, isDuelMapId } from '@/game/maps'

import { useEngineUi } from './game/useEngineUi'
import { useGameHotkeys } from './game/useGameHotkeys'
import { useGameSession } from './game/useGameSession'

export default function Game() {
  const engineUi = useEngineUi()
  const session = useGameSession({
    hud: engineUi.hud,
    onLeavePlay: engineUi.leavePlay,
    onHudReset: engineUi.resetHud,
  })
  const { adminOpen, isLocalhost } = useGameHotkeys({
    phase: session.phase,
    onlineSession: session.onlineSession,
    engine: engineUi.engine,
    hud: engineUi.hud,
    settingsOpen: engineUi.settingsOpen,
    chatOpen: engineUi.chatOpen,
    setChatOpen: engineUi.setChatOpen,
    openChat: engineUi.openChat,
    vmEdit: engineUi.vmEdit,
    levelEdit: engineUi.levelEdit,
  })

  if (session.phase === 'pick') {
    return (
      <MainMenu
        selectedId={isDuelMapId(session.mapId) ? session.mapId : DEFAULT_MAP_ID}
        onSelect={(id) => {
          if (isDuelMapId(id)) session.setMapId(id)
        }}
        skybox={session.skyboxPref}
        onSkyboxChange={session.setSkyboxPref}
        onPlay={() =>
          session.startPlay(
            isDuelMapId(session.mapId) ? session.mapId : DEFAULT_MAP_ID,
            session.skyboxPref,
          )
        }
        onPracticeRange={() =>
          session.startPlay('range', session.skyboxPref)
        }
        onTutorial={session.startTutorial}
        onHostOnline={session.startHostOnline}
        onJoinOnline={session.startJoinOnline}
        onRejoinOnline={session.startRejoinOnline}
      />
    )
  }

  const isOnline = !!session.onlineSession

  return (
    <PlayView
      mapId={session.mapId}
      sessionSkybox={session.sessionSkybox}
      onlineSession={session.onlineSession}
      hud={engineUi.hud}
      engine={engineUi.engine}
      username={session.username}
      tutorialOpen={session.tutorialOpen}
      settingsOpen={engineUi.settingsOpen}
      settingsSection={engineUi.settingsSection}
      chatOpen={engineUi.chatOpen}
      vmEdit={engineUi.vmEdit}
      levelEdit={engineUi.levelEdit}
      adminOpen={adminOpen}
      isLocalhost={isLocalhost}
      thirdPerson={engineUi.thirdPerson}
      freeCam={engineUi.freeCam}
      dummiesEnabled={engineUi.dummiesEnabled}
      onHud={engineUi.onHud}
      onEngine={engineUi.onEngine}
      onChatOpenChange={(open) => {
        if (open) engineUi.engine?.setGameplayEnabled(false)
        engineUi.setChatOpen(open)
      }}
      onOpenSettings={engineUi.openSettings}
      onSettingsOpenChange={engineUi.setSettingsOpen}
      onResume={engineUi.resumePlay}
      onOpenHelp={
        !isOnline && session.mapId === 'range' ? session.openHelp : undefined
      }
      onExit={session.backToPicker}
      onCloseTutorial={session.closeTutorial}
      onCloseVmEdit={() => engineUi.setVmEdit(false)}
      onCloseLevelEdit={() => engineUi.setLevelEdit(false)}
      onOpenLevelEdit={engineUi.openLevelEdit}
      onOpenVmEdit={engineUi.openVmEdit}
      onToggleThirdPerson={engineUi.toggleThirdPerson}
      onToggleFreeCam={engineUi.toggleFreeCam}
      onToggleDummies={engineUi.toggleDummies}
    />
  )
}
