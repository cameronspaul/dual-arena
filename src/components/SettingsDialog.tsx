import { useCallback, useEffect, useState } from 'react'
import {
  Keyboard,
  Mouse,
  Plus,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { gameAudio } from '@/game/audio'
import {
  ACTION_LABELS,
  ACTION_ORDER,
  formatKeyCode,
  MAX_BINDS_PER_ACTION,
  mouseButtonCode,
  type ActionId,
} from '@/game/core/userSettings'
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

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
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

  useEffect(() => {
    if (!open) setListening(null)
  }, [open])

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

  const nav: { id: Section; label: string; icon: typeof Volume2 }[] = [
    { id: 'audio', label: 'Audio', icon: Volume2 },
    { id: 'mouse', label: 'Mouse', icon: Mouse },
    { id: 'keybinds', label: 'Keybinds', icon: Keyboard },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(90svh,720px)] w-full max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
        onPointerDownOutside={(e) => {
          // Don't close while capturing a keybind
          if (listening) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (listening) {
            e.preventDefault()
            cancelListen()
          }
        }}
      >
        <DialogHeader className="relative shrink-0 space-y-1 border-b border-border px-5 py-4 pr-12 text-left">
          <div className="absolute top-0 left-0 h-full w-0.5 bg-primary" />
          <DialogTitle className="tracking-tight">Settings</DialogTitle>
          <DialogDescription>
            Volume, mouse, and keybinds — saved in this browser.
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-border px-4 py-3">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setSection(id)
                cancelListen()
                gameAudio.uiClick()
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold tracking-wide transition-colors',
                section === id
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/30 hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
          <div className="ml-auto">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                resetAll()
                cancelListen()
                gameAudio.uiClick()
              }}
            >
              <RotateCcw className="size-3.5" />
              Reset all
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {section === 'audio' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="mute">Mute all</Label>
                  <p className="text-xs text-muted-foreground">
                    Silence SFX without losing your levels
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {muted ? (
                    <VolumeX className="size-4 text-muted-foreground" />
                  ) : (
                    <Volume2 className="size-4 text-muted-foreground" />
                  )}
                  <Switch
                    id="mute"
                    checked={muted}
                    onCheckedChange={(v) => {
                      setMuted(v)
                      gameAudio.uiClick()
                    }}
                  />
                </div>
              </div>
              <Separator />
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
            <div className="space-y-6">
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
              <Separator />
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="invert-y">Invert Y-axis</Label>
                  <p className="text-xs text-muted-foreground">
                    Mouse up looks down
                  </p>
                </div>
                <Switch
                  id="invert-y"
                  checked={invertY}
                  onCheckedChange={(v) => {
                    setInvertY(v)
                    gameAudio.uiClick()
                  }}
                />
              </div>
            </div>
          )}

          {section === 'keybinds' && (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Multiple keys per action. Click <strong>+</strong> then press a
                  key or mouse button. Esc cancels. Click × to remove (keeps at
                  least one).
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    resetKeybinds()
                    cancelListen()
                    gameAudio.uiClick()
                  }}
                    >
                  <RotateCcw className="size-3.5" />
                  Defaults
                </Button>
              </div>

              <div className="space-y-1">
                {ACTION_ORDER.map((action) => {
                  const codes = keybinds[action] ?? []
                  const active = listening === action
                  const canAdd = codes.length < MAX_BINDS_PER_ACTION
                  return (
                    <div
                      key={action}
                      className={cn(
                        'flex flex-col gap-2 rounded-lg border border-transparent px-2 py-2 sm:flex-row sm:items-center sm:justify-between',
                        active && 'border-primary/40 bg-primary/5',
                      )}
                    >
                      <span className="shrink-0 text-sm font-medium">
                        {ACTION_LABELS[action]}
                      </span>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {codes.map((code) => (
                          <span
                            key={code}
                            className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/60 font-mono text-xs font-semibold"
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
                                className="rounded-r-md px-1 py-1 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                              >
                                <X className="size-3" />
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
                            'inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors',
                            active
                              ? 'border-primary bg-primary text-primary-foreground animate-pulse'
                              : 'border-dashed border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40',
                          )}
                        >
                          {active ? (
                            'Press…'
                          ) : (
                            <>
                              <Plus className="size-3.5" />
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
      </DialogContent>
    </Dialog>
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
    <div className={cn('space-y-3', disabled && 'opacity-50')}>
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {valueLabel}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => {
          const n = Array.isArray(v) ? v[0] : v
          if (typeof n === 'number') onChange(n)
        }}
        onValueCommit={onCommit ? () => onCommit() : undefined}
      />
    </div>
  )
}
