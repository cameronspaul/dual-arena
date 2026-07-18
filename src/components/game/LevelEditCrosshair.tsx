/** Crosshair while level editing (spawn aim). */
export function LevelEditCrosshair() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <div className="relative h-5 w-5">
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/70" />
        <div className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-white/70" />
      </div>
    </div>
  )
}
