import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Keyboard,
  Mouse,
  Palette,
  Plus,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'

import { gameAudio } from '@/game/audio'
import { APPEARANCE_PARTS } from '@/game/character/appearance'
import {
  ACTION_LABELS,
  ACTION_ORDER,
  formatKeyCode,
  MAX_BINDS_PER_ACTION,
  mouseButtonCode,
  type ActionId,
} from '@/game/core/userSettings'
import { CharacterPreview } from '@/components/game/CharacterPreview'
import { icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'

/** audio | mouse (controls) | keybinds | character */
export type SettingsSection = 'audio' | 'mouse' | 'keybinds' | 'character'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * When the dialog opens, jump to this tab (e.g. "character" from the lobby
   * customize button). Ignored while already open.
   */
  initialSection?: SettingsSection
}

/**
 * Theme-aware sticker chrome — uses CSS variables so light / dark both work.
 * (Hardcoded oklch ink shadows look fine in light and invisible in dark.)
 */
const inkBorder = 'border-foreground/80 dark:border-foreground/70'
const inkShadow =
  'shadow-[2px_3px_0_color-mix(in_oklab,var(--foreground)_40%,transparent)] dark:shadow-[2px_3px_0_color-mix(in_oklab,var(--background)_85%,black)]'
const inkShadowSm =
  'shadow-[1px_2px_0_color-mix(in_oklab,var(--foreground)_30%,transparent)] dark:shadow-[1px_2px_0_color-mix(in_oklab,var(--background)_80%,black)]'
const inkShadowLg =
  'shadow-[4px_6px_0_color-mix(in_oklab,var(--foreground)_35%,transparent)] dark:shadow-[4px_6px_0_color-mix(in_oklab,var(--background)_90%,black)]'
const panelRing =
  'ring-1 ring-black/5 dark:ring-white/10'

function pct(n: number) {
  return Math.round(n * 100)
}

function sensLabel(mul: number) {
  return `${mul.toFixed(2)}×`
}

function GameIcon({ src, className }: { src: string; className?: string }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className={cn(
        'shrink-0 object-contain select-none drop-shadow-[0_1px_0_color-mix(in_oklab,var(--foreground)_25%,transparent)]',
        className,
      )}
    />
  )
}

/** Chunk sticker button — hard border + offset shadow (theme tokens). */
function StickerBtn({
  children,
  onClick,
  className,
  disabled,
  type = 'button',
  title,
  'aria-label': ariaLabel,
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
  disabled?: boolean
  type?: 'button' | 'submit'
  title?: string
  'aria-label'?: string
}) {
  return (
    <button
      type={type}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-xl border-[2.5px] bg-card px-3 py-1.5 text-xs font-extrabold tracking-wide text-foreground transition-all',
        inkBorder,
        inkShadow,
        'hover:-translate-y-0.5 hover:bg-muted active:translate-y-0.5 active:shadow-[1px_1px_0_color-mix(in_oklab,var(--foreground)_30%,transparent)]',
        'disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** Cartoon toggle — no radix. */
function StickerSwitch({
  id,
  checked,
  onCheckedChange,
  disabled,
}: {
  id?: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative h-8 w-14 shrink-0 rounded-full border-[2.5px] transition-colors',
        inkBorder,
        inkShadowSm,
        checked
          ? 'bg-primary'
          : 'bg-muted dark:bg-input',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-6 rounded-full border-[2px] bg-card transition-transform',
          'border-foreground/70 dark:border-foreground/50',
          inkShadowSm,
          checked && 'translate-x-6',
        )}
      />
    </button>
  )
}

/** Native range styled as a chunky sticker slider. */
function StickerSlider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  disabled,
  onChange,
  onCommit,
  'aria-label': ariaLabel,
}: {
  value: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  onChange: (v: number) => void
  onCommit?: () => void
  'aria-label'?: string
}) {
  const pctFill = ((value - min) / (max - min)) * 100

  return (
    <div
      className={cn(
        'relative h-3 w-full',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-0 overflow-hidden rounded-full border-[2.5px] bg-muted dark:bg-input',
          inkBorder,
          inkShadowSm,
        )}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-75"
          style={{ width: `${pctFill}%` }}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={onCommit}
        onTouchEnd={onCommit}
        onKeyUp={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onCommit?.()
        }}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-not-allowed"
      />
      <div
        className={cn(
          'pointer-events-none absolute top-1/2 z-[5] size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] bg-card',
          inkBorder,
          inkShadowSm,
        )}
        style={{ left: `${pctFill}%` }}
      />
    </div>
  )
}

