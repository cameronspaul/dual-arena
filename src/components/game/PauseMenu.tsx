import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'

import { gameAudio } from '@/game/audio'
import { icons } from '@/lib/icons'
import { cn } from '@/lib/utils'

export interface PauseMenuProps {
  spectating: boolean
  onResume?: () => void
  onOpenSettings?: () => void
  onOpenHelp?: () => void
  onExit?: () => void
  /**
   * Online competitive match — show Offer draw / Accept-Decline / Surrender.
   * Only when the server would accept agreement actions.
   */
  onlineAgreement?: {
    /** Local player already has a pending offer out. */
    drawOfferedBySelf: boolean
    /** Opponent has offered a draw. */
    drawOfferedByOpponent: boolean
    onOfferDraw?: () => void
    onCancelDraw?: () => void
    onAcceptDraw?: () => void
    onDeclineDraw?: () => void
    onSurrender?: () => void
  } | null
}

/**
 * Full-screen pause menu when pointer lock is released (Esc).
 *
 * Must use `pointer-events-auto` — GameHud root is `pointer-events-none`.
 *
 * Resume / backdrop intentionally do NOT use `data-no-pointer-lock` so the
 * InputManager document mousedown handler can request pointer lock on the
 * same user gesture. Only non-resume controls are marked no-lock.
 */
export function PauseMenu({
  spectating,
  onResume,
  onOpenSettings,
  onOpenHelp,
  onExit,
  onlineAgreement,
}: PauseMenuProps) {
  const [confirmSurrender, setConfirmSurrender] = useState(false)

  // Stable ref so Esc listener is registered once (HUD re-renders every frame).
  const onResumeRef = useRef(onResume)
  onResumeRef.current = onResume

  // Esc → dismiss menu. Browsers usually refuse pointer lock from Escape;
  // parent still hides the menu and shows "Click to look".
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || e.repeat) return
      e.preventDefault()
      e.stopPropagation()
      onResumeRef.current?.()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  /**
   * Prefer mousedown — pointer lock needs a live user gesture.
   * Keep the handler sync so lock is requested before React unmounts the menu.
   */
  const resumeFromPointer = (e: ReactMouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    onResumeRef.current?.()
  }

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Game menu"
      onMouseDown={(e) => {
        // Backdrop only — panel chrome is not a dismiss target.
        if (e.target !== e.currentTarget) return
        resumeFromPointer(e)
      }}
    >
      <div
        data-no-pointer-lock
        className="relative w-[min(92vw,22rem)] rounded-2xl border-[3px] border-arena-ink bg-arena-panel px-6 py-6 text-center shadow-[3px_4px_0_var(--arena-ink)] ring-2 ring-arena-heat/50"
      >
        <div className="pointer-events-none absolute inset-x-3 top-0 h-2 rounded-b-full bg-arena-sheen" />

        <div className="text-2xl font-black tracking-tight text-arena-fg">
          Menu
        </div>
        <p className="mt-1.5 text-xs font-semibold text-arena-fg/50">
          Click outside or Esc to resume
        </p>

        <div className="mt-5 flex flex-col items-center gap-2">
          <MenuBtn
            variant="primary"
            onMouseDown={resumeFromPointer}
            title="Resume and lock mouse"
          >
            <MenuIcon src={icons.aim} />
            {spectating ? 'Resume look' : 'Resume'}
          </MenuBtn>

          {onOpenSettings && (
            <MenuBtn
              noPointerLock
              onClick={() => {
                gameAudio.uiClick()
                onOpenSettings()
              }}
              title="Settings"
            >
              <MenuIcon src={icons.settings} />
              Settings
            </MenuBtn>
          )}

          {onOpenHelp && (
            <MenuBtn
              noPointerLock
              onClick={() => {
                gameAudio.uiClick()
                onOpenHelp()
              }}
              title="How to play"
            >
              <MenuIcon src={icons.star} />
              Help
            </MenuBtn>
          )}

          {onlineAgreement && (
            <>
              <div className="my-1 h-px w-full bg-arena-ink/20" />

              {onlineAgreement.drawOfferedByOpponent ? (
                <div
                  data-no-pointer-lock
                  className="w-full space-y-2 rounded-xl border-2 border-arena-heat/40 bg-arena-heat/10 px-3 py-3"
                >
                  <div className="flex items-center justify-center gap-1.5 text-xs font-extrabold text-arena-fg/85">
                    <MenuIcon src={icons.trade} />
                    Opponent offers a draw
                  </div>
                  <div className="flex gap-2">
                    <MenuBtn
                      noPointerLock
                      variant="primary"
                      onClick={() => {
                        gameAudio.uiConfirm()
                        onlineAgreement.onAcceptDraw?.()
                      }}
                      title="Accept draw"
                    >
                      <MenuIcon src={icons.check} />
                      Accept
                    </MenuBtn>
                    <MenuBtn
                      noPointerLock
                      variant="danger"
                      onClick={() => {
                        gameAudio.uiClick()
                        onlineAgreement.onDeclineDraw?.()
                      }}
                      title="Decline draw"
                    >
                      <MenuIcon src={icons.x} />
                      Decline
                    </MenuBtn>
                  </div>
                </div>
              ) : onlineAgreement.drawOfferedBySelf ? (
                <MenuBtn
                  noPointerLock
                  onClick={() => {
                    gameAudio.uiClick()
                    onlineAgreement.onCancelDraw?.()
                  }}
                  title="Cancel your draw offer"
                >
                  <MenuIcon src={icons.x} />
                  Cancel draw offer
                </MenuBtn>
              ) : (
                <MenuBtn
                  noPointerLock
                  onClick={() => {
                    gameAudio.uiClick()
                    onlineAgreement.onOfferDraw?.()
                  }}
                  title="Offer a mutual draw"
                >
                  <MenuIcon src={icons.trade} />
                  Offer draw
                </MenuBtn>
              )}

              {!confirmSurrender ? (
                <MenuBtn
                  noPointerLock
                  variant="danger"
                  onClick={() => {
                    gameAudio.uiClick()
                    setConfirmSurrender(true)
                  }}
                  title="Forfeit the match"
                >
                  <MenuIcon src={icons.flag} />
                  Surrender
                </MenuBtn>
              ) : (
                <div
                  data-no-pointer-lock
                  className="w-full space-y-2 rounded-xl border-2 border-arena-danger/40 bg-arena-danger/10 px-3 py-3"
                >
                  <p className="text-xs font-extrabold text-arena-danger">
                    Forfeit? Opponent wins the match.
                  </p>
                  <div className="flex gap-2">
                    <MenuBtn
                      noPointerLock
                      variant="danger"
                      onClick={() => {
                        gameAudio.uiClick()
                        onlineAgreement.onSurrender?.()
                        setConfirmSurrender(false)
                      }}
                      title="Confirm forfeit"
                    >
                      <MenuIcon src={icons.flag} />
                      Confirm
                    </MenuBtn>
                    <MenuBtn
                      noPointerLock
                      onClick={() => {
                        gameAudio.uiClick()
                        setConfirmSurrender(false)
                      }}
                      title="Keep playing"
                    >
                      Back
                    </MenuBtn>
                  </div>
                </div>
              )}
            </>
          )}

          {onExit && (
            <MenuBtn
              noPointerLock
              variant="danger"
              onClick={() => {
                gameAudio.uiClick()
                onExit()
              }}
              title="Return to map select"
            >
              <MenuIcon src={icons.house} />
              Return home
            </MenuBtn>
          )}
        </div>
      </div>
    </div>
  )
}

