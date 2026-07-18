/**
 * In-match text + voice controls (online only).
 * Voice mode (PTT / open mic / off) and bind come from user settings.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameEngine } from '@/game/engine/GameEngine'
import type { ChatLine } from '@/game/engine/GameEngine'
import type { VoicePeerStatus } from '@/game/net'
import { CHAT_MAX_LEN } from '@duel/shared'
import {
  codesFor,
  formatKeyCode,
  type VoiceMode,
} from '@/game/core/userSettings'
import { icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { gameAudio } from '@/game/audio'
import { useSettingsStore } from '@/stores/useSettingsStore'

type VoiceUi = {
  status: VoicePeerStatus
  talking: boolean
  micReady: boolean
  speakerEnabled: boolean
  remoteSpeaking: boolean
}

interface InGameChatProps {
  engine: GameEngine
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
}

function shortId(id: string) {
  if (id.length <= 8) return id
  return id.slice(0, 6)
}

function pttLabel(codes: string[]): string {
  if (codes.length === 0) return 'Speak'
  return codes.map(formatKeyCode).join(' / ')
}

function voiceStatusLabel(
  v: VoiceUi,
  mode: VoiceMode,
  codes: string[],
): string {
  if (mode === 'off') return 'Voice off · no send, no hear'
  if (v.talking) {
    return mode === 'open_mic' ? 'Open mic · transmitting' : 'Transmitting…'
  }
  if (v.remoteSpeaking) return 'Opponent speaking'
  if (mode === 'open_mic') {
    if (v.status === 'failed') return 'Voice failed — allow mic in browser'
    if (v.status === 'connecting') return 'Linking voice…'
    return 'Open mic · connecting…'
  }
  const bind = pttLabel(codes)
  if (v.status === 'connected') return `Voice ready · hold ${bind} / Speak`
  if (v.status === 'connecting') return 'Linking voice…'
  if (v.status === 'need_permission') return 'Allow mic when prompted'
  if (v.status === 'failed') return 'Voice failed — click Speak to retry'
  if (v.status === 'closed') return 'Voice off'
  return `Hold Speak or ${bind} to talk`
}

export function InGameChat({
  engine,
  open,
  onOpenChange,
  className,
}: InGameChatProps) {
  const [lines, setLines] = useState<ChatLine[]>([])
  const [draft, setDraft] = useState('')
  const [voice, setVoice] = useState<VoiceUi>({
    status: 'idle',
    talking: false,
    micReady: false,
    speakerEnabled: true,
    remoteSpeaking: false,
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const pttHeld = useRef(false)

  const voiceMode = useSettingsStore((s) => s.voiceMode)
  const voiceVolume = useSettingsStore((s) => s.voiceVolume)
  const muted = useSettingsStore((s) => s.muted)
  const keybinds = useSettingsStore((s) => s.keybinds)

  const voiceCodes = useMemo(() => codesFor('voice', keybinds), [keybinds])

  useEffect(() => {
    const offChat = engine.onChat(setLines)
    const offVoice = engine.onVoiceUi(setVoice)
    return () => {
      offChat()
      offVoice()
    }
  }, [engine])

  // Voice volume, mode, and global mute all apply live mid-match
  useEffect(() => {
    engine.setVoiceVolume(voiceVolume)
    engine.syncVoiceFromUserSettings()
  }, [engine, voiceVolume, voiceMode, muted])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lines, open])

  useEffect(() => {
    if (!open) {
      setDraft('')
      return
    }
    const id = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 50)
    return () => window.clearTimeout(id)
  }, [open])

  const setTalking = useCallback(
    async (on: boolean) => {
      if (on === pttHeld.current) {
        // Re-assert open-mic / retry permission when we already "want" on
        if (on) await engine.setVoiceTalking(true)
        return
      }
      pttHeld.current = on
      await engine.setVoiceTalking(on)
    },
    [engine],
  )

  // Apply voice mode: off / open mic / PTT
  useEffect(() => {
    if (voiceMode === 'open_mic') {
      void setTalking(true)
      return
    }
    // off or push_to_talk: stop continuous transmit (PTT holds re-enable later)
    void setTalking(false)
  }, [voiceMode, setTalking])

  // If open mic and connection recovers / peer ready, re-assert transmit
  useEffect(() => {
    if (voiceMode !== 'open_mic') return
    if (voice.status === 'failed' || voice.status === 'closed') return
    if (!voice.talking) void setTalking(true)
  }, [voiceMode, voice.status, voice.talking, setTalking])

  // Release PTT if tab blurs or component unmounts (only for PTT mode)
  useEffect(() => {
    const stop = () => {
      if (voiceMode === 'push_to_talk' && pttHeld.current) {
        void setTalking(false)
      }
    }
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('blur', stop)
      if (voiceMode === 'push_to_talk') stop()
    }
  }, [setTalking, voiceMode])

  // Hold bound voice key(s) when chat composer is closed (PTT only)
  useEffect(() => {
    if (voiceMode !== 'push_to_talk') return

    const codeSet = new Set(voiceCodes)
    const isTypingTarget = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false
      const tag = t.tagName
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        t.isContentEditable
      )
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (!codeSet.has(e.code) || e.repeat || e.ctrlKey || e.metaKey || e.altKey) {
        return
      }
      if (open || isTypingTarget(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      void setTalking(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (!codeSet.has(e.code)) return
      if (pttHeld.current) {
        e.preventDefault()
        e.stopPropagation()
        void setTalking(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [open, setTalking, voiceMode, voiceCodes])

  const send = () => {
    const text = draft.trim()
    if (!text) return
    engine.sendChat(text)
    setDraft('')
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }

  const micOff = voiceMode === 'off'
  const openMic = voiceMode === 'open_mic'
  const bindHint = pttLabel(voiceCodes)

  return (
    <div
      className={cn(
        'pointer-events-none flex w-[min(24rem,90vw)] flex-col gap-1.5',
        className,
      )}
    >
      {/* Message log */}
      <div
        ref={listRef}
        className={cn(
          'max-h-36 overflow-y-auto rounded-xl border-[2.5px] border-arena-ink/80 bg-black/70 px-2.5 py-1.5 shadow-[2px_3px_0_rgba(0,0,0,0.45)]',
          lines.length === 0 && !open && 'hidden',
        )}
        aria-live="polite"
      >
        {lines.length === 0 && open && (
          <div className="py-1 text-[10px] font-bold text-white/45">
            Say something to your opponent…
          </div>
        )}
        {lines.map((line) => (
          <div
            key={line.id}
            className="text-[11px] leading-snug font-semibold text-white/90 drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]"
          >
            <span
              className={cn(
                'mr-1 font-extrabold',
                line.self ? 'text-sky-300' : 'text-arena-heat',
              )}
            >
              {line.self ? 'You' : shortId(line.fromId)}:
            </span>
            <span className="break-words">{line.text}</span>
          </div>
        ))}
      </div>

      {/* Composer + voice */}
      <div className="pointer-events-auto flex flex-wrap items-end gap-1.5">
        {open ? (
          <form
            className="flex min-w-0 flex-1 basis-[10rem] items-center gap-1 rounded-xl border-[3px] border-arena-ink bg-arena-panel px-2 py-1.5 shadow-[2px_3px_0_var(--arena-ink)]"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <input
              ref={inputRef}
              value={draft}
              maxLength={CHAT_MAX_LEN}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.code === 'Escape') {
                  e.preventDefault()
                  onOpenChange(false)
                }
              }}
              placeholder="Message… (Esc close)"
              className="min-w-0 flex-1 bg-transparent text-xs font-bold text-arena-fg outline-none placeholder:text-arena-fg/40"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg border-[2px] border-arena-ink bg-arena-heat px-2 py-1 text-[10px] font-extrabold tracking-wide text-arena-ink uppercase hover:brightness-110"
            >
              Send
            </button>
          </form>
        ) : (
          <button
            type="button"
            title="Open chat (Enter / Y)"
            onClick={() => {
              gameAudio.uiClick()
              onOpenChange(true)
            }}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl border-[3px] border-arena-ink bg-arena-panel px-2.5 text-[11px] font-extrabold tracking-wide text-arena-fg uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-arena-hover active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]"
          >
            <img
              src={icons.friend}
              alt=""
              className="size-4 object-contain"
              draggable={false}
            />
            Chat
          </button>
        )}

        {/* Mic control — PTT hold, open-mic status, or disabled when off */}
        {micOff ? (
          <button
            type="button"
            title="Voice fully off — change in Settings → Audio"
            disabled
            className="inline-flex h-11 min-w-[5.5rem] select-none items-center justify-center gap-1.5 rounded-xl border-[3px] border-arena-ink bg-arena-panel px-3 text-[11px] font-black tracking-wide text-arena-fg/50 uppercase opacity-70 shadow-[2px_3px_0_var(--arena-ink)]"
          >
            <img
              src={icons.shocked}
              alt=""
              className="size-4 object-contain opacity-50"
              draggable={false}
            />
            Off
          </button>
        ) : openMic ? (
          <button
            type="button"
            title="Open mic (Settings → Audio)"
            onClick={() => {
              gameAudio.uiClick()
              // Retry permission / re-assert open mic
              void setTalking(true)
            }}
            className={cn(
              'inline-flex h-11 min-w-[5.5rem] select-none items-center justify-center gap-1.5 rounded-xl border-[3px] border-arena-ink px-3 text-[11px] font-black tracking-wide uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]',
              voice.talking
                ? 'bg-arena-ok text-arena-ink ring-2 ring-arena-ok/80'
                : 'bg-arena-heat text-arena-ink hover:brightness-110',
            )}
          >
            <img
              src={icons.shocked}
              alt=""
              className="size-4 object-contain"
              draggable={false}
            />
            {voice.talking ? 'Live' : 'Mic'}
          </button>
        ) : (
          <button
            type="button"
            title={`Hold to talk (or hold ${bindHint})`}
            onPointerDown={(e) => {
              e.preventDefault()
              ;(e.currentTarget as HTMLButtonElement).setPointerCapture(
                e.pointerId,
              )
              void setTalking(true)
            }}
            onPointerUp={() => void setTalking(false)}
            onPointerCancel={() => void setTalking(false)}
            onPointerLeave={() => {
              if (pttHeld.current) void setTalking(false)
            }}
            className={cn(
              'inline-flex h-11 min-w-[5.5rem] select-none items-center justify-center gap-1.5 rounded-xl border-[3px] border-arena-ink px-3 text-[11px] font-black tracking-wide uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]',
              voice.talking
                ? 'bg-arena-ok text-arena-ink ring-2 ring-arena-ok/80'
                : 'bg-arena-heat text-arena-ink hover:-translate-y-0.5 hover:brightness-110',
            )}
          >
            <img
              src={icons.shocked}
              alt=""
              className="size-4 object-contain"
              draggable={false}
            />
            {voice.talking ? 'Live' : 'Speak'}
          </button>
        )}

        <button
          type="button"
          title={
            micOff
              ? 'Voice fully off — change in Settings → Audio'
              : voice.speakerEnabled
                ? 'Mute opponent voice'
                : 'Unmute opponent'
          }
          disabled={micOff}
          onClick={() => {
            if (micOff) return
            gameAudio.uiClick()
            engine.setVoiceSpeakerEnabled(!voice.speakerEnabled)
          }}
          className={cn(
            'inline-flex size-11 items-center justify-center rounded-xl border-[3px] border-arena-ink text-[10px] font-black shadow-[2px_3px_0_var(--arena-ink)] transition-all',
            micOff
              ? 'cursor-not-allowed bg-arena-panel text-arena-fg/40 opacity-70'
              : 'hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]',
            !micOff && !voice.speakerEnabled
              ? 'bg-arena-danger/90 text-white'
              : !micOff && voice.remoteSpeaking
                ? 'bg-arena-tech text-arena-ink'
                : !micOff
                  ? 'bg-arena-panel text-arena-fg/80'
                  : null,
          )}
        >
          {micOff
            ? 'OFF'
            : voice.speakerEnabled
              ? voice.remoteSpeaking
                ? '•••'
                : 'EAR'
              : 'OFF'}
        </button>
      </div>

      <div className="pointer-events-none px-0.5 text-[9px] font-bold tracking-wide text-white/55 uppercase drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
        {voiceStatusLabel(voice, voiceMode, voiceCodes)}
        {!open && ' · Enter chat'}
      </div>
    </div>
  )
}