function SliderRow({
  label,
  valueLabel,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  disabled,
  onCommit,
}: {
  label: string
  valueLabel: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  onCommit?: () => void
}) {
  return (
    <div className={cn('space-y-2.5', disabled && 'opacity-50')}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-extrabold tracking-wide text-foreground">
          {label}
        </span>
        <span
          className={cn(
            'rounded-lg border-[2px] bg-muted/70 px-2 py-0.5 font-mono text-xs font-bold tabular-nums text-muted-foreground dark:bg-muted/50',
            'border-foreground/55 dark:border-foreground/40',
          )}
        >
          {valueLabel}
        </span>
      </div>
      <StickerSlider
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={onChange}
        onCommit={onCommit}
        aria-label={label}
      />
    </div>
  )
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-extrabold tracking-wide text-foreground">
          {label}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  )
}

function Divider() {
  return (
    <div className="h-[2.5px] rounded-full bg-border dark:bg-foreground/15" />
  )
}

/** How long to wait after the last color-input event before committing. */
const COLOR_PICKER_DEBOUNCE_MS = 120

/**
 * Native color input with local draft UI + debounced parent commits.
 * Swatch / hex update immediately; store / 3D preview update after idle.
 * Flushes on blur and unmount so the last drag is never dropped.
 */
function DebouncedColorPicker({
  value,
  label,
  description,
  onChange,
  debounceMs = COLOR_PICKER_DEBOUNCE_MS,
}: {
  value: string
  label: string
  description: string
  onChange: (hex: string) => void
  debounceMs?: number
}) {
  const [draft, setDraft] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Latest color not yet confirmed by the `value` prop. */
  const pendingRef = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const flush = useCallback(() => {
    clearTimer()
    const pending = pendingRef.current
    if (pending == null) return
    onChangeRef.current(pending)
  }, [clearTimer])

  // External updates (reset defaults, rehydrate) — skip while we still own a pending edit
  useEffect(() => {
    if (pendingRef.current != null) {
      if (value.toLowerCase() === pendingRef.current.toLowerCase()) {
        pendingRef.current = null
      }
      return
    }
    setDraft(value)
  }, [value])

  // Flush last color on unmount
  useEffect(() => {
    return () => {
      clearTimer()
      const pending = pendingRef.current
      if (pending != null) {
        pendingRef.current = null
        onChangeRef.current(pending)
      }
    }
  }, [clearTimer])

  const scheduleCommit = useCallback(
    (hex: string) => {
      pendingRef.current = hex
      clearTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        const pending = pendingRef.current
        if (pending == null) return
        onChangeRef.current(pending)
      }, debounceMs)
    },
    [clearTimer, debounceMs],
  )

  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-xl border-[2.5px] bg-muted/40 px-3 py-2.5 transition-colors hover:bg-muted/70 dark:bg-muted/25 dark:hover:bg-muted/40',
        'border-border dark:border-foreground/20',
      )}
    >
      <span
        className={cn(
          'relative size-9 shrink-0 overflow-hidden rounded-lg border-[2.5px]',
          inkBorder,
          inkShadowSm,
        )}
        style={{ backgroundColor: draft }}
      >
        <input
          type="color"
          value={draft}
          aria-label={`${label} color`}
          onChange={(e) => {
            const hex = e.target.value
            setDraft(hex)
            scheduleCommit(hex)
          }}
          onBlur={flush}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-extrabold tracking-wide text-foreground">
          {label}
        </span>
        <span className="block text-[10px] font-semibold text-muted-foreground">
          {description}
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 rounded-md border-[2px] bg-card px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-muted-foreground',
          'border-foreground/40 dark:border-foreground/30',
        )}
      >
        {draft}
      </span>
    </label>
  )
}