function MenuIcon({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className="size-5 shrink-0 object-contain select-none drop-shadow-[0_2px_0_rgba(0,0,0,0.35)]"
    />
  )
}

function MenuBtn({
  children,
  onClick,
  onMouseDown,
  title,
  variant = 'default',
  noPointerLock = false,
}: {
  children: ReactNode
  onClick?: () => void
  onMouseDown?: (e: ReactMouseEvent) => void
  title?: string
  variant?: 'primary' | 'default' | 'danger'
  /** Skip InputManager auto re-lock (settings / exit / etc.). */
  noPointerLock?: boolean
}) {
  return (
    <button
      type="button"
      data-no-pointer-lock={noPointerLock ? '' : undefined}
      onClick={onClick}
      onMouseDown={onMouseDown}
      title={title}
      className={cn(
        'inline-flex w-full items-center justify-center gap-2 rounded-xl border-[3px] border-arena-ink px-4 py-2.5 text-center text-sm font-extrabold tracking-wide uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]',
        variant === 'primary' &&
          'bg-arena-heat py-3 text-arena-ink hover:brightness-110',
        variant === 'default' &&
          'bg-arena-panel text-arena-fg hover:bg-arena-hover',
        variant === 'danger' &&
          'bg-arena-panel text-arena-fg hover:bg-arena-danger/15',
      )}
    >
      {children}
    </button>
  )
}
