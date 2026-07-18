import { SKYBOX_LABELS, type SkyboxId } from '@/game/scene/skyboxes'
import { icons } from '@/lib/icons'

export type MapSessionBadgeProps = {
  mapName: string
  skybox: SkyboxId
  isOnline: boolean
}

/** Top-left map · sky · online chip during play. */
export function MapSessionBadge({
  mapName,
  skybox,
  isOnline,
}: MapSessionBadgeProps) {
  return (
    <div className="pointer-events-none absolute top-3 left-3 z-30 flex max-w-[min(50vw,22rem)] flex-col items-start gap-1.5">
      <div className="flex max-w-full items-center gap-1.5 rounded-xl border-[3px] border-arena-ink bg-arena-panel px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-arena-fg shadow-[2px_3px_0_var(--arena-ink)]">
        <img
          src={icons.map}
          alt=""
          aria-hidden
          className="size-3.5 shrink-0 object-contain drop-shadow-[0_1px_0_rgba(0,0,0,0.4)]"
        />
        <span className="truncate text-arena-heat">{mapName}</span>
        <span className="text-arena-fg/30">·</span>
        <span className="truncate text-arena-tech">{SKYBOX_LABELS[skybox]}</span>
        {isOnline && (
          <>
            <span className="text-arena-fg/30">·</span>
            <span className="inline-flex shrink-0 items-center gap-1 text-arena-ok">
              <img
                src={icons.globe}
                alt=""
                aria-hidden
                className="size-3 object-contain"
              />
              Online
            </span>
          </>
        )}
      </div>
    </div>
  )
}