export function SettingsDialog({
  open,
  onOpenChange,
  initialSection,
}: SettingsDialogProps) {
  const titleId = useId()
  const descId = useId()

  const {
    masterVolume,
    sfxVolume,
    muted,
    mouseSensitivity,
    adsSensitivity,
    invertY,
    toggleAds,
    toggleCrouch,
    toggleSprint,
    keybinds,
    setMasterVolume,
    setSfxVolume,
    setMuted,
    setMouseSensitivity,
    setAdsSensitivity,
    setInvertY,
    setToggleAds,
    setToggleCrouch,
    setToggleSprint,
    addKeybind,
    removeKeybind,
    resetKeybinds,
    resetAll,
  } = useSettingsStore()

  const characterAppearance = useAppStore((s) => s.characterAppearance)
  const setAppearancePart = useAppStore((s) => s.setAppearancePart)
  const resetCharacterAppearance = useAppStore(
    (s) => s.resetCharacterAppearance,
  )

  const [section, setSection] = useState<SettingsSection>(
    initialSection ?? 'audio',
  )
  /** Action waiting for a new bind (add mode). */
  const [listening, setListening] = useState<ActionId | null>(null)
  const wasOpenRef = useRef(false)

  const cancelListen = useCallback(() => setListening(null), [])

  const close = useCallback(() => {
    cancelListen()
    onOpenChange(false)
  }, [cancelListen, onOpenChange])

  // Apply initialSection when the dialog opens, and when the parent jumps
  // tabs while already open (e.g. tutorial O hotkey → mouse / keybinds / audio).
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setSection(initialSection ?? 'audio')
      setListening(null)
    } else if (open && initialSection) {
      setSection(initialSection)
    }
    if (!open) setListening(null)
    wasOpenRef.current = open
  }, [open, initialSection])

  // Body scroll lock while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Escape: cancel keybind listen first, else close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Listening handler (capture) owns Escape while binding
      if (listening) return
      e.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, listening, close])

  useEffect(() => {
    if (!listening) return

    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') {
        setListening(null)
        return
      }
      if (e.repeat) return
      addKeybind(listening, e.code)
      gameAudio.uiConfirm()
      setListening(null)
    }

    const onMouse = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const code = mouseButtonCode(e.button)
      if (!code) return
      addKeybind(listening, code)
      gameAudio.uiConfirm()
      setListening(null)
    }

    const onContext = (e: Event) => e.preventDefault()

    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onMouse, true)
    window.addEventListener('contextmenu', onContext, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onMouse, true)
      window.removeEventListener('contextmenu', onContext, true)
    }
  }, [listening, addKeybind])

  const nav: {
    id: SettingsSection
    label: string
    blurb: string
    icon: typeof Volume2
  }[] = [
    {
      id: 'audio',
      label: 'Audio',
      blurb: 'Volume & mute',
      icon: Volume2,
    },
    {
      id: 'mouse',
      label: 'Controls',
      blurb: 'Mouse & toggles',
      icon: Mouse,
    },
    {
      id: 'keybinds',
      label: 'Keybinds',
      blurb: 'Bindings',
      icon: Keyboard,
    },
    {
      id: 'character',
      label: 'Character',
      blurb: 'Colors',
      icon: Palette,
    },
  ]

  const activeNav = nav.find((n) => n.id === section) ?? nav[0]
  const ActiveIcon = activeNav.icon

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 text-foreground sm:p-6"
          data-settings-dialog
        >
          {/* Backdrop — stronger in dark, softer wash in light */}
          <motion.button
            type="button"
            aria-label="Close settings"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-foreground/35 backdrop-blur-[2px] dark:bg-black/65"
            onClick={() => {
              if (listening) return
              gameAudio.uiClick()
              close()
            }}
          />

          {/* Two-column panel: nav left · options right */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            initial={{ opacity: 0, scale: 0.94, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            className={cn(
              'relative flex h-[min(92svh,720px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border-[3px] bg-card text-card-foreground sm:h-[min(90svh,760px)] sm:flex-row',
              inkBorder,
              inkShadowLg,
              panelRing,
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top sheen — subtle in both themes */}
            <div className="pointer-events-none absolute inset-x-4 top-0 z-10 h-2 rounded-b-full bg-foreground/[0.04] dark:bg-white/10" />

            {/* ── Left rail ── */}
            <aside
              className={cn(
                'flex shrink-0 flex-col border-b-[3px] bg-muted/45 sm:w-52 sm:border-r-[3px] sm:border-b-0 md:w-56',
                'border-border dark:border-foreground/25 dark:bg-muted/25',
              )}
            >
              <div className="relative shrink-0 px-4 py-4 sm:px-4 sm:pt-5 sm:pb-4">
                <div className="absolute top-0 left-0 hidden h-full w-1 bg-primary sm:block" />
                <div className="flex items-center gap-2.5 pr-10 sm:pr-0">
                  <div
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-xl border-[2.5px] bg-primary',
                      inkBorder,
                      inkShadowSm,
                    )}
                  >
                    <GameIcon src={icons.settings} className="size-6" />
                  </div>
                  <div className="min-w-0">
                    <h2
                      id={titleId}
                      className="text-base font-black tracking-tight text-foreground sm:text-lg"
                    >
                      Settings
                    </h2>
                    <p
                      id={descId}
                      className="text-[10px] font-extrabold tracking-wide text-muted-foreground uppercase"
                    >
                      Saved locally
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => {
                    gameAudio.uiClick()
                    close()
                  }}
                  className={cn(
                    'absolute top-3.5 right-3 inline-flex size-9 items-center justify-center rounded-xl border-[2.5px] bg-card text-foreground transition-all hover:-translate-y-0.5 hover:bg-muted sm:hidden',
                    inkBorder,
                    inkShadowSm,
                  )}
                >
                  <X className="size-4" strokeWidth={2.75} />
                </button>
              </div>

              <nav
                className="flex gap-1.5 overflow-x-auto px-3 pb-3 sm:flex-1 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:px-3 sm:pb-3"
                aria-label="Settings sections"
              >
                {nav.map(({ id, label, blurb, icon: Icon }) => {
                  const active = section === id
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setSection(id)
                        cancelListen()
                        gameAudio.uiClick()
                      }}
                      className={cn(
                        'inline-flex shrink-0 items-center gap-2.5 rounded-xl border-[2.5px] px-3 py-2.5 text-left transition-all sm:w-full',
                        active
                          ? cn(
                              'border-foreground/85 bg-primary text-primary-foreground dark:border-foreground/60',
                              inkShadow,
                            )
                          : 'border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground dark:hover:border-foreground/25 dark:hover:bg-card/80',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-lg border-[2px]',
                          active
                            ? 'border-primary-foreground/25 bg-primary-foreground/15'
                            : 'border-border bg-muted/70 dark:border-foreground/20 dark:bg-muted/40',
                        )}
                      >
                        <Icon className="size-4" strokeWidth={2.5} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-extrabold tracking-wide uppercase">
                          {label}
                        </span>
                        <span
                          className={cn(
                            'hidden text-[10px] font-semibold sm:block',
                            active
                              ? 'text-primary-foreground/80'
                              : 'text-muted-foreground',
                          )}
                        >
                          {blurb}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </nav>

              <div className="mt-auto hidden border-t-[2.5px] border-border p-3 dark:border-foreground/15 sm:block">
                <StickerBtn
                  className="h-9 w-full border-dashed bg-transparent text-muted-foreground shadow-none hover:border-foreground/45 hover:bg-muted/50 hover:text-foreground dark:hover:bg-muted/30"
                  onClick={() => {
                    resetAll()
                    cancelListen()
                    gameAudio.uiClick()
                  }}
                >
                  <RotateCcw className="size-3.5" strokeWidth={2.5} />
                  Reset all
                </StickerBtn>
              </div>
            </aside>

            {/* ── Right content ── */}
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-card">
              <div className="flex shrink-0 items-start justify-between gap-3 border-b-[2.5px] border-border px-5 py-4 pr-14 dark:border-foreground/15 sm:pr-14">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ActiveIcon
                      className="size-4 text-primary"
                      strokeWidth={2.5}
                    />
                    <h3 className="text-base font-black tracking-tight text-foreground">
                      {activeNav.label}
                    </h3>
                  </div>
                  <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                    {section === 'audio' &&
                      'Master & SFX levels — mute without losing values.'}
                    {section === 'mouse' &&
                      'Sensitivity, invert Y, and hold vs toggle actions.'}
                    {section === 'keybinds' &&
                      'Multiple keys per action. Esc cancels capture.'}
                    {section === 'character' &&
                      'Paint face, hair, suit, trousers, shirt & tie.'}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => {
                    gameAudio.uiClick()
                    close()
                  }}
                  className={cn(
                    'absolute top-3.5 right-3.5 hidden size-9 items-center justify-center rounded-xl border-[2.5px] bg-muted/50 text-foreground transition-all hover:-translate-y-0.5 hover:bg-muted active:translate-y-0.5 sm:inline-flex',
                    inkBorder,
                    inkShadowSm,
                    'dark:bg-muted/40',
                  )}
                >
                  <X className="size-4" strokeWidth={2.75} />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {section === 'audio' && (
                  <div className="space-y-5">
                    <SettingRow
                      label="Mute all"
                      description="Silence SFX without losing your levels"
                    >
                      <div className="flex items-center gap-2">
                        {muted ? (
                          <VolumeX className="size-4 text-muted-foreground" />
                        ) : (
                          <Volume2 className="size-4 text-muted-foreground" />
                        )}
                        <StickerSwitch
                          checked={!!muted}
                          onCheckedChange={(v) => {
                            setMuted(v)
                            gameAudio.uiClick()
                          }}
                        />
                      </div>
                    </SettingRow>

                    <Divider />

                    <SliderRow
                      label="Master volume"
                      valueLabel={`${pct(masterVolume)}%`}
                      value={masterVolume}
                      onChange={setMasterVolume}
                      disabled={muted}
                      onCommit={() => gameAudio.uiClick()}
                    />
                    <SliderRow
                      label="SFX volume"
                      valueLabel={`${pct(sfxVolume)}%`}
                      value={sfxVolume}
                      onChange={setSfxVolume}
                      disabled={muted}
                      onCommit={() => gameAudio.uiClick()}
                    />
                  </div>
                )}

                {section === 'mouse' && (
                  <div className="space-y-5">
                    <SliderRow
                      label="Hip sensitivity"
                      valueLabel={sensLabel(mouseSensitivity)}
                      value={mouseSensitivity}
                      min={0.1}
                      max={3}
                      step={0.05}
                      onChange={setMouseSensitivity}
                    />
                    <SliderRow
                      label="ADS sensitivity"
                      valueLabel={sensLabel(adsSensitivity)}
                      value={adsSensitivity}
                      min={0.1}
                      max={3}
                      step={0.05}
                      onChange={setAdsSensitivity}
                    />

                    <Divider />

                    <SettingRow
                      label="Invert Y-axis"
                      description="Mouse up looks down"
                    >
                      <StickerSwitch
                        checked={!!invertY}
                        onCheckedChange={(v) => {
                          setInvertY(v)
                          gameAudio.uiClick()
                        }}
                      />
                    </SettingRow>

                    <Divider />

                    <div className="space-y-1">
                      <div className="text-[11px] font-extrabold tracking-wide text-primary uppercase">
                        Hold vs toggle
                      </div>
                      <p className="text-xs leading-relaxed font-semibold text-muted-foreground">
                        Off = hold the key. On = press once to engage, press
                        again to release.
                      </p>
                    </div>

                    <SettingRow
                      label="Toggle ADS"
                      description={
                        toggleAds
                          ? 'Press aim to scope in/out'
                          : 'Hold aim to stay scoped'
                      }
                    >
                      <StickerSwitch
                        checked={!!toggleAds}
                        onCheckedChange={(v) => {
                          setToggleAds(v)
                          gameAudio.uiClick()
                        }}
                      />
                    </SettingRow>

                    <SettingRow
                      label="Toggle crouch"
                      description={
                        toggleCrouch
                          ? 'Press crouch to stay crouched'
                          : 'Hold crouch to stay low'
                      }
                    >
                      <StickerSwitch
                        checked={!!toggleCrouch}
                        onCheckedChange={(v) => {
                          setToggleCrouch(v)
                          gameAudio.uiClick()
                        }}
                      />
                    </SettingRow>

                    <SettingRow
                      label="Toggle sprint"
                      description={
                        toggleSprint
                          ? 'Press sprint to keep running'
                          : 'Hold sprint to run'
                      }
                    >
                      <StickerSwitch
                        checked={!!toggleSprint}
                        onCheckedChange={(v) => {
                          setToggleSprint(v)
                          gameAudio.uiClick()
                        }}
                      />
                    </SettingRow>
                  </div>
                )}

                {section === 'character' && (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs leading-relaxed font-semibold text-muted-foreground">
                        Drag the preview to spin. Colors save locally and apply
                        to your third-person body.
                      </p>
                      <StickerBtn
                        className="shrink-0"
                        onClick={() => {
                          resetCharacterAppearance()
                          gameAudio.uiClick()
                        }}
                      >
                        <RotateCcw className="size-3.5" strokeWidth={2.5} />
                        Defaults
                      </StickerBtn>
                    </div>

                    <div
                      className={cn(
                        'relative h-44 overflow-hidden rounded-xl border-[2.5px] bg-gradient-to-b from-muted/40 via-muted/20 to-muted/50 sm:h-52',
                        inkBorder,
                        inkShadowSm,
                      )}
                    >
                      <CharacterPreview
                        appearance={characterAppearance}
                        animation="idle"
                        spin={false}
                        className="absolute inset-0 h-full w-full"
                      />
                      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center gap-1.5 pt-2">
                        <GameIcon src={icons.brush} className="size-3.5 opacity-80" />
                        <span className="text-[9px] font-extrabold tracking-wide text-muted-foreground uppercase">
                          Live preview
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {APPEARANCE_PARTS.map(({ id, label, description }) => (
                        <DebouncedColorPicker
                          key={id}
                          label={label}
                          description={description}
                          value={characterAppearance[id]}
                          onChange={(hex) => setAppearancePart(id, hex)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {section === 'keybinds' && (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs leading-relaxed font-semibold text-muted-foreground">
                        Click{' '}
                        <strong className="text-foreground">+</strong> then
                        press a key or mouse button. Esc cancels. Click × to
                        remove (keeps at least one).
                      </p>
                      <StickerBtn
                        className="shrink-0"
                        onClick={() => {
                          resetKeybinds()
                          cancelListen()
                          gameAudio.uiClick()
                        }}
                      >
                        <RotateCcw className="size-3.5" strokeWidth={2.5} />
                        Defaults
                      </StickerBtn>
                    </div>

                    <div className="space-y-1.5">
                      {ACTION_ORDER.map((action) => {
                        const codes = keybinds[action] ?? []
                        const active = listening === action
                        const canAdd = codes.length < MAX_BINDS_PER_ACTION
                        return (
                          <div
                            key={action}
                            className={cn(
                              'flex flex-col gap-2 rounded-xl border-[2.5px] border-transparent px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between',
                              active &&
                                cn(
                                  'border-primary/55 bg-primary/10 dark:border-primary/45 dark:bg-primary/15',
                                  inkShadowSm,
                                ),
                            )}
                          >
                            <span className="shrink-0 text-sm font-extrabold tracking-wide text-foreground">
                              {ACTION_LABELS[action]}
                            </span>
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              {codes.map((code) => (
                                <span
                                  key={code}
                                  className={cn(
                                    'inline-flex items-center gap-0.5 rounded-lg border-[2px] bg-muted/70 font-mono text-xs font-bold text-foreground dark:bg-muted/50',
                                    'border-foreground/55 dark:border-foreground/40',
                                    inkShadowSm,
                                  )}
                                >
                                  <span className="px-2 py-1">
                                    {formatKeyCode(code)}
                                  </span>
                                  {codes.length > 1 && (
                                    <button
                                      type="button"
                                      title={`Remove ${formatKeyCode(code)}`}
                                      onClick={() => {
                                        removeKeybind(action, code)
                                        gameAudio.uiClick()
                                      }}
                                      className="rounded-r-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                                    >
                                      <X
                                        className="size-3"
                                        strokeWidth={2.75}
                                      />
                                    </button>
                                  )}
                                </span>
                              ))}
                              <button
                                type="button"
                                disabled={!canAdd && !active}
                                onClick={() => {
                                  gameAudio.uiClick()
                                  setListening(active ? null : action)
                                }}
                                className={cn(
                                  'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg border-[2px] px-2 text-xs font-extrabold transition-all',
                                  active
                                    ? cn(
                                        'animate-pulse border-foreground/85 bg-primary text-primary-foreground dark:border-foreground/60',
                                        inkShadowSm,
                                      )
                                    : 'border-dashed border-foreground/40 text-muted-foreground hover:border-foreground/70 hover:bg-muted hover:text-foreground disabled:opacity-40 dark:border-foreground/30 dark:hover:border-foreground/50',
                                )}
                              >
                                {active ? (
                                  'Press…'
                                ) : (
                                  <>
                                    <Plus
                                      className="size-3.5"
                                      strokeWidth={2.75}
                                    />
                                    Add
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Mobile reset footer */}
              <div className="shrink-0 border-t-[2.5px] border-border p-3 dark:border-foreground/15 sm:hidden">
                <StickerBtn
                  className="h-9 w-full border-dashed bg-transparent text-muted-foreground shadow-none hover:bg-muted/50"
                  onClick={() => {
                    resetAll()
                    cancelListen()
                    gameAudio.uiClick()
                  }}
                >
                  <RotateCcw className="size-3.5" strokeWidth={2.5} />
                  Reset all
                </StickerBtn>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
