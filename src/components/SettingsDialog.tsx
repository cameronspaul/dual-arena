import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Keyboard,
  Mouse,
  Plus,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'

import { gameAudio } from '@/game/audio'
import {
  ACTION_LABELS,
  ACTION_ORDER,
  formatKeyCode,
  MAX_BINDS_PER_ACTION,
  mouseButtonCode,
  type ActionId,
} from '@/game/core/userSettings'
import { icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/useSettingsStore'

type Section = 'audio' | 'mouse' | 'keybinds'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

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
        'shrink-0 object-contain select-none drop-shadow-[0_2px_0_rgba(0,0,0,0.25)]',
        className,
      )}
    />
  )
}

/** Chunk sticker button — hard ink border + offset shadow. */
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
        'inline-flex items-center justify-center gap-1.5 rounded-xl border-[2.5px] border-foreground/85 bg-card px-3 py-1.5 text-xs font-extrabold tracking-wide text-foreground shadow-[2px_3px_0_oklch(0.2_0.03_260/_0.45)] transition-all',
        'hover:-translate-y-0.5 hover:bg-muted active:translate-y-0.5 active:shadow-[1px_1px_0_oklch(0.2_0.03_260/_0.45)]',
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
        'relative h-8 w-14 shrink-0 rounded-full border-[2.5px] border-foreground/85 shadow-[2px_2px_0_oklch(0.2_0.03_260/_0.4)] transition-colors',
        checked ? 'bg-primary' : 'bg-muted',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 size-6 rounded-full border-[2px] border-foreground/80 bg-card shadow-[1px_1px_0_oklch(0.2_0.03_260/_0.35)] transition-transform',
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
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full border-[2.5px] border-foreground/85 bg-muted shadow-[1px_2px_0_oklch(0.2_0.03_260/_0.3)]">
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
      {/* Visible thumb (follows value; input is invisible hit target) */}
      <div
        className="pointer-events-none absolute top-1/2 z-[5] size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-foreground/90 bg-card shadow-[1px_2px_0_oklch(0.2_0.03_260/_0.45)]"
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
        <span className="text-sm font-extrabold tracking-wide">{label}</span>
        <span className="rounded-lg border-[2px] border-foreground/70 bg-muted/50 px-2 py-0.5 font-mono text-xs font-bold tabular-nums text-muted-foreground">
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
        <div className="text-sm font-extrabold tracking-wide">{label}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  )
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const titleId = useId()
  const descId = useId()

  const {
    masterVolume,
    sfxVolume,
    muted,
    mouseSensitivity,
    adsSensitivity,
    invertY,
    keybinds,
    setMasterVolume,
    setSfxVolume,
    setMuted,
    setMouseSensitivity,
    setAdsSensitivity,
    setInvertY,
    addKeybind,
    removeKeybind,
    resetKeybinds,
    resetAll,
  } = useSettingsStore()

  const [section, setSection] = useState<Section>('audio')
  /** Action waiting for a new bind (add mode). */
  const [listening, setListening] = useState<ActionId | null>(null)

  const cancelListen = useCallback(() => setListening(null), [])

  const close = useCallback(() => {
    cancelListen()
    onOpenChange(false)
  }, [cancelListen, onOpenChange])

  useEffect(() => {
    if (!open) setListening(null)
  }, [open])

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
    id: Section
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
      label: 'Mouse',
      blurb: 'Sensitivity',
      icon: Mouse,
    },
    {
      id: 'keybinds',
      label: 'Keybinds',
      blurb: 'Controls',
      icon: Keyboard,
    },
  ]

  const activeNav = nav.find((n) => n.id === section) ?? nav[0]
  const ActiveIcon = activeNav.icon

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          {/* Backdrop */}
          <motion.button
            type="button"
            aria-label="Close settings"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
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
            className="relative flex h-[min(90svh,560px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border-[3px] border-foreground/85 bg-card text-card-foreground shadow-[4px_6px_0_oklch(0.15_0.03_260/_0.55)] sm:h-[min(86svh,580px)] sm:flex-row"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top sheen */}
            <div className="pointer-events-none absolute inset-x-4 top-0 z-10 h-2 rounded-b-full bg-white/10 dark:bg-white/5" />

            {/* ── Left rail ── */}
            <aside className="flex shrink-0 flex-col border-b-[3px] border-foreground/75 bg-muted/35 sm:w-52 sm:border-r-[3px] sm:border-b-0 md:w-56">
              <div className="relative shrink-0 px-4 py-4 sm:px-4 sm:pt-5 sm:pb-4">
                <div className="absolute top-0 left-0 hidden h-full w-1 bg-primary sm:block" />
                <div className="flex items-center gap-2.5 pr-10 sm:pr-0">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border-[2.5px] border-foreground/85 bg-primary shadow-[2px_2px_0_oklch(0.2_0.03_260/_0.45)]">
                    <GameIcon src={icons.settings} className="size-6" />
                  </div>
                  <div className="min-w-0">
                    <h2
                      id={titleId}
                      className="text-base font-black tracking-tight sm:text-lg"
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
                {/* Close on mobile (header); desktop uses right-pane close */}
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => {
                    gameAudio.uiClick()
                    close()
                  }}
                  className="absolute top-3.5 right-3 inline-flex size-9 items-center justify-center rounded-xl border-[2.5px] border-foreground/80 bg-card text-foreground shadow-[2px_2px_0_oklch(0.2_0.03_260/_0.35)] transition-all hover:-translate-y-0.5 hover:bg-muted sm:hidden"
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
                          ? 'border-foreground/90 bg-primary text-primary-foreground shadow-[2px_3px_0_oklch(0.2_0.03_260/_0.5)]'
                          : 'border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-lg border-[2px]',
                          active
                            ? 'border-primary-foreground/30 bg-primary-foreground/15'
                            : 'border-foreground/20 bg-muted/60',
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
                              ? 'text-primary-foreground/75'
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

              <div className="mt-auto hidden border-t-[2.5px] border-foreground/20 p-3 sm:block">
                <StickerBtn
                  className="h-9 w-full border-dashed bg-transparent text-muted-foreground shadow-none hover:border-foreground/50 hover:text-foreground"
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
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 items-start justify-between gap-3 border-b-[2.5px] border-foreground/20 px-5 py-4 pr-14 sm:pr-14">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <ActiveIcon
                      className="size-4 text-primary"
                      strokeWidth={2.5}
                    />
                    <h3 className="text-base font-black tracking-tight">
                      {activeNav.label}
                    </h3>
                  </div>
                  <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                    {section === 'audio' &&
                      'Master & SFX levels — mute without losing values.'}
                    {section === 'mouse' &&
                      'Hipfire / ADS sensitivity and look invert.'}
                    {section === 'keybinds' &&
                      'Multiple keys per action. Esc cancels capture.'}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => {
                    gameAudio.uiClick()
                    close()
                  }}
                  className="absolute top-3.5 right-3.5 hidden size-9 items-center justify-center rounded-xl border-[2.5px] border-foreground/80 bg-muted/40 text-foreground shadow-[2px_2px_0_oklch(0.2_0.03_260/_0.35)] transition-all hover:-translate-y-0.5 hover:bg-muted active:translate-y-0.5 active:shadow-[1px_1px_0_oklch(0.2_0.03_260/_0.35)] sm:inline-flex"
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
                          checked={muted}
                          onCheckedChange={(v) => {
                            setMuted(v)
                            gameAudio.uiClick()
                          }}
                        />
                      </div>
                    </SettingRow>

                    <div className="h-[2.5px] rounded-full bg-foreground/15" />

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

                    <div className="h-[2.5px] rounded-full bg-foreground/15" />

                    <SettingRow
                      label="Invert Y-axis"
                      description="Mouse up looks down"
                    >
                      <StickerSwitch
                        checked={invertY}
                        onCheckedChange={(v) => {
                          setInvertY(v)
                          gameAudio.uiClick()
                        }}
                      />
                    </SettingRow>
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
                                'border-primary/60 bg-primary/10 shadow-[2px_2px_0_oklch(0.2_0.03_260/_0.2)]',
                            )}
                          >
                            <span className="shrink-0 text-sm font-extrabold tracking-wide">
                              {ACTION_LABELS[action]}
                            </span>
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              {codes.map((code) => (
                                <span
                                  key={code}
                                  className="inline-flex items-center gap-0.5 rounded-lg border-[2px] border-foreground/70 bg-muted/60 font-mono text-xs font-bold shadow-[1px_1px_0_oklch(0.2_0.03_260/_0.2)]"
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
                                    ? 'animate-pulse border-foreground/90 bg-primary text-primary-foreground shadow-[2px_2px_0_oklch(0.2_0.03_260/_0.4)]'
                                    : 'border-dashed border-foreground/50 text-muted-foreground hover:border-foreground/80 hover:bg-muted hover:text-foreground disabled:opacity-40',
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
              <div className="shrink-0 border-t-[2.5px] border-foreground/20 p-3 sm:hidden">
                <StickerBtn
                  className="h-9 w-full border-dashed bg-transparent text-muted-foreground shadow-none"
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
