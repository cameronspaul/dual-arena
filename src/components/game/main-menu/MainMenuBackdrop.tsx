import { AnimatePresence, motion } from 'framer-motion'

export function MainMenuBackdrop({ backdropUrl }: { backdropUrl: string }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      <AnimatePresence mode="sync" initial={false}>
        <motion.img
          key={backdropUrl}
          src={backdropUrl}
          alt=""
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1.16 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-[6px] saturate-[1.05] brightness-[0.85] dark:brightness-[0.7]"
          draggable={false}
        />
      </AnimatePresence>
      {/* Theme-aware scrims so sticker panels stay readable */}
      <div className="absolute inset-0 bg-arena-scrim" />
      <div className="absolute inset-0 bg-gradient-to-t from-arena-void via-arena-void/60 to-arena-void/20" />
      <div className="absolute inset-0 bg-gradient-to-r from-arena-void/75 via-transparent to-arena-void/70" />
      <div className="absolute inset-0 bg-arena-vignette [mask-image:radial-gradient(ellipse_at_center,transparent_20%,black_100%)] [-webkit-mask-image:radial-gradient(ellipse_at_center,transparent_20%,black_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,_oklch(0.55_0.16_55/_0.12),_transparent_45%)]" />
    </div>
  )
}
