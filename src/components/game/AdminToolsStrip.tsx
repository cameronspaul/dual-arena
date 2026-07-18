import { icons } from '@/lib/icons'

/** Cartoon sticker chrome — matches GameHud / public/icons outline language. */
const devBtn =
  'pointer-events-auto rounded-xl border-[3px] border-arena-ink bg-arena-panel px-3 py-1.5 text-xs font-extrabold tracking-wide text-arena-fg shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-arena-hover active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]'
const devBtnOn =
  'pointer-events-auto rounded-xl border-[3px] border-arena-ink bg-arena-heat px-3 py-1.5 text-xs font-extrabold tracking-wide text-arena-ink shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]'

export type AdminToolsStripProps = {
  isOnline: boolean
  thirdPerson: boolean
  freeCam: boolean
  dummiesEnabled: boolean
  onBackToPicker: () => void
  onOpenLevelEdit: () => void
  onOpenVmEdit: () => void
  onToggleThirdPerson: () => void
  onToggleFreeCam: () => void
  onToggleDummies: () => void
}

/** Localhost-only bottom-left admin strip (toggled with L). */
export function AdminToolsStrip({
  isOnline,
  thirdPerson,
  freeCam,
  dummiesEnabled,
  onBackToPicker,
  onOpenLevelEdit,
  onOpenVmEdit,
  onToggleThirdPerson,
  onToggleFreeCam,
  onToggleDummies,
}: AdminToolsStripProps) {
  return (
    <div className="absolute bottom-3 left-3 z-40 flex max-w-[min(96vw,42rem)] flex-wrap items-center gap-2">
      <span className="pointer-events-none rounded-lg border-[2.5px] border-arena-ink bg-arena-heat px-2 py-1 text-[10px] font-extrabold tracking-wide text-arena-ink uppercase shadow-[1px_2px_0_var(--arena-ink)]">
        Admin · L
      </span>
      <button
        type="button"
        onClick={onBackToPicker}
        className={devBtn}
        title="Return to map select"
      >
        <span className="inline-flex items-center gap-1.5">
          <img
            src={icons.map}
            alt=""
            aria-hidden
            draggable={false}
            className="size-4 object-contain"
          />
          Change map
        </span>
      </button>
      {!isOnline && (
        <>
          <button type="button" onClick={onOpenLevelEdit} className={devBtn}>
            Level editor
          </button>
          <button type="button" onClick={onOpenVmEdit} className={devBtn}>
            Viewmodel editor
          </button>
        </>
      )}
      <button
        type="button"
        onClick={onToggleThirdPerson}
        className={thirdPerson ? devBtnOn : devBtn}
        title="Toggle over-the-shoulder third-person camera"
      >
        {thirdPerson ? 'Third person: on' : 'Third person'}
      </button>
      {!isOnline && (
        <>
          <button
            type="button"
            onClick={onToggleFreeCam}
            className={freeCam ? devBtnOn : devBtn}
            title={
              freeCam
                ? 'Exit free cam (while dead: respawn now)'
                : 'Fly freely — WASD, Space/crouch, sprint boost'
            }
          >
            {freeCam ? 'Free cam: on' : 'Free cam'}
          </button>
          <button
            type="button"
            onClick={onToggleDummies}
            className={dummiesEnabled ? devBtn : devBtnOn}
            title="Turn practice dummies fully off (no AI, anims, hitscan, or drawing)"
          >
            {dummiesEnabled ? 'Dummies: on' : 'Dummies: off'}
          </button>
        </>
      )}
    </div>
  )
}
