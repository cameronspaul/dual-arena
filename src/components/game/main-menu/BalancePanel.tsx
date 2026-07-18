import { motion } from 'framer-motion'
import { SiSolana } from 'react-icons/si'

import { gameAudio } from '@/game/audio'

import { HudPanel } from './ui'

export function BalancePanel({ balance }: { balance: number }) {
  const solBalanceLabel = balance.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className="min-h-0 lg:col-start-1 lg:row-start-1"
    >
      <HudPanel className="flex h-full flex-col p-3 sm:p-3.5" accent="heat">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5">
            <SiSolana className="size-3.5 text-[#9945FF]" aria-hidden />
            <h2 className="text-xs font-extrabold tracking-wide text-arena-fg/55 uppercase">
              Balance
            </h2>
          </div>
          <span className="rounded-md border-[2px] border-arena-ink bg-arena-surface px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-[#14F195]/80 uppercase">
            Solana
          </span>
        </div>

        <div className="mt-3 flex min-h-0 flex-1 flex-col items-center justify-center text-center">
          <div className="mb-2 flex size-11 items-center justify-center rounded-xl border-[3px] border-arena-ink bg-gradient-to-br from-[#9945FF]/35 to-[#14F195]/25 shadow-[2px_3px_0_var(--arena-ink)]">
            <SiSolana className="size-5 text-arena-fg" aria-hidden />
          </div>
          <div className="flex items-baseline justify-center gap-1">
            <span className="text-3xl font-black tabular-nums tracking-tight text-arena-heat drop-shadow-[0_2px_0_var(--arena-ink)] sm:text-4xl">
              {solBalanceLabel}
            </span>
            <span className="text-sm font-extrabold text-arena-fg/45">SOL</span>
          </div>
          <p className="mt-1 text-xs font-semibold text-arena-fg/40">
            Wallet not connected
          </p>
        </div>

        <button
          type="button"
          onClick={() => gameAudio.uiClick()}
          className="mt-3 inline-flex h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl border-[3px] border-arena-ink bg-arena-heat px-2 text-sm font-black tracking-wide text-arena-ink uppercase shadow-[2px_3px_0_var(--arena-ink)] transition-all hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--arena-ink)]"
          title="Connect Solana wallet — coming soon"
        >
          <SiSolana className="size-3.5" aria-hidden />
          Connect
        </button>
      </HudPanel>
    </motion.div>
  )
}
