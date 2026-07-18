import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

import type { SettingsSection } from '@/components/SettingsDialog'
import { gameAudio } from '@/game/audio'
import { SNIPER } from '@/game/core/config'
import type { HudSnapshot } from '@/game/types'
import {
  buildTutorialSteps,
  createTutorialProgress,
  isStepComplete,
  TUTORIAL_OPEN_SETTINGS_CODE,
  TUTORIAL_OPEN_SETTINGS_LABEL,
  type TutorialProgress,
  type TutorialSettingsSection,
  type TutorialStep,
} from '@/game/tutorial/steps'
import { icons } from '@/lib/icons'
import { cn } from '@/lib/utils'

const TUTORIAL_DONE_KEY = 'duel.tutorial.complete'

/** Min gap between manual continues (keyboard spam / double-click). */
const ADVANCE_COOLDOWN_MS = 220

export function hasCompletedTutorial(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_DONE_KEY) === '1'
  } catch {
    return false
  }
}

export function markTutorialComplete(): void {
  try {
    localStorage.setItem(TUTORIAL_DONE_KEY, '1')
  } catch {
    /* ignore quota / private mode */
  }
}

interface TutorialOverlayProps {
  open: boolean
  hud: HudSnapshot | null
  onClose: () => void
  /** Fired once when the player finishes the last step. */
  onComplete?: () => void
  /**
   * Open settings to a tab (mouse / keybinds / audio).
   * Called from settings steps via O (or the step’s open hotkey).
   */
  onOpenSettings?: (section: SettingsSection) => void
  /** When true, Enter does not advance (user is in the settings dialog). */
  settingsOpen?: boolean
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

function stepIcon(step: TutorialStep): string {
  return icons[step.icon] ?? icons.star
}

function toSettingsSection(
  s: TutorialSettingsSection,
): SettingsSection {
  return s
}

/**
 * Guided how-to-play panel for offline practice.
 * Large top-left card; action steps auto-advance; settings steps open via O.
 */
export function TutorialOverlay({
  open,
  hud,
  onClose,
  onComplete,
  onOpenSettings,
  settingsOpen = false,
}: TutorialOverlayProps) {
  const steps = useMemo(() => buildTutorialSteps(), [])
  const [index, setIndex] = useState(0)
  const progressRef = useRef<TutorialProgress>(createTutorialProgress(null))
  const finishedRef = useRef(false)
  const lastAdvanceAtRef = useRef(0)
  const autoDoneRef = useRef(new Set<string>())
  const indexRef = useRef(0)
  const totalRef = useRef(steps.length)
  const stepRef = useRef(steps[0]!)
  const onCloseRef = useRef(onClose)
  const onCompleteRef = useRef(onComplete)
  const onOpenSettingsRef = useRef(onOpenSettings)
  const settingsOpenRef = useRef(settingsOpen)

  indexRef.current = index
  totalRef.current = steps.length
  stepRef.current = steps[index] ?? steps[0]!
  onCloseRef.current = onClose
  onCompleteRef.current = onComplete
  onOpenSettingsRef.current = onOpenSettings
  settingsOpenRef.current = settingsOpen

  const step = steps[index] ?? steps[0]!
  const total = steps.length
  const isLast = index >= total - 1
  const progressPct = ((index + (step.kind === 'finish' ? 1 : 0)) / total) * 100

  const finishTutorial = useCallback(() => {
    if (!finishedRef.current) {
      finishedRef.current = true
      markTutorialComplete()
      onCompleteRef.current?.()
    }
    onCloseRef.current()
  }, [])

  const goNext = useCallback(
    (from: 'manual' | 'auto') => {
      const i = indexRef.current
      const n = totalRef.current
      if (i >= n - 1) {
        finishTutorial()
        return
      }
      if (from === 'manual') {
        gameAudio.uiClick()
      } else {
        gameAudio.uiConfirm()
      }
      setIndex(i + 1)
    },
    [finishTutorial],
  )

  const advanceManual = useCallback(() => {
    // Don't steal Enter while the user is in Settings (keybind capture, sliders).
    if (settingsOpenRef.current) return
    const now = performance.now()
    if (now - lastAdvanceAtRef.current < ADVANCE_COOLDOWN_MS) return
    lastAdvanceAtRef.current = now
    goNext('manual')
  }, [goNext])

  const openStepSettings = useCallback(() => {
    const s = stepRef.current
    if (s.kind !== 'settings' || !s.settingsSection) return
    gameAudio.uiClick()
    onOpenSettingsRef.current?.(toSettingsSection(s.settingsSection))
  }, [])

  const back = useCallback(() => {
    gameAudio.uiClick()
    setIndex((i) => Math.max(0, i - 1))
  }, [])

  const skipAll = useCallback(() => {
    gameAudio.uiClick()
    finishTutorial()
  }, [finishTutorial])

  // Reset when reopened
  useEffect(() => {
    if (!open) return
    setIndex(0)
    progressRef.current = createTutorialProgress(null)
    finishedRef.current = false
    lastAdvanceAtRef.current = 0
    autoDoneRef.current = new Set()
  }, [open])

  // Snapshot ammo/hit baseline when the step changes
  useEffect(() => {
    if (!open) return
    progressRef.current.ammoAtStepStart = hud?.ammo ?? SNIPER.magSize
    progressRef.current.hitIdAtStepStart = hud?.lastHitId ?? 0
    // eslint-disable-next-line react-hooks/exhaustive-deps -- baseline only on step change
  }, [open, index])

  /**
   * Auto-advance when the live HUD satisfies the step.
   * Armed once per step id; timer is not cancelled on later HUD ticks
   * (HUD only re-renders when hudKey changes, so we must not need many ticks).
   */
  useEffect(() => {
    if (!open || !hud) return
    const cur = steps[index]
    if (!cur || cur.kind !== 'action') return
    if (autoDoneRef.current.has(cur.id)) return
    if (!isStepComplete(cur, hud, progressRef.current)) return

    autoDoneRef.current.add(cur.id)
    const stepIndex = index
    window.setTimeout(() => {
      if (indexRef.current !== stepIndex) return
      goNext('auto')
    }, 200)
  }, [open, hud, index, steps, goNext])

  /**
   * Keyboard while tutorial is open (capture phase, works with pointer lock):
   * - Enter → continue / skip step (blocked while settings dialog is open)
   * - Space is never continue — reserved for jump
   * - O → open the settings tab for settings steps
   */
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'Escape') return

