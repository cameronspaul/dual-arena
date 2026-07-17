import { Link } from 'react-router-dom'
import { useAppStore } from '../stores/useAppStore'
import { Crosshair, Moon, Sun, Target } from 'lucide-react'
import { Button } from '../components/ui/button'
import { motion } from 'framer-motion'

function Home() {
  const { theme, toggleTheme } = useAppStore()

  return (
    <div className="relative min-h-svh overflow-hidden bg-background text-foreground">
      {/* Atmosphere */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_oklch(0.35_0.08_250/_0.35),_transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_oklch(0.4_0.12_40/_0.2),_transparent_50%)]" />

      <div className="absolute top-4 left-4 z-10">
        <motion.button
          onClick={() => toggleTheme()}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
          aria-label="Toggle theme"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          {theme === 'light' ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
          <span className="font-medium">
            {theme === 'light' ? 'Dark' : 'Light'}
          </span>
        </motion.button>
      </div>

      <div className="relative mx-auto flex min-h-svh max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >
          <Crosshair className="h-3.5 w-3.5" />
          Sniper 1v1 · Browser
        </motion.div>

        <motion.h1
          className="text-5xl font-bold tracking-tight sm:text-6xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.5 }}
        >
          Dual Arena
        </motion.h1>

        <motion.p
          className="mt-4 max-w-lg text-lg text-muted-foreground"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16, duration: 0.5 }}
        >
          One shot. One stake. Prove it. Fast 1v1 sniper duels with
          movement-first gunplay — offline range live now.
        </motion.p>

        <motion.div
          className="mt-10 flex flex-col items-center gap-3 sm:flex-row"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24, duration: 0.5 }}
        >
          <Button asChild size="lg" className="min-w-48 gap-2 text-base">
            <Link to="/play">
              <Target className="h-5 w-5" />
              Enter Range
            </Link>
          </Button>
        </motion.div>

        <motion.div
          className="mt-14 grid w-full max-w-xl gap-3 text-left sm:grid-cols-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          {[
            {
              title: 'Slide-hop',
              body: 'Sprint + crouch to slide, jump to chain speed.',
            },
            {
              title: 'Hitscan bolt',
              body: 'Headshots delete. Body shots punish. Bolt between rounds.',
            },
            {
              title: 'Wagers later',
              body: 'Soft currency escrow planned — virtual stakes first.',
            },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded-xl border border-border bg-card/60 p-4"
            >
              <div className="text-sm font-semibold">{card.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {card.body}
              </p>
            </div>
          ))}
        </motion.div>

        <p className="mt-10 text-xs text-muted-foreground/70">
          Sniper viewmodel © DJMaesen (CC BY 4.0) · See public/models/CREDITS.md
        </p>
      </div>
    </div>
  )
}

export default Home
