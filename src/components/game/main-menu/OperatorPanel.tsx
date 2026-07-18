import { useState } from 'react'
import { motion } from 'framer-motion'

import { CharacterPreview } from '@/components/game/CharacterPreview'
import type { SettingsSection } from '@/components/SettingsDialog'
import type { CharacterAppearance } from '@/game/character/appearance'
import { gameAudio } from '@/game/audio'
import { icons } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { COMMUNITY_LINKS } from './constants'
import { GameIcon, HudPanel } from './ui'

export function OperatorPanel({
  username,
  setUsername,
  characterAppearance,
  onOpenCharacterSettings,
}: {
  username: string
  setUsername: (name: string) => void
  characterAppearance: CharacterAppearance
  onOpenCharacterSettings: (section: SettingsSection) => void
}) {
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(username)
  const displayName = username.trim() || 'Operator'

  const commitName = () => {
    setUsername(nameDraft.trim())
    setEditingName(false)
    gameAudio.uiClick()
  }

  return (
    <motion.aside
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, duration: 0.28 }}
      className="flex min-h-0 flex-col gap-2.5 overflow-hidden max-lg:min-h-[22rem] lg:col-start-4 lg:row-span-2 lg:row-start-1"
    >
      <HudPanel
        className="flex min-h-0 flex-1 flex-col overflow-hidden p-2.5 sm:p-3"
        accent="none"
      >
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <GameIcon src={icons.cap} className="size-4" />
            <span className="text-xs font-extrabold tracking-wide text-arena-fg/45 uppercase">
              Operator
            </span>
          </div>
          <span className="truncate text-sm font-extrabold text-arena-tech">
            {displayName}
          </span>
        </div>

        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            maxLength={24}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') {
                setNameDraft(username)
                setEditingName(false)
              }
            }}
            onBlur={commitName}
            placeholder="Enter name"
            className="mb-2 h-9 w-full shrink-0 rounded-xl border-[2.5px] border-arena-tech/50 bg-arena-surface px-3 text-base font-bold text-arena-fg outline-none placeholder:text-arena-fg/35 focus:border-arena-tech"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              gameAudio.uiClick()
              setNameDraft(username)
              setEditingName(true)
            }}
            className="mb-2 flex h-9 w-full shrink-0 items-center justify-between rounded-xl border-[2.5px] border-arena-ink bg-arena-surface px-3 text-left text-base transition-colors hover:bg-arena-hover"
          >
            <span
              className={cn(
                'truncate font-extrabold',
                username.trim() ? 'text-arena-fg' : 'text-arena-fg/40',
              )}
            >
              {username.trim() || 'Set your name'}
            </span>
            <GameIcon
              src={icons.pencil}
              className="size-4 shrink-0 opacity-80"
            />
          </button>
        )}

        {/* Walking man — fills leftover column height */}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border-[2.5px] border-arena-ink bg-gradient-to-b from-arena-surface/40 via-arena-surface to-arena-surface-strong">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-1.5 pt-2">
            <GameIcon src={icons.speed} className="size-3.5 opacity-80" />
            <span className="text-[11px] font-extrabold tracking-wide text-arena-fg/40 uppercase">
              Live preview
            </span>
          </div>
          <CharacterPreview
            appearance={characterAppearance}
            animation="walk"
            spin={false}
            className="absolute inset-0 h-full w-full"
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-arena-panel to-transparent"
            aria-hidden
          />
          <button
            type="button"
            title="Customize character"
            aria-label="Customize character colors"
            onClick={() => {
              gameAudio.uiClick()
              onOpenCharacterSettings('character')
            }}
            className={cn(
              'absolute bottom-2.5 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-xl border-[2.5px] border-arena-ink bg-arena-panel px-3 py-1.5 text-sm font-extrabold tracking-wide text-arena-fg uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all',
              'hover:-translate-y-0.5 hover:bg-arena-hover active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]',
            )}
          >
            <GameIcon src={icons.brush} className="size-3.5" />
            Customize
          </button>
        </div>
      </HudPanel>

      <HudPanel
        className="hidden shrink-0 px-3 py-2 min-[700px]:block"
        accent="none"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold tracking-wide text-arena-fg/45 uppercase">
            <GameIcon src={icons.friend} className="size-3.5" />
            Community
          </span>
          <div className="flex items-center gap-1.5">
            {COMMUNITY_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                aria-label={link.label}
                onClick={() => gameAudio.uiClick()}
                className={cn(
                  'inline-flex size-7 items-center justify-center rounded-lg border-[2.5px] border-arena-ink shadow-[2px_2px_0_var(--arena-ink)] transition-transform hover:-translate-y-0.5 hover:scale-105',
                  link.className,
                )}
              >
                <link.icon className="size-3" />
              </a>
            ))}
          </div>
        </div>
      </HudPanel>
    </motion.aside>
  )
}