      const cur = stepRef.current
      const openCode = cur.openSettingsCode ?? TUTORIAL_OPEN_SETTINGS_CODE

      // Open the matching settings page (works even if dialog already open)
      if (cur.kind === 'settings' && e.code === openCode) {
        e.preventDefault()
        e.stopPropagation()
        openStepSettings()
        return
      }

      const isEnter = e.code === 'Enter' || e.code === 'NumpadEnter'
      if (!isEnter) return

      // While settings are open, leave keys to the dialog (keybind capture, etc.)
      if (settingsOpenRef.current) return

      e.preventDefault()
      e.stopPropagation()
      advanceManual()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, advanceManual, openStepSettings])

  if (!open) return null

  const isSettingsStep = step.kind === 'settings'
  const continueKeys = ['Enter']

  return (
    <div className="pointer-events-none absolute inset-0 z-40 select-none">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-black/55 via-black/25 to-transparent" />

      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          initial={{ opacity: 0, x: -16, y: -8 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, x: -10, y: -4 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-auto absolute top-3 left-3 w-[min(28rem,calc(100vw-1.5rem))] sm:top-4 sm:left-4 sm:w-[min(34rem,calc(100vw-2rem))]"
        >
          <div className="relative max-h-[min(88vh,42rem)] overflow-y-auto rounded-2xl border-[3px] border-arena-ink bg-arena-panel shadow-[4px_6px_0_var(--arena-ink)] ring-2 ring-arena-tech/45 sm:max-h-[min(90vh,46rem)]">
            <div className="pointer-events-none absolute inset-x-4 top-0 h-2.5 rounded-b-full bg-arena-sheen" />

            <div className="h-2 overflow-hidden rounded-t-[0.9rem] bg-arena-ink/15">
              <motion.div
                className="h-full bg-arena-tech"
                initial={false}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.25 }}
              />
            </div>

            <div className="p-4 sm:p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border-[3px] border-arena-ink bg-arena-surface shadow-[2px_3px_0_var(--arena-ink)] sm:size-14">
                    <GameIcon src={stepIcon(step)} className="size-7 sm:size-8" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold tracking-wide text-arena-tech uppercase sm:text-sm">
                      Tutorial · {index + 1}/{total}
                    </div>
                    <h2 className="text-xl font-black tracking-tight text-arena-fg sm:text-2xl">
                      {step.title}
                    </h2>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={skipAll}
                  title="Skip tutorial"
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border-[2.5px] border-arena-ink/50 bg-arena-surface text-arena-fg/55 transition-colors hover:bg-arena-hover hover:text-arena-fg"
                >
                  <GameIcon src={icons.x} className="size-4" />
                </button>
              </div>

              <p className="text-base font-semibold leading-snug text-arena-fg/80 sm:text-lg sm:leading-snug">
                {step.body}
              </p>

              {step.bullets && step.bullets.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {step.bullets.map((b) => (
                    <li
                      key={b}
                      className="flex items-start gap-2 text-sm font-bold text-arena-fg/90 sm:text-base"
                    >
                      <GameIcon
                        src={icons.check}
                        className="mt-0.5 size-4 shrink-0 opacity-80"
                      />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              )}

              {step.objective && (
                <div className="mt-4 flex items-center gap-2.5 rounded-xl border-[3px] border-arena-ink bg-arena-surface px-3 py-2.5">
                  <span className="inline-flex size-2.5 shrink-0 animate-pulse rounded-full bg-arena-heat shadow-[0_0_0_3px_color-mix(in_oklab,var(--arena-heat)_35%,transparent)]" />
                  <span className="text-sm font-extrabold tracking-wide text-arena-heat uppercase sm:text-base">
                    {step.objective}
                  </span>
                </div>
              )}

              {isSettingsStep && (
                <button
                  type="button"
                  onClick={openStepSettings}
                  className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border-[3px] border-arena-ink bg-arena-tech px-4 text-sm font-black tracking-wide text-arena-ink uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]"
                >
                  <GameIcon src={icons.settings} className="size-5" />
                  Open settings
                  <kbd className="rounded-md border-[2px] border-arena-ink/70 bg-arena-ink/10 px-2 py-0.5 font-mono text-xs font-black tracking-normal text-arena-ink normal-case">
                    {TUTORIAL_OPEN_SETTINGS_LABEL}
                  </kbd>
                </button>
              )}

              {settingsOpen && isSettingsStep && (
                <p className="mt-2 text-sm font-bold text-arena-tech">
                  Settings open — Esc to close, then Enter to continue.
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={back}
                  disabled={index === 0}
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border-[3px] border-arena-ink bg-arena-surface px-4 text-sm font-extrabold tracking-wide text-arena-fg/70 uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-arena-hover hover:text-arena-fg disabled:pointer-events-none disabled:opacity-35 active:translate-y-0.5 active:shadow-none"
                >
                  <GameIcon src={icons.leftArrow} className="size-4" />
                  Back
                </button>

                <div className="flex-1" />

                <button
                  type="button"
                  onClick={advanceManual}
                  disabled={settingsOpen}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border-[3px] border-arena-ink bg-arena-heat px-5 text-sm font-black tracking-wide text-arena-ink uppercase shadow-[3px_4px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 disabled:pointer-events-none disabled:opacity-45 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]"
                  title={
                    settingsOpen
                      ? 'Close settings (Esc) first, then continue'
                      : step.kind === 'action'
                        ? 'Press Enter to skip, or complete the objective'
                        : isSettingsStep
                          ? `Press ${TUTORIAL_OPEN_SETTINGS_LABEL} for settings, Enter to continue`
                          : 'Press Enter to continue'
                  }
                >
                  {isLast ? (
                    <>
                      <GameIcon src={icons.check} className="size-5" />
                      Finish
                    </>
                  ) : (
                    <>Continue</>
                  )}
                  <span className="inline-flex items-center gap-1">
                    {continueKeys.map((k) => (
                      <kbd
                        key={k}
                        className="rounded-md border-[2px] border-arena-ink/70 bg-arena-ink/10 px-2 py-0.5 font-mono text-xs font-black tracking-normal text-arena-ink normal-case"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
