import { Moon, Sun } from 'lucide-react'

import { gameAudio } from '@/game/audio'
import { icons } from '@/lib/icons'

import { ChromeBtn, GameIcon } from './ui'

export function MainMenuHeader({
  theme,
  toggleTheme,
  canRejoin,
  rejoinLeft,
  rejoinMatchId,
  onRejoin,
  onOpenSettings,
}: {
  theme: string
  toggleTheme: () => void
  canRejoin: boolean
  rejoinLeft: number
  rejoinMatchId?: string
  onRejoin: () => void
  onOpenSettings: () => void
}) {
  return (
    <header className="relative z-20 flex shrink-0 items-center justify-between gap-2 px-3 pt-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <GameIcon src={icons.aim} className="size-7 sm:size-8" />
        <h1 className="truncate text-2xl font-black tracking-tight text-arena-fg drop-shadow-[0_2px_0_var(--arena-ink)] sm:text-3xl">
          Glint
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canRejoin && (
          <button
            type="button"
            onClick={onRejoin}
            className="inline-flex h-9 items-center gap-2 rounded-xl border-[3px] border-arena-ink bg-arena-heat px-3 text-sm font-black tracking-wide text-arena-ink uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]"
            title={`Rejoin ${rejoinMatchId ?? 'match'} — ${rejoinLeft}s left`}
          >
            <GameIcon src={icons.reberth} className="size-4" />
            Rejoin match
            <span className="rounded-md border-[2px] border-arena-ink/60 bg-arena-ink/10 px-1.5 py-0.5 font-mono text-xs tabular-nums">
              {Math.floor(rejoinLeft / 60)}:
              {(rejoinLeft % 60).toString().padStart(2, '0')}
            </span>
          </button>
        )}
        <ChromeBtn
          onClick={() => {
            gameAudio.uiClick()
            toggleTheme()
          }}
          title={theme === 'light' ? 'Dark mode' : 'Light mode'}
        >
          {theme === 'light' ? (
            <Moon className="size-4 text-arena-heat" />
          ) : (
            <Sun className="size-4 text-arena-heat" />
          )}
        </ChromeBtn>
        <ChromeBtn
          onClick={() => {
            gameAudio.uiClick()
            onOpenSettings()
          }}
          title="Settings"
        >
          <GameIcon src={icons.settings} className="size-5" />
        </ChromeBtn>
      </div>
    </header>
  )
}
