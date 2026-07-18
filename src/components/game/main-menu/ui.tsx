import type { ReactNode } from 'react'

import { icons } from '@/lib/icons'
import { cn } from '@/lib/utils'
import type { MapId } from '@/game/maps'

/** Cartoon PNG from /public/icons — thick outline sticker set (matches HUD). */
export function GameIcon({
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

/**
 * Cartoon sticker panel — thick ink border, hard drop shadow, chunky radius.
 * Same language as GameHud HudPanel.
 */
export function HudPanel({
  children,
  className,
  accent = 'none',
}: {
  children: ReactNode
  className?: string
  accent?: 'heat' | 'tech' | 'danger' | 'ok' | 'none'
}) {
  return (
    <div
      className={cn(
        'relative rounded-2xl border-[3px] border-arena-ink bg-arena-panel shadow-[3px_4px_0_var(--arena-ink)]',
        accent === 'heat' && 'ring-2 ring-arena-heat/50',
        accent === 'tech' && 'ring-2 ring-arena-tech/50',
        accent === 'danger' && 'ring-2 ring-arena-danger/55',
        accent === 'ok' && 'ring-2 ring-arena-ok/50',
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-x-3 top-0 h-2 rounded-b-full bg-arena-sheen" />
      {children}
    </div>
  )
}

export function ChromeBtn({
  children,
  onClick,
  title,
  className,
}: {
  children: ReactNode
  onClick?: () => void
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex size-10 items-center justify-center rounded-xl border-[3px] border-arena-ink bg-arena-panel text-arena-fg shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:bg-arena-hover hover:shadow-[2px_4px_0_var(--arena-ink)] active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Chip({
  active,
  children,
  onClick,
  className,
  title,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
  className?: string
  title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-1 rounded-xl border-[2.5px] border-arena-ink px-2.5 text-sm font-extrabold transition-all',
        active
          ? 'bg-arena-heat text-arena-ink shadow-[2px_3px_0_var(--arena-ink)]'
          : 'bg-arena-surface text-arena-fg/70 shadow-[1px_2px_0_var(--arena-ink)] hover:-translate-y-0.5 hover:bg-arena-hover hover:text-arena-fg',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function MapThumb({
  mapId,
  thumbUrl,
  name,
  active,
}: {
  mapId: MapId
  thumbUrl?: string
  name: string
  active: boolean
}) {
  if (!thumbUrl) {
    return (
      <div
        className={cn(
          'absolute inset-0 bg-gradient-to-br from-slate-600 via-slate-700 to-slate-900',
          active && 'from-amber-700/80 via-slate-700 to-slate-900',
        )}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <GameIcon src={icons.aim} className="size-10 opacity-30" />
        </div>
        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
            backgroundSize: '14px 14px',
          }}
        />
        <span className="sr-only">{name}</span>
      </div>
    )
  }

  return (
    <img
      src={thumbUrl}
      alt={name}
      loading="lazy"
      className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
      data-map={mapId}
    />
  )
}

export function SectionLabel({
  iconSrc,
  children,
}: {
  iconSrc: string
  children: ReactNode
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <GameIcon src={iconSrc} className="size-3.5" />
      <span className="text-xs font-extrabold tracking-wide text-arena-fg/45 uppercase">
        {children}
      </span>
    </div>
  )
}
